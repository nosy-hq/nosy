// What a stranger hits on a machine that isn't the author's, found by a cold-install test: no `nosy` on PATH after install,
// git missing, a BOM in sources.json, `repo: "."` run from another folder (MCP), an older Nosy's pm/, the Action's commit
// step, and `--version`. Each runs the real command in a temp folder; nothing touches the network or the real home folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { nosyCommand, nosyPrefix, oldLayout } from "../tools/hints.mjs";
import { parseJson, readSources, resolveRepo, stripBom } from "../tools/sources-file.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), ROOT = path.join(Tool, "..", ".."), dirs = [];
after(() => dirs.forEach(clean));
const tmp = (p = "nosy-cold-") => { const d = fs.realpathSync(temporary(p)); dirs.push(d); return d; };
const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=n", ...a], { encoding: "utf8" });
// No global `nosy` (NOSY_COMMAND emptied, PATH holds only node) unless a test adds one; or no git either way.
function bin({ withGit = false } = {}) {
  const b = tmp("nosy-bin-");
  fs.symlinkSync(process.execPath, path.join(b, "node"));
  if (withGit) fs.symlinkSync(spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim(), path.join(b, "git"));
  return b;
}
const bare = { NOSY_COMMAND: "" };
const nosy = (cwd, args, env = {}, script = NOSY) => run(script, args, { cwd, env: { ...process.env, ...env } });
const both = r => `${r.output}\n${r.error}`;
const noTrace = r => assert.doesNotMatch(both(r), /node:internal|^\s+at .*:\d+:\d+/m, "no Node stack trace");
function product() {
  const d = tmp("nosy-cold-prod-"); git(d, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(d, "README.md"), "# x\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "feat(x): first");
  assert.equal(nosy(d, ["setup", "."]).code, 0);
  return d;
}
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

// ---- 1 + 4 (action.yml): the Action's steps, run the way the runner runs them -------------------------------------------------
const actionSteps = () => {
  const lines = fs.readFileSync(path.join(ROOT, "action.yml"), "utf8").split("\n"), out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}- name: (.*)$/.exec(lines[i]); if (!m) continue;
    const at = lines.findIndex((l, j) => j > i && /^ {6}run: \|$/.test(l)); if (at < 0) continue;
    const body = []; for (let j = at + 1; j < lines.length && (/^ {8}/.test(lines[j]) || !lines[j].trim()); j++) body.push(lines[j].slice(8));
    out[m[1]] = body.join("\n");
  }
  return out;
};
const step = name => { const s = actionSteps(); const k = Object.keys(s).find(x => x.includes(name)); assert.ok(k, `no step "${name}" in action.yml`); return s[k].replace(/\$\{\{ inputs\.pm \}\}/g, "pm"); };
const bash = (script, cwd, env = {}) => spawnSync("bash", ["-e", "-c", script], { cwd, encoding: "utf8", env: { ...process.env, NOSY_PM: "pm", ...env } });

