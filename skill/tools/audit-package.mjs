// Package audit: verifies that the local-path links in AGENTS.md and the agent adapters
// (Cursor, Gemini CLI) exist in the repo, and that AGENTS.md's command list has the same set of command names
// as the skill/SKILL.md table. Only meant to run from the repo root; never touches the network.
// Usage: node skill/tools/audit-package.mjs [repo root]
// Exit code: 0 if everything is ✓, 1 if anything is ✗.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));

const rows = [];
const ok = (what, result, note = "") => rows.push({ what, result, note });
const read = rel => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return null; } };
const exists = rel => { try { fs.accessSync(path.join(root, rel)); return true; } catch { return false; } };
const folderExists = rel => { try { return fs.statSync(path.join(root, rel)).isDirectory(); } catch { return false; } };

// Extracts local-path-shaped backtick (`...`) references from a text: strings with at least one "/" that end
// in a file extension (.md, .json, .mjs, .mdc). Replaces the `<skill>` prefix with "skill" (the shorthand used
// in AGENTS.md and commands.md). If it contains a placeholder (<name>, <a|b|c>) or a wildcard (*), it's flagged
// as {path, pattern:true} — in that case we check whether that path's FOLDER exists, not a single file
// (e.g. "skill/commands/<name>.md" → "skill/commands").
function pathsOfExtract(text) {
  const pattern = /`([^`]+)`/g;
  const found = new Map();
  let m;
  while ((m = pattern.exec(text))) {
    let candidate = m[1].trim().replace(/^<skill>/, "skill");
    if (!candidate.includes("/")) continue;
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) continue;
    const placeholder = /[<*]/.test(candidate);
    if (!placeholder && !/\.(md|json|mjs|mdc)($|[:#])/.test(candidate)) continue;
    candidate = candidate.split(/[:#]/)[0]; // drop suffixes like "file.md:12" or "file.md#section"
    if (placeholder) candidate = candidate.replace(/\s.*$/, ""); // drop argument descriptions like "canwe <question>"
    found.set(candidate, placeholder);
  }
  return [...found.entries()];
}

// --- 1) Local-path links in AGENTS.md and the adapters ------------------------------------
const sources = [
  ["AGENTS.md", read("AGENTS.md")],
  [".cursor/rules/nosy.mdc", read(".cursor/rules/nosy.mdc")],
];
for (const [file, text] of sources) {
  if (text === null) { ok(file, "✗", "couldn't read the file"); continue; }
  const paths = pathsOfExtract(text);
  if (paths.length === 0) { ok(file, "✗", "no local-path link found"); continue; }
  let allExists = true;
  for (const [y, isPattern] of paths) {
    if (isPattern) {
      const folder = path.posix.dirname(y.replace(/\*.*$/, "*")).replace(/\/\*$/, "");
      if (!folderExists(folder)) { ok(`${file} → ${y}`, "✗", `folder missing: ${folder}`); allExists = false; }
    } else if (!exists(y)) { ok(`${file} → ${y}`, "✗", "not in the repo"); allExists = false; }
  }
  if (allExists) ok(file, "✓", `${paths.length} local path(s), all present`);
}

// .gemini/settings.json: do the files in context.fileName (at least AGENTS.md) exist
const gemSettings = read(".gemini/settings.json");
if (gemSettings === null) ok(".gemini/settings.json", "–", "not configured");
else {
  try {
    const j = JSON.parse(gemSettings);
    const names = j?.context?.fileName;
    if (!Array.isArray(names) || names.length === 0) ok(".gemini/settings.json", "✗", "context.fileName isn't an array, or is empty");
    else if (!names.includes("AGENTS.md")) ok(".gemini/settings.json", "✗", "AGENTS.md isn't in the list");
    else ok(".gemini/settings.json", "✓", `context.fileName: ${names.join(", ")}`);
  } catch (e) { ok(".gemini/settings.json", "✗", `malformed json: ${e.message}`); }
}

// --- 2) Command list: does the AGENTS.md table have the same set of command names as skill/SKILL.md -----
function commandsOfExtractFromTable(text) {
  if (!text) return null;
  const names = new Set();
  for (const line of text.split("\n")) {
    // The command is the first backticked cell; SKILL.md's table puts a Direction column before it.
    const m = line.match(/^\|(?:\s*[^|`]+\|)?\s*`([a-z-]+)/i);
    if (m) names.add(m[1]);
  }
  return names;
}
const agentsMd = read("AGENTS.md");
const skillMd = read("skill/SKILL.md");
const agentsCommands = commandsOfExtractFromTable(agentsMd);
const skillCommands = commandsOfExtractFromTable(skillMd);
if (!agentsCommands || agentsCommands.size === 0) ok("command list (AGENTS.md)", "✗", "no table found");
else if (!skillCommands || skillCommands.size === 0) ok("command list (SKILL.md)", "✗", "no table found");
else {
  const missingAgents = [...skillCommands].filter(k => !agentsCommands.has(k));
  const excessAgents = [...agentsCommands].filter(k => !skillCommands.has(k));
  if (missingAgents.length === 0 && excessAgents.length === 0) {
    ok("command list", "✓", `${agentsCommands.size} command(s), AGENTS.md and SKILL.md match`);
  } else {
    if (missingAgents.length) ok("command list", "✗", `missing from AGENTS.md: ${missingAgents.join(", ")}`);
    if (excessAgents.length) ok("command list", "✗", `extra in AGENTS.md (not in SKILL.md): ${excessAgents.join(", ")}`);
  }
}

// --- 3) README.md command parity (a Ponytail v4.6 lesson): for every `/nosy:<command>`
// in the README, do commands/<command>.md and skill/commands/<command>.md exist; do the commands/ and
// skill/commands/ command sets (from file names) match -------------------------------------------------
function commandsOfExtractReadme(text) {
  if (!text) return null;
  const names = new Set();
  for (const m of text.matchAll(/\/nosy:([a-z][a-z-]*)/g)) names.add(m[1]);
  return names;
}
function commandsOfExtractFolder(rel) {
  if (!folderExists(rel)) return null;
  return new Set(fs.readdirSync(path.join(root, rel)).filter(f => f.endsWith(".md")).map(f => f.slice(0, -3)));
}
const readmeMd = read("README.md");
const readmeCommands = commandsOfExtractReadme(readmeMd);
if (readmeMd === null) ok("README.md", "✗", "couldn't read the file");
else if (!readmeCommands || readmeCommands.size === 0) ok("README.md → /nosy:<command>", "✗", "no /nosy:<command> reference found");
else {
  const missingCommands = [...readmeCommands].filter(k => !exists(`commands/${k}.md`));
  const missingSkillCommands = [...readmeCommands].filter(k => !exists(`skill/commands/${k}.md`));
  if (missingCommands.length === 0) ok("README.md → commands/", "✓", `${readmeCommands.size} command(s), all present as commands/<command>.md`);
  else ok("README.md → commands/", "✗", `missing from commands/: ${missingCommands.join(", ")}`);
  if (missingSkillCommands.length === 0) ok("README.md → skill/commands/", "✓", `${readmeCommands.size} command(s), all present as skill/commands/<command>.md`);
  else ok("README.md → skill/commands/", "✗", `missing from skill/commands/: ${missingSkillCommands.join(", ")}`);
}

const commandsFolder = commandsOfExtractFolder("commands");
const skillCommandsFolder = commandsOfExtractFolder("skill/commands");
// Reverse direction: a command that's in commands/ but never mentioned in the README is
// also ✗. Used to only check README → commands/; with 11 of 12 commands in the README the package still
// passed ✓ (the one missing, /nosy:frontyard, was only caught by frontyard itself).
if (readmeCommands && readmeCommands.size && commandsFolder) {
  const inReadmeMissing = [...commandsFolder].filter(k => !readmeCommands.has(k));
  if (inReadmeMissing.length === 0) ok("commands/ → README.md", "✓", `all ${commandsFolder.size} command(s) are mentioned in the README as /nosy:<command>`);
  else ok("commands/ → README.md", "✗", `not mentioned in the README: ${inReadmeMissing.map(k => `/nosy:${k}`).join(", ")}`);
}
if (!commandsFolder) ok("commands/", "✗", "folder missing or empty");
else if (!skillCommandsFolder) ok("skill/commands/", "✗", "folder missing or empty");
else {
  const missingSkill = [...commandsFolder].filter(k => !skillCommandsFolder.has(k));
  const missingCommands2 = [...skillCommandsFolder].filter(k => !commandsFolder.has(k));
  if (missingSkill.length === 0 && missingCommands2.length === 0) {
    ok("commands/ ↔ skill/commands/", "✓", `${commandsFolder.size} command(s), both folders match`);
  } else {
    if (missingSkill.length) ok("commands/ ↔ skill/commands/", "✗", `missing from skill/commands/: ${missingSkill.join(", ")}`);
    if (missingCommands2.length) ok("commands/ ↔ skill/commands/", "✗", `missing from commands/ (extra in skill/commands/): ${missingCommands2.join(", ")}`);
  }
}

// --- print ---------------------------------------------------------------------------------
const width = Math.max(...rows.map(r => r.what.length), 20);
console.log(`| ${"What".padEnd(width)} | Result | Note |`);
console.log(`|${"-".repeat(width + 2)}|--------|------|`);
for (const r of rows) console.log(`| ${r.what.padEnd(width)} | ${r.result.padEnd(6)} | ${r.note} |`);

process.exit(rows.some(r => r.result === "✗") ? 2 : 0); // exit contract: 2 = a ✗ row
