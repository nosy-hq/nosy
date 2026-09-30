// nudge.mjs + hooks/after-commit.mjs: what Nosy says after a commit lands. Temp repos; no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { nudge, render, matrixHits } from "../tools/nudge.mjs";
import { matrixRead } from "../tools/read-matrix.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const MATRIX = { codes: { y: "shipped", n: "not built" }, products: ["Us", "Acme", "Globex"], lines: [
  { feature: "Bulk export to CSV", codes: { Us: "n", Acme: "y", Globex: "y" } },
  { feature: "Single sign-on", codes: { Us: "n", Acme: "y", Globex: "n" } },
  { feature: "Audit log", codes: { Us: "y", Acme: "y", Globex: "y" } },
] };

function product() {
  const root = temporary("nosy-nudge-"); dirs.push(root);
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"], { env: ENV });
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify(MATRIX));
  fs.writeFileSync(path.join(pm, "state", "waves.json"), JSON.stringify({ waves: [{ name: "Now", tasks: [{ title: "Single sign-on", reason_now: "2 deals asked for it" }] }] }));
  commit(root, "chore: start");
  return { root, pm };
}
function commit(root, msg) {
  fs.appendFileSync(path.join(root, "f.txt"), msg + "\n");
  execFileSync("git", ["-C", root, "add", "."], { env: ENV });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", msg], { env: ENV });
}

test("matrixHits: explicit tag, word candidate, never a row we already have", () => {
  const M = matrixRead(MATRIX);
  const hits = matrixHits(M, [
    { hash: "a1", subject: "feat: bulk CSV export for invoices", body: "" },
    { hash: "b2", subject: "auth work", body: "Matrix: single sign-on" },
    { hash: "c3", subject: "feat: audit log filters", body: "" },
    { hash: "d4", subject: "chore: bump export deps", body: "" },
  ]);
  assert.deepEqual(hits.map(h => [h.commit, h.feature, h.link]), [["a1", "Bulk export to CSV", "candidate"], ["b2", "Single sign-on", "explicit"]]);
  assert.deepEqual(hits[0].rivals, ["Acme", "Globex"]);
});

test("nudge + render: gap, decision, and the next command; repeats nothing already said", () => {
  const { root, pm } = product();
  commit(root, "feat: bulk CSV export for invoices");
  const R = nudge(pm);
  const text = render(R);
  assert.match(text, /^Psst… after that commit:/);
  assert.match(text, /"Bulk export to CSV": \w+ looks like it \(confirm\)\. Us: not built; Acme, Globex have it\./, "the matrix's own legend names the code");
  assert.match(text, /Done\? Mark it as yours in .*matrix\.json; it goes into the weekly landing roundup/);
  assert.match(text, /Next product decision: Single sign-on \(2 deals asked for it\)/);
  assert.match(text, /Next to run: \/nosy:shipped/);
  const quiet = { ...R, matrix: [] };
  assert.equal(render(quiet, { skip: { decision: "Single sign-on", next: R.next.command } }), "", "same decision and command: say nothing");
});

const HOOK = path.join(Tool, "..", "..", "hooks", "after-commit.mjs");
const hook = (cwd, command, env = {}) => run(HOOK, [], { input: JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command } }), env: { ...process.env, ...env } });

test("shortWhy: first part only, no file paths, cut at a word", async () => {
  const { shortWhy } = await import("../tools/nudge.mjs");
  assert.equal(shortWhy("backend ready (apps/web/src/x/mapper.ts:26) · candidate — confirm"), "backend ready");
  assert.equal(shortWhy("asked for by " + "many customers ".repeat(10), 40), "asked for by many customers many…");
});

test("matrixHits: a short Matrix: tag must match exactly; one row is named once", () => {
  const M = matrixRead(MATRIX);
  assert.deepEqual(matrixHits(M, [{ hash: "a1", subject: "x", body: "Matrix: s" }]), [], "one letter doesn't pick a row by substring");
  const two = matrixHits(M, [{ hash: "a1", subject: "feat: bulk CSV export", body: "" }, { hash: "b2", subject: "feat: bulk CSV export, part 2", body: "" }]);
  assert.equal(two.length, 1);
});

test("after-commit hook: speaks once per new commit, only for commands that land work, silent when off", () => {
  const { root } = product(), memo = temporary("nosy-memo-"); dirs.push(memo);
  const env = { NOSY_NUDGE_DIR: memo };
  commit(root, "feat: bulk CSV export for invoices");
  assert.equal(hook(root, "npm test", env).output, "", "not a commit");
  const r = hook(root, 'git commit -m "feat: bulk CSV export"', env);
  assert.equal(r.code, 0, r.error);
  const out = JSON.parse(r.output);
  assert.match(out.systemMessage, /Bulk export to CSV/);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /Pass this to the owner/);
  assert.equal(hook(root, "git commit --amend --no-edit", env).output, "", "HEAD unchanged since last time: silent");
  commit(root, "fix: typo");
  assert.equal(hook(root, "git commit -am fix", env).output, "", "nothing new to say: silent");
  commit(root, "feat: SSO via SAML");
  assert.equal(hook(root, "git commit -m x", { ...env, NOSY_NO_NUDGE: "1" }).output, "");
  const bare = temporary("nosy-nudge-"); dirs.push(bare);
  assert.equal(hook(bare, "git commit -m x", env).output, "", "not moved in: silent");
});

test("after-commit hook: a plugin option left at \"false\" does not shadow NOSY_NO_NUDGE, and does not switch the hook off", () => {
  const { root } = product(), memo = temporary("nosy-memo-"); dirs.push(memo);
  commit(root, "feat: bulk CSV export for invoices");
  const optionFalse = { NOSY_NUDGE_DIR: memo, CLAUDE_PLUGIN_OPTION_DISABLE_COMMIT_NUDGE: "false" };
  assert.equal(hook(root, 'git commit -m "x"', { ...optionFalse, NOSY_NO_NUDGE: "1" }).output, "", "option \"false\" + NOSY_NO_NUDGE=1: off");
  assert.match(JSON.parse(hook(root, 'git commit -m "x"', optionFalse).output).systemMessage, /Bulk export to CSV/, "option \"false\" alone: it speaks (the off run did not use up the commit)");
});

test("after-commit hook: first time in a repo, an old HEAD (a no-op pull) stays silent", () => {
  const { root } = product(), memo = temporary("nosy-memo-"); dirs.push(memo);
  const old = "2026-01-01T00:00:00Z";
  fs.appendFileSync(path.join(root, "f.txt"), "x\n");
  execFileSync("git", ["-C", root, "commit", "-qam", "feat: bulk CSV export"], { env: { ...ENV, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old } });
  assert.equal(hook(root, "git pull", { NOSY_NUDGE_DIR: memo }).output, "");
  commit(root, "feat: SSO via SAML sign-on");
  assert.match(JSON.parse(hook(root, "git pull", { NOSY_NUDGE_DIR: memo }).output).systemMessage, /Single sign-on/, "the next real commit speaks");
});
