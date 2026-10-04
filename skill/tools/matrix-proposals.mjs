// matrix-proposals: the evidence gate between "an agent proposed a matrix cell" and "the cell changed".
// On the first run on a real product 75 cells were proposed from rival research and only 10 had enough evidence: 61 were weak,
// 3 refuted. Agents trusted page dates as release dates, proposed cells from pages they hadn't opened, and lowered a code because
// they found nothing. The neighbor agents now write what they propose to pm/state/matrix-proposals.json; this reads it, sorts each
// proposal, and applies only the ones that earned it. No model, no network: it reads the file and pm/matrix.json.
//   pm/state/matrix-proposals.json   { "proposals": [ { "rival": "<name as in the matrix>", "step": "<step no or row feature>",
//        "from": "y|p|n|u|d", "to": "y|p|n|u|d", "removal": false,
//        "evidence": [ { "url", "grade": "primary|secondary|marketing|gated", "page_opened": true|false,
//                        "date": "YYYY-MM-DD (optional)", "date_kind": "release|page|none" } ] } ] }
//   check   sorts every proposal and writes pm/state/matrix-proposals.checked.json + a short summary:
//     apply   a page was opened AND (one primary item, or two secondary items from different registrable domains). Only items whose
//             page was opened count toward that (a snippet or a directory listing proves nothing: neighbor rule 10).
//     hold    weaker than that, or no page opened: stays a proposal, the code is unchanged. `ceiling` says what the evidence could
//             support at best: marketing-only, gated-only ("listed, detail behind a login") or a single secondary source cap at p.
//     reject  `to` lowers a y or p to u or n without `removal: true` (no evidence is not evidence of absence: the cell is only
//             re-dated), or every opened page carries only a page date (date_kind "page": a sitemap lastmod, a "last updated" line,
//             a post date) as its date.
//     warnings: one url behind proposals on 2+ different rows (look again before applying); a rival or step not in the matrix (such a
//             proposal can't be applied); two proposals for one cell that disagree (both held).
//   apply   writes the "apply" class into the matrix (copy to pm/.backup/matrix-<stamp>.json first, `undo` puts it back). Step shape
//           (products[].codes[no]): the cell becomes { k, evidence: <first primary url>, verified_at: <today> }. Line shape
//           (lines[].codes[name]): the code string only (it has nowhere to keep a date). Every cell a proposal looked at, hold and
//           reject included, gets verified_at refreshed when its evidence was opened this round, and its code left alone.
//           --dry-run lists the changes and writes nothing.
//   undo    restores the newest matrix backup (refuses when the matrix changed since the apply, unless --force).
// A proposal against a matrix that moved on (decided 2 Oct): the proposals file is a snapshot of what the agents saw. If a cell's
//   code in the matrix is no longer the proposal's `from`, someone (an earlier apply, the owner, a rebuild from the rival tables) changed it after
//   the agent looked, so its evidence was weighed against a cell that isn't there any more: that proposal is held with the reason, per cell, never
//   applied. That also makes a second `apply` of the same file a no-op instead of a repeat. When the proposals file is older than the matrix file
//   as a whole, the summary says so once, because then several cells may be affected. It is a warning, not a refusal: a matrix rebuilt after the
//   agents wrote (build-matrix) is the normal order, and the per-cell check is what protects the cell. A cell with no `from` in the proposal can't be
//   checked and is applied as before.
// Registrable domain = the hostname without a leading "www." and its last two labels ("docs.rival.com" -> "rival.com"). Good enough
// for the independence test; "rival.co.uk" and "other.co.uk" would count as one site, which only errs toward asking for more evidence.
// Usage: node matrix-proposals.mjs check <pm> [--matrix <file>] [--proposals <file>]
//        node matrix-proposals.mjs apply <pm> [--matrix <file>] [--dry-run]
//        node matrix-proposals.mjs undo <pm> [--force]
// Exit: 0 done · 1 no proposals file / no matrix / bad JSON / nothing to undo.
import { localDayOf } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";
import { parseJson, readSourcesSafe, rivalsDir, rivalFiles } from "./sources-file.mjs";
import { nosyCommand } from "./hints.mjs";

