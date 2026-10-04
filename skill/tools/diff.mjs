// What changed since the last save + run history (scheduled runs + history).
// Usage: node diff.mjs <pm> save [--label <command>] [--clean [N=26]]  |  node diff.mjs <pm> [--previous <folder|date>] [--all] [--top N=5] [--json <file>]
// --top N: markdown shows only the top N changes by priority (severity, default 5);
// --all still shows everything (severity + the top cap). The JSON's "changes" always keeps everything (as
// before); "top" is the same top-N slice. On a genuine first run (one snapshot, nothing before it), instead
// of flagging every reference "fresh", prints one line: "first run: baseline saved, N references recorded".
// Patterns: Crayon severity score/"Sparks" summary (crayon.md) · Visualping diff highlighting + noise suppression against G2's "alert noise" complaint (visualping.md) · Spark "Scheduled tasks"+Run history / Linear Loops (productboard-spark.md, linear-agent.md).
// pm/sources.json is read OPTIONALLY (K.matrix, K.diff thresholds); falls back to defaults otherwise. Deterministic work; no LLM/network calls.
import fs from "node:fs"; import path from "node:path"; import { createHash } from "node:crypto";
import { readSources } from "./sources-file.mjs";

const argv = process.argv.slice(2);
const pm = argv[0] || "pm";
const saveMi = argv[1] === "save";
let K = {}; try { K = readSources(pm); } catch {}
const F = K.diff || {};
// Thresholds may come from the OPTIONAL "diff" key in sources.json; otherwise defaults.
const Threshold = {
  freshHigh: F.psst_high_score ?? 2.2, freshMedium: F.psst_medium_score ?? 1.0,
  deltaHigh: F.psst_delta_high ?? 1.0, deltaMedium: F.psst_delta_medium ?? 0.4,
  waitWorkMedium: F.pending_work_medium ?? 3, waitDayMedium: F.pending_day_medium ?? 14,
  waitWorkHigh: F.pending_work_high ?? 6, waitDayHigh: F.pending_day_high ?? 30,
  signalHigh: F.signal_increase_high ?? 5, cleanDefault: F.clean_default ?? 26,
};

// --- argv helpers (find-stale.mjs pattern) ---
const al = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const flagExists = flag => { const i = argv.indexOf(flag); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const jsonPath = al("--json"), labelValueOf = al("--label"), previousValueOf = al("--previous"), all = flagExists("--all");
// markdown shows only the top N (priority order, already high→medium→low); --top
// overrides the count, --all still means "show everything" (severity + the top cap, unchanged).
const topValueOf = al("--top");
const topN = (topValueOf && /^\d+$/.test(topValueOf)) ? +topValueOf : 5;
let cleanValueOf = null;
{ const i = argv.indexOf("--clean"); if (i >= 0) { const s = argv[i + 1]; if (s && /^\d+$/.test(s)) cleanValueOf = +argv.splice(i, 2)[1]; else { argv.splice(i, 1); cleanValueOf = Threshold.cleanDefault; } } }

// --- base helpers ---
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const zamanStampOf = () => new Date().toISOString().slice(0, 16).replace(":", "");
// Only folders named like a snapshot (2026-10-04T1230, or with a -2 suffix for a second one in the same minute) are snapshots.
// pm/history also holds other things (watch/, the matrix-before-build-*.json backups): treating every directory as a snapshot
// made `watch/` the "latest snapshot" (it sorts after the timestamps) and produced a huge false diff, and `--clean` could delete it.
const SnapshotName = /^\d{4}-\d{2}-\d{2}T\d{4}(?:-\d+)?$/;
const snapshotFolders = historyDirectory => fs.existsSync(historyDirectory)
  ? fs.readdirSync(historyDirectory, { withFileTypes: true }).filter(d => d.isDirectory() && SnapshotName.test(d.name)).map(d => d.name).sort() : [];
const stampDateOf = name => { const m = String(name).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})$/); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) : Date.parse(name); };
// Snapshot files and the key each one gets in a package (explicit, so file names and accessors can't drift apart).
const STATUS_FILES = { "status.json": "status", "lowhanging.json": "lowHanging", "signals.json": "signal", "waves.json": "waves", "size.json": "size", "inventory.json": "inventory" };
const STATUS_FILES_OF = Object.keys(STATUS_FILES);
const matrixSourcePath = () => (K.matrix && fs.existsSync(K.matrix)) ? K.matrix : path.join(pm, "matrix.json");

