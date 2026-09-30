// `doctor --check` must not be kind to a broken install: a manifest that won't parse fails, an installed copy that lost
// a file is flagged, and the fix for a stale copy is a command that runs on this machine (there may be no global `nosy`).
// Plain `nosy doctor` reads a pm/sources.json with a UTF-8 BOM like every other command.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run as runTool, temporary, clean, Tool } from "./helpers.mjs";
import { check, render, exitCode } from "../tools/health.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), REAL_SKILL = path.join(Tool, "..");
const dirs = [];
after(() => dirs.forEach(clean));
const tmp = p => { const d = temporary(p); dirs.push(d); return d; };
const put = (root, files) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), typeof c === "string" ? c : JSON.stringify(c)); } return root; };
const ok = { git: { status: 0, stdout: "git version 2.43.0" }, gh: { status: 0, stdout: "gh version 2.40.0 (2026-01-01)" } };
const runner = (cmd, args, cwd) => {
  if (args[0] === "--version" && cmd in ok) return ok[cmd];
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] });
  return r.error ? { missing: r.error.code === "ENOENT", status: null, stdout: "" } : { status: r.status, stdout: (r.stdout || "").trim() };
};
const line = (R, re) => R.lines.find(l => re.test(l.what));
const checkHere = (o = {}) => check({ cwd: tmp("nosy-cwd-"), home: tmp("nosy-home-"), env: {}, run: runner, ...o });

// A complete fake plugin with the real skill folder's data files, so only what a test changes is wrong.
function plugin(extra = {}) {
  const root = tmp("nosy-plugin-");
  put(root, {
    "package.json": { name: "nosy", version: "1.2.3" }, ".claude-plugin/plugin.json": { name: "nosy", version: "1.2.3", skills: ["./skill/"] },
    "commands/peek.md": "x", "skill/SKILL.md": "---\nname: nosy\ndescription: x\n---\n# Nosy\n", "skill/rules.md": "x", "skill/tools/nosy.mjs": "", "skill/tools/next.mjs": "",
    "skill/data/rules.json": "[]", "skill/data/lang/tr/renames.json": "{}", "skill/commands/peek.md": "x", ...extra,
  });
  return root;
}

