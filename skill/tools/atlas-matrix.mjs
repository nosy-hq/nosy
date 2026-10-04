// atlas-matrix: the candidate × axis matrix of `atlas`, built from the scouts' reports (pm/atlas/*.md, the shape of templates/market.md).
// Counting here, judgment in the scout, memory in pm/. Reads files only; uses no network and no model.
//   Each report has a header (`- **Owner decision:**`, `- **Verified:**`) and a `## Scores` table: | Axis | Score | Grade | Date | Basis |.
//   Grade: read (the source itself was opened) · snippet (a search summary) · unreadable (blocked or behind a login) · terms-unread (the
//   licence or terms page couldn't be opened) · judgment. Only `read` scores count.
// A candidate is ranked only when ALL of these hold: the owner hasn't said no · it is verified (`Verified:` starts with a date AND the
// report's `## Verification` section has at least one bullet with a url: a second source was read) · at least half of the axes (all axes seen in any report) are
// graded `read`. Everyone else is listed as not ranked yet, each with the reasons. The score is the plain mean of the `read` scores (no
// weights, so anyone can recompute it). The ranking is a suggestion; the owner decides, and a "no" is never ranked or re-argued.
// Checks, per cell: a score outside 1-5, an unknown grade, a `read` score without a url in Basis, no date or a date in the future, and stale
// (older than --days, default 90: prices, rules and rival lists move). Per report: one url behind three or more axes, an axis other reports have
// that this one lacks. Problems are warnings, never silent drops; a problem cell still shows, it just can't count as `read`.
// Usage: node atlas-matrix.mjs <pm> [--json <file>] [--now YYYY-MM-DD] [--days 90]
// Exit: 0 ranked, nothing to look at · 2 it ran and something needs a look (a problem, a stale row, a candidate not ranked) · 1 there are no reports.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const DAY = 864e5;
export const GRADES = ["read", "snippet", "unreadable", "terms-unread", "judgment"];
export const STALE_DAYS = 90, SAME_URL_AXES = 3;
const DASH = /^[–—-]$|^\?$|^$/;
const URL_RE = /https?:\/\/[^\s)|>\]]+/g;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const placeholder = s => /^<.*>$/.test(String(s ?? "").trim());
const clean = s => String(s ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();

// header bullets: `- **Key:** value`
function header(text) {
  const h = {};
  for (const m of text.matchAll(/^- \*\*([^*:]+):\*\*\s*(.*)$/gm)) h[m[1].trim().toLowerCase()] = m[2].trim();
  return h;
}
function section(text, title) {
  const m = text.match(new RegExp(`^## ${title}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"));
  return m ? m[1] : null;
}
function rows(sec) {
  return (sec ?? "").split("\n").filter(l => /^\s*\|/.test(l)).map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()))
    .filter(c => c.length >= 5 && !/^-+$/.test(c[0].replace(/\s|:/g, "")) && !/^axis$/i.test(c[0]) && !placeholder(c[0]) && c[0] !== "…");
}

export function parseReport(text, file = "") {
  const slug = path.basename(file).replace(/\.md$/, ""), h = header(text);
  const name = (text.match(/^#\s+(.+)$/m)?.[1] ?? slug).trim();
  const decisionWord = (h["owner decision"] ?? "undecided").toLowerCase().match(/^(yes|no|undecided)\b/)?.[1] ?? "undecided";
  const verified = (h["verified"] ?? "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  // A verification is a bullet that names the second source it read (a url): a note, an italic "left empty", or a placeholder is not one.
  const verification = clean(section(text, "Verification")).split("\n").some(l => /^\s*[-*]\s.*https?:\/\//.test(l));
  const cells = rows(section(text, "Scores")).map(c => ({ axis: c[0], rawScore: c[1], grade: c[2].toLowerCase(), date: c[3], basis: c[4] }));
  return { slug, name, readOn: isDate(h["read on"] ?? "") ? h["read on"] : null, decision: decisionWord, verifiedOn: verified && isDate(verified) ? verified : null, verification, cells };
}

// Checks one report's cells against `now`; returns { cells (with score/problems/stale), problems }.
function checkCells(r, now, days) {
  const notes = [], urlAxes = new Map();
  const cells = r.cells.map(c => {
    const p = [], score = DASH.test(c.rawScore) ? null : Number(c.rawScore);
    if (score !== null && !(Number.isInteger(score) && score >= 1 && score <= 5)) p.push(`score "${c.rawScore}" isn't 1-5 or –`);
    if (!GRADES.includes(c.grade)) p.push(`unknown grade "${c.grade}" (${GRADES.join(", ")})`);
    const urls = c.basis.match(URL_RE) ?? [];
    if (c.grade === "read" && score !== null && !urls.length) p.push("graded read but the basis has no url");
    const dated = isDate(c.date), age = dated ? (now - Date.parse(c.date)) / DAY : null;
    if (!dated) p.push("no date"); else if (age < 0) p.push("dated in the future");
    const stale = dated && age > days;
    for (const u of new Set(urls)) urlAxes.set(u, [...(urlAxes.get(u) ?? []), c.axis]);
    // a cell with a problem still shows, but never counts as read
    const counts = score !== null && c.grade === "read" && !p.length;
    return { axis: c.axis, score, grade: GRADES.includes(c.grade) ? c.grade : "unknown", date: dated ? c.date : null, basis: c.basis, stale: !!stale, ageDays: age === null ? null : Math.floor(age), counts, problems: p };
  });
  for (const [u, axes] of urlAxes) if (axes.length >= SAME_URL_AXES) notes.push(`one url backs ${axes.length} axes (${axes.join(", ")}): ${u}. Look again before trusting them as separate findings`);
  return { cells, notes };
}

export function build(reports, { now = Date.now(), days = STALE_DAYS } = {}) {
  const axes = [...new Set(reports.flatMap(r => r.cells.map(c => c.axis)))];
  const cands = reports.map(r => {
    const { cells, notes } = checkCells(r, now, days);
    const missing = axes.filter(a => !cells.some(c => c.axis === a));
    const read = cells.filter(c => c.counts), why = [];
    if (r.decision === "no") why.push("the owner said no");
    if (!cells.length) why.push("no scores");
    if (!r.verifiedOn) why.push("not verified (no Verified: date)");
    else if (!r.verification) why.push("not verified (Verified: is dated, but ## Verification is empty)");
    if (cells.length && read.length * 2 < axes.length) why.push(`only ${read.length} of ${axes.length} axes are graded read (half are needed)`);
    const score = read.length ? Math.round(read.reduce((n, c) => n + c.score, 0) / read.length * 10) / 10 : null;
    const warnings = [...notes, ...(missing.length ? [`missing ${missing.length} ${missing.length === 1 ? "axis" : "axes"} the other reports have: ${missing.join(", ")}`] : []),
      ...cells.flatMap(c => c.problems.map(p => `${c.axis}: ${p}`)), ...cells.filter(c => c.stale).map(c => `${c.axis}: stale, read ${c.ageDays} days ago (older than ${days})`)];
    return { candidate: r.name, slug: r.slug, owner: r.decision, readOn: r.readOn, verifiedOn: r.verifiedOn, score, read: read.length, of: axes.length, rankable: !why.length, notRankedBecause: why, cells, warnings };
  });
  const ranked = cands.filter(c => c.rankable).sort((a, b) => b.score - a.score || b.read - a.read || a.candidate.localeCompare(b.candidate))
    .map((c, i) => ({ rank: i + 1, candidate: c.candidate, slug: c.slug, score: c.score, read: c.read, of: c.of, verifiedOn: c.verifiedOn }));
  return { axes, ranked, notRanked: cands.filter(c => !c.rankable).map(c => ({ candidate: c.candidate, slug: c.slug, why: c.notRankedBecause })), candidates: cands };
}

export function render(m, days = STALE_DAYS) {
  const L = ["Where next (a suggestion; the owner decides)", ""];
  if (m.ranked.length) for (const r of m.ranked) L.push(`${r.rank}. ${r.candidate}: ${r.score.toFixed(1)} of 5 · ${r.read} of ${r.of} axes read from a source · verified ${r.verifiedOn}`);
  else L.push("Nothing is ranked yet.");
  if (m.notRanked.length) { L.push("", "Not ranked yet"); for (const n of m.notRanked) L.push(`- ${n.candidate}: ${n.why.join("; ")}`); }
  const warn = m.candidates.filter(c => c.warnings.length);
  if (warn.length) { L.push("", "To look at"); for (const c of warn) for (const w of c.warnings) L.push(`- ${c.candidate}: ${w}`); }
  L.push("", `The score is the plain mean of the axes graded read; only those count. A cell older than ${days} days is stale. This is research, not advice.`);
  return L.join("\n");
}

export const files = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith("_") && f !== "axes.md").sort().map(f => path.join(dir, f)); } catch { return []; } };

