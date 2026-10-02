// Interview and call notes into themes with receipts. The Dovetail/BuildBetter pattern, kept
// local: notes dropped in pm/signal/interviews/ become themes with how many interviews raised each one, 1–2 masked
// quotes linked to file:line, matched to a matrix row, a roadmap item or a request-doc item when one fits.
// Usage: node interview-themes.mjs <pm folder> [file|folder ...] [--json <file>] [--quote N]
// Input: arguments > sources.json signal.interviews > <pm>/signal/interviews/  (.md and .txt)
// Reads: sources.json (matrix, request, roadmap.path, interview.interviewers), pm/waves.md (default roadmap).
// Only the customer's words count: a line whose speaker label is an interviewer ("Q:", "Interviewer:", names in
// sources.json interview.interviewers) is skipped, as are headings and "Participants:/Date:" meta lines.
// Deterministic; no network. Quotes are masked with mask.mjs (same rules as collect-signals); names inside a
// sentence are not detectable and are left to the owner (never publish quotes without privacy-scan).
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { small, words, root, smallAscii, langOfLoad } from "./text.mjs";
import { matrixRead } from "./read-matrix.mjs";
import { mask } from "./mask.mjs";
import { readSources } from "./sources-file.mjs";

const STOP = new Set(("the and for with that this from are was were is to of in on at an a we you they it its our your their can could would should will have has had not but just also very really like " +
  "want wants need needs would right now every time when what how there here them then than some more most much many one two all any get got make use using used able lot thing things way " +
  "see sees seen like likes only too just still own also keep let put try set via per help helps know think said says tell told great nice good bad instead actually " +
  "bir ve ile için bu şu çok daha gibi ama var yok olsun olur bizim sizin şimdi her zaman").split(/\s+/));
const META = /^(participants?|attendees?|date|company|role|duration|interviewer|interviewee|customer|katılımcılar|tarih|şirket|rol|süre)\s*:/i;
const DEFAULT_INTERVIEWERS = ["q", "question", "interviewer", "moderator", "me", "us", "we", "nosy", "soru", "biz", "görüşmeci"];

// Words of 3+ letters ("SMS", "CSV" matter); stopwords drop the short filler.
const rootsOf = t => [...new Set(words(t, 2).map(w => smallAscii(w)).filter(w => !STOP.has(w) && !/^\d+$/.test(w)).map(root).filter(r => r.length >= 3))];