// Reads the existing JSONs for a "snapshot" (a history folder, or the live pm/state); skips whatever is missing.
function noktaRead(sourceDirectory) {
  const base = sourceDirectory || path.join(pm, "state");
  const pkg = {};
  for (const f of STATUS_FILES_OF) { const p = path.join(base, f); if (fs.existsSync(p)) pkg[STATUS_FILES[f]] = read(p); }
  const mPath = sourceDirectory ? path.join(sourceDirectory, "matrix.json") : matrixSourcePath();
  if (fs.existsSync(mPath)) pkg.matrix = read(mPath);
  return pkg;
}
// Source files in the live state (a [sourcePath, destName] list to copy for save).
function liveSources() {
  const list = [];
  for (const f of STATUS_FILES_OF) { const p = path.join(pm, "state", f); if (fs.existsSync(p)) list.push([p, f]); }
  const mPath = matrixSourcePath(); if (fs.existsSync(mPath)) list.push([mPath, "matrix.json"]);
  return list;
}

// --- content summary (excludes "generated" fields, stable JSON) — for dedup and "no change" ---
function cleanCopy(v) { if (Array.isArray(v)) return v.map(cleanCopy); if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) if (k !== "generated") o[k] = cleanCopy(v[k]); return o; } return v; }
function stableString(v) { if (Array.isArray(v)) return `[${v.map(stableString).join(",")}]`; if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stableString(v[k])).join(",")}}`; return JSON.stringify(v); }
const contentSummary = pkg => createHash("sha256").update(Object.keys(pkg).sort().map(k => `${k}=${stableString(cleanCopy(pkg[k]))}`).join("|")).digest("hex").slice(0, 16);

// --- psst (lowhanging) keying: ref if there is one, otherwise the normalized title (PR note stripped) ---
// The ref alone isn't enough: the same issue/decision number can be referenced by two different items of different
// signal types (e.g. "#409 connection · 1 field" the dropped-field item, vs. "#409 Acme Books: ..." the issue-opened-against-us item).
// The key also includes the base type (with the "in PR" suffix stripped) and the distinguishing part right after the ref,
// up to the first "·" (e.g. "connection" / "record"); that part excludes the tail that varies run to run, like status/date.
const REF_RE = /§\d+[a-z]?|K\d{2,3}(?:\s*m\.\d+)?|#\d+/;
// if lowhanging.json's item.ref field is present, it's used first; otherwise (old-format lowhanging.json)
// it's pulled out of title+evidence via regex (backward compat). baseType is already part of the key, so the same ref
// appearing under two types ("#409" as both a dropped field and an issue) doesn't collide.
const psstKey = m => {
  const cleanTitle = String(m.title || "").replace(/\s*\(in #\d+\)\s*$/, "").replace(/\s+/g, " ").trim();
  const baseType = String(m.type || "").replace(/\s*·\s*in PR\s*$/, "");
  const refM = m.ref ? [m.ref] : `${cleanTitle} ${m.evidence || ""}`.match(REF_RE);
  if (!refM) return cleanTitle.toLowerCase();
  const ref = String(refM[0]).replace(/\s+/g, " "), i = cleanTitle.indexOf(ref);
  const extra = i >= 0 ? cleanTitle.slice(i + ref.length).split("·")[0].trim().toLowerCase() : "";
  return `${ref}::${baseType}${extra ? "::" + extra : ""}`;
};
const severityValue = score => (score ?? 0) >= Threshold.freshHigh ? "high" : (score ?? 0) >= Threshold.freshMedium ? "medium" : "low";
const deltaSeverity = d => Math.abs(d) >= Threshold.deltaHigh ? "high" : Math.abs(d) >= Threshold.deltaMedium ? "medium" : "low";
// Waiting is measured by both run count and calendar time: on a stakeout that runs several times a day, "3 runs, 0 days"
// is noise (in an end-to-end trial, 18 items came out "medium" at once). The run-count threshold only counts once at
// least a week has passed.
const waitSeverity = (work, day) => (day >= Threshold.waitDayHigh || (work >= Threshold.waitWorkHigh && day >= 7)) ? "high" : (day >= Threshold.waitDayMedium || (work >= Threshold.waitWorkMedium && day >= 7)) ? "medium" : "low";

function comparePsst(old, fresh) {
  const out = [], oldM = new Map((old?.items || []).map(m => [psstKey(m), m])), freshM = new Map((fresh?.items || []).map(m => [psstKey(m), m]));
  for (const [k, m] of freshM) if (!oldM.has(k)) out.push({ area: "psst", type: "fresh", severity: severityValue(m.score), title: m.title, detail: `score ${m.score} · ${m.type}`, reason: "A new low-hanging item; wasn't in the previous list.", source: m.evidence || "lowhanging.json" });
  for (const [k, m] of oldM) if (!freshM.has(k)) out.push({ area: "psst", type: "resolved", severity: severityValue(m.score), title: m.title, detail: `last score ${m.score} · ${m.type}`, reason: "Was in the previous list, no longer showing up: may have been done or its condition changed.", source: m.evidence || "lowhanging.json" });
  for (const [k, y] of freshM) { const e = oldM.get(k); if (!e || (e.score === y.score && e.type === y.type)) continue;
    const typeChanged = e.type !== y.type, delta = (y.score ?? 0) - (e.score ?? 0);
    out.push({ area: "psst", type: "changed", severity: typeChanged ? "medium" : deltaSeverity(delta), title: y.title,
      detail: `score ${e.score} → ${y.score}${typeChanged ? ` · type "${e.type}" → "${y.type}"` : ""}`,
      reason: typeChanged ? "Its type changed (e.g. entered or left an open PR)." : delta > 0 ? "Its score went up." : "Its score went down.", source: y.evidence || "lowhanging.json" }); }
  return out;
}
// Keys present in both the old and new lists (still open) — aging runs on these.
const psstCommon = (old, fresh) => { const e = new Set((old?.items || []).map(psstKey)); return (fresh?.items || []).map(psstKey).filter(k => e.has(k)); };

function compareStatus(old, fresh) {
  const out = []; if (!fresh) return out;
  const oldPr = new Map((old?.prs || []).map(p => [p.n, p])), freshPr = new Map((fresh?.prs || []).map(p => [p.n, p]));
  for (const [n, p] of freshPr) if (!oldPr.has(n)) out.push({ area: "state", type: "fresh", severity: "medium", title: `PR #${n} opened: ${p.t}`, detail: `${p.a} · ${p.count} commits`, reason: "New open PR; the content isn't on main yet.", source: `#${n}` });
  for (const [n, p] of oldPr) if (!freshPr.has(n)) out.push({ area: "state", type: "resolved", severity: "high", title: `PR #${n} is no longer open: ${p.t}`, detail: `${p.a} · had ${p.count} commits in range`, reason: "Dropped from the open-PR list: merged or closed. Page lines that say 'open PR' may be stale.", source: `#${n}` });
  const oldGr = new Map((old?.groups || []).map(g => [g.ref, g]));
  for (const g of fresh.groups || []) { const e = oldGr.get(g.ref);
    if (!e) { out.push({ area: "state", type: "fresh", severity: g.where.includes("main") ? "medium" : "low", title: `${g.ref}: ${String(g.topic).slice(0, 90)}`, detail: `${g.n} commits · ${g.where.join(", ")} · ${g.who.join(", ")}`, reason: "First time a commit was seen for this reference.", source: g.ref }); continue; }
    const mainPassed = !e.where.includes("main") && g.where.includes("main");
    if (mainPassed) out.push({ area: "state", type: "changed", severity: "high", title: `${g.ref}: landed on main`, detail: String(g.topic).slice(0, 90), reason: "Used to only be in an open PR, now on main. Page lines saying 'in flight' should be updated.", source: g.ref });
    else if (g.n > e.n) out.push({ area: "state", type: "changed", severity: "low", title: `${g.ref}: new commit`, detail: `${e.n} → ${g.n} commits`, reason: "Another commit landed against the same reference.", source: g.ref });
  }
  if (old?.lastMain && fresh.lastMain && old.lastMain !== fresh.lastMain) out.push({ area: "state", type: "changed", severity: "low", title: "main advanced", detail: `${old.lastMain} → ${fresh.lastMain}`, reason: "Informational: main's tip changed.", source: "status.json" });
  return out;
}