const CODES = ["y", "p", "n", "u", "d"], GRADES = ["primary", "secondary", "marketing", "gated"];
const TR = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/read-matrix.json", import.meta.url), "utf8")); // a hand-written line-shape matrix may be keyed in Turkish (read-matrix.mjs)
const LK = TR.lineShapeKeys || {};
const fold = s => String(s ?? "").replace(/[İI]/g, "i").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/\s+/g, " ").trim();
const iso = (d = new Date()) => localDayOf(d);

// An address typed without its scheme ("rival.com/changelog") is still that site: "https://" is assumed, or two pages of one site would pass as two sources.
const parseUrl = url => { const t = String(url ?? "").trim(); if (!t) return null; try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; } };
export function hostOf(url) { const u = parseUrl(url); return u && u.hostname.includes(".") ? u.hostname.toLowerCase().replace(/^www\./, "") : ""; }
// "docs.rival.com" and "rival.com" are one site; "rival.com" and "review-site.com" are two.
export function domainOf(url) { const h = hostOf(url); return h ? h.split(".").slice(-2).join(".") : ""; }
// The same page written two ways ("https://www.x.com/a/#top", "https://x.com/a") is one url.
export function urlKey(url) { const u = parseUrl(url); return u && u.hostname.includes(".") ? `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}` : String(url ?? "").trim().toLowerCase(); }

// --- reading the matrix (both shapes; applying needs the raw object, so this finds cells instead of reducing them) -----------
const pickKey = (o, k) => (o && o[k] !== undefined ? k : (LK[k] && o && o[LK[k]] !== undefined ? LK[k] : k));
const codeOf = v => (v && typeof v === "object" ? v.k : v);
// Where a proposal's cell is: { shape, rival (the name as the matrix has it), rivalFound, stepFound, current (code or null), get/set }.
export function locate(M, rival, step, { codes } = {}) {
  const mapCode = v => (codes && v !== undefined && v !== null && !CODES.includes(v) && Object.prototype.hasOwnProperty.call(codes, v) ? codes[v] : v);
  const out = { shape: null, rival, rivalFound: false, stepFound: false, current: null, ours: false };
  if (!M || typeof M !== "object") return out;
  if (Array.isArray(M.steps)) {
    out.shape = "step";
    const no = (M.steps.find(a => String(a.no) === String(step).trim()) || M.steps.find(a => fold(a.name) === fold(step)) || {}).no;
    out.stepFound = no !== undefined; out.no = no === undefined ? null : String(no);
    const P = (M.products || []).find(u => u && fold(u.name) === fold(rival));
    out.rivalFound = !!P; if (P) out.rival = P.name; else if (M.biz && fold(M.biz.name) === fold(rival)) out.ours = true;
    if (P && out.stepFound) { out.holder = P; out.current = mapCode(codeOf((P.codes || {})[out.no])) ?? null; }
    return out;
  }
  const lk = pickKey(M, "lines"), pk = pickKey(M, "products");
  if (!Array.isArray(M[lk])) return out;
  out.shape = "line";
  const names = (M[pk] || []).map(u => typeof u === "string" ? u : u && u.name);
  const name = names.find(n => fold(n) === fold(rival));
  out.rivalFound = name !== undefined; if (name !== undefined) out.rival = name; else if (names[0] && fold(names[0]) === fold(rival)) out.ours = true;
  const line = M[lk].find(r => fold(r[pickKey(r, "feature")]) === fold(step)) || M[lk].find(r => r.no !== undefined && String(r.no) === String(step).trim());
  out.stepFound = !!line;
  if (line && out.rivalFound) { out.holder = line; out.codesKey = pickKey(line, "codes"); out.current = mapCode(codeOf((line[out.codesKey] || {})[name])) ?? null; }
  return out;
}

