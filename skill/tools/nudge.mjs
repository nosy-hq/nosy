// nudge: what Nosy says right after a commit or merge, while the owner is still building.
// "That commit may close a gap rivals have; here's the next product decision; here's what to run."
// Usage: node nudge.mjs <pm folder> [--since <ref>] [--json]   (default: the last commit only)
// Reads: pm/sources.json (repo), pm/matrix.json, pm/state/waves.json or lowhanging.json, git log. Never writes,
// no network. The PostToolUse hook (hooks/after-commit.mjs) calls nudge() and remembers what it already said.
// Matrix links, strongest first:
//   explicit   the commit says `Matrix: <no or feature name>` (the same convention as `Bet: <id>`)
//   candidate  2+ distinctive words shared with a matrix row, and more than half of the row's words. Word overlap is a weak "shipped" signal (kill
//              criterion 1: 9% right), so it's always worded "looks like, confirm". On 45 days of the first product (3000
//              commits): one shared word gave 7 candidates (2 plausible), 2+ gave 6, 2+ and over half gives fewer.
// Only rows we don't fully have (our code isn't y) count: a gap closing is the news.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { words, root, smallAscii } from "./text.mjs";
import { matrixRead } from "./read-matrix.mjs";
import { Maintenance } from "./frontyard.mjs";
import { next } from "./next.mjs";
import { sourcesProblem } from "./hints.mjs";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const Filler = new Set(["with", "from", "that", "this", "into", "when", "only", "also", "more", "than", "then", "each", "every", "support", "supports", "make", "makes", "adds", "added", "first", "page", "screen", "feature", "features", "update", "updates"]);
const CODE = { y: "have it", p: "partial", n: "missing", u: "not found", d: "announced", f: "open PR", s: "decided, not built", b: "backend ready, no screen" };
// The matrix file's own legend wins (Nosy's `codes`, a Turkish-keyed page's `kodlar`); CODE is the fallback.
const legendOf = file => { const raw = readJson(file) || {}, L = [raw.codes, raw.kodlar].find(o => o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every(v => typeof v === "string")); return { ...CODE, ...(L || {}) }; };
const rootsOf = s => new Set(words(s, 3).filter(w => !Filler.has(w) && !/^\d+$/.test(w)).map(w => root(smallAscii(w))));

// Commits in (since, HEAD], newest first; without `since`, HEAD alone. [{ hash, subject, body }]; [] on any git failure.
export function commitsIn(repo, since, max = 10) {
  const range = since ? [`${since}..HEAD`] : ["-1", "HEAD"];
  try {
    const raw = execFileSync("git", ["-C", repo, "log", "--no-merges", `--max-count=${max}`, "--format=%h\x1f%s\x1f%b\x1e", ...range],
      { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "ignore"] });
    return raw.split("\x1e").map(s => s.trim()).filter(Boolean).map(s => { const [hash, subject, body = ""] = s.split("\x1f"); return { hash, subject, body }; });
  } catch { return []; }
}

// Which matrix row (that we don't fully have) each commit may close. [{ commit, subject, feature, no, link, us, rivals }]
export function matrixHits(M, commits) {
  if (!M) return [];
  const rivalsWith = line => M.products.slice(1).filter(p => !M.oh.has(p) && line.codes[p] === "y");
  const open = M.lines.filter(l => l.codes[M.biz] !== "y").map(l => ({ l, F: rootsOf(l.feature) }));
  const hits = [];
  for (const c of commits) {
    let best = null;
    const tag = `${c.subject}\n${c.body}`.match(/^\s*Matrix:\s*(.+)$/mi)?.[1]?.trim();
    if (tag) {
      const t = smallAscii(tag);
      const e = open.find(({ l }) => (l.no != null && String(l.no) === t) || smallAscii(l.feature) === t || (t.length >= 3 && smallAscii(l.feature).includes(t)));
      if (e) best = { e, link: "explicit" };
    }
    if (!best && !Maintenance.test(c.subject)) {
      const C = rootsOf(c.subject);
      let top = 0;
      for (const e of open) {
        const overlap = [...e.F].filter(w => C.has(w)).length;
        if (overlap >= 2 && overlap * 2 > e.F.size && overlap > top) { top = overlap; best = { e, link: "candidate" }; }
      }
    }
    if (best && !hits.some(h => h.feature === best.e.l.feature && (h.link === "explicit" || best.link === "candidate"))) hits.push({ commit: c.hash, subject: c.subject, feature: best.e.l.feature, no: best.e.l.no ?? null, link: best.link,
      us: best.e.l.codes[M.biz] || "u", rivals: rivalsWith(best.e.l) });
  }
  return hits;
}

