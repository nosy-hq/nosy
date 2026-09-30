// Contract tests for preread.mjs's --diff --fetch fallback (internal request 24, end-to-end verified for
// internal request 36/27 against a real large public PR).
//
// Reproduces, with a real local git repo + bare "origin" (no network), the exact shape of the bug found in
// that trial: `gh pr diff` fails (simulated - too many files), so preread falls back to fetching the PR
// branch and using `git grep`. Before the fix, that grep had NO pathspec, so it searched the WHOLE tree at
// the PR's ref - including files the PR never touched, just inherited unchanged from main. On a real
// 900-file PR that's also what made --fetch impractically slow (git lazily fetches every blob in the
// tree, not just the PR's own files, on a partial clone). These tests prove both were fixed: the grep is
// now scoped to the PR's own changed files (from `gh api .../pulls/N/files`, paginated).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, clean, Tool } from "./helpers.mjs";

let K, gh, output;

function git(repoDir, args, env) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", env: { ...process.env, ...env } });
}
function commit(repoDir, files, message) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(repoDir, rel);
    execFileSync("mkdir", ["-p", path.dirname(full)]);
    execFileSync("sh", ["-c", `cat > ${JSON.stringify(full)}`], { input: content });
  }
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", message]);
  return git(repoDir, ["rev-parse", "HEAD"]).trim();
}

before(async () => {
  K = await fakeProductSetup();

  // A file that already lives on main BEFORE either PR branch exists, and that matches the product's
  // "logging the card number" never rule. Both PR branches will inherit it unchanged - it's exactly the
  // kind of pre-existing, PR-untouched file the old unscoped `git grep` would have wrongly "confirmed" a
  // violation in.
  commit(K.repo, { "backend/legacy-logger.js": "console.log(card_id_for_debug);\n" }, "chore: legacy debug logger (pre-existing, not part of any PR)");
  const base = git(K.repo, ["rev-parse", "HEAD"]).trim();

  // PR #900: touches an unrelated file only - should NOT trip the never rule once evidence is scoped
  // correctly (a false positive here would mean the old bug is back).
  git(K.repo, ["checkout", "-q", "-b", "pr-900", base]);
  commit(K.repo, { "backend/new-feature.js": "export function total(items) { return items.length; }\n" }, "feat: add totals helper");
  git(K.repo, ["push", "-q", "origin", "pr-900:refs/pull/900/head"]);

  // PR #901: touches a NEW file that genuinely violates the rule - the positive case, to prove real
  // violations are still found (and cited at the right file:line) once scoped.
  git(K.repo, ["checkout", "-q", "-b", "pr-901", base]);
  commit(K.repo, { "backend/new-feature-2.js": "export function pay() {\n  console.log(cvv_value);\n}\n" }, "feat: add payment helper");
  git(K.repo, ["push", "-q", "origin", "pr-901:refs/pull/901/head"]);

  git(K.repo, ["checkout", "-q", "main"]);

  const iso = new Date().toISOString();
  const fixture = { ...K.gh };
  fixture.prListFull = [
    // The PR description quotes a `console.log(card...)`-shaped snippet (like #610 in fake-product.mjs) -
    // that's what trips the "never" rule text match and puts it in the diff-verification queue; whether the
    // rule is actually CONFIRMED depends on whether the PR's own changed files contain it, which is what
    // these tests check.
    { number: 900, title: "fix: card handling cleanup", author: { login: "dev1" },
      updatedAt: iso, createdAt: iso, body: "Saw an old console.log(card) somewhere in the codebase while working on this; not something this PR adds.",
      files: [{ path: "backend/new-feature.js" }], isDraft: false,
      statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }], mergeable: "MERGEABLE" },
    { number: 901, title: "feat: card/cvv payment helper", author: { login: "dev2" },
      updatedAt: iso, createdAt: iso, body: "Adds a payment helper; might still have a stray console.log(cvv) from debugging.",
      files: [{ path: "backend/new-feature-2.js" }], isDraft: false,
      statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }], mergeable: "MERGEABLE" },
  ];
  // No prDiff entries for 900/901 -> the fake gh simulates gh pr diff's real "too many files" failure.
  fixture.prFiles = { "900": ["backend/new-feature.js"], "901": ["backend/new-feature-2.js"] };

  gh = fakeGhSetup(fixture);
  const r = run(path.join(Tool, "preread.mjs"), [K.pm, "999999", "--diff", "--fetch"], { env: gh.env });
  assert.equal(r.code, 0, `preread --diff --fetch returned an unexpected exit code, stderr: ${r.error}`);
  output = r.output;
});
after(() => {
  clean(K.root); clean(gh.dir);
});

test("PR #900 (doesn't touch the violating file) is NOT confirmed as a violation - no false positive from a file it never touched", () => {
  const line = output.split("\n").find(l => l.includes("· logging the card number:") && l.includes("#900"));
  assert.ok(line, `verification line for #900 not found in:\n${output}`);
  assert.match(line, /pattern not found in the PR's own changed files/);
  assert.doesNotMatch(line, /legacy-logger\.js/, "must not cite the pre-existing, PR-untouched file as evidence");
});

test("PR #901 (genuinely touches the violating file) IS confirmed, citing the right file and line", () => {
  const line = output.split("\n").find(l => l.includes("· logging the card number:") && l.includes("#901"));
  assert.ok(line, `verification line for #901 not found in:\n${output}`);
  assert.match(line, /found: backend\/new-feature-2\.js:2:\s*console\.log\(cvv_value\)/);
});

test("both PRs are flagged with the rule name in the main table (title/body match, before the diff is checked)", () => {
  const l900 = output.split("\n").find(l => l.includes("#900") && !l.startsWith("- #900"));
  const l901 = output.split("\n").find(l => l.includes("#901") && !l.startsWith("- #901"));
  assert.match(l900, /logging the card number/);
  assert.match(l901, /logging the card number/);
});

test("--diff without --fetch leaves a note instead of fetching on its own", () => {
  const r = run(path.join(Tool, "preread.mjs"), [K.pm, "999999", "--diff"], { env: gh.env });
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const line = r.output.split("\n").find(l => l.includes("· logging the card number:") && l.includes("#900"));
  assert.ok(line, `verification line for #900 not found in:\n${r.output}`);
  assert.match(line, /couldn't get the diff.*I can fetch the branch and look with --fetch/);
});