// --- classifying -------------------------------------------------------------------------------------------------------
const norm = e => ({ url: String((e && e.url) ?? "").trim(), grade: GRADES.includes(String(e && e.grade).toLowerCase()) ? String(e.grade).toLowerCase() : "unknown",
  opened: !!e && e.page_opened === true, date: e && e.date ? String(e.date) : "", dateKind: ["release", "page", "none"].includes(e && e.date_kind) ? e.date_kind : "none" });

// One proposal on its own (the matrix cell it points at comes in as `cell`, from locate()). Pure.
export function classify(p, cell = {}) {
  const ev = (Array.isArray(p.evidence) ? p.evidence : []).map(norm), opened = ev.filter(e => e.opened);
  const primary = opened.filter(e => e.grade === "primary"), secondaryDomains = new Set(opened.filter(e => e.grade === "secondary").map(e => domainOf(e.url) || e.url));
  const strong = primary.length > 0 || secondaryDomains.size >= 2;
  // What the evidence could carry at best. Marketing-only, gated-only and a single secondary source stop at p.
  const ceiling = strong ? "y" : opened.length ? "p" : null;
  const to = String(p.to ?? "").toLowerCase(), from = String(p.from ?? "").toLowerCase();
  const current = CODES.includes(cell.current) ? cell.current : from; // the matrix is the authority; the proposal's `from` is what the agent saw
  const R = { rival: p.rival, step: String(p.step ?? ""), from, to, removal: p.removal === true, opened: opened.length > 0, ceiling, evidence: ev, reasons: [] };
  if (!CODES.includes(to)) return { ...R, class: "hold", reasons: [`\`to\` is "${p.to ?? ""}": not one of y p n u d`] };
  // Absence of evidence is not evidence of absence: a y or p stays, and only its date moves.
  if ((current === "y" || current === "p") && (to === "u" || to === "n") && p.removal !== true)
    return { ...R, class: "reject", reasons: [`lowers ${current} to ${to} without \`removal: true\`: nothing found this round is not "not there"; the cell keeps ${current} and is only re-dated`] };
  // Every page that was opened dates itself with a page date: that says when the page was touched, not when anything shipped.
  if (opened.length && opened.every(e => e.date && e.dateKind === "page"))
    return { ...R, class: "reject", reasons: ["every opened page is dated only by a page date (a last-updated line, a post date or a sitemap lastmod), which is not a ship date"] };
  if (strong) return { ...R, class: "apply", reasons: [primary.length ? `primary evidence: ${primary[0].url}` : `two independent secondary sources: ${[...secondaryDomains].join(", ")}`] };
  const why = [];
  if (!opened.length) why.push(ev.length ? "no evidence page was opened (a snippet or a listing is not a page read)" : "no evidence");
  else {
    const g = new Set(opened.map(e => e.grade));
    if (g.has("secondary")) why.push("one secondary source: needs a primary item or a second one from another domain");
    if (g.has("marketing")) why.push("the product's own marketing page only (at most p)");
    if (g.has("gated")) why.push("listed, detail behind a login (at most p)");
    if (g.has("unknown")) why.push("evidence grade missing or unknown");
  }
  return { ...R, class: "hold", reasons: why };
}