// Converts the Acme Books (lines[].codes[product]) and Nosy (steps[] + products[].codes[no], us.codes[no]) formats into a common cell map.
function matrixParse(M) {
  if (!M) return null;
  if (Array.isArray(M.lines)) {
    const usNameOf = M.products?.[0], cells = new Map();
    for (const r of M.lines) { const sKey = `${r.group || ""}::${r.feature}`; for (const product of M.products || []) cells.set(`${product}||${sKey}`, { code: r.codes?.[product], label: r.feature, product, sKey, biz: product === usNameOf }); }
    return { usNameOf, cells };
  }
  if (Array.isArray(M.steps)) {
    const codeCoz = c => (c && typeof c === "object") ? c.k : c;
    const products = [{ name: "(us)", codes: M.biz?.codes || {} }, ...(M.products || []).map(u => ({ name: u.name, codes: u.codes || {} }))];
    const cells = new Map();
    for (const a of M.steps || []) for (const u of products) cells.set(`${u.name}||${a.no}`, { code: codeCoz(u.codes[a.no]), label: a.name, product: u.name, sKey: a.no, biz: u.name === "(us)" });
    return { usNameOf: "(us)", cells };
  }
  return null;
}
function compareMatrix(old, fresh) {
  const out = [], Y = matrixParse(fresh); if (!Y) return out;
  const E = matrixParse(old), keys = new Set([...(E?.cells.keys() || []), ...Y.cells.keys()]);
  for (const k of keys) {
    const e = E?.cells.get(k), y = Y.cells.get(k); if (!y) continue;
    if (!e) { out.push({ area: "matrix", type: "fresh", severity: "medium", title: `${y.product} × ${y.label}`, detail: `code ${y.code ?? "?"}`, reason: "New row or product in the matrix.", source: "matrix.json" }); continue; }
    if (e.code === y.code) continue;
    const bizCode = Y.cells.get(`${Y.usNameOf}||${y.sKey}`)?.code;
    // "d" (announced, not shipped) doesn't count as launched; d → y is the real launch.
    const rivalWasOpened = !y.biz && (e.code === "n" || e.code === "u" || e.code === "d") && y.code === "y", bizMissing = bizCode === "n" || bizCode === "p";
    const rivalAnnounced = !y.biz && y.code === "d" && e.code !== "y";
    const severity = rivalWasOpened && bizMissing ? "high" : y.biz ? "medium" : "low";
    const reason = rivalWasOpened && bizMissing ? "A rival shipped something we don't have, or have only partially." : rivalAnnounced ? "A rival announced it but it isn't usable yet; revisit once it ships." : y.biz ? "Our own score changed." : "A rival's cell changed; we already have the equivalent.";
    out.push({ area: "matrix", type: "changed", severity, title: `${y.product} × ${y.label}`, detail: `${e.code ?? "?"} → ${y.code ?? "?"}${y.biz ? "" : ` (ours: ${bizCode ?? "?"})`}`, reason, source: "matrix.json" });
  }
  return out;
}

