// install.mjs: the skill copied into each agent's folder, with a marker so update/uninstall only touch what it
// wrote. Temp projects (and a temp HOME for --global); no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const project = (...signs) => { const d = temporary("nosy-install-"); dirs.push(d); for (const s of signs) s.endsWith("/") ? fs.mkdirSync(path.join(d, s), { recursive: true }) : fs.writeFileSync(path.join(d, s), ""); return d; };
// Uninstall also clears the hooks' small memo files from the temp folder: point them at a throwaway folder, not the real one.
const memos = temporary("nosy-memos-"); dirs.push(memos);
const ENV = { ...process.env, NOSY_STATE_DIR: memos, NOSY_NUDGE_DIR: memos };
const nosy = (...a) => run(NOSY, a, { env: ENV });

test("detects the agents a project uses and installs for exactly those", () => {
  const d = project(".cursor/", "AGENTS.md");
  const r = nosy("install", "--dir", d);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Found: Codex, Cursor\./);
  for (const p of [".agents/skills/nosy", ".cursor/skills/nosy"]) {
    assert.ok(fs.existsSync(path.join(d, p, "SKILL.md")), `${p}/SKILL.md`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(d, p, ".nosy-install.json"), "utf8")).tool, "nosy install");
  }
  assert.ok(!fs.existsSync(path.join(d, ".claude")), "no folder for an agent that isn't there");
  assert.ok(!fs.existsSync(path.join(d, ".agents/skills/nosy/test")), "the test folder isn't copied");
});

