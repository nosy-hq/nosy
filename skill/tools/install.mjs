// install: puts Nosy's skill where each coding agent in a project reads skills, in one command
// (`npx github:nosy-hq/nosy install`). Idea from Impeccable's `npx impeccable install`: half of the issues on
// Caveman and Ponytail were setup (pm/inspiration-skill-products.md), and every agent reads skills from its own folder.
//   nosy install   [--dir <project>] [--providers claude,codex,…] [--global] [--dry-run]
//   nosy update    re-copies every install this tool made (found by its marker file)
//   nosy uninstall [--providers …]   removes only folders this tool made; never one it didn't write
// What it writes: a copy of skill/ (without skill/test/) at <agent folder>/skills/nosy/, plus a marker file
// (.nosy-install.json: version, the source label "github:nosy-hq/nosy", when) inside it. A copy, not a link: the npx cache is temporary, and a
// cloud session reads what's committed. It never touches settings files, hooks or anything outside those folders.
// Claude Code's hooks and /nosy:<command> commands come with the plugin; install says so and prints the command.
// Uninstall leaves nothing of Nosy's behind except pm/ (yours): it removes the copies, the agent folders install itself created
// (the marker lists them; an agent folder that was already there is never touched), and the small memo files the hooks keep in the
// temp folder. The plugin is Claude Code's to remove (`/plugin uninstall nosy@nosy`); the output says so.
// Exit (docs/CLI-CONTRACT.md): 0 done or nothing to do · 1 couldn't run.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import crypto from "node:crypto"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { firstRunFile } from "./loaded.mjs";
import { advice, nodeCommandFor, nosyOnPath } from "./hints.mjs";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".nosy-install.json";
// Where the copy came from, as a label that is the same on every machine. The marker is committed with the folder, so it
// must not carry the installing machine's own path (a home folder, npx's temp cache). `update` re-copies from the Nosy that runs it.
const SOURCE = "github:nosy-hq/nosy";
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(SKILL, "..", "package.json"), "utf8")).version; } catch { return "unknown"; } })();

// Where each agent reads project skills, and what in a project says the agent is used there. `global` is the
// user-level folder, only for agents whose docs name one.
export const PROVIDERS = {
  claude:   { name: "Claude Code",    dir: ".claude/skills",   signs: [".claude", "CLAUDE.md"], global: ".claude/skills", invoke: "/nosy (or install the plugin: then /nosy:nosy, /nosy:<command> and the hooks)" },
  codex:    { name: "Codex",          dir: ".agents/skills",   signs: [".codex", ".agents", "AGENTS.md"], global: ".agents/skills", invoke: "$nosy" },
  cursor:   { name: "Cursor",         dir: ".cursor/skills",   signs: [".cursor", ".cursorrules"], invoke: "/nosy" },
  gemini:   { name: "Gemini CLI",     dir: ".gemini/skills",   signs: [".gemini", "GEMINI.md"], invoke: "/nosy" },
  copilot:  { name: "GitHub Copilot", dir: ".github/skills",   signs: [".github/copilot-instructions.md", ".github/instructions"], invoke: "/nosy" },
  opencode: { name: "OpenCode",       dir: ".opencode/skills", signs: [".opencode", "opencode.json"], invoke: "/nosy" },
  kiro:     { name: "Kiro",           dir: ".kiro/skills",     signs: [".kiro"], invoke: "/nosy" },
};
// Nothing detected: the two folders most agents read (Claude Code, and the shared Agent Skills folder Codex uses).
const DEFAULT = ["claude", "codex"];

export function detect(project) {
  return Object.entries(PROVIDERS).filter(([, p]) => p.signs.some(s => fs.existsSync(path.join(project, s)))).map(([k]) => k);
}

// The skill folder's files, test/ left out (it's for developing Nosy, not using it).
function sourceFiles(dir = SKILL, rel = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && e.name === "test") return [];
    if (e.name === MARKER || e.name === ".DS_Store") return [];
    return e.isDirectory() ? sourceFiles(path.join(dir, e.name), r) : [r];
  });
}

const real = p => { try { return fs.realpathSync(p); } catch { return null; } };
// A target that is (or resolves into) this skill folder itself: Nosy's own repo links .claude/skills/nosy → skill/.
const isSelf = target => { const r = real(target); return !!r && (r === real(SKILL) || r.startsWith(real(SKILL) + path.sep)); };
const markerOf = target => { try { return JSON.parse(fs.readFileSync(path.join(target, MARKER), "utf8")); } catch { return null; } };

