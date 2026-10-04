// sources-file: the one way to read pm/sources.json. Two things every reader needs and none should redo:
//  1. A UTF-8 byte-order mark (PowerShell 5's `Out-File`/`Set-Content -Encoding UTF8` and old Notepad write one) is not
//     part of the JSON: strip it, or JSON.parse throws and the file is reported "missing" or "not valid".
//  2. A relative `repo` (setup writes "." on purpose, so the file is the same on every teammate's machine) means "the
//     product this pm/ belongs to", not "whatever folder the process was started in": resolve it, or a run from another
//     folder (an MCP client, a CI step, `--pm ../elsewhere/pm`) points git at the wrong place and crashes.
// No dependencies; reads only.
import fs from "node:fs"; import path from "node:path";

export const stripBom = text => String(text ?? "").replace(/^﻿/, "");
// JSON.parse that tolerates a leading BOM. Throws like JSON.parse otherwise.
export const parseJson = text => JSON.parse(stripBom(text));

const isAbs = p => path.isAbsolute(p) || path.win32.isAbsolute(p);
// The nearest folder at or above `dir` that holds a .git (folder or file), or null.
const gitRoot = dir => { for (let d = dir; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, ".git"))) return d; if (path.dirname(d) === d) return null; } };

// Where a relative `repo` points. "." is the repo the pm/ lives in: the git root at or above the folder that holds pm/
// (so the same file works from any folder, and from a pm/ nested in docs/); without a git root, the folder Nosy runs from
// when it holds pm/, else the folder that holds pm/. Any other relative path is taken from the folder that holds pm/.
export function resolveRepo(pm, repo, { cwd = process.cwd() } = {}) {
  if (typeof repo !== "string" || repo === "" || isAbs(repo)) return repo;
  const pmAbs = path.resolve(cwd, pm), home = path.dirname(pmAbs), from = path.resolve(cwd, repo);
  if (path.normalize(repo) === ".") return gitRoot(home) || ((pmAbs === from || pmAbs.startsWith(from + path.sep)) && fs.existsSync(from) ? from : home);
  const base = path.resolve(home, repo);
  return fs.existsSync(base) ? base : from;
}