// All proposals against a matrix: classes, plus the warnings that need a look across proposals.
export function check(file, M, { codes, rivals = [] } = {}) {
  const fileOf = name => rivals.find(r => fold(r.name) === fold(name) || fold(r.slug) === fold(name));
  const list = (Array.isArray(file) ? file : Array.isArray(file && file.proposals) ? file.proposals : []).filter(p => p && typeof p === "object" && !Array.isArray(p)); // a null or a string in the list isn't a proposal
  const warnings = [], cells = new Map();
  const out = list.map((p, i) => {
    const cell = locate(M, p.rival, p.step, { codes }), C = { ...classify(p, cell), index: i, warnings: [] };
    C.cell = { shape: cell.shape, found: cell.rivalFound && cell.stepFound, current: cell.current };
    if (!cell.rivalFound) C.warnings.push(cell.ours ? `"${p.rival}" is our own product, not a rival: its column isn't changed from rival research` : cell.stepFound && fileOf(p.rival) ? `rival "${p.rival}" has a rival file (${fileOf(p.rival).file}) but no column yet: applying adds it, with only the cells that earn it` : `rival "${p.rival}" is not in the matrix`);
    else if (!cell.stepFound) C.warnings.push(`step "${p.step}" is not in the matrix`);
    else if (cell.current && CODES.includes(C.from) && cell.current !== C.from) {
      C.warnings.push(`the matrix says ${cell.current} for this cell, the proposal says it started at ${C.from}`);
      // The cell moved after the agent looked (see the header): never applied on evidence weighed against another cell.
      if (C.class === "apply") { C.class = "hold"; C.stale = true; C.reasons = [`the matrix changed since the agent looked: it says ${cell.current} now, the proposal started from ${C.from}; propose again against the current matrix`]; }
    }
    if (cell.rivalFound && cell.stepFound) { const k = `${fold(cell.rival)}\u0000${cell.shape === "step" ? cell.no : fold(p.step)}`; (cells.get(k) || cells.set(k, []).get(k)).push(C); C.cellKey = k; }
    return C;
  });
  // Two proposals for one cell that disagree: neither goes in on its own.
  for (const group of cells.values()) if (group.length > 1 && new Set(group.map(c => c.to)).size > 1)
    for (const c of group) { if (c.class === "apply") { c.class = "hold"; c.reasons = ["another proposal for the same cell says something else: look at both"]; } c.warnings.push("two proposals for this cell disagree"); }
  // One url behind proposals on two rows or more.
  const byUrl = new Map();
  for (const c of out) for (const url of new Set(c.evidence.map(e => e.url).filter(Boolean))) { const k = urlKey(url); if (!byUrl.has(k)) byUrl.set(k, { url, rows: new Map() }); byUrl.get(k).rows.set(`${fold(c.rival)}\u0000${fold(c.step)}`, c); }
  const shared = [...byUrl.values()].filter(x => new Set([...x.rows.values()].map(c => fold(c.step))).size > 1);
  for (const x of shared) {
    const cs = [...x.rows.values()];
    warnings.push({ kind: "shared-url", url: x.url, rows: cs.map(c => `${c.rival} / ${c.step}`), text: `one page backs ${new Set(cs.map(c => fold(c.step))).size} rows (${cs.map(c => `${c.rival} / ${c.step}`).join("; ")}): look again before applying` });
    for (const c of cs) c.warnings.push(`the same page (${x.url}) backs other rows: look again before applying`);
  }
  for (const c of out) for (const w of c.warnings) if (/not in the matrix|our own product/.test(w)) warnings.push({ kind: "not-in-matrix", rival: c.rival, step: c.step, text: `${c.rival} / ${c.step}: ${w}` });
  const count = k => out.filter(c => c.class === k).length;
  return { type: "matrix-proposals-checked", counts: { total: out.length, apply: count("apply"), hold: count("hold"), reject: count("reject") }, proposals: out, warnings };
}

export function summary(R) {
  const n = R.counts, L = [`# Matrix proposals · ${n.total} checked: ${n.apply} to apply, ${n.hold} held, ${n.reject} rejected`, ""];
  const line = c => `- ${c.rival} / step ${c.step}: ${c.from || "?"} → ${c.to || "?"}${c.class === "apply" ? "" : ` (stays ${c.cell && c.cell.current || c.from || "as it is"})`} · ${c.reasons.join("; ")}${c.warnings.length ? ` · ⚠ ${c.warnings.join("; ")}` : ""}`;
  for (const [k, title, note] of [["apply", "Apply", ""], ["hold", "Hold (still proposals, codes unchanged)", ""], ["reject", "Reject", ""]]) {
    const cs = R.proposals.filter(c => c.class === k); if (!cs.length) continue;
    L.push(`## ${title} (${cs.length})`, ...cs.map(line), "");
  }
  if (R.olderThanMatrix) L.push("Note: the proposals file is older than the matrix, so the agents looked at an earlier matrix. A cell whose code has changed since is held below; the rest is checked as usual.", "");
  if (R.warnings.length) L.push("## Look again", ...R.warnings.map(w => `- ${w.text}`), "");
  if (n.hold) L.push("A held cell keeps its code. A rival with no release-notes page can't be proven current or stale: say \"no source to verify against\", not \"no change\".");
  return L.join("\n").trim();
}

