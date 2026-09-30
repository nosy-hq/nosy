// loaded.mjs: the "is Nosy loaded?" lines (version, commands, hooks on/off, pm/ found or absent + the next command),
// said once by the SessionStart hook and every time by `/nosy` with no command. Temp folders only; no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { status, render, invoke, HOOKS, hookOff, claimFirstRun, versionOf } from "../tools/loaded.mjs";

const HOOK = path.join(Tool, "..", "..", "hooks", "psst-summary.mjs"), NEXT = path.join(Tool, "next.mjs"), NOSY = path.join(Tool, "nosy.mjs");
const REPO = path.join(Tool, "..", "..");
const dirs = [];
after(() => dirs.forEach(clean));
const tmp = p => { const d = temporary(p); dirs.push(d); return d; };
const withPm = (files = {}) => { const d = tmp("nosy-loaded-"); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };
// A hook run with its own state folder, so the marker never leaks between tests (or into the real temp folder).
const hook = (cwd, state, env = {}) => run(HOOK, [], { input: JSON.stringify({ cwd }), env: { ...process.env, NOSY_STATE_DIR: state, ...env } });

test("status: counts the commands, reads the hooks and the pm/ state", () => {
  const L = status({ cwd: withPm(), env: {} });
  assert.equal(L.version, JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).version);
  assert.equal(L.commands, fs.readdirSync(path.join(REPO, "commands")).filter(f => f.endsWith(".md")).length);
  assert.ok(L.commands >= 17);
  assert.equal(L.hooksInstalled, true);
  assert.deepEqual(L.hooks.map(h => h.on), [true, true, true, true]);
  assert.equal(L.pm.state, "none");
  assert.equal(status({ cwd: withPm({ "pm/sources.json": "{}" }), env: {} }).pm.state, "ready");
  assert.equal(status({ cwd: withPm({ "pm/sources.json": "{ nope" }), env: {} }).pm.state, "broken");
  assert.equal(status({ cwd: withPm({ "pm/kaynaklar.json": "{}" }), env: {} }).pm.state, "older");
  assert.equal(status({ cwd: withPm({ "pm/notes.md": "x" }), env: {} }).pm.state, "empty");
});

test("status: a skill copied without the plugin has no hooks, and says so", () => {
  const skill = tmp("nosy-skillonly-");
  fs.mkdirSync(path.join(skill, "skill", "commands"), { recursive: true });
  for (const c of ["a", "b", "c"]) fs.writeFileSync(path.join(skill, "skill", "commands", `${c}.md`), "x");
  const L = status({ cwd: withPm(), env: {}, skill: path.join(skill, "skill") });
  assert.equal(L.commands, 3);
  assert.equal(L.hooksInstalled, false);
  assert.match(render(L, { prefix: "/nosy " }), /Hooks: none, this is the skill without the plugin \(the plugin adds them: \/plugin install nosy@nosy\)\./);
});

test("a plugin has no bare /nosy: the top-level skill is /nosy:nosy there, /nosy in a skill-only install", () => {
  assert.equal(invoke({ CLAUDE_PLUGIN_ROOT: "/x/nosy" }), "/nosy:nosy");
  assert.equal(invoke({}), "/nosy");
  const L = status({ cwd: withPm(), env: {} });
  assert.match(render(L, { prefix: "/nosy:" }), /\(\/nosy:nosy lists them\)/);
  assert.doesNotMatch(render(L, { prefix: "/nosy:" }), /\/nosy lists them/);
  assert.match(render(L, { prefix: "/nosy " }), /\(\/nosy lists them\)/);
});

test("hook switches: either one turns a hook off (an option left at \"false\" never shadows the env var); every switch is the one its hook file reads", () => {
  const h = HOOKS[0];
  assert.equal(hookOff(h, { NOSY_NO_PSST: "1" }), true);
  assert.equal(hookOff(h, { NOSY_NO_PSST: "0" }), false);
  assert.equal(hookOff(h, { CLAUDE_PLUGIN_OPTION_DISABLE_PSST_HOOK: "false", NOSY_NO_PSST: "1" }), true, "an option at \"false\" (Claude Code's exported default) does not shadow the env switch");
  assert.equal(hookOff(h, { CLAUDE_PLUGIN_OPTION_DISABLE_PSST_HOOK: "false" }), false);
  assert.equal(hookOff(h, { CLAUDE_PLUGIN_OPTION_DISABLE_PSST_HOOK: "true" }), true);
  for (const x of HOOKS) assert.equal(hookOff(x, { [x.option]: "false", [x.env]: "1" }), true, `${x.env} with ${x.option}=false`);
  for (const x of HOOKS) {
    const src = fs.readFileSync(path.join(REPO, "hooks", x.file), "utf8");
    assert.ok(src.includes(x.option) && src.includes(x.env), `${x.file} reads ${x.option} / ${x.env}`);
    assert.ok(fs.readFileSync(path.join(REPO, "hooks", "hooks.json"), "utf8").includes(x.file), `${x.file} is wired in hooks.json`);
  }
});

