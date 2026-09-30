// never-check.mjs and the PreToolUse hook: the added lines of a change about to ship, matched against the
// owner's never rules (regex only). Throwaway repos; no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { addedLines, check } from "../tools/never-check.mjs";

const NC = path.join(Tool, "never-check.mjs"), HOOK = path.join(Tool, "..", "..", "hooks", "never-check.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const never = [{ name: "Fax sending", pattern: "\\bfax\\b.{0,30}send|send.{0,30}\\bfax\\b" }, { name: "git add -A", pattern: "git (add -A|stash)" }];
function repo({ rules = never } = {}) {
  const root = temporary("nosy-nc-"); dirs.push(root);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { env: ENV, stdio: "ignore" });
  git("init", "-q", "-b", "main"); fs.writeFileSync(path.join(root, "a.js"), "x\n"); git("add", "."); git("commit", "-q", "-m", "init");
  fs.mkdirSync(path.join(root, "pm")); fs.writeFileSync(path.join(root, "pm", "sources.json"), JSON.stringify({ repo: root, ref: "main", preread: { never: rules } }));
  return { root, pm: path.join(root, "pm"), git, put: (f, s) => fs.writeFileSync(path.join(root, f), s) };
}

test("addedLines: file and new line number of every added line, removals skipped", () => {
  const diff = "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -3,0 +4,2 @@\n+one\n+two\n@@ -9 +11 @@\n-old\n+new\n";
  assert.deepEqual(addedLines(diff), [{ file: "x.js", line: 4, text: "one" }, { file: "x.js", line: 5, text: "two" }, { file: "x.js", line: 11, text: "new" }]);
});

test("staged: a code line that breaks a rule is reported with file:line; a doc that names the rule isn't; exit 2", () => {
  const r = repo();
  r.put("fax.js", "// ok\nexport const x = () => sendDocument(fax);\n");
  r.put("DECISIONS.md", "We won't send by fax.\n");
  r.git("add", ".");
  const out = run(NC, [r.pm]);
  assert.equal(out.code, 2, out.error);
  assert.match(out.output, /\*\*Fax sending\*\*\n {2}- fax\.js:2 {2}export const x = \(\) => sendDocument\(fax\);/);
  assert.doesNotMatch(out.output, /DECISIONS\.md/);
  assert.match(run(NC, [r.pm, "--all-files"]).output, /DECISIONS\.md:1/, "--all-files includes docs");
});

test("clean change: exit 0; no rules: exit 0 with a note; unreadable sources: exit 1", () => {
  const r = repo(); r.put("b.js", "const ok = 1;\n"); r.git("add", ".");
  const out = run(NC, [r.pm]);
  assert.equal(out.code, 0); assert.match(out.output, /No never rule matched in the staged changes \(2 rules\)/);
  const none = repo({ rules: [] });
  assert.match(run(NC, [none.pm]).output, /No never rules in sources\.json/);
  assert.equal(run(NC, [path.join(none.root, "nope")]).code, 1);
});

test("--base: the branch's own commits since it left main", () => {
  const r = repo();
  r.git("checkout", "-q", "-b", "feat");
  r.put("fax.js", "send(fax)\n"); r.git("add", "."); r.git("commit", "-q", "-m", "fax");
  const out = run(NC, [r.pm, "--base", "main"]);
  assert.equal(out.code, 2);
  assert.match(out.output, /the branch's changes since main add something/);
});

test("rules are the owner's patterns in any language: a Turkish pattern matches Turkish code text", () => {
  const R = check({ preread: { never: [{ name: "KEP gönderimi", pattern: "\\bKEP\\b.{0,40}(gönder|send)" }] } },
    "--- a/k.go\n+++ b/k.go\n@@ -0,0 +1 @@\n+// KEP ile tebligat gönder\n");
  assert.equal(R.hits.length, 1);
  assert.equal(R.hits[0].rule, "KEP gönderimi");
});

// The PostToolUse hook, fed the same stdin Claude Code sends.
const hook = (cwd, command, env = {}) => run(HOOK, [], { input: JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", cwd, tool_input: { command } }), env: { ...process.env, ...env } });

test("hook: after `git commit`, a rule broken by the commit comes back to the agent as a reason, with file:line", () => {
  const r = repo();
  r.put("fax.js", "send(fax)\n"); r.git("add", "."); r.git("commit", "-q", "-m", "fax");
  const out = hook(r.root, 'git commit -m "fax"');
  assert.equal(out.code, 0);
  const j = JSON.parse(out.output);
  assert.equal(j.decision, "block");
  assert.match(j.reason, /the commit you just made adds something on this product's never list:\n- \*\*Fax sending\*\*\n {2}- fax\.js:1 {2}send\(fax\)/);
  assert.match(j.reason, /nothing was undone/);
  assert.equal(j.hookSpecificOutput.additionalContext, j.reason);
});

test("hook: a git command that is itself on the never list is named", () => {
  const r = repo();
  const j = JSON.parse(hook(r.root, "git add -A && git status").output);
  assert.match(j.reason, /this command matches this product's never list: \*\*git add -A\*\*/);
});

test("hook: silent for a clean commit, a non-git command, no pm/, or when turned off", () => {
  const r = repo();
  r.put("ok.js", "const ok = 1;\n"); r.git("add", "."); r.git("commit", "-q", "-m", "ok");
  assert.equal(hook(r.root, "git commit -m ok").output, "");
  assert.equal(hook(r.root, "npm test -- send fax").output, "", "only git/gh commands are checked");
  const bare = temporary("nosy-nc-bare-"); dirs.push(bare);
  assert.equal(hook(bare, "git commit -m x").output, "");
  r.put("fax.js", "send(fax)\n"); r.git("add", "."); r.git("commit", "-q", "-m", "fax");
  assert.equal(hook(r.root, "git commit -m fax", { NOSY_NO_NEVER_CHECK: "1" }).output, "");
});

test("hook: after `gh pr create`, the branch's changes since the integration branch are checked", () => {
  const r = repo();
  r.git("checkout", "-q", "-b", "feat");
  r.put("fax.js", "send(fax)\n"); r.git("add", "."); r.git("commit", "-q", "-m", "fax");
  const j = JSON.parse(hook(r.root, 'gh pr create --title "Fax" --body x').output);
  assert.match(j.reason, /this PR's changes since main add something/);
});
