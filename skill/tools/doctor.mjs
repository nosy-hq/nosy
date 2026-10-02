// doctor: finds a pm/ folder written by an older Nosy and says what to fix (Impeccable's `doctor` idea: schema
// drift is repaired mechanically, truth drift is routed to the command that owns it). Three severities:
//   auto     no decision needed: `--fix` applies it (rename an old Turkish file/folder, rename an old sources.json
//            key, point a sources.json path at the renamed file)
//   mention  the owner should know, nothing to decide now (both the old and the new name exist: merge by hand)
//   route    a command owns it (no sources.json → move-in; a state file with old keys → re-run what writes it)
// Old names come from skill/data/lang/tr/renames.json (generated from docs/RENAMES.md, the English migration).
// `--fix` is never silent about what it touches: it lists the changes, copies what it will rewrite to
// pm/.backup/doctor-<stamp>/ (git-ignored by its own .gitignore), says whose files these are (Nosy's own, inside pm/: never the
// repo, the product code or the text of the owner's notes), and prints the one line that undoes it. `--fix --dry-run` stops after
// the list. `--undo` puts the last fix back (a file changed since is left alone unless `--force`).
// Usage: node doctor.mjs <pm> [--fix [--dry-run]] [--json <file>]
//        node doctor.mjs <pm> --undo [--force]
//        node doctor.mjs --check [<pm>] [--json <file>]   is my install healthy? (Node, git, gh, skill files, hooks, pm/sources.json;
//                                                       skill/tools/health.mjs; each ✗ line carries its fix)
// Exit: 0 nothing found · 2 findings remain · 1 couldn't read the pm folder. Read-only without --fix.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { next as nextPicks } from "./next.mjs"; import { parseJson } from "./sources-file.mjs"; // parseJson: the shared reader (a UTF-8 BOM is not a typo)

// --check is a different question and has to work when this file's own data is what's broken: hand it over before reading anything.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--check")) {
  const { main } = await import("./health.mjs"); process.exit(await main(process.argv.slice(2)));
}
const BACKUP = ".backup";
const R = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/renames.json", import.meta.url), "utf8"));
const FILES = R.files || {}, FOLDERS = R.folders || {}, KEYS = R.keys || {}, WORDS = R.words || {};
// A state file's command, for "re-run what writes it" (names after renaming).
const WRITER = { "status.json": "shipped (or peek)", "lowhanging.json": "psst", "lowhanging.filtered.json": "psst", "inventory.json": "nosy inventory",
  "signals.json": "nosy signals", "stale.json": "tea", "design.json": "dresscode", "plan-gates.json": "nosy gates", "metrics.json": "nosy metrics",
  "frontyard.json": "frontyard", "size.json": "scoop", "size-last.json": "canwe", "waves.json": "scoop", "matrix.json": "neighbors" };

// A sources.json key the way the migration renamed it: the exact pair it made, else word by word ("ekran_eksik" →
// "screen_missing", camelCase kept). Unchanged when any word is unknown.
export function keyOf(k) {
  if (KEYS[k]) return KEYS[k];
  const parts = k.split(/(_|(?=[A-Z]))/);
  let changed = false;
  const out = parts.map(p => { if (p === "_" || !p) return p; const low = p.toLowerCase(), w = WORDS[low]; if (!w) return p; changed = changed || w !== low;
    return p[0] === p[0].toUpperCase() && p[0] !== p[0].toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w; });
  return changed && parts.every(p => p === "_" || !p || WORDS[p.toLowerCase()]) ? out.join("") : k;
}
// Glossary entries are the product's own terms (often Turkish on purpose), never renamed.
const LEAVE = new Set(["glossary", "sozluk", "refAliases", "private"]);
function renameKeys(o, at = [], found = []) {
  if (Array.isArray(o)) return [o.map((x, i) => renameKeys(x, [...at, i], found)[0]), found];
  if (!o || typeof o !== "object") return [o, found];
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const nk = keyOf(k);
    if (nk !== k) found.push({ from: [...at, k].join("."), to: [...at, nk].join(".") });
    out[nk] = LEAVE.has(nk) ? v : renameKeys(v, [...at, nk], found)[0];
  }
  return [out, found];
}
// A path value pointing at an old pm/ file name ("…/pm/matris.json") gets the new segment names.
const newSegment = s => FILES[s] || FOLDERS[s] || s;
function renamePaths(o, found = [], at = []) {
  if (Array.isArray(o)) return o.map((x, i) => renamePaths(x, found, [...at, i]));
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, LEAVE.has(k) ? v : renamePaths(v, found, [...at, k])]));
  if (typeof o !== "string" || !/[/\\]/.test(o) || !/\.[a-z]{2,5}$|\/$/i.test(o)) return o;
  const segs = o.split("/"), n = segs.map(newSegment).join("/");
  if (n !== o) found.push({ at: at.join("."), from: o, to: n });
  return n;
}
function oldKeysIn(json) {
  const keys = new Set(); const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); if (!LEAVE.has(k)) walk(v); } };
  walk(json); return [...keys].filter(k => keyOf(k) !== k);
}

