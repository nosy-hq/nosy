// Contract tests for skill/tools/find-sources.mjs: reads a repo ONLY and produces a sources.json suggestion.
// Runs against the fake product "Cargo" (K.repo, DECISIONS.md, BACKEND-NEEDS.md come ready-made); no network/gh
// needed (the only gh call in the code is for issue.our, and it's silently skipped if ghTry fails).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, output;

before(async () => {
  K = await fakeProductSetup();
  const jsonPath = path.join(temporary("nosy-findsources-"), "suggestion.json");
  const r = run(path.join(Tool, "find-sources.mjs"), [K.repo, "--pm", K.pm, "--json", jsonPath]);
  assert.equal(r.code, 0, `find-sources returned an unexpected exit code: ${r.error}`);
  output = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => clean(K.root));

test("ref and preread.decisions (DECISIONS.md) are found correctly", () => {
  assert.equal(output.json.ref, "origin/main");
  assert.equal(output.json.suggestion.preread.decisions, "DECISIONS.md");
});

test("request.path and request.title find BACKEND-NEEDS.md and the '### <no>. <name>' pattern", () => {
  assert.equal(output.json.suggestion.request.path, "BACKEND-NEEDS.md");
  assert.match(output.json.suggestion.request.title, /###/);
});

test("refs includes the K/§/# patterns (common in DECISIONS/BACKEND-NEEDS/commit titles)", () => {
  const refs = output.json.suggestion.refs.join(" ");
  assert.match(refs, /K\\d\{2,3\}/, `refs should include the K pattern: ${refs}`);
  assert.match(refs, /§\\d\+/, `refs should include the § pattern: ${refs}`);
  assert.match(refs, /#\\d\+/, `refs should include the # pattern: ${refs}`);
});

test("without --write, sources.json is left untouched", () => {
  const alreadyExists = fs.existsSync(K.sources);
  assert.ok(alreadyExists, "the fake product should already have a sources.json");
  const contentBefore = fs.readFileSync(K.sources, "utf8");
  const r = run(path.join(Tool, "find-sources.mjs"), [K.repo, "--pm", K.pm]);
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(K.sources, "utf8"), contentBefore, "--write wasn't given, sources.json shouldn't change");
  assert.match(r.output, /To write: `--write --onTop`/);
});

test("when --pm is INSIDE the repo, repo=\".\" and matris is written relative; OUTSIDE, it stays absolute", () => {
  // in the fake product, K.pm is a sibling of K.repo (root/pm, root/repo) — outside the repo.
  assert.equal(output.json.suggestion.repo, path.resolve(K.repo), "repo should stay absolute when K.pm is outside the repo");
  assert.ok(path.isAbsolute(output.json.suggestion.matrix), "matris should also stay absolute when K.pm is outside the repo");

  // give --pm a folder INSIDE the repo (K.repo/pm-inside) to test the relative-write behavior.
  const pmInside = path.join(K.repo, "pm-inside");
  const jsonPath2 = path.join(temporary("nosy-findsources-inside-"), "suggestion.json");
  const r = run(path.join(Tool, "find-sources.mjs"), [K.repo, "--pm", pmInside, "--json", jsonPath2]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath2, "utf8"));
  assert.equal(j.suggestion.repo, ".", "repo should be written as \".\" when pm is inside the repo");
  assert.equal(j.suggestion.matrix, path.join("pm-inside", "matrix.json"), "matris should be written relative to the repo root");
});

test("--write (file doesn't exist yet) writes a NEW pm; an existing one isn't overwritten without --onTop", () => {
  // fresh/empty pm: no file yet → --write writes it.
  const freshPm = temporary("nosy-findsources-freshpm-");
  const r1 = run(path.join(Tool, "find-sources.mjs"), [K.repo, "--pm", freshPm, "--write"]);
  assert.equal(r1.code, 0, `stderr: ${r1.error}`);
  const goalFresh = path.join(freshPm, "sources.json");
  assert.ok(fs.existsSync(goalFresh), "--write should have written sources.json in the new pm folder");
  clean(freshPm);

  // existing pm: --write alone doesn't overwrite it, --onTop is required.
  const copyPm = temporary("nosy-findsources-exists-");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  const previousContent = fs.readFileSync(path.join(copyPm, "sources.json"), "utf8");
  const r2 = run(path.join(Tool, "find-sources.mjs"), [K.repo, "--pm", copyPm, "--write"]);
  assert.equal(r2.code, 0);
  assert.equal(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"), previousContent, "--write alone shouldn't overwrite an existing file");
  assert.match(r2.output, /without --onTop it won't be overwritten/);

  const r3 = run(path.join(Tool, "find-sources.mjs"), [K.repo, "--pm", copyPm, "--write", "--onTop"]);
  assert.equal(r3.code, 0, `stderr: ${r3.error}`);
  assert.ok(fs.existsSync(path.join(copyPm, "sources.json.backup")), "--onTop should take a .backup first");
  assert.notEqual(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"), previousContent, "the file should have changed after --onTop");
  clean(copyPm);
});

// move-in shouldn't have to ask where the landing page is when the repo already says.
test("frontyard: a web home page in the repo, else the README for a tool, else left for the owner", () => {
  const root = temporary("nosy-landing-");
  try {
    const repoWith = (name, files) => {
      const r = path.join(root, name); fs.mkdirSync(r, { recursive: true });
      for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), body); }
      for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]]) execFileSync("git", ["-C", r, ...a], { stdio: "ignore" });
      const j = path.join(root, name + ".json");
      const out = run(path.join(Tool, "find-sources.mjs"), [r, "--pm", path.join(r, "pm"), "--json", j]);
      assert.equal(out.code, 0, out.error);
      assert.doesNotMatch(out.output, /Next: `node (\.\.\/){3,}/, "no long ../../ path in the next step");
      return JSON.parse(fs.readFileSync(j, "utf8")).suggestion.frontyard;
    };
    assert.deepEqual(repoWith("site", { "src/pages/index.astro": "<h1>Hi</h1>", "src/pages/blog/index.astro": "", "README.md": "# x" }), { path: "src/pages/index.astro", every: 7 });
    assert.deepEqual(repoWith("next", { "apps/web/app/page.tsx": "export default 1", "apps/api/main.go": "" }), { path: "apps/web/app/page.tsx", every: 7 });
    assert.deepEqual(repoWith("cli", { "package.json": '{"bin":{"x":"x.mjs"}}', "x.mjs": "", "README.md": "# x" }), { path: "README.md", every: 7 });
    assert.equal(repoWith("app", { "src/App.tsx": "", "README.md": "# x" }), undefined, "an app with screens but no home page: ask the owner");
  } finally { clean(root); }
});