// The next product decision: one source for every surface (next-decision.mjs).
export { nextDecision, shortWhy } from "./next-decision.mjs";
import { nextDecision } from "./next-decision.mjs";
import { readSourcesSafe } from "./sources-file.mjs";

export function nudge(pm, { since = null, now = Date.now() } = {}) {
  const K = readSourcesSafe(pm);
  if (!K) return null;
  const repo = K.repo || ".";
  const commits = commitsIn(repo, since);
  const matrixFile = K.matrix ? path.resolve(repo, K.matrix) : path.join(pm, "matrix.json");
  const M = matrixRead(matrixFile);
  const pick = next(pm, { now }).picks[0];
  return { type: "nudge", generated: new Date(now).toISOString(), commits: commits.map(c => ({ hash: c.hash, subject: c.subject })),
    product: M?.biz || null, legend: legendOf(matrixFile), matrixFile: K.matrix || `${path.basename(pm)}/matrix.json`,
    matrix: matrixHits(M, commits), decision: nextDecision(pm), next: pick && pick.command !== "stakeout" ? pick : null };
}

// `skip`: what was already said ({ decision, next }): a line only repeats when it changed. Empty string = say nothing.
export function render(R, { skip = {}, prefix = "/nosy:" } = {}) {
  if (!R) return "";
  const lines = [];
  const legend = R.legend || CODE, hits = R.matrix.slice(0, 3);
  for (const h of hits) {
    const who = h.rivals.length ? `${h.rivals.slice(0, 3).join(", ")}${h.rivals.length > 3 ? ` +${h.rivals.length - 3}` : ""} ${h.rivals.length === 1 ? "has" : "have"} it` : "no rival has it yet";
    const how = h.link === "explicit" ? `${h.commit} closes it` : `${h.commit} looks like it (confirm)`;
    lines.push(`· "${h.feature}": ${how}. ${R.product || "Us"}: ${legend[h.us] || h.us}; ${who}.`);
  }
  if (R.matrix.length > 3) lines.push(`· …and ${R.matrix.length - 3} more matrix rows (node <skill>/tools/nudge.mjs pm --json).`);
  if (hits.length) lines.push(`  Done? Mark it as yours in ${R.matrixFile || "pm/matrix.json"}; it goes into the weekly landing roundup (${prefix}frontyard).`);
  if (R.decision && (lines.length || R.decision.title !== skip.decision))
    lines.push(`· Next product decision: ${R.decision.title}${R.decision.why ? ` (${R.decision.why})` : ""}.`);
  if (R.next && R.next.command !== skip.next) lines.push(`· Next to run: ${prefix}${R.next.command} · ${R.next.reason}`);
  return lines.length ? ["Psst… after that commit:", ...lines].join("\n") : "";
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const since = take("--since"), json = argv.includes("--json");
  const R = nudge(argv.filter(a => a !== "--json")[0] || "pm", { since });
  if (!R) { console.error(`Psst… ${sourcesProblem(argv.filter(a => a !== "--json")[0] || "pm") || "no pm/sources.json: run `nosy setup .` first"}`); process.exit(1); }
  console.log(json ? JSON.stringify(R, null, 1) : (render(R) || "Nothing to say about the last commit."));
}