function main(argv) {
  const al = n => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const jsonFile = al("--json"), nowArg = al("--now"), days = Number(al("--days") ?? STALE_DAYS), [pm] = argv;
  if (!pm || !(days > 0) || (nowArg && !isDate(nowArg))) { console.error("Usage: atlas-matrix.mjs <pm> [--json file] [--now YYYY-MM-DD] [--days N]"); return 1; }
  const fs_ = files(path.join(pm, "atlas"));
  if (!fs_.length) { console.error(`Psst… no reports in ${path.join(pm, "atlas")} yet. This command only ranks the reports: the research that writes them is the atlas step in your agent (/nosy:atlas in Claude Code, \`$nosy atlas\` in Codex, /nosy atlas elsewhere), where one nosy-scout per candidate writes pm/atlas/<slug>.md (templates/market.md). Run that, then this again.`); return 1; }
  const m = build(fs_.map(f => parseReport(fs.readFileSync(f, "utf8"), f)), { now: nowArg ? Date.parse(nowArg) : Date.now(), days });
  console.log(render(m, days));
  if (jsonFile) { fs.mkdirSync(path.dirname(path.resolve(jsonFile)), { recursive: true }); fs.writeFileSync(jsonFile, JSON.stringify({ generatedAt: new Date(nowArg ? Date.parse(nowArg) : Date.now()).toISOString().slice(0, 10), days, ...m }, null, 1) + "\n"); console.log(`\nWrote ${jsonFile}`); }
  return m.notRanked.length || m.candidates.some(c => c.warnings.length) ? 2 : 0;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