// <pm>/sources.json as an object, `repo` made absolute (pass { raw: true } to get the file as written, e.g. to edit and
// write it back). Throws when the file is missing or isn't JSON, exactly like JSON.parse(fs.readFileSync(...)).
export function readSources(pm, { raw = false, cwd } = {}) {
  const K = parseJson(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  if (!raw && K && typeof K === "object" && !Array.isArray(K) && typeof K.repo === "string") {
    Object.defineProperty(K, "repoAsWritten", { value: K.repo, enumerable: false }); // messages quote what the file says
    K.repo = resolveRepo(pm, K.repo, { cwd });
    // A relative `matrix` ("pm/matrix.json": find-sources writes it relative to the repo) is read from the repo, not from whatever folder Nosy was
    // started in. Since pm/ is found by walking up (findPm), Nosy often runs from a subfolder, where the path as written points at nothing and every
    // reader would say "no matrix". Only when it isn't there from the current folder but is in the repo: a file that resolves today is left exactly as written.
    if (typeof K.matrix === "string" && K.matrix && !isAbs(K.matrix) && typeof K.repo === "string") {
      const here = path.resolve(cwd || process.cwd(), K.matrix), there = path.resolve(K.repo, K.matrix);
      if (!fs.existsSync(here) && fs.existsSync(there)) { Object.defineProperty(K, "matrixAsWritten", { value: K.matrix, enumerable: false }); K.matrix = there; }
    }
  }
  return K;
}
// Same, but null when the file is missing or isn't JSON (for readers that treat that as "no sources yet").
export function readSourcesSafe(pm, opts) { try { return readSources(pm, opts); } catch { return null; } }

// Where this product's pm/ is. On a real product pm/ sat next to the repo folder, not inside it, so
// commands worked from one folder only. In order:
//   1. `explicit` (--pm or NOSY_PM) always wins, as written.
//   2. ./pm when it holds sources.json (or the old kaynaklar.json, so `doctor` can still run on an old pm/): "pm", as before.
//   3. the first <ancestor>/pm that holds one of them, nearest ancestor first: its absolute path.
//   4. "pm", as before (the commands that create it, `setup`, `move-in`, still write there).
// A caller that wants to say which one it chose compares the result with "pm": anything else without an `explicit` came from step 3.
const hasSources = dir => ["sources.json", "kaynaklar.json"].some(f => fs.existsSync(path.join(dir, f)));
export function findPm(cwd = process.cwd(), { explicit } = {}) {
  if (explicit) return explicit;
  const start = path.resolve(cwd);
  if (hasSources(path.join(start, "pm"))) return "pm";
  for (let d = path.dirname(start); ; d = path.dirname(d)) {
    if (hasSources(path.join(d, "pm"))) return path.join(d, "pm");
    if (path.dirname(d) === d) break;
  }
  return "pm";
}

// ---- Rival files kept somewhere else ----
// A real product kept its rival research in references/<name>/competitive-*.md, so `doctor` said "no rival files yet" and
// `neighbors` started from zero. sources.json `rivalsPath` (a folder, relative to the folder that holds pm/, or absolute)
// says where they are; nothing else in pm/ moves.
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// The rival folder: K.rivalsPath when it is set and exists, else <pm>/rivals (as written, so callers' output is unchanged).
export function rivalsDir(pm, K) {
  const d = rivalsPathAbs(pm, K);
  return d && isDir(d) ? d : path.join(pm, "rivals");
}
// What `rivalsPath` names, made absolute from the folder that holds pm/ (whether or not it exists), or null when it isn't set.
// pm relative or absolute gives the same answer (path.resolve against the process folder first).
export function rivalsPathAbs(pm, K) {
  const p = K && typeof K.rivalsPath === "string" ? K.rivalsPath.trim() : "";
  return p ? path.resolve(path.dirname(path.resolve(pm)), p) : null;
}
// Is this markdown a rival file? By its own structure, from the rival template (templates/rival.md): the "Latest major announcement"
// field or heading, a "Position relative to …" heading, or the matrix table (3+ rows whose code column holds a single status letter,
// y p n u d, in every filled row). Nosy writes these files itself, so its template's headings are the structure; nothing is read
// from the rival's or the product's own prose.
const RIVAL_MARK = /^[ \t]*(?:[-*][ \t]+)?(?:#{1,6}[ \t]*)?\**[ \t]*(?:Latest major announcement|Position relative to)\b/mi;
export function rivalDoc(text) {
  const t = stripBom(text);
  if (RIVAL_MARK.test(t)) return true;
  const rows = t.split("\n").filter(l => /^\s*\|.*\|\s*$/.test(l)).map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
  const width = Math.max(0, ...rows.map(r => r.length));
  for (let col = 1; col < width; col++) {
    const cells = rows.map(r => r[col]).filter(c => c != null && c !== "" && !/^:?-{2,}:?$/.test(c));
    const codes = cells.filter(c => /^[ypnud]$/i.test(c));
    if (codes.length >= 3 && codes.length >= cells.length - 1) return true; // all but the header cell
  }
  return false;
}
// Why a markdown file is not rival-shaped, in words the owner can act on (null when it is). rivals-import used to say only "nothing to import" for a plausible
// file whose matrix used "Yes / No" or ✓ / ✗ instead of the codes y p n u d (BlogFactory field test).
export function rivalDocWhy(text) {
  if (rivalDoc(text)) return null;
  const t = stripBom(text), rows = t.split("\n").filter(l => /^\s*\|.*\|\s*$/.test(l)).map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
  if (!rows.length) return "no table, and none of the template's headings (Latest major announcement, Position relative to)";
  const width = Math.max(0, ...rows.map(r => r.length)); let best = null;
  for (let col = 1; col < width; col++) {
    const cells = rows.map(r => r[col]).filter(c => c != null && c !== "" && !/^:?-{2,}:?$/.test(c));
    const words = cells.filter(c => /^(yes|no|true|false|✓|✔|✗|✘|x|-|—|partial|n\/a)$/i.test(c));
    if (words.length >= 3 && (!best || words.length > best.n)) best = { n: words.length, sample: [...new Set(words.slice(0, 3))].join(" / ") };
  }
  if (best) return `a table with ${best.n} Yes/No-style cells (${best.sample}) but not the codes y p n u d, which is how Nosy reads a cell (y yes, p partial, n no, u not found, d announced); recode the column, or copy the file's tables into the template`;
  const codes = rows.flatMap(r => r.slice(1)).filter(c => /^[ypnud]$/i.test(c)).length;
  return codes ? `a table, but only ${codes} cell${codes === 1 ? "" : "s"} with a code y p n u d (at least 3 in one column, in every filled row of that column)` : "a table, but no column of the codes y p n u d, and none of the template's headings (Latest major announcement, Position relative to)";
}
export const markdownFiles = dir => walkMarkdown(dir);
const SKIP_DIRS = new Set(["node_modules", ".git", "vendor"]);
// Every .md under `dir` as "/"-joined paths relative to it, depth-first, never entering SKIP_DIRS (a rivalsPath of "." must not list a
// node_modules tree first and filter it afterwards: fs.readdirSync's `recursive` option does that, and exists only from Node 18.17).
// Symbolic links to folders are not followed (a link back up the tree would never end); `depth` bounds the rest.
function walkMarkdown(dir, rel = "", depth = 8, out = []) {
  let entries; try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && depth > 0) walkMarkdown(dir, r, depth - 1, out); }
    else if (isMarkdownName(e.name) && !e.name.startsWith("_")) out.push(r);
  }
  return out;
}
// A markdown file by name: .md, .MD or .markdown (an editor or a Windows folder gives any of them; matching only ".md" made such a rival look like it was not there).
export const isMarkdownName = name => /\.(md|markdown)$/i.test(name);
export const markdownSlug = name => name.replace(/\.(md|markdown)$/i, "");
// One flat folder (pm/rivals, pm/atlas): its markdown files (not the `_` template, nor the names in `skip`) and what was passed over, so "no rivals yet" can say what
// was there. A subfolder is not descended into and a file of another extension is not read; both are named instead of vanishing.
export function flatMarkdown(dir, { skip = [] } = {}) {
  const files = [], skipped = [];
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { files, skipped }; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
    let isDir = e.isDirectory(); if (e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(dir, e.name)).isDirectory(); } catch { /* a broken link is a file we cannot read */ } }
    if (isDir) { if (!SKIP_DIRS.has(e.name)) skipped.push(`${e.name}/ (a subfolder; files inside are not read)`); }
    else if (isMarkdownName(e.name)) { if (!skip.includes(e.name)) files.push(e.name); }
    else skipped.push(`${e.name} (not a .md or .markdown file)`);
  }
  return { files, skipped };
}
// " Skipped: a/ (...), b.txt (...)." with at most `max` names, then how many more; "" when nothing was skipped.
export const skippedNote = (skipped, max = 6) => skipped.length ? ` Skipped: ${skipped.slice(0, max).join(", ")}${skipped.length > max ? `, and ${skipped.length - max} more` : ""}.` : "";
const RIVAL_READ_MAX = 1 << 20; // a rival file is a page or two of tables; a megabyte of markdown is something else
// The rival files in a rival folder, as paths relative to it ("/" separators). The default <pm>/rivals is flat, every .md but the
// `_`-prefixed template (as always). A configured rivalsPath may nest (references/<name>/competitive-x.md) and hold other
// documents, so there it is recursive and only rival-shaped files count.
export function rivalFiles(dir, { nested = false } = {}) {
  try {
    if (!nested) return fs.readdirSync(dir).filter(f => isMarkdownName(f) && !f.startsWith("_"));
    return walkMarkdown(dir).filter(f => { try { const p = path.join(dir, f); return fs.statSync(p).size <= RIVAL_READ_MAX && rivalDoc(fs.readFileSync(p, "utf8")); } catch { return false; } });
  } catch { return []; }
}