function compareSignal(old, fresh) {
  const out = []; if (!fresh) return out;
  const key = h => h.ref || h.title, oldH = new Map((old?.goals || []).map(h => [key(h), h]));
  for (const h of fresh.goals || []) { const e = oldH.get(key(h));
    if (!e) { out.push({ area: "signal", type: "fresh", severity: "medium", title: h.title, detail: `${h.count} requests · ${h.customer || ""}`, reason: "New demand target.", source: h.ref || "signals.json" }); continue; }
    if ((h.count ?? 0) !== (e.count ?? 0)) { const delta = (h.count ?? 0) - (e.count ?? 0);
      out.push({ area: "signal", type: "changed", severity: delta >= Threshold.signalHigh ? "high" : "medium", title: h.title, detail: `${e.count} → ${h.count} requests (${delta > 0 ? "+" : ""}${delta})`, reason: delta > 0 ? "Demand went up." : "Demand went down.", source: h.ref || "signals.json" }); }
  }
  const oldT = new Set((old?.themes || []).map(t => t.key));
  for (const t of fresh.themes || []) if (!oldT.has(t.key)) out.push({ area: "signal", type: "fresh", severity: "medium", title: `New theme: ${t.key}`, detail: `${t.count} records`, reason: "Wasn't there in the previous scan.", source: "signals.json" });
  return out;
}