export function examine(pm) {
  const findings = [], add = (severity, id, summary, fix, extra = {}) => findings.push({ severity, id, summary, fix, ...extra });
  if (!fs.existsSync(pm) || !fs.statSync(pm).isDirectory()) return { error: `no folder at ${pm}`, findings };
  // 1. Old file and folder names, deepest first so a folder's own files are named before it moves.
  const walk = (dir, rel = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name === ".git" || e.name === "node_modules" || e.name === BACKUP) return [];
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? [...walk(path.join(dir, e.name), r), { rel: r, dir: true }] : [{ rel: r, dir: false }];
  });
  for (const e of walk(pm)) {
    const base = path.basename(e.rel), to = e.dir ? FOLDERS[base] : FILES[base];
    if (!to || to === base) continue;
    const target = path.join(path.dirname(e.rel), to);
    if (fs.existsSync(path.join(pm, target))) add("mention", "both-names", `${e.rel} and ${target} both exist`, `merge ${e.rel} into ${target} by hand, then delete ${e.rel}`, { path: e.rel });
    else add("auto", "old-name", `${e.rel} has its old name`, `rename to ${target}`, { path: e.rel, to: target, dir: e.dir });
  }
  // 2. sources.json (or the old kaynaklar.json): old keys and paths.
  const src = ["sources.json", "kaynaklar.json"].map(f => path.join(pm, f)).find(f => fs.existsSync(f));
  if (!src) add("route", "no-sources", "no sources.json", "run move-in (or `nosy setup <repo>`)");
  else {
    let K = null; try { K = parseJson(fs.readFileSync(src, "utf8")); } catch (e) { add("mention", "sources-unreadable", `${path.basename(src)} isn't valid JSON`, `fix it by hand: ${String(e.message).slice(0, 80)}`); }
    if (K) {
      const [, keys] = renameKeys(K), paths = []; renamePaths(K, paths);
      // One finding per file, not per key: "23 old keys (birakilan → dropped, istek → request, …)".
      if (keys.length) add("auto", "old-key", `${path.basename(src)}: ${keys.length} old key${keys.length === 1 ? "" : "s"}`, `rename (${keys.slice(0, 4).map(k => `${k.from.split(".").pop()} → ${k.to.split(".").pop()}`).join(", ")}${keys.length > 4 ? ", …" : ""})`, { keys });
      for (const p of paths) add("auto", "old-path", `${path.basename(src)}: ${p.at} points at an old name`, `${p.from} → ${p.to}`);
    }
  }
  if (!["product.md", "urun.md"].some(f => fs.existsSync(path.join(pm, f)))) add("route", "no-product", "no product.md", "run move-in");
  // 3. State files with old keys: written by an older script. Translating them in place would guess at shapes;
  // the command that owns the file rewrites it correctly.
  for (const dirName of ["state", "durum"]) {
    const d = path.join(pm, dirName); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(f => f.endsWith(".json"))) {
      let j; try { j = parseJson(fs.readFileSync(path.join(d, f), "utf8")); } catch { continue; }
      const old = oldKeysIn(j); if (!old.length) continue;
      const name = FILES[f] || f;
      add("route", "old-state", `${dirName}/${f} was written by an older Nosy (keys like ${old.slice(0, 3).join(", ")})`, `re-run ${WRITER[name] || "the command that writes it"}`, { path: `${dirName}/${f}` });
    }
  }
  // 4. Stale outputs: the shape is fine but what Nosy knows is old (no page, a list older than
  // the last commits, rivals not checked in a month). Doctor fixes shape; freshness goes to the command that owns it,
  // so these only name that command (next.mjs's own staleness rules), and don't count as something doctor must fix.
  if (src && fs.existsSync(path.join(pm, "state"))) {
    try { for (const p of nextPicks(pm).picks.filter(p => !["stakeout", "move-in", "doctor"].includes(p.command))) add("stale", `stale-${p.command}`, p.reason, `run ${p.command}`); } catch {}
  }
  // The matrix file itself isn't checked: read-matrix.mjs reads the old keys (urunler, satirlar, …) through its
  // lineShapeKeys alias, so an old matrix only needs sources.json pointing at its new name.
  return { findings };
}