test("a plugin.json that won't parse is a hard failure, never 'Healthy'", async () => {
  for (const [name, body] of [["truncated", "{bad"], ["empty", ""], ["null", "null"], ["a list", "[]"]]) {
    const root = plugin({ ".claude-plugin/plugin.json": body });
    const R = await checkHere({ skill: path.join(root, "skill") });
    const l = line(R, /plugin\.json isn't valid/);
    assert.ok(l, `${name}: no line about plugin.json`);
    assert.equal(l.level, "fail", name); assert.match(l.fix, /\/plugin uninstall nosy@nosy/, name);
    assert.equal(exitCode(R), 2, name); assert.doesNotMatch(render(R), /Healthy/, name);
    assert.equal(line(R, /no plugin manifest/), undefined, `${name}: must not be called 'fine for a skill-only install'`);
  }
  // No manifest at all is still just a note (a skill-only install), and a good one is still healthy.
  const none = plugin(); fs.rmSync(path.join(none, ".claude-plugin"), { recursive: true });
  assert.equal(line(await checkHere({ skill: path.join(none, "skill") }), /no plugin manifest/).level, "note");
  assert.equal(exitCode(await checkHere({ skill: path.join(plugin(), "skill") })), 0);
});

test("a manifest with a BOM still reads", async () => {
  const root = plugin({ ".claude-plugin/plugin.json": "﻿" + JSON.stringify({ name: "nosy", version: "1.2.3", skills: ["./skill/"] }) });
  const R = await checkHere({ skill: path.join(root, "skill") });
  assert.equal(line(R, /plugin manifest read/).level, "ok"); assert.equal(exitCode(R), 0);
});

test("an installed copy that lost a file is flagged, and the fix is the runnable update command", async () => {
  const proj = tmp("nosy-proj-");
  const inst = runTool(path.join(Tool, "install.mjs"), ["install", "--dir", proj, "--providers", "codex"]);
  assert.equal(inst.code, 0, inst.error);
  const copy = path.join(proj, ".agents", "skills", "nosy");
  const healthy = await check({ cwd: proj, skill: REAL_SKILL, home: tmp("nosy-home-"), env: {}, run: runner });
  assert.match(line(healthy, /skill copies found/)?.what || "", /Codex here/);
  const victim = fs.readdirSync(path.join(copy, "commands"))[0];
  fs.rmSync(path.join(copy, "commands", victim));
  const R = await check({ cwd: proj, skill: REAL_SKILL, home: tmp("nosy-home-"), env: {}, run: runner });
  const l = line(R, /Codex here.*damaged/);
  assert.ok(l, "a copy with a missing file passed as healthy"); assert.equal(l.level, "warn");
  assert.match(l.what, new RegExp(`missing .*${victim.replace(".", "\\.")}`));
  assert.equal(l.fix, "`nosy update` puts them back"); // NOSY_COMMAND is pinned to `nosy` by helpers.mjs
  assert.equal(line(R, /skill copies found/), undefined);
  // The command it names really repairs the copy.
  const fixed = runTool(NOSY, ["update", "--dir", proj]);
  assert.equal(fixed.code, 0, fixed.error);
  assert.ok(fs.existsSync(path.join(copy, "commands", victim)));
});

test("the stale-copy fix names a command that runs here, not a global `nosy` that may not exist", async () => {
  const cwd = tmp("nosy-cwd-"), root = plugin(), emptyBin = tmp("nosy-bin-");
  put(cwd, { ".claude/skills/nosy/SKILL.md": "x", ".claude/skills/nosy/.nosy-install.json": { version: "0.0.1" } });
  const saved = { NOSY_COMMAND: process.env.NOSY_COMMAND, PATH: process.env.PATH };
  try {
    delete process.env.NOSY_COMMAND; process.env.PATH = emptyBin; // no global nosy, no override
    const R = await checkHere({ cwd, skill: path.join(root, "skill") });
    const l = line(R, /Claude Code here.*version 0\.0\.1/);
    assert.match(l.fix, /^`node .*nosy\.mjs"? update`$/); assert.doesNotMatch(l.fix, /^`nosy /);
    process.env.NOSY_COMMAND = "npx github:nosy-hq/nosy";
    assert.equal(line(await checkHere({ cwd, skill: path.join(root, "skill") }), /version 0\.0\.1/).fix, "`npx github:nosy-hq/nosy update`");
  } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
});

test("plain `nosy doctor` reads a sources.json with a BOM (the invisible byte is not a typo to fix by hand)", () => {
  const dir = tmp("nosy-bom-"), pm = path.join(dir, "pm");
  put(pm, { "sources.json": "﻿" + JSON.stringify({ repo: ".", name: "acme" }), "product.md": "# Acme\n", "state/waves.json": "﻿{}" });
  const r = runTool(NOSY, ["doctor", "--pm", pm], { cwd: dir });
  assert.doesNotMatch(r.output + r.error, /isn't valid JSON|Unexpected token/, r.output + r.error);
  // A real typo is still reported, with where.
  put(pm, { "sources.json": "{ bad" });
  assert.match(runTool(NOSY, ["doctor", "--pm", pm], { cwd: dir }).output, /sources\.json isn't valid JSON/);
});

test("the install marker (committed with the folder) names its source as a label, never the installing machine's own path", () => {
  const proj = tmp("nosy-marker-");
  const r = runTool(path.join(Tool, "install.mjs"), ["install", "--dir", proj, "--providers", "claude,codex"]);
  assert.equal(r.code, 0, r.error);
  for (const d of [".claude/skills/nosy", ".agents/skills/nosy"]) {
    const text = fs.readFileSync(path.join(proj, d, ".nosy-install.json"), "utf8"), m = JSON.parse(text);
    assert.equal(m.source, "github:nosy-hq/nosy"); assert.equal(m.tool, "nosy install"); assert.ok(m.version && m.files > 10);
    for (const local of [proj, fs.realpathSync(proj), path.resolve(Tool, ".."), os.tmpdir(), os.homedir()]) assert.ok(!text.includes(local), `the marker names ${local}`);
    assert.doesNotMatch(text, /(^|["\s])\/(Users|home|private|var|tmp)\//, "no absolute path at all");
  }
  // update still finds and refreshes the copies by their marker.
  const u = runTool(NOSY, ["update", "--dir", proj]);
  assert.equal(u.code, 0, u.error); assert.match(u.output, /refreshed/);
});
