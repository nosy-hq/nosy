// git-hooks.mjs: the after-commit nudge and the never-rule check as plain git hooks, for agents with no hooks of their own.
// Real git in temp repos; the two tools are stubs (the hook only has to call them in order), nothing touches the network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { plan, apply, locate, block, START, END, HOOK_NAMES } from "../tools/git-hooks.mjs";

const HOOKS = path.join(Tool, "git-hooks.mjs"), NOSY = path.join(Tool, "nosy.mjs");
const dirs = [];
after(() => dirs.forEach(clean));
const tmp = p => { const d = temporary(p); dirs.push(d); return d; };
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", NOSY_NO_GIT_HOOKS: "", NOSY_NO_NUDGE: "", NOSY_NO_NEVER_CHECK: "" } });
const out = r => (r.stdout || "") + (r.stderr || "");
function repo({ pm = true } = {}) {
  const d = tmp("nosy-gh-"); git(d, "init", "-q"); git(d, "config", "commit.gpgsign", "false");
  if (pm) { fs.mkdirSync(path.join(d, "pm")); fs.writeFileSync(path.join(d, "pm", "sources.json"), "{}\n"); }
  return d;
}
// Stub tools: what the hook calls, printing a marker and the arguments, one of them failing on purpose.
function stubs({ fail = false } = {}) {
  const d = tmp("nosy-gh-tools-");
  fs.writeFileSync(path.join(d, "never-check.mjs"), `console.log("NEVER-STUB " + process.argv.slice(2).join(" ")); ${fail ? "process.exit(2);" : ""}`);
  fs.writeFileSync(path.join(d, "nudge.mjs"), `console.log("NUDGE-STUB " + process.argv.slice(2).join(" ")); ${fail ? "process.exit(1);" : ""}`);
  return d;
}
const install = (d, tools) => { const w = locate(d); apply(plan("install", { ...w, tools })); return w; };
let n = 0;
const commit = (d, env = {}) => { fs.writeFileSync(path.join(d, `f${n++}.txt`), "x"); git(d, "add", "-A"); return spawnSync("git", ["commit", "-q", "-m", "c"], { cwd: d, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", NOSY_NO_GIT_HOOKS: "", NOSY_NO_NUDGE: "", NOSY_NO_NEVER_CHECK: "", ...env } }); };

test("install writes post-commit and post-merge, executable, and a commit then prints the never-check and the nudge, in that order", () => {
  const d = repo(), w = install(d, stubs());
  for (const name of HOOK_NAMES) {
    const f = path.join(w.hooks, name);
    assert.ok(fs.readFileSync(f, "utf8").includes(START), name);
    assert.ok(fs.statSync(f).mode & 0o111, `${name} is executable`);
  }
  const r = commit(d), text = out(r);
  assert.equal(r.status, 0);
  assert.match(text, /NEVER-STUB pm --last-commit[\s\S]*NUDGE-STUB pm/, "never-check first, then the nudge");
});

test("a repo without pm/sources.json hears nothing; the switches silence the run, or one half", () => {
  const plain = repo({ pm: false }); install(plain, stubs());
  assert.doesNotMatch(out(commit(plain)), /STUB/);
  const d = repo(); install(d, stubs());
  assert.doesNotMatch(out(commit(d, { NOSY_NO_GIT_HOOKS: "1" })), /STUB/);
  const half = out(commit(d, { NOSY_NO_NUDGE: "1" }));
  assert.match(half, /NEVER-STUB/); assert.doesNotMatch(half, /NUDGE-STUB/);
  const other = out(commit(d, { NOSY_NO_NEVER_CHECK: "1" }));
  assert.match(other, /NUDGE-STUB/); assert.doesNotMatch(other, /NEVER-STUB/);
});

test("the hook never fails a commit, even when both tools exit non-zero", () => {
  const d = repo(); install(d, stubs({ fail: true }));
  const r = commit(d);
  assert.equal(r.status, 0);
  assert.match(out(r), /NEVER-STUB/); assert.match(out(r), /NUDGE-STUB/);
});

test("a pull or merge speaks too (post-merge)", () => {
  const src = repo({ pm: false }); fs.mkdirSync(path.join(src, "pm")); fs.writeFileSync(path.join(src, "pm", "sources.json"), "{}\n"); git(src, "add", "-A"); git(src, "commit", "-q", "-m", "first");
  const cl = tmp("nosy-gh-clone-"); fs.rmSync(cl, { recursive: true }); git(path.dirname(cl), "clone", "-q", src, cl);
  install(cl, stubs());
  fs.writeFileSync(path.join(src, "g.txt"), "y"); git(src, "add", "-A"); git(src, "commit", "-q", "-m", "second");
  const r = git(cl, "pull", "-q", "--no-rebase");
  assert.match(out(r), /NUDGE-STUB/);
});

test("an existing shell hook is kept and runs first; uninstall takes out only our block", () => {
  const d = repo(), w = locate(d), f = path.join(w.hooks, "post-commit");
  fs.mkdirSync(w.hooks, { recursive: true });
  fs.writeFileSync(f, "#!/bin/sh\necho MINE-FIRST\n"); fs.chmodSync(f, 0o755);
  install(d, stubs());
  const text = out(commit(d));
  assert.match(text, /MINE-FIRST[\s\S]*NEVER-STUB/);
  apply(plan("uninstall", w));
  assert.equal(fs.readFileSync(f, "utf8"), "#!/bin/sh\necho MINE-FIRST\n", "your hook is back exactly as it was");
  assert.ok(!fs.existsSync(path.join(w.hooks, "post-merge")), "a file that held only our block is removed");
});

test("install twice changes nothing; a hook that is not a shell script is refused and left alone", () => {
  const d = repo(), tools = stubs(), w = install(d, tools);
  const before = fs.readFileSync(path.join(w.hooks, "post-commit"), "utf8");
  assert.ok(plan("install", { ...w, tools }).every(s => s.state === "already installed"));
  install(d, tools);
  assert.equal(fs.readFileSync(path.join(w.hooks, "post-commit"), "utf8"), before);
  assert.equal((before.match(new RegExp(START.replace(/[`()]/g, "\\$&"), "g")) || []).length, 1, "one block");

  const py = repo(), pw = locate(py);
  fs.mkdirSync(pw.hooks, { recursive: true });
  fs.writeFileSync(path.join(pw.hooks, "post-commit"), "#!/usr/bin/env python3\nprint('mine')\n");
  const steps = plan("install", { ...pw, tools });
  assert.ok(steps.find(s => s.name === "post-commit").refuse);
  apply(steps);
  assert.equal(fs.readFileSync(path.join(pw.hooks, "post-commit"), "utf8"), "#!/usr/bin/env python3\nprint('mine')\n");
});

test("core.hooksPath is respected, and the skill inside the repo is named relative to the repo root (no personal path in the hook)", () => {
  const d = repo(); git(d, "config", "core.hooksPath", ".githooks");
  const w = locate(d);
  assert.equal(w.hooks, path.join(fs.realpathSync(d), ".githooks"));
  const inside = path.join(w.root, ".agents", "skills", "nosy", "tools");
  const text = block({ root: w.root, tools: inside });
  assert.match(text, /"\$NOSY_ROOT\/\.agents\/skills\/nosy\/tools\/never-check\.mjs"/);
  assert.ok(!text.includes(w.root), "the repo's own path is not written into the hook");
  assert.ok(text.startsWith(START) && text.trimEnd().endsWith(END));
  assert.match(block({ root: w.root, tools: "/opt/nosy/tools" }), /"\/opt\/nosy\/tools\/nudge\.mjs"/, "outside the repo: the path as it is");
});

test("the command: outside a repo it says so (exit 1); --dry-run writes nothing; status tells the truth; nosy git-hooks reaches it", () => {
  const nogit = tmp("nosy-gh-none-");
  const r = run(HOOKS, ["status"], { cwd: nogit });
  assert.equal(r.code, 1);
  assert.match(r.error, /not inside a git repository/);
  const d = repo(), w = locate(d);
  const dry = run(HOOKS, ["install", "--dry-run"], { cwd: d });
  assert.equal(dry.code, 0);
  assert.match(dry.output, /post-commit: would create/);
  assert.ok(!fs.existsSync(path.join(w.hooks, "post-commit")));
  assert.match(run(HOOKS, ["status"], { cwd: d }).output, /post-commit: absent/);
  const via = run(NOSY, ["git-hooks", "install"], { cwd: d });
  assert.equal(via.code, 0);
  assert.match(via.output, /post-commit: created/);
  assert.match(run(HOOKS, ["status"], { cwd: d }).output, /post-commit: installed/);
  assert.match(run(NOSY, ["git-hooks", "uninstall"], { cwd: d }).output, /removed the file/);
  assert.match(run(HOOKS, ["status"], { cwd: d }).output, /post-commit: absent/);
  assert.match(run(HOOKS, []).output, /Usage: nosy git-hooks/);
});

test("nosy install --git-hooks: the skill copy and the hooks in one step, the hooks call that copy, --dry-run writes neither, uninstall removes both", () => {
  const INSTALL = path.join(Tool, "install.mjs");
  const d = repo();
  const dry = run(INSTALL, ["--dir", d, "--providers", "cursor", "--git-hooks", "--dry-run"]);
  assert.equal(dry.code, 0);
  assert.match(dry.output, /git hook \.git\/hooks\/post-commit: would create/);
  assert.ok(!fs.existsSync(path.join(d, ".git", "hooks", "post-commit")) && !fs.existsSync(path.join(d, ".cursor")));
  const r = run(INSTALL, ["--dir", d, "--providers", "cursor", "--git-hooks"]);
  assert.equal(r.code, 0);
  assert.match(r.output, /git hook \.git\/hooks\/post-commit: created/);
  assert.doesNotMatch(r.output, /nosy install --git-hooks/, "already done: the footer does not suggest it again");
  const hook = fs.readFileSync(path.join(d, ".git", "hooks", "post-commit"), "utf8");
  assert.match(hook, /"\$NOSY_ROOT\/\.cursor\/skills\/nosy\/tools\/never-check\.mjs"/, "calls the copy just written, not the npx cache");
  assert.ok(fs.existsSync(path.join(d, ".cursor", "skills", "nosy", "tools", "never-check.mjs")));
  const un = run(INSTALL, ["uninstall", "--dir", d, "--providers", "cursor"]);
  assert.equal(un.code, 0);
  assert.ok(!fs.existsSync(path.join(d, ".git", "hooks", "post-commit")) && !fs.existsSync(path.join(d, ".cursor", "skills", "nosy")));
});

test("nosy install without the flag touches no hook, and suggests it; --global and a folder that is not a repo say why they skip", () => {
  const INSTALL = path.join(Tool, "install.mjs");
  const d = repo();
  const r = run(INSTALL, ["--dir", d, "--providers", "cursor"]);
  assert.match(r.output, /nosy install --git-hooks/);
  assert.ok(!fs.existsSync(path.join(d, ".git", "hooks", "post-commit")), "the install alone writes no hook");
  const plain = tmp("nosy-gh-norepo-");
  assert.match(run(INSTALL, ["--dir", plain, "--providers", "cursor", "--git-hooks"]).output, /Git hooks skipped: this folder is not a git repository/);
});