test("action.yml: the commit step adds the current folder names (pm/state, not the old durum) and works in a real repo with a remote", () => {
  const text = fs.readFileSync(path.join(ROOT, "action.yml"), "utf8");
  assert.doesNotMatch(text, /durum/, "no old Turkish folder name in the Action");
  const remote = tmp("nosy-remote-"); git(remote, "init", "-q", "--bare", "-b", "main");
  const d = tmp("nosy-ci-"); git(d, "init", "-q", "-b", "main"); git(d, "remote", "add", "origin", remote);
  fs.writeFileSync(path.join(d, "README.md"), "x\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "start"); git(d, "push", "-q", "-u", "origin", "main");
  fs.mkdirSync(path.join(d, "pm", "state"), { recursive: true });
  fs.writeFileSync(path.join(d, "pm", "state", "status.json"), "{}\n"); fs.writeFileSync(path.join(d, "pm", "page.html"), "<p>x</p>\n");
  const script = step("commit pm/state");
  const a = bash(script, d); assert.equal(a.status, 0, a.stderr);
  assert.match(git(remote, "log", "--format=%s", "main").stdout, /nosy: weekly status and decision page/);
  assert.match(git(remote, "ls-tree", "-r", "--name-only", "main").stdout, /pm\/state\/status\.json[\s\S]*pm\/page\.html|pm\/page\.html[\s\S]*pm\/state\/status\.json/);
  assert.equal(bash(script, d).status, 0, "nothing new to commit is not a failure");
  // A step that couldn't run leaves no page: only state/ is added, still no error.
  fs.rmSync(path.join(d, "pm", "page.html")); git(d, "rm", "-q", "--cached", "pm/page.html"); git(d, "commit", "-qm", "drop page");
  fs.writeFileSync(path.join(d, "pm", "state", "status.json"), '{"a":1}\n');
  const c = bash(script, d); assert.equal(c.status, 0, c.stderr);
  assert.match(git(d, "log", "-1", "--format=%s").stdout, /nosy: weekly status/);
});

test("action.yml: the first step reads a sources.json with a BOM, and says what's wrong (one line, no stack trace) when it can't", () => {
  const script = step("point pm/sources.json");
  const d = tmp("nosy-ci-bom-"); fs.mkdirSync(path.join(d, "pm"));
  fs.writeFileSync(path.join(d, "pm", "sources.json"), "\uFEFF" + JSON.stringify({ repo: "/nowhere/on/this/runner", ref: "main" }));
  const ok = bash(script, d); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, "pm", "sources.json"), "utf8")).repo, d, "an owner-machine path is pointed at the workspace");
  fs.writeFileSync(path.join(d, "pm", "sources.json"), "\uFEFF{ not json");
  const bad = bash(script, d); assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Psst… pm\/sources\.json is not valid JSON \(.*\)\. Fix that spot/); assert.doesNotMatch(bad.stderr, /^\s+at |node:internal/m);
  fs.rmSync(path.join(d, "pm", "sources.json"));
  const gone = bash(script, d); assert.equal(gone.status, 1); assert.match(gone.stderr, /pm\/sources\.json is missing\. First, locally: npx github:nosy-hq\/nosy setup \./);
});

