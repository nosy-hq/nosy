// What `nosy publish` is allowed to send: counts and structure, never quotes. Your local pm/ files hold commit subjects,
// author display names, PR titles and issue titles (that is what the shipped record is made of); the dashboard needs
// none of those words, only how many, when and which reference. Each function here takes the parsed local file and
// returns a copy with exactly the fields Nosy Cloud reads, and with every word from your git history or issue tracker
// replaced by a count or an id:
//   commit subjects  → "N commits"          author names → "N authors"
//   PR titles        → "PR #N opened"       issue titles → "#N"
// Titles of your own matrix rows, your own request items and your own notes stay: they are your product's structure,
// not someone else's words. docs/DATA.md lists every key that leaves.
// A library: no side effects.
import fs from "node:fs"; import path from "node:path";

const cut = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// "#123 Login page is broken" → "#123"; "PR #9 fix the thing" → "PR #9". Anything else is left alone.
export const withoutIssueTitle = s => { const t = String(s ?? "").trim(), m = t.match(/^((?:PR\s+)?#\d+)\s+\S/i); return m ? m[1] : t; };

// ---- state/status.json: the shipped record. Cloud reads generated, range, main, pr, lastMain and groups. ----
export function safeStatus(S) {
  if (!S || typeof S !== "object") return S;
  return {
    type: "state", generated: S.generated, range: S.range, main: S.main, pr: S.pr, lastMain: S.lastMain,
    groups: (S.groups || []).map(g => ({
      ref: cut(g.ref, 60), n: g.n, where: (g.where || []).map(w => cut(w, 40)), last: g.last,
      who: [plural((g.who || []).length, "author")], topic: plural(g.n ?? 0, "commit"),
    })),
  };
}

// ---- state/diff.json: what changed since the last run. Cloud reads changes[].{area,type,severity,title,detail,reason}. ----
export function safeChange(c) {
  let { title, detail } = c;
  if (c.area === "state") {
    const pr = String(title).match(/^(PR #\d+ (?:opened|is no longer open)):/);
    if (pr) { title = pr[1]; detail = plural(+(String(detail).match(/(\d+) commits/)?.[1] ?? 0), "commit"); }        // "author · N commits" → "N commits"
    else if (c.type === "fresh" && c.source && String(title).startsWith(`${c.source}: `)) {
      title = `${c.source}: first commit seen`;                                                                       // the commit subject goes
      detail = String(detail).split(" · ").slice(0, 2).join(" · ");                                                    // "N commits · where · who" → "N commits · where"
    } else if (/: landed on main$/.test(String(title))) detail = "";                                                  // the detail was the subject
  } else if (c.area === "signal") {
    title = c.type === "fresh" ? (/^New theme/.test(title) ? "New theme in the demand data" : "New demand target") : "Demand target changed"; // may be a customer's words
  } else title = withoutIssueTitle(title);
  return { area: c.area, type: c.type, severity: c.severity, title: cut(title, 200), detail: cut(detail, 200), reason: cut(c.reason, 300) };
}
export function safeDiff(D) {
  if (!D || typeof D !== "object") return D;
  return { type: "diff", generated: D.generated, previous: D.previous, current: D.current, changes: (D.changes || []).map(safeChange) };
}

// ---- state/lowhanging.json: psst's list. Cloud reads items[].{score,effort,type,title,evidence,detail}. ----
export function safeItem(i) {
  let { title, evidence, detail } = i;
  if (i.type === "Issue opened against us") { title = withoutIssueTitle(title); evidence = String(evidence).split(" · ").slice(1).join(" · "); } // "login · date" → "date"
  else if (i.type === "Shipped, not tied to any plan") { evidence = ""; detail = []; }                                                                // commit hashes and subjects
  return { score: i.score, effort: i.effort, type: i.type, title: cut(title, 240), evidence: cut(evidence, 240), detail: (detail || []).map(d => cut(d, 240)), ref: i.ref ?? null };
}
export function safeLowhanging(L) {
  if (!L || typeof L !== "object") return L;
  return { type: "lowHanging", generated: L.generated, ref: L.ref, items: (L.items || []).map(safeItem) };
}

// ---- state/glance.json (computed): the page's first screen. Shipped tags come from commit subjects; use the references. ----
export function safeGlance(G) {
  if (!G || typeof G !== "object") return G;
  const out = JSON.parse(JSON.stringify(G));
  if (out.decision) { out.decision.title = withoutIssueTitle(out.decision.title); }
  if (out.lanes) for (const l of out.lanes) for (const i of l.items || []) i.title = withoutIssueTitle(i.title);
  const you = out.lanes?.find(l => l.key === "you"), tile = out.tiles?.find(t => t.key === "you");
  if (you && tile) tile.note = cut(you.items.map(i => i.title).join(" · "), 60) || "nothing";
  return out;
}

// ---- summary.md: Cloud shows the bullets of the first section only, so only that section is sent. ----
export function safeSummary(md) {
  const out = []; let started = false;
  for (const line of String(md).split("\n")) {
    if (/^#{1,3} /.test(line)) { if (started) break; started = true; }
    out.push(line);
  }
  return out.join("\n").replace(/\s+$/, "") + "\n";
}

// ---- who wrote the commits: names to look for in everything that leaves (a name in free text stops the send) ----
export function authorNames(pm) {
  const S = readJson(path.join(pm, "state", "status.json"));
  const names = new Set();
  for (const g of S?.groups || []) for (const w of g.who || []) names.add(w);
  for (const p of S?.prs || []) if (p.a) names.add(p.a);
  for (const b of S?.localBranches || []) if (b.author) names.add(b.author);
  return [...names].map(n => String(n).trim()).filter(n => n.length >= 3 && !/^(unknown|github-actions|dependabot|bot)/i.test(n));
}

// The files and computed files that make up the payload, with what each one carries. Printed by --dry-run and listed in docs/DATA.md.
export const PayloadKeys = {
  "pm/matrix.json": "product steps, our status per step, rival names, categories, status and evidence lines (your matrix, as written)",
  "pm/state/status.json": "generated, range, main, pr, lastMain, groups[{ref, n, where, last, who: \"N authors\", topic: \"N commits\"}]",
  "pm/state/lowhanging.json": "generated, ref, items[{score, effort, type, title, evidence, detail, ref}]: your own list; issue items reduced to \"#N\"",
  "pm/state/diff.json": "generated, previous, current, changes[{area, type, severity, title, detail, reason}]",
  "pm/history/runs.jsonl": "one line per run: time, label, ref, last commit id, counts",
  "pm/summary.md": "the first section of your summary (the section the dashboard shows)",
  "pm/state/watch.json": "rival names and the public page URLs you listed, with their change state",
  "pm/state/glance.json": "computed: next decision (title, size, checks), four numbers, where we stand, roadmap lanes, shipped (counts and references)",
  "pm/state/rival-facts.json": "computed: each rival's price line, from your rival files",
  "pm/state/demand.json": "computed: counts per goal from your matrix and psst items, sources by format, hidden counts; no quotes, no customer names",
};
