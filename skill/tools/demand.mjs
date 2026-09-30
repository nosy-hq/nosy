// Demand × readiness: one place that reads pm/state/signals.json (collect-signals.mjs output)
// and answers "how many times was this asked for, by how many customers, since when?" for a psst item, a canwe
// question or a roadmap task. Pure reader: no network, no customer text beyond what signals.json already holds
// (quotes there are masked by collect-signals).
// Used by: lowhanging.mjs (psst ranking), canwe.mjs (Demand section), nosy.mjs (runs collect-signals when inputs exist).
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { words, root, smallAscii } from "./text.mjs";

export function demandLoad(pm) {
  const p = path.join(pm, "state", "signals.json");
  if (!fs.existsSync(p)) return null;
  try { const J = JSON.parse(fs.readFileSync(p, "utf8")); return { generated: J.generated || null, goals: (J.goals || []).filter(g => (g.count || 0) > 0), total: J.total || 0,
    window: (J.sources || []).map(s => s?.window).find(w => w?.kind === "github issues") || null }; }
  catch { return null; }
}

const norm = s => smallAscii(String(s || "")).replace(/\s*\(in #\d+\)|\s*·\s*in PR$/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const rootsOf = s => [...new Set(words(s, 3).map(w => root(smallAscii(w))))];

// Best demand record for an item: same ref first, then the same title (collect-signals copies psst titles as-is),
// then a strong word overlap (at least 2 roots and at least 60% of the item's roots). Returns null when unsure:
// a missing demand number is better than a borrowed one.
export function demandFor(D, { ref, title }) {
  if (!D?.goals?.length) return null;
  if (ref) { const g = D.goals.find(g => g.ref && g.ref === ref); if (g) return g; }
  const t = norm(title); if (!t) return null;
  const same = D.goals.find(g => norm(g.title) === t); if (same) return same;
  const r = rootsOf(title); if (r.length < 2) return null;
  let best = null, bestShare = 0;
  for (const g of D.goals) { const gr = new Set(rootsOf(g.title)); const hit = r.filter(x => gr.has(x)).length, share = hit / r.length;
    if (hit >= 2 && share >= 0.6 && share > bestShare) { best = g; bestShare = share; } }
  return best;
}

// All demand records a free-text question touches (canwe): a goal counts if at least 2 of the question's roots,
// or all of them when the question has fewer than 2, appear in the goal's title or masked examples.
export function demandForQuestion(D, question, extraRoots = []) {
  if (!D?.goals?.length) return [];
  const q = [...new Set([...rootsOf(question), ...extraRoots.map(w => root(smallAscii(w)))])].filter(x => x.length >= 3);
  if (!q.length) return [];
  const need = Math.min(2, q.length);
  return D.goals.map(g => { const text = rootsOf(`${g.title} ${(g.examples || []).map(e => e.text).join(" ")}`); const set = new Set(text);
    return { g, hit: q.filter(x => set.has(x) || text.some(w => w.length >= 4 && x.length >= 4 && (w.startsWith(x) || x.startsWith(w)))).length }; })
    .filter(x => x.hit >= need).sort((a, b) => b.hit - a.hit || (b.g.count || 0) - (a.g.count || 0)).slice(0, 5).map(x => x.g);
}

export function trendWord(t) {
  if (!t) return "";
  if (!t.previous30) return t.last30 ? "new" : "";
  return t.last30 > t.previous30 * 1.1 ? "rising" : t.last30 < t.previous30 * 0.9 ? "falling" : "flat";
}

// What a GitHub-issue count was counted over ("newest 200 issues (open and closed, opened 2026-08-01 to 2026-09-30), as of
// 2026-09-30"). The window is the whole reason a count moves between runs, so it is printed next to every one.
export function windowText(w) {
  if (!w) return "";
  const span = w.oldest && w.newest ? `, opened ${w.oldest} to ${w.newest}` : "";
  return `${w.complete ? `all ${w.count} issues` : `newest ${w.limit} issues`} (${w.states || "open and closed"}${span}), as of ${w.as_of || "?"}`;
}
// A goal made only of GitHub issues is a topic cluster (related issues matched by wording), never "N people asked once".
export const isCluster = g => { const k = Object.keys(g?.source || {}); return k.length > 0 && k.some(x => x === "github"); };

// One line a person can read. Exports (support tickets, surveys): "asked 14 times by 6 customers since 2026-03-02 · rising
// (5 in the last 30 days, 2 before)". Issues: "14 related issues, 6 people since 2026-03-02 · rising (...)" - a cluster, so it
// never says "asked N times". `D` (demandLoad) adds the window the count was taken over.
export function demandLine(g, D) {
  if (!g) return "";
  const first = g.first || g.ilk, tw = trendWord(g.trend), cluster = isCluster(g);
  const tail = (first ? ` since ${String(first).slice(0, 10)}` : "") + (tw ? ` · ${tw}${g.trend ? ` (${g.trend.last30} in the last 30 days, ${g.trend.previous30} before)` : ""}` : "");
  const win = D?.window && cluster ? ` · counted over ${windowText(D.window)}` : "";
  if (!cluster) return `asked ${g.count} time${g.count === 1 ? "" : "s"}${g.customer ? ` by ${g.customer} customer${g.customer === 1 ? "" : "s"}` : ""}${tail}${win}`;
  const onlyIssues = Object.keys(g.source).every(x => x === "github");
  return `${g.count} related ${onlyIssues ? `issue${g.count === 1 ? "" : "s"}` : `mention${g.count === 1 ? "" : "s"}`}${g.customer ? `, ${g.customer} ${g.customer === 1 ? "person" : "people"}` : ""}${tail}${win}`;
}

// Where collect-signals looks for input (same order as the script): sources.json signal.path, else <pm>/signal/.
export function demandInputs(pm, K) {
  const paths = K?.signal?.path?.length ? [].concat(K.signal.path) : [path.join(pm, "signal")];
  return paths.filter(p => { try { const st = fs.statSync(p); return st.isFile() || (st.isDirectory() && fs.readdirSync(p, { recursive: true }).some(f => /\.(csv|json|jsonl|md|txt)$/i.test(String(f)))); } catch { return false; } });
}

// --- Interview themes: pm/state/interviews.json from interview-themes.mjs ---
export function interviewsLoad(pm) {
  const p = path.join(pm, "state", "interviews.json");
  if (!fs.existsSync(p)) return null;
  try { const J = JSON.parse(fs.readFileSync(p, "utf8")); return (J.interviews || []).length ? J : null; } catch { return null; }
}
// Themes a free-text question touches: the same rule as demandForQuestion, against the theme name, its matched
// target and its masked quotes.
export function interviewsForQuestion(I, question, extraRoots = []) {
  if (!I?.themes?.length) return [];
  const q = [...new Set([...rootsOf(question), ...extraRoots.map(w => root(smallAscii(w)))])].filter(x => x.length >= 3);
  if (!q.length) return [];
  const need = Math.min(2, q.length);
  return I.themes.map(t => { const text = rootsOf(`${t.key} ${t.target?.title || ""} ${(t.quotes || []).map(x => x.text).join(" ")}`);
    return { t, hit: q.filter(x => text.some(w => w === x || (w.length >= 4 && x.length >= 4 && (w.startsWith(x) || x.startsWith(w))))).length }; })
    .filter(x => x.hit >= need).sort((a, b) => b.hit - a.hit || b.t.interviews - a.t.interviews).slice(0, 3).map(x => x.t);
}
export function interviewLine(t, total) {
  const q = t.quotes?.[0];
  return `raised in ${t.interviews} of ${total} interview${total === 1 ? "" : "s"} (${t.mentions} mention${t.mentions === 1 ? "" : "s"})${q ? ` — "${q.text.slice(0, 110)}${q.text.length > 110 ? "…" : ""}" (${q.file}:${q.line})` : ""}`;
}
// Interview input folder: sources.json signal.interviews, else <pm>/signal/interviews/.
export function interviewInputs(pm, K) {
  const paths = K?.signal?.interviews ? [].concat(K.signal.interviews) : [path.join(pm, "signal", "interviews")];
  return paths.filter(p => { try { const st = fs.statSync(p); return st.isFile() || (st.isDirectory() && fs.readdirSync(p, { recursive: true }).some(f => /\.(md|txt)$/i.test(String(f)))); } catch { return false; } });
}

// Library, not a CLI: a misdirected `node demand.mjs ...` would otherwise print
// nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "demand.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy psst\` or \`node skill/tools/lowhanging.mjs\`?`);
  process.exit(1);
}