export function plan(project, { providers = null, global = false, action = "install" } = {}) {
  const home = os.homedir();
  // Nosy's own repo is the source; installing into it would copy the skill into itself.
  if (!global && real(path.join(project, "skill")) === real(SKILL)) return { error: "This is Nosy's own repo (its skill/ is the source). Run install in the project you want Nosy in: `--dir <project>`." };
  const chosen = providers?.length ? providers : action === "install" ? (detect(project).length ? detect(project) : DEFAULT) : Object.keys(PROVIDERS);
  const unknown = chosen.filter(k => !PROVIDERS[k]);
  if (unknown.length) return { error: `unknown provider(s): ${unknown.join(", ")} (known: ${Object.keys(PROVIDERS).join(", ")})` };
  const steps = [];
  for (const k of chosen) {
    const p = PROVIDERS[k];
    if (global && !p.global) { steps.push({ provider: k, skip: `${p.name} has no user-level skills folder Nosy knows; install it per project` }); continue; }
    const target = path.join(global ? home : project, global ? p.global : p.dir, "nosy");
    const marker = markerOf(target), exists = fs.existsSync(target) || !!fs.lstatSync(target, { throwIfNoEntry: false });
    if (isSelf(target)) { steps.push({ provider: k, target, skip: "already the Nosy skill itself (a link to this repo's skill/)" }); continue; }
    if (action === "uninstall") { if (marker) steps.push({ provider: k, target, remove: true, created: Array.isArray(marker.created) ? marker.created : undefined }); else if (exists) steps.push({ provider: k, target, skip: "not written by nosy install (no marker); left alone" }); continue; }
    if (action === "update" && !marker) continue;
    if (exists && !marker) { steps.push({ provider: k, target, skip: "a nosy folder is already there and wasn't written by nosy install; left alone (remove it yourself to install)" }); continue; }
    steps.push({ provider: k, target, copy: true, from: marker?.version || null });
  }
  return { project, global, action, providers: chosen, detected: detect(project), steps };
}

