// Groups commits in a git range by their references (#issue, §item, K-decision).
// Usage: node collect-status.mjs <repo> <start-ref|date> [end-ref] [--json <file>] [--pm <pm folder>]
// Output: markdown (stdout); if --json is given, the same data is written for the page section (auto-section.mjs).
// If --pm is given, reference patterns are read from that product's sources.json under `refs` (refs.mjs); otherwise falls back to the first product + generic patterns.
// If end-ref is omitted, it's detected with integration-branch.mjs: the branch with the most merged PRs in the
// last 90 days (some projects merge to a branch other than the default one before releasing — internal request
// 73), falling back to sources.json's `ref` (or "origin/main"). An explicit end-ref argument always wins.
// Deterministic work: not left to the LLM (ccpm pattern).
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs";
import { integrationBranchOf } from "./integration-branch.mjs";
import { waveMapOf } from "./waves-map.mjs";
import { localBranchesCloseToMerging } from "./local-branches.mjs";
import { readSources } from "./sources-file.mjs";
const argv = process.argv.slice(2), ji = argv.indexOf("--json"), jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
const pi = argv.indexOf("--pm"), pmDir = pi >= 0 ? argv.splice(pi, 2)[1] : null;
const [repo = ".", from, toArg] = argv;
let K = null;
if (pmDir) { try { K = readSources(pmDir); } catch {} }
let to = toArg, toReason = null;
if (!to) {
  const defaultRef = (K && K.ref) || "origin/main";
  const defaultBranch = defaultRef.replace(/^origin\//, "");
  const det = integrationBranchOf({ ghRepo: K?.issue?.repo, defaultBranch, explicit: K?.integrationBranch });
  to = det.branch === defaultBranch ? defaultRef : `origin/${det.branch}`;
  toReason = det.reason;
}
const local = d => new Date(d).toLocaleString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/[,/]/g, m => m === "/" ? "." : "");
// Truncates a GitHub title at ~70 chars with "…" and prepends the rest with "…" to the start of the body.
const fullTitle = c => { const b = (c.messageBody || "").split("\n"); return /…$/.test(c.messageHeadline) && /^…/.test(b[0] || "") ? c.messageHeadline.slice(0, -1) + b[0].slice(1) : c.messageHeadline; };
const range = /^\d{4}-\d{2}-\d{2}/.test(from || "") ? ["--since", /\d:\d/.test(from) ? from : `${from} 00:00`, to] : [from ? `${from}..${to}` : to, "-n", "300"];
// %aI: exact ISO date (for sorting); display uses local() — deduplicated (main and PR
// commits now carry the timestamp in the same format, so the "Last" column can sort by real time).
// References are read from the whole message, not just the subject: the link convention puts `Bet: <id>` (and often
// `Closes #N`) in the body (N3/N5). Merge commits are kept only when their own message carries a reference (a merged
// branch's `Bet: <id>` line, a "Merge pull request #N" with a ref): that's how merged-in work gets credited.
const logRaw = execFileSync("git", ["-C", repo, "log", ...range, "--format=%h%x1f%aI%x1f%an%x1f%P%x1f%s%x1f%b%x1e"], { encoding: "utf8", maxBuffer: 256 << 20 });
const log = logRaw.split("\x1e").map(r => r.replace(/^\n+/, "")).filter(Boolean).map(r => { const [h, iso, a, parents, s, body] = r.split("\x1f");
  return { h, iso, d: local(iso), a, s, body: (body || "").trim(), merge: (parents || "").trim().split(" ").length > 1, where: "main" }; });
