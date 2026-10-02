// What `nosy publish` is allowed to send: counts and structure, never quotes. Your local pm/ files hold commit subjects,
// author display names, PR titles and issue titles (that is what the shipped record is made of); the dashboard needs
// none of those words, only how many, when and which reference. Each function here takes the parsed local file and
// returns a copy with exactly the fields Nosy Cloud reads, and with every word from your git history or issue tracker
// replaced by a count or an id:
//   commit subjects  → "N commits"          author names → "N authors"
//   PR titles        → "PR #N opened"       issue titles → "#N"
// Titles of your own matrix rows, your own request items and your own notes stay: they are your product's structure,
// not someone else's words. docs/DATA.md lists every key that leaves.
// The checked list (psst-final.json) leaves as title, size, type, verdict and the evidence references as written;
// never the refuter's `checked` file:line lists, the titles it dropped, the receipts, or a branch or author name.
// A library: no side effects.
import fs from "node:fs"; import path from "node:path";

const cut = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// "#123 Login page is broken" → "#123"; "PR #9 fix the thing" → "PR #9". Anything else is left alone.
export const withoutIssueTitle = s => { const t = String(s ?? "").trim(), m = t.match(/^((?:PR\s+)?#\d+)\s+\S/i); return m ? m[1] : t; };

// ---- state/status.json: the shipped record. Cloud reads generated, range, main, pr, prCommits, openPrs, lastMain and groups. ----
// `pr` is what collect-status always wrote and is NOT a count of open PRs (it also holds merge commits on main; internal request 205).
// `openPrs` (PRs listed, null when gh could not be read) and `prCommits` (their commits) are the honest numbers; older status files lack them.
export function safeStatus(S) {
  if (!S || typeof S !== "object") return S;
  return {
    type: "state", generated: S.generated, range: S.range, main: S.main, pr: S.pr,
    ...(S.prCommits != null ? { prCommits: S.prCommits } : {}), ...("openPrs" in S ? { openPrs: S.openPrs } : {}), ...(S.openPrsCapped ? { openPrsCapped: true } : {}), lastMain: S.lastMain,
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
    detail = String(detail).split(" · ")[0];                                                                          // "N requests · <customer>" → "N requests"
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
// Items the receipts hold on purpose (receipts.json, gate.held: a decision or a code comment with a reference parks them) are left out, and
// `leftOut` says how many, so the dashboard never lists as "could come next" something the owner decided to hold. Matched by title, the way
// next-decision.mjs does; nothing is dropped that the receipts do not name (a missing or unreadable receipts file leaves the list whole).
const small = s => String(s ?? "").trim().toLowerCase();
export const heldTitles = R => new Set((R?.items || []).filter(r => r?.gate?.held).map(r => small(r.title)));
export function safeLowhanging(L, R = null) {
  if (!L || typeof L !== "object") return L;
  const held = heldTitles(R), all = L.items || [], kept = all.filter(i => !held.has(small(i?.title)));
  return { type: "lowHanging", generated: L.generated, ref: L.ref, items: kept.map(safeItem), leftOut: all.length - kept.length };
}

// ---- state/psst-final.json: psst's list after the refuter checked it (psst-refute.mjs apply). Cloud shows it instead of the raw list. ----
// Sent: items[{title, size, type, verdict, evidence[]}] and the counts. Not sent: `checked` (the file:line lists the refuter read), `fix` and `why`
// (free text that can name a branch or a person), `claim`, `receipt`, and `dropped` (titles of what was refuted; only how many leaves).
// A reference, not a sentence: `src/a.ts`, `src/a.ts:12`, `src/a.ts:12-30`, `pm/request.md §5`, `§5`, `#12`, `K7`, a date. A bare word (a login,
// a branch name) is not one: it needs a file extension or `:line`.
const REFERENCE = /^(?:(?=[^\s·|]*(?:\.\w|:\d))[^\s·|]{1,200}(?:\s§\d+)?|§\d+|#\d+|K\d+|\d{4}-\d{2}-\d{2})$/;
export function safePsstFinal(F) {
  if (!F || typeof F !== "object") return F;
  const n = v => (Number.isFinite(v) ? v : 0), st = F.stats || {};
  // The draft psst writes has no `type` (id, title, claim, size, evidence: ["file:line"], receipt), so the type cannot be what decides how much to
  // cut: a title that opens with "#N" is always reduced to "#N" (an issue's words), and an evidence entry leaves only when it is a reference
  // (a file or a file:line, a "path §N", a date) and not free text such as a commit subject or a login that rode along from the raw list.
  const item = i => {
    const issue = i.type === "Issue opened against us", shipped = i.type === "Shipped, not tied to any plan";
    const ev = (Array.isArray(i.evidence) ? i.evidence : i.evidence ? [i.evidence] : []).map(e => String(e));
    const refs = e => (issue && e.includes(" · ") ? e.split(" · ").slice(1).join(" · ") : e).split(" · ").map(x => x.trim()).filter(x => REFERENCE.test(x));
    return { title: cut(withoutIssueTitle(i.title), 240), size: i.size ? cut(i.size, 4) : null, type: i.type ? cut(i.type, 80) : null,
      verdict: i.verdict === "weakened" ? "weakened" : "stands",
      evidence: shipped ? [] : ev.flatMap(refs).map(e => cut(e, 240)).filter(Boolean) };
  };
  return { type: "psstFinal", generated: F.generated, stats: { drafted: n(st.drafted), stands: n(st.stands), weakened: n(st.weakened), refuted: n(st.refuted) }, items: (F.items || []).map(item) };
}
// Is the checked list as new as the raw list it checked? A checked list older than the draft list it came from may no longer hold (the same
// rule next-decision.mjs uses), so then the raw list is what goes. `generated` when both have one, else the files' own times.
export function finalIsCurrent(pm) {
  const f = path.join(pm, "state", "psst-final.json"), l = path.join(pm, "state", "lowhanging.json");
  if (!fs.existsSync(f)) return false;
  if (!fs.existsSync(l)) return true;
  const when = (file, J) => { const t = Date.parse(J?.generated || ""); return Number.isNaN(t) ? fs.statSync(file).mtimeMs : t; };
  return when(f, readJson(f)) >= when(l, readJson(l));
}

// ---- state/glance.json (computed): the page's first screen. Shipped tags come from commit subjects; use the references. ----
export function safeGlance(G) {
  if (!G || typeof G !== "object") return G;
  const out = JSON.parse(JSON.stringify(G));
  // The decision's `why` is built from the refuter's `fix` ("corrected: ..."), a roadmap line's evidence (an issue's author, a commit subject) or a
  // decision's summary, none of which may leave; the dashboard shows the title, the size and the checks.
  if (out.decision) { out.decision.title = withoutIssueTitle(out.decision.title); out.decision.why = ""; }
  if (out.lanes) for (const l of out.lanes) for (const i of l.items || []) i.title = withoutIssueTitle(i.title);
  // The people's to-do list (pm/todo/) leaves as a count and an age, never a title or a name.
  if (out.todo) out.todo = { open: out.todo.open, oldestDays: out.todo.oldestDays, people: out.todo.people, items: [], more: 0 };
  const you = out.lanes?.find(l => l.key === "you"), tile = out.tiles?.find(t => t.key === "you");
  if (you && tile) tile.note = cut(you.items.map(i => i.title).join(" · "), 60) || "nothing";
  return out;
}

// ---- summary.md: Cloud shows the bullets of the first section only, so only that section is sent. ----
// Whatever comes before the first heading is not part of that section and stays home. A file with no heading at all is one section, cut to its
// first 40 lines, so a notes file saved under this name cannot go up whole.
export function safeSummary(md) {
  const lines = String(md).replace(/^﻿/, "").split("\n");
  if (!lines.some(l => /^#{1,3} /.test(l))) return lines.slice(0, 40).join("\n").replace(/\s+$/, "") + "\n";
  const out = []; let started = false;
  for (const line of lines) {
    if (/^#{1,3} /.test(line)) { if (started) break; started = true; }
    if (started) out.push(line);
  }
  return out.join("\n").replace(/\s+$/, "") + "\n";
}

// ---- history/runs.jsonl: one line per run. Cloud reads zaman, label, ref, lastMain and numbers; a line is cut to those (counts stay numbers). ----
export function safeRuns(text) {
  const out = [];
  for (const l of String(text).split("\n")) {
    if (!l.trim()) continue;
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const numbers = Object.fromEntries(Object.entries(r.numbers && typeof r.numbers === "object" ? r.numbers : {}).filter(([, v]) => Number.isFinite(v)).slice(0, 40).map(([k, v]) => [cut(k, 40), v]));
    out.push(JSON.stringify({ zaman: cut(r.zaman, 40), label: cut(r.label, 40), ref: cut(r.ref, 60), lastMain: r.lastMain == null ? null : cut(r.lastMain, 40), numbers }));
  }
  return out.length ? out.join("\n") + "\n" : "";
}

// ---- who wrote the commits: names to look for in everything that leaves (a name in free text stops the send) ----
// The shipped record's authors, and the authors of the owner's own branches (receipts and `facts`).
export function authorNames(pm) {
  const S = readJson(path.join(pm, "state", "status.json")), R = readJson(path.join(pm, "state", "receipts.json")), B = readJson(path.join(pm, "state", "facts", "branches.json"));
  const names = new Set();
  for (const g of S?.groups || []) for (const w of g.who || []) names.add(w);
  for (const p of S?.prs || []) if (p.a) names.add(p.a);
  for (const b of S?.localBranches || []) if (b.author) names.add(b.author);
  for (const r of R?.items || []) for (const x of r?.local || []) if (x?.author) names.add(x.author);
  for (const b of Array.isArray(B?.branches) ? B.branches : []) if (b?.author) names.add(b.author);
  return [...names].map(n => String(n).trim()).filter(n => n.length >= 3 && !/^(unknown|ghost|github-actions|dependabot|bot)/i.test(n));
}
// Names of the owner's own branches that are not in the integration branch (status, receipts, facts, the PRs facts read): "side/pricing-v2".
// A branch name in the text that leaves stops the send like a person's name does. Only names that look like a branch (a slash, or a dash or
// underscore and at least 8 characters), never a plain word such as main or release.
export function branchNames(pm) {
  const S = readJson(path.join(pm, "state", "status.json")), R = readJson(path.join(pm, "state", "receipts.json")), B = readJson(path.join(pm, "state", "facts", "branches.json")), G = readJson(path.join(pm, "state", "facts", "github.json"));
  const names = new Set(), add = b => {
    const n = String(b ?? "").trim().replace(/^(?:refs\/heads\/|origin\/|upstream\/)/, "");
    if (n && !/\s/.test(n) && (n.includes("/") ? n.length >= 5 : /[-_]/.test(n) && n.length >= 8) && !/^(?:main|master|develop|development|release|staging|production|trunk)$/i.test(n)) names.add(n);
  };
  for (const b of S?.localBranches || []) add(b?.branch);
  for (const r of R?.items || []) { for (const x of r?.local || []) add(x?.branch); for (const e of r?.edits || []) add(e?.branch); }
  for (const b of Array.isArray(B?.branches) ? B.branches : []) add(b?.branch);
  for (const i of Array.isArray(G?.items) ? G.items : []) if (i?.kind === "pr") add(i?.branch);
  return [...names].slice(0, 2000);
}

// The files and computed files that make up the payload, with what each one carries. Printed by --dry-run and listed in docs/DATA.md.
export const PayloadKeys = {
  "pm/matrix.json": "product steps, our status per step, rival names, categories, status and evidence lines (your matrix, as written)",
  "pm/state/status.json": "generated, range, main, pr (commits on open PRs plus merges on main, not a PR count), prCommits, openPrs (openPrsCapped when the list hit its limit), lastMain, groups[{ref, n, where, last, who: \"N authors\", topic: \"N commits\"}]",
  "pm/state/lowhanging.json": "generated, ref, leftOut (how many items the receipts hold on purpose), items[{score, effort, type, title, evidence, detail, ref}]: your own list; issue items reduced to \"#N\"; held items left out",
  "pm/state/psst-final.json": "only when it is as new as lowhanging.json: psst's list after the refuter checked it: generated, stats (counts), items[{title, size, type, verdict, evidence}]; no file:line check lists, no dropped titles, no receipts",
  "pm/state/diff.json": "generated, previous, current, changes[{area, type, severity, title, detail, reason}]",
  "pm/history/runs.jsonl": "one line per run: time, label, ref, last commit id, counts (nothing else of the line)",
  "pm/summary.md": "the first section of your summary (the section the dashboard shows)",
  "pm/state/watch.json": "rival names and the public page URLs you listed, with their change state",
  "pm/state/glance.json": "computed: next decision (title, size, checks), four numbers, where we stand, roadmap lanes, shipped (counts and references), how many things wait on people and for how long (no titles, no names)",
  "pm/state/rival-facts.json": "computed: each rival's price line, from your rival files",
  "pm/state/rival-demand.json": "computed, only if you ran `nosy rival-demand`: titles, vote counts and links of open issues and Discussions on your open-source rivals' own public trackers (their public data, not yours), and which rivals share an ask",
  "pm/state/demand.json": "computed: counts per goal from your matrix and psst items, sources by format, hidden counts; no quotes, no customer names",
};
