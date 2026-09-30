// doctor: finds a pm/ folder written by an older Nosy and says what to fix (Impeccable's `doctor` idea: schema
// drift is repaired mechanically, truth drift is routed to the command that owns it). Three severities:
//   auto     no decision needed: `--fix` applies it (rename an old Turkish file/folder, rename an old sources.json
//            key, point a sources.json path at the renamed file)
//   mention  the owner should know, nothing to decide now (both the old and the new name exist: merge by hand)
//   route    a command owns it (no sources.json → move-in; a state file with old keys → re-run what writes it)
// Old names come from skill/data/lang/tr/renames.json (generated from docs/RENAMES.md, the English migration).
// Usage: node doctor.mjs <pm> [--fix] [--json <file>]
//        node doctor.mjs --check [<pm>] [--json <file>]   is my install healthy? (Node, git, gh, skill files, hooks, pm/sources.json;
//                                                       skill/tools/health.mjs; each ✗ line carries its fix)
// Exit: 0 nothing found · 2 findings remain · 1 couldn't read the pm folder. Read-only without --fix.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { next as nextPicks } from "./next.mjs"; import { parseJson } from "./sources-file.mjs"; // parseJson: the shared reader (a UTF-8 BOM is not a typo)

// --check is a different question and has to work when this file's own data is what's broken: hand it over before reading anything.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--check")) {
  const { main } = await import("./health.mjs"); process.exit(await main(process.argv.slice(2)));
}
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
    if (e.name === ".git" || e.name === "node_modules") return [];
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

export function fix(pm, R) {
  const done = [];
  const src = ["sources.json", "kaynaklar.json"].map(f => path.join(pm, f)).find(f => fs.existsSync(f));
  if (src && R.findings.some(f => f.id === "old-key" || f.id === "old-path")) {
    let K = parseJson(fs.readFileSync(src, "utf8"));
    K = renameKeys(K)[0]; K = renamePaths(K);
    fs.writeFileSync(src, JSON.stringify(K, null, 1) + "\n");
    done.push(`${path.basename(src)}: keys and paths renamed`);
  }
  // Deepest paths first (the walk already lists a folder after its contents).
  for (const f of R.findings.filter(f => f.id === "old-name")) {
    const from = path.join(pm, f.path), to = path.join(pm, path.dirname(f.path), path.basename(f.to));
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.renameSync(from, to); done.push(`${f.path} → ${path.join(path.dirname(f.path), path.basename(f.to)).replace(/^\.\//, "")}`);
  }
  return done;
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
  const jsonOut = take("--json"), doFix = argv.includes("--fix");
  const pm = argv.filter(a => a !== "--fix")[0] || "pm";
  let R = examine(pm), fixed = null;
  if (R.error) { console.error(render(R)); process.exit(1); }
  if (doFix) { fixed = fix(pm, R); R = examine(pm); }
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "doctor", generated: new Date().toISOString(), fixed, ...R }, null, 1)); }
  console.log(render(R, { fixed }));
  process.exitCode = R.findings.some(f => f.severity !== "stale") ? 2 : 0; // stale outputs are mentioned, not failures
}