// --- applying ----------------------------------------------------------------------------------------------------------
const firstUrl = c => (c.evidence.find(e => e.opened && e.grade === "primary") || c.evidence.find(e => e.opened) || {}).url || "";
// A matrix with the "apply" class written in and every opened cell re-dated. Returns { matrix, changes } and never touches the input.
// `codes` (sources.json matrixCodes) maps the owner's own letters to Nosy's. A cell that holds one of the owner's letters keeps speaking that
// language: the new code is written back as the owner's letter when exactly one letter means it, so a hand-kept matrix isn't left with two vocabularies.
export function applyTo(M, R, { today = iso(), codes, rivals = [] } = {}) {
  const next = JSON.parse(JSON.stringify(M)), changes = [], skipped = [];
  const fileOf = name => rivals.find(r => fold(r.name) === fold(name) || fold(r.slug) === fold(name));
  const ownLetter = (raw, to) => {
    const was = codeOf(raw);
    if (!codes || typeof was !== "string" || CODES.includes(was) || !Object.prototype.hasOwnProperty.call(codes, was)) return to;
    const letters = Object.entries(codes).filter(([, v]) => v === to).map(([k]) => k);
    return letters.length === 1 ? letters[0] : to;
  };
  for (const c of R.proposals) {
    let cell = locate(next, c.rival, c.step, { codes });
    // A rival that has a file (a new stub the research is filling in) but no column yet: the first cell that earns its place creates the column, empty
    // otherwise. build-matrix leaves a rival with a blank table out, and this refused any rival it didn't have, so the first research pass on a new rival
    // could never be applied without seeding every cell by hand (BlogFactory field test). Only step-shape matrices, only a "apply" proposal, only a rival
    // with a file: a typo in a rival's name still adds nothing.
    if (c.class === "apply" && !cell.rivalFound && !cell.ours && cell.stepFound && cell.shape === "step" && fileOf(c.rival)) {
      const f = fileOf(c.rival); (next.products ||= []).push({ name: f.name, file: f.file, category: f.category || "", codes: {} });
      changes.push({ kind: "rival-added", rival: f.name, step: c.step, from: null, to: null, evidence: "" });
      cell = locate(next, f.name, c.step, { codes });
    }
    if (!cell.rivalFound || !cell.stepFound) { if (c.class === "apply") skipped.push({ rival: c.rival, step: c.step, why: !cell.rivalFound ? "rival not in the matrix" : "step not in the matrix" }); continue; }
    const name = cell.rival;
    if (c.class === "apply") {
      if (cell.shape === "step") {
        const old = cell.holder.codes && cell.holder.codes[cell.no], cur = old && typeof old === "object" ? old : {};
        (cell.holder.codes ||= {})[cell.no] = { ...cur, k: ownLetter(old, c.to), evidence: firstUrl(c), verified_at: today };
      } else { const h = (cell.holder[cell.codesKey] ||= {}); h[name] = ownLetter(h[name], c.to); }
      changes.push({ kind: cell.current === c.to ? "re-verified" : "code", rival: name, step: c.step, ...(cell.no != null ? { no: cell.no } : {}), from: cell.current, to: c.to, evidence: firstUrl(c) });
    } else if (c.opened && !c.stale && cell.shape === "step" && cell.current !== null) {
      // Hold and reject: the code stays. The rival's pages were read this round, so the cell is re-dated. (Not for a proposal held because
      // the cell moved on since the agent looked: those pages were opened before, and "verified today" would be false.)
      const old = cell.holder.codes[cell.no];
      cell.holder.codes[cell.no] = old && typeof old === "object" ? { ...old, verified_at: today } : { k: old, verified_at: today };
      changes.push({ kind: "re-dated", rival: name, step: c.step, ...(cell.no != null ? { no: cell.no } : {}), from: cell.current, to: cell.current, why: c.class });
    }
  }
  return { matrix: next, changes, skipped };
}