// What --fix would do, in order: the sources.json rewrite, then the renames. Each step names the file it changes.
export function plan(pm, R) {
  const steps = [];
  const src = ["sources.json", "kaynaklar.json"].map(f => path.join(pm, f)).find(f => fs.existsSync(f));
  if (src && R.findings.some(f => f.id === "old-key" || f.id === "old-path")) steps.push({ kind: "rewrite", file: path.basename(src), summary: `${path.basename(src)}: keys and paths renamed` });
  for (const f of R.findings.filter(f => f.id === "old-name")) {
    const to = path.join(path.dirname(f.path), path.basename(f.to)).replace(/^\.\//, "");
    steps.push({ kind: "rename", from: f.path, to, summary: `${f.path} → ${to}` });
  }
  return steps;
}

export const SCOPE = "These are Nosy's own files inside pm/ (names and keys an older Nosy wrote). Your repo, your product code and the text of your notes are not touched.";
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

// Applies the plan. Returns the list of what was done (as before); `.backup` is the folder holding the copy and the manifest
// `undo` reads. Backs up before writing; nothing changes when there is nothing to do.
export function fix(pm, R, { now = new Date() } = {}) {
  const steps = plan(pm, R), done = [];
  if (!steps.length) return done;
  let dir = path.join(pm, BACKUP, `doctor-${stamp(now)}`);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(pm, BACKUP, `doctor-${stamp(now)}-${n}`); // two fixes in one second keep both copies
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(pm, BACKUP, ".gitignore"), "*\n"); // the copies never show up in git status or a commit
  const manifest = { type: "doctorBackup", at: now.toISOString(), steps: [] };
  // The manifest is written even when a step throws halfway (a locked file, a folder that can't move): what was already done stays undoable.
  try {
  const src = ["sources.json", "kaynaklar.json"].map(f => path.join(pm, f)).find(f => fs.existsSync(f));
  if (src && steps.some(x => x.kind === "rewrite")) {
    fs.copyFileSync(src, path.join(dir, path.basename(src)));
    let K = parseJson(fs.readFileSync(src, "utf8"));
    K = renameKeys(K)[0]; K = renamePaths(K);
    fs.writeFileSync(src, JSON.stringify(K, null, 1) + "\n");
    manifest.steps.push({ kind: "rewrite", file: path.basename(src), backup: path.basename(src), after: sha(src) });
    done.push(`${path.basename(src)}: keys and paths renamed`);
  }
  // Deepest paths first (the walk already lists a folder after its contents).
  for (const f of R.findings.filter(f => f.id === "old-name")) {
    const from = path.join(pm, f.path), to = path.join(pm, path.dirname(f.path), path.basename(f.to));
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.renameSync(from, to);
    const rel = path.join(path.dirname(f.path), path.basename(f.to)).replace(/^\.\//, "");
    manifest.steps.push({ kind: "rename", from: f.path, to: rel });
    done.push(`${f.path} → ${rel}`);
  }
  } finally { fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1)); }
  done.backup = dir;
  return done;
}

// Puts the last doctor fix back: renames reversed (last first), rewritten files restored from their copy. A file changed since the
// fix is left alone and reported, unless `force`. Returns { ok, restored: [...], skipped: [...], from }.
export function undo(pm, { force = false } = {}) {
  const root = path.join(pm, BACKUP);
  const manifestOf = d => { try { const m = JSON.parse(fs.readFileSync(path.join(root, d, "manifest.json"), "utf8")); return m && typeof m === "object" && Array.isArray(m.steps) ? m : null; } catch { return null; } };
  const runs = fs.existsSync(root) ? fs.readdirSync(root).filter(d => d.startsWith("doctor-") && fs.existsSync(path.join(root, d, "manifest.json"))).sort() : [];
  const unreadable = runs.filter(d => !manifestOf(d));
  const last = [...runs].reverse().find(d => { const m = manifestOf(d); return m && !m.undone; });
  if (!last) return { ok: false, error: unreadable.length && unreadable.length === runs.length ? `the doctor backup in ${root} has a manifest that can't be read (${unreadable.join(", ")}): the copies in it can be put back by hand` : runs.length ? "every doctor fix here has been undone already" : `no doctor fix to undo under ${root}` };
  const dir = path.join(root, last), M = manifestOf(last), restored = [], skipped = [];
  for (const st of [...M.steps].reverse()) {
    if (st.kind === "rename") {
      const from = path.join(pm, st.from), to = path.join(pm, st.to);
      if (fs.existsSync(to) && !fs.existsSync(from)) { fs.renameSync(to, from); restored.push(`${st.to} → ${st.from}`); }
      else if (!fs.existsSync(to) && fs.existsSync(from)) continue; // already back (a half-finished undo run again)
      else skipped.push(`${st.to}: ${fs.existsSync(to) ? `${st.from} exists again` : "it is gone"}`);
    } else if (st.kind === "rewrite") {
      // After a rename back the file has its old name (kaynaklar.json); it is the one the copy was taken from.
      const cur = path.join(pm, st.file), copy = path.join(dir, st.backup);
      const target = fs.existsSync(cur) ? cur : null;
      if (!target) { skipped.push(`${st.file}: not there to restore`); continue; }
      if (!force && sha(target) !== st.after) { skipped.push(`${st.file}: changed since the fix (use --force to put the old copy back anyway)`); continue; }
      fs.copyFileSync(copy, target); restored.push(`${st.file}: old keys and paths restored`);
    }
  }
  if (!skipped.length || force) { M.undone = new Date().toISOString(); fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(M, null, 1)); }
  return { ok: !skipped.length, restored, skipped, from: dir };
}