// Commits from open PRs: work from other sessions or people that hasn't landed on main yet.
// No remote / no gh / offline: gh can't read PRs at all in a lot of real repos (this
// one included - no GitHub remote). That used to print a "PR could not be read: <raw error>" line and stop
// there; now it's one quiet note plus a local-branch fallback for "close to merging" (see below), same as recent.mjs.
const prs = [];
let noRemote = false;
try {
  const sinceMs = /^\d{4}-\d{2}-\d{2}/.test(from || "") ? Date.parse(from + (/\d:\d/.test(from) ? "" : "T00:00:00")) : 0;
  const js = JSON.parse(execFileSync("gh", ["pr", "list", "--state", "open", "--limit", "30", "--json", "number,title,author,isDraft,commits"], { cwd: repo, encoding: "utf8", maxBuffer: 256 << 20 }));
  for (const p of js) {
    const own = (p.commits || []).filter(c => !/^Merge /.test(c.messageHeadline) && Date.parse(c.committedDate) >= sinceMs);
    prs.push({ n: p.number, t: p.title, a: p.author.login, draft: p.isDraft, count: own.length, last: own.at(-1)?.committedDate });
    for (const c of own) log.push({ h: c.oid.slice(0, 9), d: local(c.committedDate), iso: c.committedDate, a: (c.authors?.[0]?.login || c.authors?.[0]?.name || p.author.login), s: fullTitle(c), where: `#${p.number}` });
  }
} catch { noRemote = true; }
const localBranches = noRemote
  ? localBranchesCloseToMerging({ repo, integrationBranch: to.replace(/^origin\//, ""), refSource: K || pmDir })
  : [];
const refRe = refRegex(patternsOfLoad(pmDir));
const kind = s => s.match(/^(\w+)(?:\(([^)]*)\))?!?:/) || [];
const groups = new Map(), none = [], byAuthor = new Map();
const deps = [];
for (const c of log) {
  if (!c.merge) byAuthor.set(c.a, (byAuthor.get(c.a) || 0) + 1);
  if (/^chore\(deps\)/.test(c.s)) { deps.push(c); continue; }
  const refs = [...new Set((`${c.s}\n${c.body || ""}`.match(refRe) || []).map(groupKeyOf))];
  if (c.merge && !refs.length) continue; // a merge with no reference of its own adds nothing (its commits are listed)
  if (!refs.length) { none.push(c); continue; }
  for (const r of refs) { if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
}
// main and open-PR commits used to be mixed (order within a group was discovery order, not time);
// so a group is now sorted by real time (iso) first, so "Last" is truly the newest.
for (const cs of groups.values()) cs.sort((a, b) => Date.parse(b.iso) - Date.parse(a.iso));
const order = r => (r[0] === "K" ? 0 : r[0] === "§" ? 1 : r[0] === "#" ? 3 : 2) * 1e4 + parseInt(r.replace(/\D/g, ""), 10);
const mainN = log.filter(c => c.where === "main" && !c.merge).length;
// Which decision/request a ref serves: pm/waves.md's N-sections, waves-map.mjs.
// waveCol stays false (no "Wave" column at all, not a column full of "—") when there's no waves file to read.
const waveInfo = waveMapOf(pmDir);
const waveCol = waveInfo.found;
let o = `# Delivery · ${range.join(" ")}\n\n${toReason ? `- **End ref:** ${to} — ${toReason}\n` : ""}- **Commits:** ${mainN} on main, ${log.filter(c => !c.merge).length - mainN} on open PRs (excluding merges) · ${[...byAuthor].map(([a, n]) => `${a} ${n}`).join(", ")}\n- **Latest main commit:** ${log[0]?.h || "—"}\n\n## Open PRs\n\n${prs.map(p => `- #${p.n}${p.draft ? " (draft)" : ""} ${p.t.slice(0, 90)} · ${p.a} · ${p.count} commits in range${p.last ? `, last ${local(p.last)}` : ""}`).join("\n") || "—"}\n`;
// No remote / no gh / offline: one quiet line, never the old "PR could not be read"
// dead end - the local branches not yet in the integration branch stand in for "close to merging".
if (noRemote) o += `\n(no remote: PRs not read; local branches used)\n\n## Close to merging (local branches) (${localBranches.length})\n\n| Branch | Ahead | Last | Author | Refs |\n|---|---|---|---|---|\n${localBranches.map(b => `| ${b.branch} | ${b.ahead} | ${local(b.last)} | ${b.author} | ${b.refs.join(" ") || "—"} |`).join("\n") || "—"}\n`;
o += `\n## By reference\n\n| Ref | Commits | Where | Who | Last | Topic (first commit) |${waveCol ? " Wave |" : ""}\n|---|---|---|---|---|---|${waveCol ? "---|" : ""}\n`;
for (const [r, cs] of [...groups].sort((a, b) => order(a[0]) - order(b[0])))
  o += `| ${r} | ${cs.length} | ${[...new Set(cs.map(c => c.where))].join(", ")} | ${[...new Set(cs.map(c => c.a))].join(", ")} | ${cs[0].d} | ${cs[cs.length - 1].s.replace(/\|/g, "/").slice(0, 110)} |${waveCol ? ` ${waveInfo.map.get(r) || "—"} |` : ""}\n`;
const types = new Map(); for (const c of none) { const k = kind(c.s)[1] || "other"; types.set(k, (types.get(k) || 0) + 1); }
o += `\n- **Dependency updates:** ${deps.length} commits (${deps.map(c => (c.s.match(/#\d+/) || [""])[0]).filter(Boolean).join(" ")})\n`;
o += `\n## Without a reference (${none.length})\n\n${[...types].map(([k, n]) => `${k} ${n}`).join(" · ")}\n\n`;
for (const c of none.filter(c => !/^(chore\(deps\)|test|style|Merge)/.test(c.s)).slice(0, 25)) o += `- \`${c.h}\` ${c.a}: ${c.s.slice(0, 120)}\n`;
process.stdout.write(o);
if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({ type: "state", generated: new Date().toISOString(), range: range.join(" "), ...(toReason ? { endRef: to, endRefReason: toReason } : {}), main: mainN, pr: log.length - mainN, lastMain: log.find(c => c.where === "main")?.h || null,
  prs: prs.map(p => ({ n: p.n, t: p.t, a: p.a, draft: p.draft, count: p.count, last: p.last ? local(p.last) : null })),
  noRemote, localBranches: localBranches.map(b => ({ branch: b.branch, ahead: b.ahead, last: local(b.last), author: b.author, subject: b.subject, refs: b.refs })),
  groups: [...groups].sort((a, b) => order(a[0]) - order(b[0])).map(([r, cs]) => ({ ref: r, n: cs.length, where: [...new Set(cs.map(c => c.where))], who: [...new Set(cs.map(c => c.a))], last: cs[0].d, topic: cs[cs.length - 1].s, ...(waveCol ? { wave: waveInfo.map.get(r) || "—" } : {}) })),
  dependency: deps.length, withoutReference: none.length }, null, 1));