function compareWaves(old, fresh) {
  const out = []; if (!fresh) return out;
  const isWhere = P => { const m = new Map(); for (const d of P?.waves || []) for (const is of d.tasks || []) m.set(is.ref || is.title, d.name); return m; };
  const isFind = (P, key) => { for (const d of P?.waves || []) for (const is of d.tasks || []) if ((is.ref || is.title) === key) return is; return null; };
  const oldWhere = isWhere(old);
  for (const [key, wave] of isWhere(fresh)) { const e = oldWhere.get(key), is = isFind(fresh, key);
    if (!e) { out.push({ area: "waves", type: "fresh", severity: wave === "now" ? "medium" : "low", title: is?.title || key, detail: `wave: ${wave}`, reason: "Entered a wave for the first time.", source: is?.ref || "waves.json" }); continue; }
    if (e !== wave) out.push({ area: "waves", type: "changed", severity: "medium", title: is?.title || key, detail: `${e} → ${wave}`, reason: "Wave changed: priority was reassessed.", source: is?.ref || "waves.json" });
  }
  return out;
}

// Aging from runs.jsonl + snapshots: how many consecutive runs (via the folder field) a psst key has most recently appeared in, and how many days it's been open.
function age(historyDirectory, currentLowHanging, keys) {
  if (!keys.length) return [];
  const jsonlPath = path.join(historyDirectory, "runs.jsonl");
  const lines = fs.existsSync(jsonlPath) ? fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean).map(s => JSON.parse(s)) : [];
  const cache = new Map();
  const folderKeysOf = name => { if (!name) return new Set(); if (cache.has(name)) return cache.get(name); const l = read(path.join(historyDirectory, name, "lowhanging.json")); const s = new Set((l?.items || []).map(psstKey)); cache.set(name, s); return s; };
  const titles = new Map((currentLowHanging?.items || []).map(m => [psstKey(m), m]));
  const result = [];
  for (const key of new Set(keys)) {
    let work = 0, ilkZaman = null;
    for (let i = lines.length - 1; i >= 0; i--) { if (!folderKeysOf(lines[i].folder).has(key)) break; work++; ilkZaman = lines[i].zaman; }
    if (!work) continue;
    const day = Math.floor((Date.now() - Date.parse(ilkZaman)) / 86400000), m = titles.get(key);
    result.push({ title: m?.title || key, work, day, source: m?.evidence || "lowhanging.json" });
  }
  return result.sort((a, b) => b.work - a.work || b.day - a.day);
}

// --- save: take a snapshot, append a line to runs.jsonl, clean up old ones if asked ---
function clean(historyDirectory, n) {
  const folders = snapshotFolders(historyDirectory);
  const toBeDeleted = folders.slice(0, Math.max(0, folders.length - n));
  for (const name of toBeDeleted) { const goal = path.join(historyDirectory, name); if (path.dirname(goal) === historyDirectory) fs.rmSync(goal, { recursive: true, force: true }); }
  console.log(`clean: deleted ${toBeDeleted.length} old records (kept ${n})${toBeDeleted.length ? ": " + toBeDeleted.join(", ") : ""}`);
}
function saveRun() {
  const historyDirectory = path.join(pm, "history"); fs.mkdirSync(historyDirectory, { recursive: true });
  const folders = snapshotFolders(historyDirectory);
  const lastFolder = folders.at(-1) || null;
  const livePackage = noktaRead(null), freshSummary = contentSummary(livePackage);
  const lastSummary = lastFolder ? contentSummary(noktaRead(path.join(historyDirectory, lastFolder))) : null;
  let goalFolder = lastFolder, changed = false;
  if (!lastFolder || freshSummary !== lastSummary) {
    // If save is called more than once in the same minute, the name could collide; on collision append -2, -3… to avoid overwriting an existing one.
    goalFolder = zamanStampOf(); let goalPath = path.join(historyDirectory, goalFolder);
    for (let extra = 2; fs.existsSync(goalPath); extra++) { goalFolder = `${zamanStampOf()}-${extra}`; goalPath = path.join(historyDirectory, goalFolder); }
    fs.mkdirSync(goalPath, { recursive: true });
    for (const [source, name] of liveSources()) fs.copyFileSync(source, path.join(goalPath, name));
    changed = true;
  }
  const d = livePackage.status, l = livePackage.lowHanging, s = livePackage.signal, w = livePackage.waves;
  const numbers = { psst: l?.items?.length, pr: d?.prs?.length, group: d?.groups?.length, signal: s?.goals?.length, wave: w?.waves?.length };
  for (const k of Object.keys(numbers)) if (numbers[k] === undefined) delete numbers[k];
  const line = { zaman: new Date().toISOString(), label: labelValueOf || null, ref: K.ref || null, lastMain: d?.lastMain || null, folder: goalFolder, numbers };
  fs.appendFileSync(path.join(historyDirectory, "runs.jsonl"), JSON.stringify(line) + "\n");
  const message = changed ? `saved: ${path.join(pm, "history", goalFolder)}` : `no change (same as last save: ${path.join(pm, "history", lastFolder)})`;
  console.log(`# diff save · ${new Date().toISOString()}\n\n${message}\n\nNumbers: ${JSON.stringify(numbers)}`);
  if (cleanValueOf != null) clean(historyDirectory, cleanValueOf);
}