// pm/matrix.json is built from the rival tables (build-matrix.mjs), so a change written only there is lost at the next rebuild. Writes the same
// cells into pm/rivals/<file>.md: the row's code, and the evidence cell with a trailing `[verified: date]` (build-matrix reads that back as
// verified_at). Only step-shape cells of a rival that has a file; the row's own name cell and any other row are left as written.
// Returns the rows it changed: [{ file, step }].
export function syncRivals(pm, matrix, changes, { dir = path.join(pm, "rivals") } = {}) {
  const done = [], skipped = [], byName = new Map((matrix.products || []).map(p => [p.name, p]));
  for (const ch of changes) {
    const prod = byName.get(ch.rival), file = prod && prod.file && path.join(dir, prod.file);
    if (!file || !fs.existsSync(file)) continue;
    // A proposal may name the row by its feature ("Change alerts") instead of its number: the change carries the number it was found under (`no`).
    const no = String(ch.no ?? ch.step), cell = prod.codes && prod.codes[no]; if (!cell || typeof cell !== "object") continue;
    const re = /^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|\s*([ypnud])\b[^|]*\|\s*(.*?)\s*\|?\s*$/i;
    // A row whose Code cell is still empty (a new stub, before its research) is written too: the cell must live in the rival's table, which is what the matrix is rebuilt from.
    const blank = /^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|\s*\|\s*(.*?)\s*\|?\s*$/;
    const lines = fs.readFileSync(file, "utf8").split("\n"); let hit = false;
    for (let i = 0; i < lines.length; i++) {
      let m = lines[i].match(re);
      if (!m) { const b = lines[i].match(blank); if (b && !b[2].startsWith("<")) m = [b[0], b[1], b[2], "", b[3]]; }
      if (!m || m[1] !== no) continue;
      const base = String(cell.evidence ?? m[4]).replace(/\s*\[verified:[^\]]*\]\s*$/, "");
      lines[i] = `| ${m[1]} | ${m[2]} | ${cell.k} | ${base}${cell.verified_at ? ` [verified: ${cell.verified_at}]` : ""} |`; hit = true; break;
    }
    // A row that isn't in the rival's table yet (the table lists fewer steps than the matrix): added after the last row, so the cell lives in the file the matrix is rebuilt from.
    // Silently skipping it let `apply` say "Changed 1 cell" and the next rebuild erase that cell (field-test hunt).
    if (!hit) {
      const at = lines.map((l, i) => (/^\|\s*\d{1,2}\s*\|/.test(l) ? i : -1)).filter(i => i >= 0).pop(), name = (matrix.steps || []).find(x => String(x.no) === no)?.name;
      if (at === undefined || !name) { skipped.push({ file: prod.file, step: no, why: at === undefined ? "the rival's file has no feature table" : "the step has no name in the matrix" }); continue; }
      lines.splice(at + 1, 0, `| ${no} | ${name} | ${cell.k} | ${String(cell.evidence ?? "")}${cell.verified_at ? ` [verified: ${cell.verified_at}]` : ""} |`); hit = true;
    }
    if (hit) { fs.writeFileSync(file, lines.join("\n")); done.push({ file: prod.file, step: no }); }
  }
  done.skipped = skipped;
  return done;
}