test("nothing detected: Claude Code and the shared .agents folder; --providers picks exactly", () => {
  const d = project();
  assert.match(nosy("install", "--dir", d).output, /No coding agent's folder found here; installing for Claude Code and Codex/);
  assert.ok(fs.existsSync(path.join(d, ".claude/skills/nosy/SKILL.md")) && fs.existsSync(path.join(d, ".agents/skills/nosy/SKILL.md")));
  const e = project();
  nosy("install", "--dir", e, "--providers", "gemini");
  assert.deepEqual(fs.readdirSync(e), [".gemini"]);
  assert.equal(nosy("install", "--dir", e, "--providers", "vim").code, 1);
});

test("the installed copy runs on its own: its tools find their data files", () => {
  const d = project(".claude/");
  nosy("install", "--dir", d);
  const tools = path.join(d, ".claude/skills/nosy/tools");
  const h = run(path.join(tools, "nosy.mjs"), ["help"]);
  assert.equal(h.code, 0, h.error); assert.match(h.output, /nosy install/);
  const x = run(path.join(tools, "explain.mjs"), []);
  assert.equal(x.code, 0, x.error);
  const k = run(path.join(tools, "doctor.mjs"), [path.join(d, "nope")]);
  assert.equal(k.code, 1, "doctor loads its rename map and runs");
});

test("dry run writes nothing; a second install refreshes; update touches only what install wrote", () => {
  const d = project(".cursor/");
  assert.match(nosy("install", "--dir", d, "--dry-run").output, /would install \.cursor\/skills\/nosy/);
  assert.ok(!fs.existsSync(path.join(d, ".cursor/skills")));
  nosy("install", "--dir", d);
  fs.writeFileSync(path.join(d, ".cursor/skills/nosy/stale.txt"), "from an older version");
  assert.match(nosy("install", "--dir", d).output, /refreshed/);
  assert.ok(!fs.existsSync(path.join(d, ".cursor/skills/nosy/stale.txt")), "a refresh replaces the folder, no leftovers");
  const u = nosy("update", "--dir", d);
  assert.match(u.output, /Cursor: refreshed/); assert.doesNotMatch(u.output, /Claude Code/);
});

test("a nosy folder it didn't write is never overwritten or removed", () => {
  const d = project(".claude/");
  fs.mkdirSync(path.join(d, ".claude/skills/nosy"), { recursive: true });
  fs.writeFileSync(path.join(d, ".claude/skills/nosy/SKILL.md"), "mine");
  assert.match(nosy("install", "--dir", d).output, /wasn't written by nosy install; left alone/);
  assert.match(nosy("uninstall", "--dir", d).output, /not written by nosy install \(no marker\); left alone/);
  assert.equal(fs.readFileSync(path.join(d, ".claude/skills/nosy/SKILL.md"), "utf8"), "mine");
});

test("uninstall removes what it wrote and an emptied skills folder, never the agent's own folder", () => {
  const d = project(".cursor/");
  fs.writeFileSync(path.join(d, ".cursor/rules.mdc"), "keep");
  nosy("install", "--dir", d);
  const r = nosy("uninstall", "--dir", d);
  assert.match(r.output, /Cursor: removed \.cursor\/skills\/nosy/);
  assert.deepEqual(fs.readdirSync(path.join(d, ".cursor")), ["rules.mdc"]);
  assert.match(nosy("uninstall", "--dir", d).output, /Nothing to remove/);
});

test("--global uses the user folder, only for agents that have one; Nosy's own repo is refused", () => {
  const home = temporary("nosy-home-"); dirs.push(home);
  const r = run(NOSY, ["install", "--global", "--providers", "claude,cursor"], { env: { ...process.env, HOME: home } });
  assert.ok(fs.existsSync(path.join(home, ".claude/skills/nosy/SKILL.md")));
  assert.match(r.output, /Cursor: Cursor has no user-level skills folder/);
  const self = nosy("install", "--dir", path.join(Tool, "..", ".."));
  assert.equal(self.code, 1); assert.match(self.error, /Nosy's own repo/);
});

test("tools run through a symlinked skill folder (Nosy's own .claude/skills/nosy, a macOS /var path): not a silent no-op", () => {
  const d = temporary("nosy-link-"); dirs.push(d);
  fs.symlinkSync(path.join(Tool, ".."), path.join(d, "skill-link"));
  const tools = path.join(d, "skill-link", "tools");
  const doc = run(path.join(tools, "doctor.mjs"), [path.join(d, "nope")]);
  assert.equal(doc.code, 1); assert.match(doc.error, /no folder at/);
  const nx = run(path.join(tools, "next.mjs"), [path.join(d, "pm")]);
  assert.match(nx.output, /move-in/);
  const ex = run(path.join(tools, "explain.mjs"), []);
  assert.ok(ex.output.length > 0, "explain lists the rules");
});

// ---- uninstall leaves nothing of Nosy's behind except pm/ ----
import crypto from "node:crypto";
const listing = d => fs.readdirSync(d, { recursive: true }).map(String).sort();

test("uninstall after a default install (no agent folder was there): the folders install made go too, the project is as it was", () => {
  const d = project();
  fs.mkdirSync(path.join(d, "pm")); fs.writeFileSync(path.join(d, "pm", "sources.json"), "{}");
  fs.writeFileSync(path.join(d, "README.md"), "mine");
  const before = listing(d);
  assert.match(nosy("install", "--dir", d).output, /Claude Code: installed \.claude\/skills\/nosy/);
  const marker = JSON.parse(fs.readFileSync(path.join(d, ".agents/skills/nosy/.nosy-install.json"), "utf8"));
  assert.deepEqual(marker.created, [".agents", ".agents/skills"], "the marker lists exactly what install created");
  const r = nosy("uninstall", "--dir", d);
  assert.equal(r.code, 0, r.error);
  assert.deepEqual(listing(d), before, "nothing left but what was there: pm/ and the README are untouched");
  assert.match(r.output, /Left alone: your pm\/ folder \(yours\)\. The Claude Code plugin .* `\/plugin uninstall nosy@nosy`\./);
});

test("uninstall never removes an agent folder that was already there, or anything of the owner's inside skills/", () => {
  const d = project(".cursor/", ".claude/");
  fs.mkdirSync(path.join(d, ".claude/skills/other"), { recursive: true }); fs.writeFileSync(path.join(d, ".claude/skills/other/SKILL.md"), "theirs");
  nosy("install", "--dir", d, "--providers", "claude,cursor");
  const marker = c => JSON.parse(fs.readFileSync(path.join(d, c, ".nosy-install.json"), "utf8")).created;
  assert.deepEqual(marker(".claude/skills/nosy"), [], ".claude and .claude/skills were already there");
  assert.deepEqual(marker(".cursor/skills/nosy"), [".cursor/skills"], "only skills/ was new under .cursor");
  nosy("uninstall", "--dir", d);
  assert.deepEqual(listing(d), [".claude", ".claude/skills", ".claude/skills/other", ".claude/skills/other/SKILL.md", ".cursor"]);
});

test("a refresh and an update keep the record of what install created, so uninstall still cleans up", () => {
  const d = project();
  nosy("install", "--dir", d, "--providers", "codex"); nosy("install", "--dir", d, "--providers", "codex"); nosy("update", "--dir", d);
  fs.writeFileSync(path.join(d, ".agents/skills/.DS_Store"), "finder");
  nosy("uninstall", "--dir", d);
  assert.deepEqual(listing(d), [], "even a Finder .DS_Store doesn't keep an empty .agents/skills alive");
});

test("a copy made by an older install (marker without the list) loses its emptied skills/ folder but never the agent folder", () => {
  const d = project();
  nosy("install", "--dir", d, "--providers", "gemini");
  const mf = path.join(d, ".gemini/skills/nosy/.nosy-install.json"), m = JSON.parse(fs.readFileSync(mf, "utf8"));
  delete m.created; fs.writeFileSync(mf, JSON.stringify(m));
  nosy("uninstall", "--dir", d);
  assert.deepEqual(listing(d), [".gemini"]);
});

test("uninstall clears the hooks' temp memos for this project only; a dry run changes nothing", () => {
  const d = project(), other = project();
  const memoOf = pmDir => path.join(memos, `nosy-nudge-${crypto.createHash("sha1").update(path.resolve(pmDir)).digest("hex").slice(0, 12)}.json`);
  // macOS temp folders resolve through /var -> /private/var; the hook hashes what git and cwd report, so cover both spellings.
  const mine = [memoOf(path.join(d, "pm")), memoOf(path.join(fs.realpathSync(d), "pm"))], theirs = memoOf(path.join(other, "pm")), marker = path.join(memos, "nosy-loaded.json");
  const write = () => { for (const f of [...mine, theirs, marker]) fs.writeFileSync(f, "{}"); };
  nosy("install", "--dir", d); write();
  nosy("uninstall", "--dir", d, "--dry-run");
  assert.ok(fs.existsSync(path.join(d, ".claude/skills/nosy/SKILL.md")) && [...mine, theirs, marker].every(f => fs.existsSync(f)), "dry run removes nothing");
  nosy("uninstall", "--dir", d);
  assert.ok(mine.every(f => !fs.existsSync(f)) && !fs.existsSync(marker), "this project's memos and the first-run marker are gone");
  assert.ok(fs.existsSync(theirs), "another project's memo is not ours to touch");
  fs.rmSync(theirs, { force: true });
  nosy("uninstall", "--dir", d); // nothing to remove: memos are only touched when something was removed
});

test("--global uninstall: removes the user-folder copy and the folders it created there, not a pre-existing ~/.claude", () => {
  const home = temporary("nosy-home-"); dirs.push(home);
  fs.mkdirSync(path.join(home, ".claude"));
  const env = { ...ENV, HOME: home };
  run(NOSY, ["install", "--global", "--providers", "claude,codex"], { env });
  assert.ok(fs.existsSync(path.join(home, ".agents/skills/nosy/SKILL.md")));
  const r = run(NOSY, ["uninstall", "--global"], { env });
  assert.equal(r.code, 0, r.error);
  assert.deepEqual(listing(home), [".claude"], ".agents (made by install) is gone, .claude (already there) stays");
});

test("a nosy folder that install didn't write is never removed by uninstall", () => {
  const d = project(); fs.mkdirSync(path.join(d, ".claude/skills/nosy"), { recursive: true }); fs.writeFileSync(path.join(d, ".claude/skills/nosy/SKILL.md"), "mine");
  const r = nosy("uninstall", "--dir", d);
  assert.match(r.output, /not written by nosy install \(no marker\); left alone/);
  assert.ok(fs.existsSync(path.join(d, ".claude/skills/nosy/SKILL.md")));
});
