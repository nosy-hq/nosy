// health.mjs (`nosy doctor --check`): is the install healthy? Temp folders, fake plugin layouts and an injected
// runner for git/gh; no network. Every failing line must carry its fix.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run as runTool, temporary, clean, Tool } from "./helpers.mjs";
import { check, render, exitCode, nodeOk, MIN_NODE } from "../tools/health.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), REAL_SKILL = path.join(Tool, "..");
const dirs = [];
after(() => dirs.forEach(clean));
const tmp = p => { const d = temporary(p); dirs.push(d); return d; };
const put = (root, files) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), typeof c === "string" ? c : JSON.stringify(c)); } return root; };
const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=n", ...a], { encoding: "utf8" });
const ok = { git: { status: 0, stdout: "git version 2.43.0" }, gh: { status: 0, stdout: "gh version 2.40.0 (2026-01-01)" } };
// A runner that answers git/gh --version from `answers` and everything else with the real thing.
const runner = (answers = {}) => (cmd, args, cwd) => {
  if (args[0] === "--version" && cmd in answers) return answers[cmd];
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] });
  return r.error ? { missing: r.error.code === "ENOENT", status: null, stdout: "" } : { status: r.status, stdout: (r.stdout || "").trim() };
};
const gone = { missing: true, status: null, stdout: "" };
const line = (R, re) => R.lines.find(l => re.test(l.what));