export function render(R, { fixed = null } = {}) {
  if (R.error) return `Couldn't read it: ${R.error}. Run this from the product's folder (or pass the pm folder: nosy doctor --pm <folder>); no pm/ yet? \`nosy setup .\` (or /nosy:move-in) makes one. \`nosy doctor --check\` checks the install itself.`;
  const stale = R.findings.filter(f => f.severity === "stale"), shape = R.findings.filter(f => f.severity !== "stale");
  const staleLines = stale.length ? ["", `Out of date (${stale.length}; not doctor's to fix, the command that owns each refreshes it):`, ...stale.map(f => `  - ${f.summary}: ${f.fix}`)] : [];
  if (!shape.length) return (fixed?.length ? `Fixed ${fixed.length}: ${fixed.join(" · ")}\nNothing else to fix.` : "Nothing to fix: this pm/ matches this version of Nosy.") + staleLines.join("\n");
  if (!R.findings.length) return fixed?.length ? `Fixed ${fixed.length}: ${fixed.join(" · ")}\nNothing else to fix.` : "Nothing to fix: this pm/ matches this version of Nosy.";
  const by = s => R.findings.filter(f => f.severity === s);
  const lines = [];
  if (fixed?.length) lines.push(`Fixed ${fixed.length}:`, ...fixed.map(x => `  ✓ ${x}`), "");
  const auto = by("auto"), mention = by("mention"), route = by("route");
  if (auto.length) lines.push(`Can fix on its own (${auto.length}; \`nosy doctor --fix\`):`, ...auto.map(f => `  - ${f.summary}: ${f.fix}`), "");
  if (mention.length) lines.push(`Worth knowing (${mention.length}):`, ...mention.map(f => `  - ${f.summary}: ${f.fix}`), "");
  if (route.length) lines.push(`Needs a command (${route.length}):`, ...route.map(f => `  - ${f.summary}: ${f.fix}`), "");
  return [...lines, ...staleLines].join("\n").trimEnd();
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), doFix = argv.includes("--fix"), dry = argv.includes("--dry-run"), doUndo = argv.includes("--undo"), force = argv.includes("--force");
  const pm = argv.filter(a => !a.startsWith("--"))[0] || "pm";
  const { nosyCommand } = await import("./hints.mjs");
  if (doUndo) {
    if (!fs.existsSync(pm)) { console.error(render({ error: `no folder at ${pm}`, findings: [] })); process.exit(1); }
    const U = undo(pm, { force });
    if (U.error) { console.error(U.error); process.exit(1); }
    console.log([`Put back from ${U.from}:`, ...U.restored.map(x => `  ✓ ${x}`), ...(U.skipped.length ? ["Left alone:", ...U.skipped.map(x => `  - ${x}`)] : [])].join("\n"));
    process.exit(U.ok ? 0 : 2);
  }
  let R = examine(pm), fixed = null;
  if (R.error) { console.error(render(R)); process.exit(1); }
  const steps = doFix ? plan(pm, R) : [];
  if (doFix && steps.length) {
    console.log(`${dry ? "Would change" : "Changing"} ${steps.length} thing${steps.length === 1 ? "" : "s"} (only inside ${pm}):\n${steps.map(x => `  - ${x.summary}`).join("\n")}\n${SCOPE}\n`);
    if (dry) { console.log(`Nothing was changed. \`${nosyCommand("doctor --fix")}\` applies it, after copying what it rewrites to ${path.join(pm, BACKUP)}/.`); }
  }
  if (doFix && !dry) { fixed = fix(pm, R); R = examine(pm); }
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "doctor", generated: new Date().toISOString(), fixed, backup: fixed?.backup || null, ...R }, null, 1)); }
  console.log(render(R, { fixed }));
  if (fixed?.backup) console.log(`\nBacked up first: ${fixed.backup}. To put it all back: \`${nosyCommand("doctor --undo")}\`.`);
  process.exitCode = R.findings.some(f => f.severity !== "stale") ? 2 : 0; // stale outputs are mentioned, not failures
}