// ---- The team's own GitHub logins (2 Oct) ----
// sources.json `team`: an array of logins (or one string) of the people who build the product. An issue one of them opens is a work item,
// not a customer asking: collect-signals keeps it out of demand, lowhanging keeps it out of "issue opened against us". Case and a leading
// "@" don't matter. One reader here so the two can't drift.
const loginKey = x => String(x ?? "").trim().replace(/^@/, "").toLowerCase();
export const teamLogins = K => new Set([].concat(K && K.team !== undefined && K.team !== null ? K.team : []).filter(x => typeof x === "string").map(loginKey).filter(Boolean));
export const isTeamLogin = (logins, login) => { const k = loginKey(login); return !!k && logins.has(k); };

// The matrix file the owner configured (`sources.json` `matrix`, relative to pm/ or to the folder above it), else pm/matrix.json. `check`, `diff`, `freshness`, `handoff` and `build-waves`
// honoured it; `publish`, `nosy page` and the first screen read pm/matrix.json whatever it said, so a valid matrix kept at docs/matrix.json was "missing" to publish and a page was
// built without it, with no warning (field-test hunt).
export function matrixFile(pm, K) {
  const def = path.join(pm, "matrix.json");
  const cfg = K && typeof K.matrix === "string" && K.matrix.trim() ? K.matrix.trim() : null;
  if (!cfg) return def;
  if (path.isAbsolute(cfg)) return cfg;
  const root = path.resolve(pm);
  for (const c of [path.join(root, cfg), path.resolve(path.dirname(root), cfg)]) if (fs.existsSync(c)) return c;
  return def;
}