// A complete fake plugin: skill/, commands/, hooks/, manifests.
function plugin(extra = {}) {
  const root = tmp("nosy-plugin-");
  put(root, {
    "package.json": { name: "nosy", version: "1.2.3" }, ".claude-plugin/plugin.json": { name: "nosy", version: "1.2.3", skills: ["./skill/"] },
    "commands/peek.md": "x", "commands/psst.md": "x",
    "hooks/hooks.json": { hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/a.mjs"' }] }], Stop: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/b.mjs"' }] }] } },
    "hooks/a.mjs": "console.log(1);\n", "hooks/b.mjs": "console.log(2);\n",
    "skill/SKILL.md": "---\nname: nosy\ndescription: x\n---\n# Nosy\n", "skill/rules.md": "x", "skill/tools/nosy.mjs": "", "skill/tools/next.mjs": "", "skill/data/rules.json": "[]", "skill/data/lang/tr/renames.json": "{}",
    "skill/commands/peek.md": "x", "skill/commands/psst.md": "x", ...extra,
  });
  return root;
}
const checkPlugin = (root, o = {}) => check({ cwd: tmp("nosy-cwd-"), skill: path.join(root, "skill"), home: tmp("nosy-home-"), env: {}, run: runner(ok), ...o });

test("the Node floor: 18.17 (recursive readdir), not 18.0, not 19, 20.1; 22 and 24 fine", () => {
  assert.equal(MIN_NODE, "18.17");
  for (const v of ["16.20.0", "18.0.0", "18.16.1", "19.9.0", "20.0.0", "14.21.3"]) assert.equal(nodeOk(v), false, v);
  for (const v of ["18.17.0", "18.20.4", "20.1.0", "20.19.0", "21.0.0", "22.21.0", "v24.21.0"]) assert.equal(nodeOk(v), true, v);
  // The claim in health.mjs is only as good as the scan: recursive readdir is what needs it, and it's still used.
  const uses = fs.readdirSync(Tool).filter(f => f.endsWith(".mjs") && /readdirSync\([^)]*recursive/.test(fs.readFileSync(path.join(Tool, f), "utf8")));
  assert.ok(uses.length > 0, "if nothing uses recursive readdir any more, the floor can drop: revisit MIN_NODE");
});

test("an old Node is a hard failure whose line names the version, the floor and the fix; exit 2", async () => {
  const R = await checkPlugin(plugin(), { node: "16.20.0" });
  const l = line(R, /^Node 16/);
  assert.equal(l.level, "fail");
  assert.equal(`${l.what}: ${l.fix}`, "Node 16.20.0 found, needs 18.17+: install from https://nodejs.org (the current LTS is fine)");
  assert.equal(exitCode(R), 2);
  assert.match(render(R), /✗ Node 16\.20\.0 found, needs 18\.17\+: install from https:\/\/nodejs\.org/);
  const mid = await checkPlugin(plugin(), { node: "20.5.0" });
  assert.equal(line(mid, /Node 20/).level, "ok", "18.17, 20 and 22 are all run in CI: nothing to warn about");
  assert.equal(exitCode(mid), 0);
});

test("git missing is a hard failure with its fix; gh missing is only a note", async () => {
  const R = await checkPlugin(plugin(), { run: runner({ git: gone, gh: gone }) });
  assert.equal(line(R, /^git not found/).level, "fail");
  assert.match(line(R, /^git not found/).fix, /git-scm\.com\/downloads/);
  assert.equal(line(R, /gh \(GitHub CLI\) not found/).level, "note");
  assert.match(line(R, /gh \(GitHub CLI\)/).fix, /cli\.github\.com.*gh auth login/);
  assert.equal(exitCode(R), 2);
  const onlyGh = await checkPlugin(plugin(), { run: runner({ gh: gone }) });
  assert.equal(exitCode(onlyGh), 0, "gh is optional");
});

test("a healthy plugin layout: every check green, exit 0, nothing pm/-related to fix", async () => {
  const R = await checkPlugin(plugin());
  assert.deepEqual(R.lines.map(l => l.level).filter(l => l !== "ok"), ["note"], "the only note is: no pm/ here");
  assert.match(line(R, /no pm\//).what, /Nosy hasn't moved in/);
  assert.match(line(R, /no pm\//).fix, /move-in/);
  assert.match(line(R, /skill files found/).what, /SKILL\.md, 2 commands/);
  assert.match(line(R, /hooks: 2 scripts wired/).what, /all on/);
  assert.equal(exitCode(R), 0);
  assert.match(render(R), /Healthy\./);
});

test("the skill folder: a missing file, a SKILL.md an agent can't load, no commands", async () => {
  const a = plugin(); fs.rmSync(path.join(a, "skill", "data", "lang"), { recursive: true });
  assert.match(line(await checkPlugin(a), /skill folder is missing/).what, /data\/lang\/tr\/renames\.json/);
  assert.match(line(await checkPlugin(a), /skill folder is missing/).fix, /reinstall/);
  const b = plugin({ "skill/SKILL.md": "# Nosy, no header\n" });
  assert.match(line(await checkPlugin(b), /no `name: nosy` header/).fix, /reinstall/);
  const c = plugin(); fs.rmSync(path.join(c, "skill", "commands"), { recursive: true });
  assert.equal(line(await checkPlugin(c), /has no command files/).level, "fail");
});

test("the plugin manifest: a dead skills path fails, mismatched command counts and versions warn", async () => {
  const a = plugin({ ".claude-plugin/plugin.json": { name: "nosy", version: "1.2.3", skills: ["./nope/"] } });
  assert.match(line(await checkPlugin(a), /points at \.\/nope\//).fix, /reinstall/);
  const b = plugin({ "commands/extra.md": "x" });
  assert.equal(line(await checkPlugin(b), /the plugin has 3 commands but the skill documents 2/).level, "warn");
  const c = plugin({ ".claude-plugin/plugin.json": { name: "nosy", version: "1.0.0", skills: ["./skill/"] } });
  assert.match(line(await checkPlugin(c), /package\.json says 1\.2\.3 but the plugin manifest says 1\.0\.0/).what, /1\.0\.0/);
});

test("hooks: invalid JSON, a missing script and a script that won't parse each fail with a reinstall fix; no hooks folder is only a note", async () => {
  const bad = plugin({ "hooks/hooks.json": "{ nope" });
  const l = line(await checkPlugin(bad), /hooks\/hooks\.json isn't valid/);
  assert.equal(l.level, "fail"); assert.match(l.fix, /\/plugin uninstall nosy@nosy.*\/plugin install nosy@nosy/);
  const missing = plugin(); fs.rmSync(path.join(missing, "hooks", "b.mjs"));
  assert.match(line(await checkPlugin(missing), /names hooks\/b\.mjs/).what, /isn't there/);
  const syntax = plugin({ "hooks/a.mjs": "const = ;\n" });
  const s = line(await checkPlugin(syntax), /hooks\/a\.mjs doesn't parse/);
  assert.equal(s.level, "fail"); assert.match(s.fix, /nodejs\.org/);
  const none = plugin(); fs.rmSync(path.join(none, "hooks"), { recursive: true });
  const n = line(await checkPlugin(none), /no hooks here/);
  assert.equal(n.level, "note"); assert.match(n.fix, /\/plugin install nosy@nosy/);
});

test("hooks you switched off are named with their switch, not called a failure", async () => {
  const R = await checkPlugin(plugin(), { env: {} });
  const real = await check({ cwd: tmp("nosy-cwd-"), skill: REAL_SKILL, home: tmp("nosy-home-"), env: { NOSY_NO_PSST: "1", NOSY_NO_CITE_CHECK: "1" }, run: runner(ok) });
  assert.match(line(real, /switched off by you/).what, /opening summary \(NOSY_NO_PSST\), reference check \(NOSY_NO_CITE_CHECK\)/);
  assert.equal(line(real, /switched off/).level, "note");
  assert.equal(line(R, /hooks:/).level, "ok");
});

test("copies nosy install made: an old one warns (nosy update), a broken link and a SKILL.md-less folder fail", async () => {
  const cwd = tmp("nosy-cwd-"), root = plugin();
  put(cwd, { ".claude/skills/nosy/SKILL.md": "x", ".claude/skills/nosy/.nosy-install.json": { version: "0.0.1" } });
  fs.mkdirSync(path.join(cwd, ".agents/skills"), { recursive: true }); fs.symlinkSync(path.join(cwd, "gone"), path.join(cwd, ".agents/skills/nosy"));
  put(cwd, { ".cursor/skills/nosy/notes.txt": "x" });
  const R = await checkPlugin(root, { cwd });
  assert.equal(line(R, /Claude Code here.*version 0\.0\.1, this Nosy is 1\.2\.3/).fix, "`nosy update`");
  assert.equal(line(R, /Codex here.*broken link/).level, "fail");
  assert.match(line(R, /Codex here.*broken link/).fix, /rm .*\.agents\/skills\/nosy.*npx github:nosy-hq\/nosy install/);
  assert.match(line(R, /Cursor here.*no SKILL\.md/).fix, /npx github:nosy-hq\/nosy install/);
  assert.equal(exitCode(R), 2);
});

test("the plugin installed but switched off in Claude Code's own settings", async () => {
  const home = tmp("nosy-home-");
  put(home, { ".claude/plugins/installed_plugins.json": { plugins: { "nosy@nosy": [{ scope: "user" }] } }, ".claude/settings.json": { enabledPlugins: { "nosy@nosy": false } } });
  const R = await checkPlugin(plugin(), { home });
  const l = line(R, /installed but disabled/);
  assert.equal(l.level, "fail"); assert.equal(l.fix, "`/plugin enable nosy`");
  put(home, { ".claude/settings.json": { enabledPlugins: { "nosy@nosy": true } } });
  assert.equal(line(await checkPlugin(plugin(), { home }), /installed but disabled/), undefined);
  assert.equal(line(await checkPlugin(plugin(), { home: tmp("nosy-home-") }), /installed but disabled/), undefined, "no registry: nothing to say");
});

test("pm/: absent is a note; unreadable sources.json, a repo that isn't git, no commits and a bad ref each fail with their fix", async () => {
  const cwd = tmp("nosy-cwd-"), root = plugin(), go = () => checkPlugin(root, { cwd });
  assert.equal(line(await go(), /no pm\//).level, "note");
  put(cwd, { "pm/notes.md": "x" });
  assert.match(line(await go(), /pm\/ exists but has no sources\.json/).fix, /move-in/);
  put(cwd, { "pm/kaynaklar.json": "{}" });
  assert.equal(line(await go(), /older Nosy/).fix, "`nosy doctor --fix`");
  fs.rmSync(path.join(cwd, "pm", "kaynaklar.json"));
  put(cwd, { "pm/sources.json": "{ bad json" });
  const j = line(await go(), /pm\/sources\.json isn't valid JSON \(/);
  assert.equal(j.level, "fail"); assert.match(j.fix, /fix that spot by hand.*\/nosy:move-in.*nosy setup \./);
  put(cwd, { "pm/sources.json": "[1]" });
  assert.match(line(await go(), /isn't a JSON object/).fix, /nosy setup \./);
  put(cwd, { "pm/sources.json": { repo: "../nowhere" } });
  const r = line(await go(), /`repo` \(\.\.\/nowhere\) isn't a git repo/);
  assert.match(r.fix, /fix `repo` in pm\/sources\.json/);
  put(cwd, { "pm/sources.json": { repo: "." } }); git(cwd, "init", "-q", "-b", "main");
  assert.match(line(await go(), /has no commits yet/).fix, /git commit --allow-empty/);
  put(cwd, { "a.txt": "x" }); git(cwd, "add", "-A"); git(cwd, "commit", "-qm", "first");
  const okLine = line(await go(), /pm\/sources\.json reads; repo \. at HEAD resolves/);
  assert.equal(okLine.level, "ok");
  put(cwd, { "pm/sources.json": { repo: ".", ref: "trunk" } });
  const bad = line(await go(), /`ref` \(trunk\) isn't a branch or commit/);
  assert.match(bad.fix, /branch -a.*git fetch/);
  put(cwd, { "pm/sources.json": { repo: ".", ref: "main", issue: { repo: "a/b" } } });
  const R = await checkPlugin(root, { cwd, run: runner({ gh: gone }) });
  assert.match(line(R, /issue\.repo \(a\/b\) but gh isn't installed/).fix, /install gh/);
});

test("`nosy doctor --check` end to end: exit 2 and the fix printed for a broken pm/, exit 0 for a healthy folder, --json written, bad flag is 1", () => {
  const cwd = tmp("nosy-cli-"), broken = put(tmp("nosy-cli-"), { "pm/sources.json": "{ nope" });
  const r = runTool(NOSY, ["doctor", "--check"], { cwd: broken });
  assert.equal(r.code, 2, r.output);
  assert.match(r.output, /✗ pm\/sources\.json isn't valid JSON \(.*\): fix that spot by hand/);
  assert.match(r.output, /1 thing to fix first \(✗\)/);
  const h = runTool(NOSY, ["doctor", "--check", "--json", path.join(cwd, "out", "h.json")], { cwd });
  assert.equal(h.code, 0, h.output);
  assert.match(h.output, /✓ Node /);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, "out", "h.json"), "utf8")).type, "health");
  const direct = runTool(path.join(Tool, "doctor.mjs"), ["--check"], { cwd });
  assert.equal(direct.code, 0); assert.match(direct.output, /install check/);
  const flag = runTool(path.join(Tool, "health.mjs"), ["--nope"], { cwd });
  assert.equal(flag.code, 1); assert.match(flag.error, /Unknown option --nope\. Usage: nosy doctor --check/);
  assert.match(runTool(NOSY, ["help"]).output, /nosy doctor --check {6}is my install healthy\?/);
});

test("a copy of the skill installed by `nosy install` checks healthy on its own (no plugin manifest, no hooks: notes only)", () => {
  const project = tmp("nosy-proj-");
  assert.equal(runTool(NOSY, ["install", "--dir", project, "--providers", "claude"]).code, 0);
  const copy = path.join(project, ".claude", "skills", "nosy", "tools", "nosy.mjs");
  const r = runTool(copy, ["doctor", "--check"], { cwd: project });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /✓ skill files found/);
  assert.match(r.output, /✓ skill copies found: Claude Code here/);
  assert.match(r.output, /– no hooks here \(the skill without the plugin\).*\/plugin install nosy@nosy adds them/);
});