// The rival files in pm/rivals (or sources.json rivalsPath): { slug, file, name } with the name from the file's own first heading. A rival the matrix doesn't have
// yet can be added from a proposal only when it has one of these.
export function knownRivals(pm) {
  const K = readSourcesSafe(pm) || {}, dir = rivalsDir(pm, K), out = [];
  for (const f of rivalFiles(dir, { nested: dir !== path.join(pm, "rivals") })) {
    let text = ""; try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    const slug = path.basename(f).replace(/\.md$/i, ""), reg = K.rivals && K.rivals[slug] && K.rivals[slug].name;
    out.push({ slug, file: f, name: (typeof reg === "string" && reg) || (text.match(/^#\s+(.+)$/m) || [])[1]?.trim() || slug, category: (text.match(/^-?\s*\*\*Category:\*\*\s*(.+)$/mi) || [])[1]?.trim() || "" });
  }
  return out;
}

const sha = s => crypto.createHash("sha1").update(s).digest("hex");
const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
const BACKUP = ".backup", isBackup = f => /^matrix-[0-9T]+(-\d+)?\.json$/.test(f);
// Oldest first: by stamp, then by the -2, -3 suffix of two applies in one second ("-2.json" would sort before ".json" as plain text).
const backupOrder = (a, b) => { const k = f => f.match(/^matrix-([0-9T]+)(?:-(\d+))?\.json$/); const [x, y] = [k(a), k(b)]; return x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : (+x[2] || 1) - (+y[2] || 1); };

export function backupOf(pm, file, { now = new Date() } = {}) {
  const dir = path.join(pm, BACKUP); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), "*\n"); // the copies never show up in git status or a commit (same as doctor.mjs)
  let to = path.join(dir, `matrix-${stamp(now)}.json`);
  for (let n = 2; fs.existsSync(to); n++) to = path.join(dir, `matrix-${stamp(now)}-${n}.json`);
  fs.copyFileSync(file, to);
  return to;
}

// Puts the newest matrix backup back. A matrix that changed since its apply is left alone unless `force`.
export function undo(pm, { force = false } = {}) {
  const dir = path.join(pm, BACKUP), found = (fs.existsSync(dir) ? fs.readdirSync(dir).filter(isBackup) : []).sort(backupOrder);
  if (!found.length) return { ok: false, message: `No matrix backup in ${dir}: nothing to undo.` };
  const name = found[found.length - 1], backup = path.join(dir, name), metaFile = backup.replace(/\.json$/, ".meta.json");
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {}
  const target = meta.target || path.join(pm, "matrix.json"), now = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (!force && meta.after && now !== null && sha(now) !== meta.after) return { ok: false, message: `${target} changed after the apply that made ${name}: left alone. \`--force\` restores the backup anyway.` };
  fs.copyFileSync(backup, target);
  const rdir = backup.replace(/\.json$/, "-rivals");
  if (fs.existsSync(rdir)) { for (const f of fs.readdirSync(rdir)) fs.copyFileSync(path.join(rdir, f), path.join(pm, "rivals", f)); fs.renameSync(rdir, rdir.replace(/-rivals$/, "-rivals.undone")); }
  fs.renameSync(backup, backup.replace(/\.json$/, ".undone.json")); // the next undo goes one apply further back
  try { fs.renameSync(metaFile, metaFile.replace(/\.json$/, ".undone.json")); } catch {}
  return { ok: true, message: `Put ${target} back as it was before ${meta.at || name}.`, target, backup };
}

// --- files + CLI ---------------------------------------------------------------------------------------------------------
const readJsonFile = f => { try { return parseJson(fs.readFileSync(f, "utf8")); } catch (e) { throw new Error(`${f} isn't valid JSON (${String(e.message).split("\n")[0].slice(0, 80)}): nothing was changed.`); } };
// The indent the file already uses ("\t" or n spaces), so applying a cell doesn't re-indent a matrix the owner keeps by hand. build-matrix's own is 1.
const indentOf = raw => { const m = /^[ \t]+(?=["{\[])/m.exec(raw); return m ? (m[0].includes("\t") ? "\t" : m[0].length) : 1; };
export function run(pm, { matrixFile = path.join(pm, "matrix.json"), proposalsFile = path.join(pm, "state", "matrix-proposals.json") } = {}) {
  if (!fs.existsSync(proposalsFile)) throw new Error(`No ${proposalsFile}: the neighbor agents write their proposed matrix cells there (neighbors step 4).`);
  if (!fs.existsSync(matrixFile)) throw new Error(`No ${matrixFile}: nothing to check the proposals against.`);
  const P = readJsonFile(proposalsFile), M = readJsonFile(matrixFile), K = readSourcesSafe(pm);
  const codes = K && K.matrixCodes && typeof K.matrixCodes === "object" ? K.matrixCodes : undefined;
  const R = check(P, M, { codes, rivals: knownRivals(pm) });
  // The proposals file is older than the matrix: the agents looked at an earlier matrix (see the header: said once, cells are checked one by one).
  try { if (fs.statSync(proposalsFile).mtimeMs < fs.statSync(matrixFile).mtimeMs) R.olderThanMatrix = true; } catch {}
  return { P, M, codes, R, matrixFile, proposalsFile };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; }, flag = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
  const matrixArg = take("--matrix"), proposalsArg = take("--proposals"), dry = flag("--dry-run"), force = flag("--force");
  const [cmd, pm = "pm"] = argv;
  const fail = m => { console.error(`Psst… ${m}`); process.exit(1); };
  if (cmd === "undo") { const u = undo(pm, { force }); if (!u.ok) fail(u.message); console.log(u.message); }
  else if (cmd === "check" || cmd === "apply") {
    let X; try { X = run(pm, { ...(matrixArg ? { matrixFile: matrixArg } : {}), ...(proposalsArg ? { proposalsFile: proposalsArg } : {}) }); } catch (e) { fail(e.message); }
    const { R, M, codes, matrixFile } = X, outFile = path.join(pm, "state", "matrix-proposals.checked.json");
    const write = () => { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify({ ...R, generated: new Date().toISOString(), source: path.basename(X.proposalsFile) }, null, 1)); };
    if (cmd === "check") { write(); console.log(summary(R)); console.log(`\nWrote ${outFile}. \`${nosyCommand("matrix-proposals apply")}\` applies the "apply" ones.`); }
    else {
      const A = applyTo(M, R, { codes, rivals: knownRivals(pm) }), code = A.changes.filter(c => c.kind === "code"), redated = A.changes.length - code.length;
      console.log(summary(R)); console.log("");
      console.log(`${dry ? "Would change" : "Changed"} ${code.length} cell(s)${redated ? `, re-dated ${redated}` : ""} in ${matrixFile}:`);
      for (const c of A.changes) console.log(`- ${c.rival} / step ${c.step}: ${c.kind === "code" ? `${c.from ?? "—"} → ${c.to}` : c.kind}${c.evidence ? ` · ${c.evidence}` : ""}`);
      for (const s of A.skipped) console.log(`- skipped ${s.rival} / step ${s.step}: ${s.why}`);
      if (!dry && A.changes.length) {
        write();
        const raw = fs.readFileSync(matrixFile, "utf8"), bak = backupOf(pm, matrixFile), body = JSON.stringify(A.matrix, null, indentOf(raw)) + (raw.endsWith("\n") ? "\n" : "");
        fs.writeFileSync(bak.replace(/\.json$/, ".meta.json"), JSON.stringify({ at: new Date().toISOString(), target: path.resolve(matrixFile), after: sha(body) }));
        fs.writeFileSync(matrixFile, body);
        const rdir = bak.replace(/\.json$/, "-rivals"); // the rival tables about to change: undo puts them back with the matrix
        for (const ch of A.changes) { const f = (A.matrix.products || []).find(p => p.name === ch.rival)?.file, src = f && path.join(pm, "rivals", f); if (src && fs.existsSync(src) && !fs.existsSync(path.join(rdir, f))) { fs.mkdirSync(rdir, { recursive: true }); fs.copyFileSync(src, path.join(rdir, f)); } }
        const rows = syncRivals(pm, A.matrix, A.changes);
        if (rows.length) console.log(`Also written into ${rows.length} row(s) of the rival tables (pm/rivals/), which pm/matrix.json is rebuilt from.`);
        for (const sk of rows.skipped || []) console.log(`! step ${sk.step} of ${sk.file} was not written into its rival table (${sk.why}): the next rebuild from the rival files would drop that cell.`);
        console.log(`\nBacked up first: ${bak}. To put it back: \`${nosyCommand("matrix-proposals undo")}\`.`);
      } else if (dry) console.log("\n(dry run: nothing written)");
      else console.log("\nNothing to change.");
    }
  } else fail("usage: matrix-proposals check|apply|undo <pm> [--matrix <file>] [--dry-run]");
}