// --- diff: compares the last (or --previous) snapshot with the current one (last snapshot or live state) ---
function previousFind(folders, value) {
  if (folders.includes(value)) return value;
  const prefix = folders.filter(k => k.startsWith(value)); if (prefix.length) return prefix.at(-1);
  const t = /T/.test(value) ? stampDateOf(value) : Date.parse(value + "T12:00:00Z"); if (Number.isNaN(t)) return null;
  let en = null, enDiff = Infinity;
  for (const k of folders) { const f = Math.abs(stampDateOf(k) - t); if (f < enDiff) { enDiff = f; en = k; } }
  return en;
}
// `shown`: what actually gets printed (top N unless --all). `moreCount`: how many more non-low-severity
// changes exist beyond `shown` (0 when --all, since nothing beyond severity is hidden then).
function printMarkdown(previous, current, shown, moreCount, pendingOnes, hiddenOnes) {
  const AREA_NAME = { psst: "Low-hanging fruit", state: "Delivery", matrix: "Matrix", signal: "Demand signal", waves: "Waves" };
  let o = `# Since the last run · ${previous || "?"} → ${current}\n\n`;
  o += shown.length ? shown.map((d, i) => `${i + 1}. **[${d.severity}]** ${d.title} — ${d.reason}`).join("\n") + "\n\n" : "No notable changes in this range.\n\n";
  for (const area of Object.keys(AREA_NAME)) {
    const list = shown.filter(d => d.area === area); if (!list.length) continue;
    o += `## ${AREA_NAME[area]}\n\n| Severity | Type | What | Detail | Why | Source |\n|---|---|---|---|---|---|\n`;
    for (const d of list) o += `| ${d.severity} | ${d.type} | ${String(d.title).replace(/\|/g, "/")} | ${String(d.detail || "").replace(/\|/g, "/")} | ${d.reason} | ${String(d.source || "").replace(/\|/g, "/")} |\n`;
    o += "\n";
  }
  if (pendingOnes.length) o += `## Pending\n\n| Work | Runs | Days |\n|---|---|---|\n${pendingOnes.slice(0, 8).map(b => `| ${String(b.title).replace(/\|/g, "/")} | ${b.work} | ${b.day} |`).join("\n")}\n\n`;
  if (moreCount) o += `+${moreCount} more (use \`--all\`).\n`;
  if (hiddenOnes) o += `${hiddenOnes} low-severity change${hiddenOnes === 1 ? "" : "s"} hidden; see with \`--all\`.\n`;
  process.stdout.write(o);
}
function diffRun() {
  const historyDirectory = path.join(pm, "history");
  const folders = snapshotFolders(historyDirectory);
  const lastFolder = folders.at(-1) || null;
  const livePackage = noktaRead(null), lastPackage = lastFolder ? noktaRead(path.join(historyDirectory, lastFolder)) : null;
  let currentLabel, currentPackage, previousLabel, previousPackage;
  if (!lastFolder) { currentLabel = "(current, not saved)"; currentPackage = livePackage; previousLabel = null; previousPackage = null; }
  else if (contentSummary(livePackage) !== contentSummary(lastPackage)) { currentLabel = "(current, not saved)"; currentPackage = livePackage; previousLabel = lastFolder; previousPackage = lastPackage; }
  else { currentLabel = lastFolder; currentPackage = lastPackage; const o2 = folders.at(-2) || null; previousLabel = o2; previousPackage = o2 ? noktaRead(path.join(historyDirectory, o2)) : null; }
  if (previousValueOf) {
    const matching = previousFind(folders, previousValueOf);
    if (!matching) { console.error(`--previous didn't match: ${previousValueOf} (available: ${folders.join(", ") || "missing"})`); process.exit(1); }
    previousLabel = matching; previousPackage = noktaRead(path.join(historyDirectory, matching));
  }
  if (!previousPackage) {
    if (!lastFolder) {
      // Nothing has ever been saved yet - there's no baseline at all, not even a first-run one.
      console.log(`# Since the last run\n\nNo previous record to compare against. Run \`node diff.mjs ${pm} save\` first.`);
      if (jsonPath) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonPath), { recursive: true }), jsonPath), JSON.stringify({ type: "diff", generated: new Date().toISOString(), previous: previousLabel, current: currentLabel, changes: [], top: [], pendingOnes: [], hiddenOnes: 0 }, null, 1));
      return;
    }
    // exactly one snapshot exists (the baseline just saved by `diff.mjs ... save`) and
    // there's nothing before it to compare against. Comparing it to nothing would flag every single
    // reference as "fresh" (noise, not a real diff) - say so in one line instead and count what got recorded.
    const baseline = [
      ...comparePsst(null, currentPackage.lowHanging),
      ...compareStatus(null, currentPackage.status),
      ...compareMatrix(null, currentPackage.matrix),
      ...compareSignal(null, currentPackage.signal),
      ...compareWaves(null, currentPackage.waves),
    ];
    const n = baseline.length;
    console.log(`# Since the last run\n\nfirst run: baseline saved, ${n} reference${n === 1 ? "" : "s"} recorded; changes start next run.`);
    if (jsonPath) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonPath), { recursive: true }), jsonPath), JSON.stringify({ type: "diff", generated: new Date().toISOString(), previous: null, current: currentLabel, firstRun: true, baselineCount: n, changes: [], top: [], pendingOnes: [], hiddenOnes: 0 }, null, 1));
    return;
  }
  const everything = [
    ...comparePsst(previousPackage.lowHanging, currentPackage.lowHanging),
    ...compareStatus(previousPackage.status, currentPackage.status),
    ...compareMatrix(previousPackage.matrix, currentPackage.matrix),
    ...compareSignal(previousPackage.signal, currentPackage.signal),
    ...compareWaves(previousPackage.waves, currentPackage.waves),
  ];
  const pendingOnes = age(historyDirectory, currentPackage.lowHanging, psstCommon(previousPackage.lowHanging, currentPackage.lowHanging));
  for (const b of pendingOnes) { const severity = waitSeverity(b.work, b.day); if (severity === "low") continue;
    everything.push({ area: "psst", type: "waiting", severity, title: b.title, detail: `open for ${b.work} runs, ${b.day} days`, reason: "The same work has been on the list for multiple runs; a nudge to the owner, in the spirit of Spark/Linear Loops' \"run history\" pattern.", source: b.source }); }
  const Order = { "high": 0, "medium": 1, "low": 2 };
  everything.sort((a, b) => Order[a.severity] - Order[b.severity]);
  const toBeShown = all ? everything : everything.filter(d => d.severity !== "low"), hiddenOnes = everything.length - toBeShown.length;
  // top N by priority (severity, already sorted above), independent of --all: markdown prints just this
  // unless --all is given (then it prints the full toBeShown list, same as before); the JSON keeps the full
  // "changes" list either way and adds this as "top".
  const topItems = toBeShown.slice(0, topN);
  const shownForMarkdown = all ? toBeShown : topItems, moreCount = all ? 0 : toBeShown.length - topItems.length;
  printMarkdown(previousLabel, currentLabel, shownForMarkdown, moreCount, pendingOnes, hiddenOnes);
  if (jsonPath) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonPath), { recursive: true }), jsonPath), JSON.stringify({ type: "diff", generated: new Date().toISOString(), previous: previousLabel, current: currentLabel, changes: toBeShown, top: topItems, pendingOnes, hiddenOnes }, null, 1));
}

if (saveMi) saveRun(); else diffRun();