test("render: three lines; off hooks are named with their switch; the next command only when asked", () => {
  const L = status({ cwd: withPm(), env: { NOSY_NO_NUDGE: "1", NOSY_NO_PSST: "1" } });
  const out = render(L);
  assert.equal(out.split("\n").length, 3);
  assert.match(out, /^Nosy \S+ is loaded: \d+ commands/);
  assert.match(out, /Hooks on: never-check, reference check\. Off: opening summary \(NOSY_NO_PSST\), after-commit nudge \(NOSY_NO_NUDGE\)\./);
  assert.match(out, /No pm\/ here yet: run \/nosy:move-in to set Nosy up for this repo\./);
  assert.match(render(L, { prefix: "/nosy " }), /run \/nosy move-in to set Nosy up/);
  assert.match(render(L, { prefix: "nosy ", moveIn: "nosy setup ." }), /run nosy setup \. to set Nosy up/);
  assert.doesNotMatch(render(L, { nextStep: false }), /move-in/, "where the picks below say it, the line doesn't");
  assert.match(render(status({ cwd: withPm({ "pm/kaynaklar.json": "{}" }), env: {} })), /older Nosy: run \/nosy:doctor/);
  assert.match(render(status({ cwd: withPm({ "pm/sources.json": "{ x" }), env: {} })), /can't be read.*nosy doctor --check/);
});

test("claimFirstRun: true once, then never; false (silent) when it can't remember", () => {
  const state = tmp("nosy-state-"), env = { NOSY_STATE_DIR: path.join(state, "deep", "er") };
  assert.equal(claimFirstRun({ env, version: "9.9.9" }), true);
  assert.equal(claimFirstRun({ env, version: "9.9.9" }), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(env.NOSY_STATE_DIR, "nosy-loaded.json"), "utf8")).version, "9.9.9");
  const blocked = path.join(state, "file"); fs.writeFileSync(blocked, "x");
  assert.equal(claimFirstRun({ env: { NOSY_STATE_DIR: path.join(blocked, "sub") } }), false, "an unwritable folder: no greeting, so no nag");
  assert.equal(typeof versionOf(), "string");
});

test("session hook: the first session after install says the three lines (also with no pm/), the second is quiet again", () => {
  const state = tmp("nosy-state-"), cwd = withPm();
  const r = hook(cwd, state);
  assert.equal(r.code, 0, r.error);
  const out = JSON.parse(r.output);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(out.systemMessage.split("\n").length, 3);
  assert.match(out.systemMessage, /is loaded: \d+ commands/);
  assert.match(out.systemMessage, /Hooks on: opening summary, after-commit nudge, never-check, reference check\./);
  assert.match(out.systemMessage, /No pm\/ here yet: run \/nosy:move-in/);
  const again = hook(cwd, state);
  assert.equal(again.code, 0);
  assert.equal(again.output, "", "no pm/ and already greeted: silent, as the design says");
});

test("session hook: first run in a moved-in folder still carries the usual whisper as context; pm/ is reported as found", () => {
  const state = tmp("nosy-state-"), cwd = withPm({ "pm/sources.json": JSON.stringify({ repo: "." }) });
  const out = JSON.parse(hook(cwd, state).output);
  assert.match(out.systemMessage, /pm\/ found: Nosy has moved in here\./);
  assert.match(out.hookSpecificOutput.additionalContext, /^Psst… next: \/nosy:move-in|^Psst… next: \/nosy:/);
  assert.equal(hook(cwd, state).output.startsWith("Psst… next: /nosy:"), true, "afterwards: the old plain whisper, unchanged");
});

test("session hook: NOSY_NO_PSST and the plugin option keep it fully silent, and leave no marker", () => {
  const state = tmp("nosy-state-"), cwd = withPm();
  assert.equal(hook(cwd, state, { NOSY_NO_PSST: "1" }).output, "");
  assert.equal(hook(cwd, state, { CLAUDE_PLUGIN_OPTION_DISABLE_PSST_HOOK: "true" }).output, "");
  assert.equal(hook(cwd, state, { CLAUDE_PLUGIN_OPTION_DISABLE_PSST_HOOK: "false", NOSY_NO_PSST: "1" }).output, "", "option \"false\" + NOSY_NO_PSST=1: still off");
  assert.ok(!fs.existsSync(path.join(state, "nosy-loaded.json")), "switched off means not even counted as greeted");
  assert.match(JSON.parse(hook(cwd, state).output).systemMessage, /is loaded/, "turned back on: the greeting is still due");
});

test("session hook: an unwritable state folder means silence, never a repeated greeting", () => {
  const state = tmp("nosy-state-"), blocked = path.join(state, "file"); fs.writeFileSync(blocked, "x");
  const cwd = withPm();
  assert.equal(hook(cwd, path.join(blocked, "sub")).output, "");
  assert.equal(hook(cwd, path.join(blocked, "sub")).output, "");
});

test("/nosy with no command (next.mjs and `nosy`) prints the lines first, with no repeat of the move-in command, and --json stays clean", () => {
  const cwd = withPm();
  const r = run(NEXT, ["pm"], { cwd, env: { ...process.env, NOSY_NO_NUDGE: "1" } });
  assert.equal(r.code, 0, r.error);
  const [l1, l2, l3, , l5] = r.output.split("\n");
  assert.match(l1, /^Nosy \S+ is loaded: \d+ commands/);
  assert.match(l2, /^Hooks on: opening summary, never-check, reference check\. Off: after-commit nudge \(NOSY_NO_NUDGE\)\./);
  assert.equal(l3, "No pm/ here yet: Nosy hasn't moved in.");
  assert.match(l5, /^Psst… here's what I'd run next:/);
  assert.match(r.output, /1\. \/nosy:move-in · no pm\/ folder yet/);
  const cli = run(NOSY, [], { cwd });
  assert.match(cli.output, /^Nosy \S+ is loaded/);
  const j = run(NEXT, ["pm", "--json", path.join(cwd, "n.json")], { cwd });
  assert.doesNotMatch(j.output, /is loaded/, "--json is for scripts: no extra lines");
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, "n.json"), "utf8")).type, "next");
  const off = run(NEXT, ["pm", "--prefix", "/nosy "], { cwd, env: { ...process.env, NOSY_NO_PSST: "1" } });
  assert.match(off.output, /Off: opening summary \(NOSY_NO_PSST\)/, "/nosy shows the opening summary as off when NOSY_NO_PSST is set");
});