// Folders under `base` that don't exist yet on the way to `target`'s parent: the ones this install is about to create.
const missingChain = (base, target) => { const out = []; for (let d = path.dirname(target); d.startsWith(base + path.sep) && !fs.existsSync(d); d = path.dirname(d)) out.unshift(path.relative(base, d)); return out; };
// A folder counts as empty when only macOS's .DS_Store is in it.
const emptyDir = d => { try { return fs.readdirSync(d).every(f => f === ".DS_Store"); } catch { return false; } };
const tempMemos = (project, env = process.env) => {
  // Both spellings of the folder (macOS temp and symlinked folders resolve to a different real path than they are opened by).
  const roots = new Set([path.join(project, "pm")]);
  try { roots.add(path.join(fs.realpathSync(project), "pm")); } catch {}
  try { roots.add(path.join(execFileSync("git", ["-C", project, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), "pm")); } catch {}
  // The same names the hooks write: after-commit.mjs's per-product memo, loaded.mjs's first-run marker.
  return [...[...roots].map(r => path.join(env.NOSY_NUDGE_DIR || os.tmpdir(), `nosy-nudge-${crypto.createHash("sha1").update(path.resolve(r)).digest("hex").slice(0, 12)}.json`)), firstRunFile(env)];
};

export function apply(P) {
  const files = sourceFiles();
  const base = P.global ? os.homedir() : P.project;
  for (const s of P.steps) {
    if (s.remove) {
      fs.rmSync(s.target, { recursive: true, force: true });
      // What install itself created (skills/ and, when there was none, the agent's own folder), deepest first, only while empty.
      // Anything else in there is the owner's, so it stays; an agent folder that was already there is never on the list.
      for (const rel of [...(s.created || [])].sort((a, b) => b.length - a.length)) {
        const d = path.join(base, rel);
        if (d.startsWith(base + path.sep) && emptyDir(d)) { fs.rmSync(d, { recursive: true, force: true }); }
      }
      // A copy made before install kept a list (no `created` in its marker): an emptied skills/ folder still goes, never the agent's own folder.
      if (s.created === undefined) try { if (!fs.readdirSync(path.dirname(s.target)).length) fs.rmdirSync(path.dirname(s.target)); } catch {}
      continue;
    }
    if (!s.copy) continue;
    const before = markerOf(s.target)?.created || [];
    const created = [...new Set([...before, ...missingChain(base, s.target)])];
    // Replace wholesale: files a newer version dropped don't linger.
    if (markerOf(s.target)) fs.rmSync(s.target, { recursive: true, force: true });
    for (const f of files) { const to = path.join(s.target, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(SKILL, f), to); }
    fs.writeFileSync(path.join(s.target, MARKER), JSON.stringify({ tool: "nosy install", version: VERSION, source: SOURCE, installed: new Date().toISOString(), files: files.length, created }, null, 1) + "\n");
  }
  // The hooks' memo files in the temp folder: per-product nudge memory and the first-run marker. Harmless, but not ours to leave.
  if (P.action === "uninstall" && !P.global && P.steps.some(x => x.remove)) for (const f of tempMemos(P.project)) fs.rmSync(f, { force: true });
}

export function render(P, { dry = false } = {}) {
  if (P.error) return P.error;
  const rel = t => P.global ? t.replace(os.homedir(), "~") : path.relative(P.project, t) || ".";
  const verb = s => s.remove ? (dry ? "would remove" : "removed")
    : s.from === VERSION ? (dry ? `would refresh (${VERSION})` : `refreshed (${VERSION})`)
    : s.from ? (dry ? `would update (${s.from} → ${VERSION})` : `updated (${s.from} → ${VERSION})`)
    : (dry ? "would install" : "installed");
  const lines = [];
  if (P.action === "install" && !P.global) lines.push(P.detected.length ? `Found: ${P.detected.map(k => PROVIDERS[k].name).join(", ")}.` : `No coding agent's folder found here; installing for ${DEFAULT.map(k => PROVIDERS[k].name).join(" and ")} (--providers to choose).`);
  for (const s of P.steps) lines.push(s.skip ? `  – ${PROVIDERS[s.provider].name}: ${s.skip}${s.target ? ` (${rel(s.target)})` : ""}` : `  ✓ ${PROVIDERS[s.provider].name}: ${verb(s)} ${rel(s.target)}`);
  const done = P.steps.filter(s => s.copy);
  if (done.length && !dry && P.action !== "uninstall") {
    lines.push("", "Next: open your agent in this project and type " + [...new Set(done.map(s => PROVIDERS[s.provider].invoke))].join(" · ") + ". It sets Nosy up (`move-in`) the first time.");
    if (done.some(s => s.provider === "claude")) lines.push("Claude Code: the plugin adds /nosy:<command> commands and the hooks (session start, after-commit): `/plugin marketplace add nosy-hq/nosy` then `/plugin install nosy@nosy`.");
    // Nothing puts `nosy` on PATH: name the command that really runs, from the copy just written (npx's cache is temporary).
    const first = done.find(s => s.provider === "claude") || done[0], tool = path.join(first.target, "tools", "nosy.mjs");
    const run = nosyOnPath() ? "nosy" : nodeCommandFor(tool, P.global ? undefined : P.project);
    const where = !P.global && path.resolve(P.project) !== process.cwd() ? ` (from inside ${P.project})` : "";
    lines.push(`Without an agent, in a terminal${where}: \`${run} setup .\`, then \`${run} peek\` (\`${run} help\` lists every command). Wherever the docs say \`nosy <command>\`, that is what to type${run === "nosy" ? "" : " here, since there is no global `nosy`"}.`);
    if (!P.global) lines.push("Commit the new folders so teammates and cloud sessions get the same skill.");
  }
  if (P.action === "uninstall" && P.steps.some(s => s.remove)) lines.push("", `${dry ? "Would leave" : "Left"} alone: your pm/ folder (yours). The Claude Code plugin (its /nosy:<command> commands and hooks) is Claude Code's to remove: \`/plugin uninstall nosy@nosy\`.`);
  if (!P.steps.some(s => s.copy || s.remove)) lines.push(P.action === "uninstall" ? "Nothing to remove: no folder here was written by nosy install." : P.action === "update" ? "Nothing to update: nosy install hasn't been run here (or with --global)." : "Nothing to do.");
  return lines.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const flag = k => { const i = argv.indexOf(k); if (i >= 0) argv.splice(i, 1); return i >= 0; };
  const action = ["install", "update", "uninstall"].includes(argv[0]) ? argv.shift() : "install";
  const dir = path.resolve(take("--dir") || process.cwd()), providers = (take("--providers") || "").split(",").map(s => s.trim()).filter(Boolean);
  const dry = flag("--dry-run"), global = flag("--global");
  if (!fs.existsSync(dir)) { console.error(`No folder at ${dir}. Check the path given to --dir (or run this from the project's folder).`); process.exit(1); }
  const P = plan(dir, { providers, global, action });
  if (P.error) { console.error(P.error); process.exit(1); }
  try { if (!dry) apply(P); } catch (e) { console.error(`Couldn't write: ${e.message}. ${advice(e.message) || "Check that you can write to that folder; `--dry-run` shows what would be written."}`); process.exit(1); }
  console.log(render(P, { dry }));
}