// One file → { file, date, statements: [{ text, line }] }.
export function parseInterview(raw, file, interviewers = DEFAULT_INTERVIEWERS) {
  const iv = new Set(interviewers.map(x => smallAscii(x)));
  const lines = String(raw).split(/\r?\n/);
  const dm = path.basename(file).match(/(\d{4}-\d{2}-\d{2})/) || String(raw).match(/^\s*(?:date|tarih)\s*:\s*(\d{4}-\d{2}-\d{2})/im);
  const out = [];
  lines.forEach((l, i) => {
    let t = l.trim(); if (!t || /^#/.test(t) || /^[-*_]{3,}$/.test(t)) return;
    t = t.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    if (META.test(t)) return;
    // Speaker label: "**A:** …", "Customer: …", "Jane (CFO): …". Only a short, label-like prefix counts, so a
    // bullet such as "Bulk export is essential: at year end…" stays a statement.
    const sp = t.match(/^\**([\p{L}][\p{L}. '()-]{0,24}?)\**\s*:\s*\**\s*(.+)$/u);
    if (sp && sp[1].trim().split(/\s+/).length <= 3 && /^(\p{Lu}|q$|a$)/iu.test(sp[1].trim()) && !/\s(is|are|was|were|would|should|needs?|wants?)\s/i.test(" " + sp[1] + " ")) {
      const who = smallAscii(sp[1].replace(/\(.*\)/, "").trim());
      if (iv.has(who) || iv.has(who.split(/\s+/)[0])) return;
      t = sp[2];
    }
    t = t.replace(/\*\*/g, "").trim();
    if (t.length < 20) return;
    // Long paragraph: split into sentences, each keeps the paragraph's line.
    const parts = t.length > 300 ? t.split(/(?<=[.!?])\s+(?=\p{Lu})/u) : [t];
    for (const p of parts) if (p.trim().length >= 20) out.push({ text: p.trim(), line: i + 1 });
  });
  return { file, date: dm ? dm[1] : null, statements: out };
}

function calculate(pm, { paths = [], quoteN = 2 } = {}) {
  const K = readSources(pm);
  langOfLoad(K); // sources.json's `language`
  const show = f => { try { return execFileSync("git", ["-C", K.repo, "show", `${K.ref}:${f}`], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { try { return fs.readFileSync(path.resolve(K.repo || ".", f), "utf8"); } catch { return ""; } } };

  // --- input files ---
  const inputs = paths.length ? paths : K.signal?.interviews ? [].concat(K.signal.interviews) : [path.join(pm, "signal", "interviews")];
  const expand = p => { if (!fs.existsSync(p)) return []; const st = fs.statSync(p); if (st.isFile()) return /\.(md|txt)$/i.test(p) ? [p] : [];
    return fs.readdirSync(p, { recursive: true }).map(f => path.join(p, String(f))).filter(f => /\.(md|txt)$/i.test(f) && fs.statSync(f).isFile()).sort(); };
  const files = [...new Set(inputs.flatMap(expand))];
  const base = { type: "interviews", generated: new Date().toISOString(), inputs };
  if (!files.length) return { ...base, interviews: [], themes: [], once: 0 };
  const interviewers = [...DEFAULT_INTERVIEWERS, ...(K.interview?.interviewers || [])];
  const rel = f => path.relative(pm, f).startsWith("..") ? f : path.relative(pm, f);
  const interviews = files.map(f => parseInterview(fs.readFileSync(f, "utf8"), rel(f), interviewers));
  const S = interviews.flatMap(iv => iv.statements.map(s => ({ ...s, file: iv.file, date: iv.date, roots: rootsOf(s.text) }))).filter(s => s.roots.length >= 2);

  // --- targets: matrix rows, roadmap items, request-doc items ---
  const targets = [];
  const MO = K.matrix ? matrixRead(K.matrix, { codes: K.matrixCodes }) : null;
  for (const r of MO?.lines || []) targets.push({ kind: "matrix", id: r.no ? `row ${r.no}` : null, title: r.feature, code: r.codes?.[MO.biz] ?? null, text: `${r.feature} ${r.not || ""}` });
  const roadmapPath = K.roadmap?.path || path.join(pm, "waves.md");
  const roadmap = fs.existsSync(roadmapPath) ? fs.readFileSync(roadmapPath, "utf8") : K.roadmap?.path ? show(K.roadmap.path) : "";
  for (const m of roadmap.matchAll(/^\s*-\s+\*\*(.+?)\*\*(.*)$/gm)) { const title = m[1].replace(/`/g, "").replace(/\s*·.*$/, "").trim(); if (title.length > 3) targets.push({ kind: "roadmap", id: null, title: title.slice(0, 120), text: `${title} ${m[2].slice(0, 200)}` }); }
  if (K.request?.path && K.request?.title) { const doc = show(K.request.path), hRe = new RegExp(K.request.title, "gm"); let m;
    while ((m = hRe.exec(doc))) targets.push({ kind: "request", id: `§${m[1]}`, title: `§${m[1]} ${m[2]}`.slice(0, 120), text: m[2] }); }
  targets.forEach(t => t.roots = rootsOf(t.text));

  // --- 1) group statements across interviews first. "Rare" is judged among the statements only: a word the request doc
  //        uses everywhere ("export" in a legal product) can still be what three customers have in common.
  const sdf = new Map(); for (const s of S) for (const r of new Set(s.roots)) sdf.set(r, (sdf.get(r) || 0) + 1);
  const rareCap = Math.max(3, Math.ceil(S.length * 0.3));
  const rare = s => s.roots.filter(r => (sdf.get(r) || 0) >= 1 && (sdf.get(r) || 0) <= rareCap);
  const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));
  const shared = (A, B) => A.filter(a => B.some(b => same(a, b)));
  const parent = S.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  // Linked when they share two rare longer words, or one longer word plus at least two short ones ("sms", "pdf", "end").
  const linked = (a, b) => { const sh = shared(rare(a), rare(b)), long = sh.filter(r => r.length >= 4).length; return long >= 2 || (long >= 1 && sh.length >= 3); };
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) if (linked(S[i], S[j])) parent[find(j)] = find(i);
  const clusters = new Map(); S.forEach((s, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(s); });

  // --- 2) match each group as a whole to a target: the group's core roots (in at least half its statements) against the
  //        target's roots, weighted by rarity over statements + targets; at least 2 shared roots and a minimum score.
  const docs = [...S.map(s => s.roots), ...targets.map(t => t.roots)], N = docs.length || 1, df = new Map();
  for (const d of docs) for (const r of new Set(d)) df.set(r, (df.get(r) || 0) + 1);
  const idf = r => Math.log((N + 1) / (df.get(r) || 1));
  const MIN_SCORE = K.interview?.minScore ?? 5;
  const groups = new Map(); let once = 0;
  const surface = (members, r) => { for (const m of members) for (const w of words(m.text, 2)) if (root(smallAscii(w)) === r) return w; return r; };
  for (const members of clusters.values()) {
    const counts = new Map(); for (const m of members) for (const r of new Set(m.roots)) counts.set(r, (counts.get(r) || 0) + 1);
    const core = [...counts].filter(([, c]) => c >= Math.max(1, Math.ceil(members.length / 2))).map(([r]) => r);
    let best = null, bs = 0, bsh = [];
    // A short target ("§3 Bulk export") can't reach an absolute score, so coverage counts too: the group's words
    // cover at least 60% of the target's own words.
    let bcov = 0;
    for (const t of targets) { const sh = shared(core, t.roots); if (sh.length < 2) continue; const sc = sh.reduce((a, r) => a + idf(r), 0), cov = sh.length / (t.roots.length || 1);
      const ok = sc >= MIN_SCORE || cov >= 0.6; if (ok && (cov > bcov || (cov === bcov && sc > bs))) { bs = sc; bcov = cov; best = t; bsh = sh; } }
    if (best) { const k = `${best.kind}:${best.title}`; if (!groups.has(k)) groups.set(k, { target: best, members: [], why: bsh }); groups.get(k).members.push(...members); continue; }
    if (members.length < 2) { once++; continue; }
    // Top shared rare words, one per stem family ("hearing" and "hearings" count once).
    const key = []; for (const [r] of [...counts].filter(([r, c]) => c >= 2 && (sdf.get(r) || 0) <= rareCap).sort((a, b) => b[1] - a[1] || (sdf.get(a[0]) - sdf.get(b[0])))) { if (key.length >= 3) break; if (!key.some(k => same(k, r))) key.push(r); }
    // Name the theme in the customers' own word order (the shortest statement's order): "bulk export year", not "year export bulk".
    const ref = smallAscii([...members].sort((x, y) => x.text.length - y.text.length)[0].text), at = r => { const i = ref.search(new RegExp(`(?<![\\p{L}])${r}`, "u")); return i < 0 ? 1e9 : i; };
    const keyName = key.sort((x, y) => at(x) - at(y)).map(r => surface(members, r)).join(" ");
    groups.set(`theme:${keyName}:${groups.size}`, { target: null, key: keyName, members });
  }

  const themes = [...groups.values()].map(g => {
    const files = [...new Set(g.members.map(m => m.file))], dates = g.members.map(m => m.date).filter(Boolean).sort();
    // Quotes from different interviews first.
    const quotes = []; const usedFile = new Set();
    for (const m of [...g.members].sort((a, b) => a.text.length - b.text.length)) { if (quotes.length >= quoteN) break; if (usedFile.has(m.file) && files.length > quotes.length) continue; usedFile.add(m.file);
      quotes.push({ text: mask(m.text).slice(0, 200), file: m.file, line: m.line, date: m.date }); }
    return { key: g.target ? g.target.title : g.key, target: g.target ? { kind: g.target.kind, id: g.target.id, title: g.target.title, code: g.target.code ?? null, matchedOn: g.why } : null,
      interviews: files.length, mentions: g.members.length, first: dates[0] || null, last: dates.at(-1) || null, quotes };
  }).sort((a, b) => b.interviews - a.interviews || b.mentions - a.mentions);

  return { ...base, interviews: interviews.map(iv => ({ file: iv.file, date: iv.date, statements: iv.statements.length })), themes, once, statements: S.length };
}

function formatMd(R) {
  if (!R.interviews.length) return `# Interview themes\n\nNo interview notes found (${R.inputs.join(", ")}). Drop interview or call notes (.md/.txt, one file per conversation, a date in the file name) in pm/signal/interviews/.\n`;
  const n = R.interviews.length, kindName = { matrix: "matrix", roadmap: "roadmap", request: "request doc" };
  let o = `# Interview themes · ${n} interview${n === 1 ? "" : "s"}, ${R.statements} customer statements\n\n`;
  const matched = R.themes.filter(t => t.target), open = R.themes.filter(t => !t.target);
  const row = t => `| ${t.key.replace(/\|/g, "/").slice(0, 70)} | ${t.interviews} of ${n} | ${t.mentions} | ${t.quotes.map(q => `${q.file}:${q.line}`).join(", ")} |`;
  if (matched.length) { o += `## Matches our own work\n\n| Theme | Interviews | Mentions | Receipts |\n|---|---|---|---|\n`;
    o += matched.map(t => row({ ...t, key: `${kindName[t.target.kind]}: ${t.target.id ? t.target.id + " · " : ""}${t.target.title}${t.target.code ? ` (ours: ${t.target.code})` : ""}` })).join("\n") + "\n\n"; }
  if (open.length) o += `## Not on the matrix, roadmap or request doc — candidates\n\n| Theme | Interviews | Mentions | Receipts |\n|---|---|---|---|\n${open.map(row).join("\n")}\n\n`;
  o += `## Quotes\n\n`;
  for (const t of R.themes.slice(0, 12)) o += `**${t.target ? t.target.title : t.key}** — ${t.interviews} of ${n} interviews\n${t.quotes.map(q => `- "${q.text}" (${q.file}:${q.line})`).join("\n")}\n\n`;
  if (R.once) o += `${R.once} statement(s) came up only once and don't form a theme.\n\n`;
  o += `Privacy: quotes are masked (email, phone, IDs, IBAN, card, URL keys). Names inside a sentence can't be detected: check before sharing, and never publish quotes without privacy-scan.\n`;
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), q = take("--quote");
  const [pm = "pm", ...paths] = argv;
  const R = calculate(pm, { paths, quoteN: q != null ? +q : 2 });
  process.stdout.write(formatMd(R));
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
}

export { calculate };
