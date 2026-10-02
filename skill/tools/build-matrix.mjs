// Reads the feature tables ("## Feature matrix", or the older "## Loop matrix") in pm/rivals/*.md and writes pm/matrix.json.
// Usage: node build-matrix.mjs <pm folder>
// Our own column comes from pm/us.json: {"name":"...", "codes":{"1":"y",...}, "notes":{"1":"..."}}
// The step count isn't fixed: it grows on its own from the highest row number across the files (cycle 5: 19 -> 21).
// Reads status, the latest announcement (importance/reason parsed out), and "Position relative to Nosy"; if a
// field is missing, old (19-row) files still work: no Status means "active", no announcement leaves the text empty.
// Code "d": announced but not usable today (coming soon, waitlist, invite-only beta).
// Doesn't count as "exists".
import fs from "node:fs"; import path from "node:path";
const pm = process.argv[2] || "pm";
const dir = path.join(pm, "rivals");
if (!fs.existsSync(dir)) { console.error(`Psst… no ${dir}/ yet: run /nosy:neighbors first (it writes one file per rival), or \`nosy rivals-import\` if your rival files live elsewhere (\`rivalsPath\` in sources.json).`); process.exit(1); }
const files = fs.readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith("_")).sort();

const field = (src, k) => (src.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*(.+)$`, "m")) || [, ""])[1].trim();
const section = (src, title) => { const m = src.match(new RegExp(`^## ${title}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m")); return m ? m[1].trim() : ""; };

// Field shape: "active | acquired (by whom, when) | shut down (when)". No field means active.
function parseStatus(src) {
  const raw = field(src, "Status");
  if (!raw) return { status: "active", statusType: "active" };
  const statusType = /^acquired/i.test(raw) ? "acquired" : /^shut down/i.test(raw) ? "shutDown" : "active";
  return { status: raw, statusType };
}

// Field shape: "<date, what, url> · delivery: <shipped|announced> · importance: <high|medium|low> · why it
// matters: <sentence>". Without the importance/reason suffix (old files), the whole line goes to
// announcementText and severity/reason stay empty. The delivery suffix, if present,
// is split into announcementDelivery; otherwise empty (unknown).
function parseAnnouncement(src) {
  let text = field(src, "Latest major announcement"); let severity = "", reason = "", delivery = "";
  if (text) {
    const t = text.match(/\s*·\s*delivery\s*:\s*(shipped|announced|beta|preview)\s*(?=·|$)/i);
    if (t) { delivery = /^shipped$/i.test(t[1]) ? "output" : "announced"; text = (text.slice(0, t.index) + " " + text.slice(t.index + t[0].length)).replace(/\s+·\s*$/, "").trim(); }
    let m = text.match(/·\s*why it matters\s*:\s*([\s\S]+)$/i);
    if (m) { reason = m[1].trim(); text = text.slice(0, m.index).trim(); }
    m = text.match(/·\s*importance\s*:\s*(high|medium|low)\s*$/i);
    if (m) { severity = m[1].toLowerCase(); text = text.slice(0, m.index).trim(); }
    text = text.replace(/\s*·\s*$/, "").trim();
  }
  return { announcementText: text, announcementSeverity: severity, announcementReason: reason, announcementDelivery: delivery, ...parseDate(text) };
}

// Announcement date from free text: the first date mentioned, at whatever precision
// it's given. "2026-09-25" - "2026-09" - "4 August 2026" - "June 1, 2026" - "June 2026" - "Q1 2026" / "2026 Q2" - "2025".
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthRe = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const two = n => String(n).padStart(2, "0");
function parseDate(text) {
  const t = String(text || "").toLowerCase(), candidates = [];
  const add = (re, f, certainty) => { for (const m of t.matchAll(re)) { const v = f(m); if (v) candidates.push({ i: m.index, v, certainty }); } };
  const cut = { day: 4, month: 3, quarter: 2, year: 1 };
  add(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, m => `${m[1]}-${m[2]}-${m[3]}`, "day");
  add(/\b(20\d\d)-(0[1-9]|1[0-2])\b(?!-\d)/g, m => `${m[1]}-${m[2]}`, "month");
  add(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${monthRe})\\.?\\s+(20\\d\\d)`, "gu"), m => `${m[3]}-${two(MONTHS[m[2]])}-${two(m[1])}`, "day");
  add(new RegExp(`\\b(${monthRe})\\.?\\s+(\\d{1,2}),?\\s+(20\\d\\d)`, "gu"), m => `${m[3]}-${two(MONTHS[m[1]])}-${two(m[2])}`, "day");
  add(new RegExp(`(?<![\\d\\p{L}])(${monthRe})\\.?\\s+(20\\d\\d)`, "gu"), m => `${m[2]}-${two(MONTHS[m[1]])}`, "month");
  add(/(?:q)([1-4])\s*(20\d\d)|(20\d\d)\s*(?:q)([1-4])/g, m => { const y = m[2] || m[3], q = +(m[1] || m[4]); return `${y}-${two(q * 3 - 2)}`; }, "quarter");
  add(/\b(20\d\d)\b/g, m => m[1], "year");
  if (!candidates.length) return { announcementDate: "", announcementDateCertainty: "" };
  // A year mentioned after "no dated announcement found" isn't the announcement's date.
  const notFound = t.search(/not found|no date|undated/);
  if (notFound >= 0 && notFound < Math.min(...candidates.map(a => a.i))) return { announcementDate: "", announcementDateCertainty: "" };
  // Among candidates starting at the same spot, the most certain one; the earliest date is the announcement's date.
  candidates.sort((a, b) => a.i - b.i || cut[b.certainty] - cut[a.certainty]);
  const first = candidates[0], same = candidates.filter(a => Math.abs(a.i - first.i) <= 12).sort((a, b) => cut[b.certainty] - cut[a.certainty])[0];
  return { announcementDate: same.v, announcementDateCertainty: same.certainty };
}

const steps = new Map(); const products = [];
for (const f of files) {
  const md = fs.readFileSync(path.join(dir, f), "utf8");
  const name = (md.match(/^#\s+(.+)$/m) || [, f])[1].trim();
  const cat = field(md, "Category");
  const codes = {};
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|\s*([ypnud])\b[^|]*\|\s*(.*?)\s*\|?\s*$/i);
    if (!m) continue;
    // A trailing `[verified: YYYY-MM-DD]` in the evidence cell is when someone last opened the rival's pages for this row (internal request 199,
    // written by matrix-proposals apply). It travels as `verified_at`, so a rebuild from the rival tables doesn't lose it, and it is not part of the evidence text.
    const vm = m[4].match(/\s*\[verified:\s*(\d{4}-\d{2}-\d{2})\]\s*$/);
    steps.set(m[1], m[2]); codes[m[1]] = { k: m[3].toLowerCase(), evidence: vm ? m[4].slice(0, vm.index) : m[4], ...(vm ? { verified_at: vm[1] } : {}) };
  }
  if (Object.keys(codes).length) products.push({
    name: name, file: f, category: cat, codes: codes,
    ...parseStatus(md), ...parseAnnouncement(md),
    location: section(md, "Position relative to"), // "…to us" (templates/rival.md) or the older "…to Nosy"
  });
  else console.error("no matrix:", f);
}
// Never lose the owner's matrix (fresh-user run on twentyhq/twenty: rival files without tables made this write an
// empty stub over a hand-written pm/matrix.json). No rival file with a table → leave the file alone. Otherwise the
// existing matrix's own rows are kept (rival tables add rows, never remove them), and the old file is copied to
// pm/history/ before it's replaced.
const target = path.join(pm, "matrix.json");
let existing = null; try { existing = JSON.parse(fs.readFileSync(target, "utf8")); } catch {}
if (!products.length) {
  console.log(`No rival file has a feature table yet${files.length ? ` (${files.length} file(s) read)` : ""}; ${fs.existsSync(target) ? `${target} left as it is` : "no matrix written"}. Fill a rival file's table (templates/rival.md), then run this again.`);
  process.exit(0);
}
for (const s of existing?.steps || []) if (s && s.no != null && !steps.has(String(s.no))) steps.set(String(s.no), s.name);
const usPath = path.join(pm, "us.json");
const us = fs.existsSync(usPath) ? JSON.parse(fs.readFileSync(usPath, "utf8")) : null;
const out = {
  update: new Date().toISOString().slice(0, 10),
  codes: { y: "exists", p: "partial", n: "missing", u: "notFound", d: "announced, not shipped" },
  steps: [...steps].sort((a, b) => a[0] - b[0]).map(([no, nameValue]) => ({ no, name: nameValue })),
  biz: us, products: products,
};
if (fs.existsSync(target)) {
  const before = fs.readFileSync(target, "utf8"), after = JSON.stringify(out, null, 1);
  if (before.trim() !== after.trim()) {
    const bak = path.join(pm, "history", `matrix-before-build-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.writeFileSync(bak, before);
    console.log(`previous matrix kept at ${bak}`);
  }
}
fs.writeFileSync(target, JSON.stringify(out, null, 1));
console.log(`${products.length} products, ${out.steps.length} steps -> ${path.join(pm, "matrix.json")}`);