test("no leftover old (Turkish) folder or file names in what the tools and the Action run", () => {
  const skip = new Set(["doctor.mjs", "hints.mjs", "find-sources.mjs", "verify-setup.mjs", "read-matrix.mjs", "cite-check.mjs", "loaded.mjs", "health.mjs", "next.mjs", "nosy.mjs", "sources-file.mjs"]);
  for (const f of fs.readdirSync(Tool).filter(f => f.endsWith(".mjs") && !skip.has(f))) {
    const code = fs.readFileSync(path.join(Tool, f), "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
    assert.doesNotMatch(code, /["'`/](durum|kaynaklar|kararlar|gunluk|rakipler)[/"'`.]/, `${f} points at an old name`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "docs", "examples", "nosy-weekly.yml"), "utf8"), /durum|kaynaklar/);
  // sources.json's matrix key is `matrix` now (nudge used to read the old `matris`).
  assert.doesNotMatch(fs.readFileSync(path.join(Tool, "nudge.mjs"), "utf8"), /K\.matris/);
});

// ---- 2: the command a hint names is one that runs ------------------------------------------------------------------------------------
test("nosyCommand: a global nosy on PATH, else the installed path, else the npx form; NOSY_COMMAND overrides; paths are quoted", () => {
  const here = tmp(), tools = path.join(here, ".claude", "skills", "nosy", "tools"); fs.mkdirSync(tools, { recursive: true });
  const self = path.join(tools, "nosy.mjs"); fs.writeFileSync(self, "");
  const env = PATH => ({ PATH, NOSY_COMMAND: "" });
  assert.equal(nosyCommand("setup .", { env: env(bin()), cwd: here, self }), "node .claude/skills/nosy/tools/nosy.mjs setup .");
  assert.equal(nosyPrefix({ env: env(bin()), cwd: path.join(here, ".claude"), self }), "node skills/nosy/tools/nosy.mjs");
  assert.equal(nosyPrefix({ env: env(bin()), cwd: tmp(), self }), `node ${self}`, "outside the folder: the absolute path");
  const spaced = path.join(tmp(), "My Repo (v2)"); fs.mkdirSync(spaced); fs.writeFileSync(path.join(spaced, "nosy.mjs"), "");
  assert.equal(nosyPrefix({ env: env(bin()), cwd: spaced, self: path.join(spaced, "nosy.mjs") }), "node nosy.mjs");
  assert.equal(nosyPrefix({ env: env(bin()), cwd: tmp(), self: path.join(spaced, "nosy.mjs") }), `node "${path.join(spaced, "nosy.mjs")}"`);
  // a global `nosy` (a link into a nosy.mjs, as npm makes it) wins; some other program called nosy doesn't
  const g = tmp("nosy-global-"); fs.symlinkSync(self, path.join(g, "nosy"));
  assert.equal(nosyCommand("peek", { env: env(g), cwd: here, self }), "nosy peek");
  const other = tmp("nosy-other-"); fs.writeFileSync(path.join(other, "nosy"), "#!/bin/sh\n"); fs.chmodSync(path.join(other, "nosy"), 0o755);
  assert.match(nosyPrefix({ env: env(other), cwd: here, self }), /^node /);
  // npx's throwaway cache: the npx form, not a path that disappears
  const cache = path.join(tmp(), "_npx", "abc", "node_modules", "nosy", "skill", "tools", "nosy.mjs");
  assert.equal(nosyPrefix({ env: env(bin()), cwd: here, self: cache }), "npx github:nosy-hq/nosy");
  assert.equal(nosyCommand("setup .", { env: { PATH: g, NOSY_COMMAND: "my-nosy" }, self }), "my-nosy setup .");
});

test("install ends with the command that really runs, and the hints from the installed copy use it", () => {
  const p = tmp("nosy-inst-"); git(p, "init", "-q", "-b", "main");
  const env = { PATH: bin(), ...bare };
  const r = nosy(p, ["install"], env);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Without an agent, in a terminal: `node \.claude\/skills\/nosy\/tools\/nosy\.mjs setup \.`, then `node \.claude\/skills\/nosy\/tools\/nosy\.mjs peek`/);
  const installed = path.join(p, ".claude", "skills", "nosy", "tools", "nosy.mjs");
  assert.equal(nosy(p, ["--version"], env, installed).output.trim(), `nosy ${version}`, "the printed path runs");
  const hint = nosy(p, ["peek"], env, installed);
  assert.equal(hint.code, 1); assert.match(hint.error, /Run `node \.claude\/skills\/nosy\/tools\/nosy\.mjs setup \.`/); assert.doesNotMatch(hint.error, /`nosy setup/);
  const menu = nosy(p, [], env, installed); assert.match(menu.output, /1\. node \.claude\/skills\/nosy\/tools\/nosy\.mjs setup/);
  // another folder is named too
  const g = tmp("nosy-global-"); fs.symlinkSync(NOSY, path.join(g, "nosy"));
  assert.match(nosy(p, ["install", "--dry-run"], { PATH: g, ...bare }).output, /Nothing to do|would/);
  const real = nosy(tmp("nosy-inst2-"), ["install"], { PATH: g, ...bare });
  assert.match(real.output, /Without an agent, in a terminal: `nosy setup \.`, then `nosy peek`/);
  assert.doesNotMatch(real.output, /there is no global/);
});

// ---- 3: git missing or not a repo -----------------------------------------------------------------------------------------------------
test("git missing: peek, shipped, psst, weekly and setup say to install git (one line, exit 1), never a stack trace or 'not a git repo'", () => {
  const d = product(), env = { PATH: bin(), ...bare };
  for (const args of [["peek"], ["shipped"], ["psst"], ["weekly"], ["notes"], ["inventory"], ["canwe", "x"]]) {
    const r = nosy(d, args, env);
    assert.equal(r.code, 1, args.join(" ")); noTrace(r);
    assert.match(r.error, /^Psst… git isn't installed \(or isn't on your PATH\): install it from https:\/\/git-scm\.com\/downloads/, args.join(" "));
    assert.equal(r.error.trim().split("\n").length, 1, `${args.join(" ")}: one line`);
    assert.doesNotMatch(r.output, /Nothing found/, "no silent 'nothing found'");
  }
  const s = nosy(d, ["setup", "."], env);
  assert.equal(s.code, 1); noTrace(s);
  assert.match(both(s), /git isn't installed/); assert.doesNotMatch(both(s), /not a git repo/);
  const empty = tmp(); const t = nosy(empty, ["setup", "."], env);
  assert.equal(t.code, 1); assert.match(both(t), /git isn't installed/);
});

test("no pm/ at all: page says how to make one (exit 1), not an ENOENT trace; doctor and peek too", () => {
  const d = tmp();
  for (const args of [["page"], ["peek"], ["shipped"], ["psst"], ["weekly"]]) {
    const r = nosy(d, args); assert.equal(r.code, 1, args.join(" ")); noTrace(r);
    assert.match(r.error, /^Psst… no pm\/ folder here\..*`nosy setup \.`/s, args.join(" "));
    assert.doesNotMatch(both(r), /ENOENT/);
  }
  const doc = nosy(d, ["doctor"]); assert.equal(doc.code, 1); assert.match(doc.error, /no pm\/ yet\? `nosy setup \.`/);
  assert.equal(fs.existsSync(path.join(d, "pm")), false, "nothing was created");
});

// ---- 4: BOM ---------------------------------------------------------------------------------------------------------------------------
test("sources-file: a leading BOM is not part of the JSON; parse errors stay errors", () => {
  assert.equal(stripBom("\uFEFF{}"), "{}"); assert.deepEqual(parseJson("\uFEFF{\"a\":1}"), { a: 1 });
  assert.throws(() => parseJson("\uFEFF{"), SyntaxError);
  const d = tmp(); fs.writeFileSync(path.join(d, "sources.json"), "\uFEFF" + JSON.stringify({ repo: "/abs/repo", ref: "main" }));
  assert.deepEqual(readSources(d), { repo: "/abs/repo", ref: "main" });
  assert.throws(() => readSources(path.join(d, "nope")));
});

test("a UTF-8 BOM in pm/sources.json (PowerShell, old Notepad) is read everywhere, not reported 'missing'", () => {
  const d = product(), f = path.join(d, "pm", "sources.json");
  fs.writeFileSync(f, "\uFEFF" + fs.readFileSync(f, "utf8"));
  for (const args of [["peek"], ["check"], ["doctor", "--check"], ["facts"], ["inventory"]]) {
    const r = nosy(d, args); noTrace(r);
    assert.doesNotMatch(both(r), /is missing|not valid JSON|isn't valid JSON|Unexpected token/, args.join(" "));
    assert.ok(r.code === 0 || r.code === 2, `${args.join(" ")} exit ${r.code}: ${r.error}`);
  }
  assert.match(nosy(d, ["doctor", "--check"]).output, /sources\.json reads/);
});

// ---- 5: `repo: "."` from another folder, and MCP --------------------------------------------------------------------------------------
test("resolveRepo: '.' is the repo the pm/ lives in, wherever Nosy runs from; an absolute or Windows path is left alone", () => {
  const d = tmp(); git(d, "init", "-q", "-b", "main"); fs.mkdirSync(path.join(d, "docs", "pm"), { recursive: true });
  const other = tmp();
  assert.equal(resolveRepo(path.join(d, "docs", "pm"), ".", { cwd: other }), d, "the repo root above a nested pm/");
  assert.equal(resolveRepo(path.join(d, "docs", "pm"), ".", { cwd: d }), d, "run from the repo root: as it always was");
  assert.equal(resolveRepo(path.join(d, "docs", "pm"), ".", { cwd: path.join(d, "docs") }), d);
  fs.mkdirSync(path.join(d, "pm")); assert.equal(resolveRepo(path.join(d, "pm"), ".", { cwd: other }), d);
  assert.equal(resolveRepo("pm", "/abs/x"), "/abs/x"); assert.equal(resolveRepo("pm", "C:\\Users\\x\\repo"), "C:\\Users\\x\\repo");
  assert.equal(resolveRepo("pm", undefined), undefined);
});

test("a relative repo works from another folder: --pm <abs> from elsewhere runs (no git stack trace)", () => {
  const d = product(), elsewhere = tmp();
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, "pm", "sources.json"), "utf8")).repo, ".");
  for (const args of [["peek"], ["shipped"], ["psst"], ["inventory"]]) {
    const r = nosy(elsewhere, [...args, "--pm", path.join(d, "pm")]); noTrace(r);
    assert.ok(r.code === 0 || r.code === 2, `${args.join(" ")} exit ${r.code}: ${r.error}`);
    assert.doesNotMatch(both(r), /not a git repository/);
  }
});

const mcp = (cwd, env, ...msgs) => {
  const r = spawnSync(process.execPath, [NOSY, "mcp"], { cwd, encoding: "utf8", env: { ...process.env, ...env }, input: msgs.map(m => JSON.stringify({ jsonrpc: "2.0", ...m })).join("\n") + "\n" });
  return r.stdout.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
};
test("MCP: a relative repo works from the client's folder; a missing pm/ or repo is a JSON-RPC error carrying the fix; version is real", () => {
  const d = product(), elsewhere = tmp();
  const [init, ok] = mcp(elsewhere, { NOSY_PM: path.join(d, "pm") }, { id: 1, method: "initialize", params: {} }, { id: 2, method: "tools/call", params: { name: "nosy_peek", arguments: {} } });
  assert.equal(init.result.serverInfo.version, version);
  assert.equal(ok.result.isError, false, JSON.stringify(ok)); assert.match(ok.result.content[0].text, /Delivery/);
  // no pm/ where the client starts it
  const [none] = mcp(elsewhere, { NOSY_PM: "" }, { id: 3, method: "tools/call", params: { name: "nosy_peek", arguments: {} } });
  assert.equal(none.error.code, -32000); assert.match(none.error.message, /^Psst… no pm\/ folder here.*NOSY_PM.*absolute path/s); assert.doesNotMatch(none.error.message, /\n\s+at /);
  // a repo that isn't there (an owner-machine path)
  const f = path.join(d, "pm", "sources.json"), K = JSON.parse(fs.readFileSync(f, "utf8")); K.repo = "/nowhere/on/this/machine"; fs.writeFileSync(f, JSON.stringify(K));
  const [bad] = mcp(elsewhere, { NOSY_PM: path.join(d, "pm") }, { id: 4, method: "tools/call", params: { name: "nosy_psst", arguments: {} } });
  assert.match(bad.error.message, /`repo` in pm\/sources\.json \(\/nowhere\/on\/this\/machine\) isn't a git repo.*Fix `repo`/); assert.doesNotMatch(bad.error.message, /\n\s+at /);
  // an unknown tool is still its own error
  const [unk] = mcp(elsewhere, {}, { id: 5, method: "tools/call", params: { name: "nosy_nope" } });
  assert.equal(unk.error.code, -32602);
});

// ---- 6: an older Nosy's pm/ -----------------------------------------------------------------------------------------------------------
function oldProduct() {
  const d = tmp("nosy-old-"); git(d, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(d, "README.md"), "# x\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "start");
  fs.mkdirSync(path.join(d, "pm", "durum"), { recursive: true });
  fs.writeFileSync(path.join(d, "pm", "kaynaklar.json"), JSON.stringify({ repo: ".", ref: "main", matris: "pm/matris.json" }));
  fs.writeFileSync(path.join(d, "pm", "durum", "durum.json"), "{}"); fs.writeFileSync(path.join(d, "pm", "urun.md"), "x\n");
  return d;
}
test("an older Nosy's pm/: commands say 'run doctor --fix' (not setup), setup refuses to write a second sources.json", () => {
  const d = oldProduct();
  assert.deepEqual(oldLayout(path.join(d, "pm")).sort(), ["durum", "kaynaklar.json", "urun.md"]);
  for (const args of [["peek"], ["shipped"], ["psst"], ["canwe", "x"], ["weekly"], ["page"]]) {
    const r = nosy(d, args); assert.equal(r.code, 1, args.join(" ")); noTrace(r);
    assert.match(r.error, /older Nosy \(.*kaynaklar\.json.*\).*`nosy doctor --fix`/s, args.join(" "));
    assert.doesNotMatch(r.error, /Run `nosy setup/);
  }
  const s = nosy(d, ["setup", "."]);
  assert.equal(s.code, 1); assert.match(both(s), /older Nosy.*`nosy doctor --fix`.*second, empty one/s);
  assert.equal(fs.existsSync(path.join(d, "pm", "sources.json")), false, "no duplicate sources.json");
  assert.equal(fs.existsSync(path.join(d, "pm", "matrix.json")), false);
  assert.equal(fs.existsSync(path.join(d, "pm", "state")), false, "and no state/ beside durum/");
});

test("doctor doesn't create pm/state itself (so it never warns about it beside durum/), and --fix then leaves a clean pm/", () => {
  const d = oldProduct();
  const a = nosy(d, ["doctor"]); assert.equal(a.code, 2);
  assert.equal(fs.existsSync(path.join(d, "pm", "state")), false, "read-only doctor writes nothing");
  assert.doesNotMatch(a.output, /both exist/);
  const f = nosy(d, ["doctor", "--fix"]); assert.match(f.output, /durum → state/);
  assert.ok(fs.existsSync(path.join(d, "pm", "state", "status.json")) && fs.existsSync(path.join(d, "pm", "sources.json")));
  assert.equal(fs.existsSync(path.join(d, "pm", "kaynaklar.json")), false);
  assert.match(nosy(d, ["doctor"]).output, /Nothing to fix/);
  assert.equal(nosy(d, ["peek"]).code, 0, "and the commands work again");
});

// ---- 7: version -------------------------------------------------------------------------------------------------------------------------
test("nosy --version, -v and `version` print the package version", () => {
  for (const a of ["--version", "-v", "version"]) { const r = nosy(tmp(), [a]); assert.equal(r.code, 0); assert.equal(r.output.trim(), `nosy ${version}`, a); }
  assert.match(nosy(tmp(), ["help"]).output, /nosy version\s+which Nosy this is/);
});
