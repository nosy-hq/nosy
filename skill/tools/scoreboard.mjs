// The scoreboard page (wave N4, direction "the git shipped record"): what shipped, what's close, how bets did,
// and what nobody has decided on. `tea` publishes it; `stakeout` refreshes it weekly.
// Reads: <pm>/state/shipped.json (N1/N2: explicit links only) and, if present, <pm>/state/score.json (N3: bets).
// Rules baked in from the kill-criteria evidence (pm/decisions.md, "Direction: narrow Nosy to the git shipped record"):
//   - the headline shipped count is shown only when every explicit link kind was counted, incl. issue timeline/
//     comment cross-references; otherwise the list shows, the headline says why it's withheld;
//   - a rate or median over fewer than `minN` items is hidden, and the page says "too few to say" (84);
//   - every shipped row says how it was linked; nothing on this page comes from text similarity (72);
//   - requests nobody has decided on get their own section (85).
// Usage: node scoreboard.mjs <pm folder> <out.html> [--min-n 5]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { thresholds } from "./thresholds.mjs";

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const day = d => d ? new Date(d + (d.length === 10 ? "T12:00:00Z" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
const median = a => { const s = a.filter(x => typeof x === "number").sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const num = x => x == null ? "—" : Number.isInteger(x) ? String(x) : x.toFixed(1);
export const AllLinks = ["closes", "mentions", "timeline", "bet"];
const LinkLabel = { closes: "PR closes it", mentions: "PR mentions it", timeline: "linked from the issue", bet: "bet id in PR/commit", commit: "commit names it", pr: "PR names it" };
const MissingLabel = { closes: "PRs that close the request", mentions: "PRs that mention the request", timeline: "links on the issue's own timeline or in comments" };
const StatusLabel = { open: "open", landed: "landed", partial: "partly landed", reverted: "reverted", dropped: "dropped" };

// minN: explicit argument > sources.json/thresholds `minN` > score.json's own minN > 5.
export function minNOf(pm, given, score) { return Number(given) || Number(thresholds(pm).minN) || Number(score?.minN) || 5; }

export function page(pm, { minN } = {}) {
  const s = read(path.join(pm, "state", "shipped.json"));
  if (!s) throw new Error(`${path.join(pm, "state", "shipped.json")} is missing: run shipped first`);
  const sc = read(path.join(pm, "state", "score.json"));
  const n0 = minNOf(pm, minN, sc);
  const shipped = s.shipped || [], counts = s.counts || {};
  // A decision-log product (source "decisions": DECISIONS.md, ADRs) has no issue timeline to miss; a commit or PR
  // naming the decision is the complete explicit link, so nothing is withheld there.
  const counted = s.linkTypes || [], missing = s.source === "decisions" ? [] : AllLinks.filter(k => !counted.includes(k) && k !== "bet");
  const complete = !missing.length;
  const full = shipped.filter(x => !x.partly);
  const med = full.length >= n0 ? median(full.map(x => x.days)) : null;

  const stat = (b, t, cls = "") => `<div class="st"><b class="${cls}">${b}</b><span>${t}</span></div>`;
  const stats = [
    counts.requests != null ? stat(counts.requests, s.source === "decisions" ? "decisions made in the window" : "requests and decisions in the window") : "",
    complete ? stat(full.length, `shipped to <code>${esc(s.branch)}</code>, linked`, "ok")
             : stat("—", `shipped count withheld: ${missing.map(k => MissingLabel[k] || k).join(" and ")} aren't counted yet, so it would undercount`, "warn"),
    stat(med == null ? "—" : `${num(med)} d`, med == null ? `median time to ship: too few to say (needs ${n0}, have ${full.length})` : "median from opened to shipped"),
    counts.open != null ? stat(counts.open, s.source === "decisions" ? "decided, nothing landed yet" : "still open") : "",
  ].join("");

  const rec = s.recent || {};
  const recent = (rec.merged?.length || rec.close?.length) ? `<h2>Since ${day(rec.since)}</h2><div class="two">
<div><h3>Merged</h3>${rec.merged?.length ? `<ul>${rec.merged.map(p => `<li>#${p.n} ${esc(p.title)}${p.ref ? ` <span class="tag">${esc(p.ref)}</span>` : ""} <span class="m">${day(p.merged)}</span></li>`).join("")}</ul>` : `<p class="m">Nothing merged.</p>`}</div>
<div><h3>Close to merging</h3>${rec.close?.length ? `<ul>${rec.close.map(p => `<li>#${p.n} ${esc(p.title)}${p.ref ? ` <span class="tag">${esc(p.ref)}</span>` : ""} <span class="m">${esc(p.why)}</span></li>`).join("")}</ul>` : `<p class="m">Nothing waiting.</p>`}</div></div>` : "";

  // a decision's own measurement/success line (read-decisions.mjs's measurementOf),
  // shown next to the shipped row it belongs to — recorded, not scored (never a ✓/✗ on the line itself,
  // same rule as a bet's unchecked "expected outcome" below). When the line names a checkable event AND
  // shipped-record.mjs could cross-check it against scan-metrics.mjs's known event names, say so — an
  // exact-name fact, never a judgement call.
  const measureLine = x => {
    if (!x.measure?.line) return "";
    const ev = x.measure.event ? ` — event <code>${esc(x.measure.event.name)}</code> exists in code: ${x.measure.event.existsInCode ? "yes" : "no"}` : "";
    return `<br><span class="m">to check: ${esc(x.measure.line)}${ev}</span>`;
  };
  const rows = shipped.map(x => `<tr class="${x.partly ? "part" : ""}"><td><span class="ref">${esc(x.ref)}</span> ${esc(x.title)}${x.partly ? " <b>— partly</b>" : ""}<br><span class="tag">${(x.prs || []).map(p => `#${p.n}`).join(", ")} · ${esc(LinkLabel[x.link] || x.link)}</span>${measureLine(x)}</td><td>${esc(x.team || "—")}</td><td>${day(x.opened)}</td><td>${day(x.landed)}</td><td class="n">${num(x.days)}</td></tr>`).join("");
  const shippedSec = `<h2>Shipped</h2>${shipped.length ? `<div class="sc"><table><tr><th>What</th><th>Team</th><th>Opened</th><th>Shipped</th><th>Days</th></tr>${rows}</table></div>` : `<p class="m">Nothing linked shipped in this window.</p>`}`;

  // Where it went: requests per team (counts.byTeam, optional) against shipped per team.
  const byTeam = counts.byTeam || null;
  const teamSec = byTeam ? (() => {
    const got = {}; for (const x of full) got[x.team || "No team"] = (got[x.team || "No team"] || 0) + 1;
    const teams = Object.entries(byTeam).sort((a, b) => b[1] - a[1]);
    return `<h2>Where it went</h2><div class="sc"><table><tr><th>Team</th><th>Opened</th><th>Shipped</th></tr>${teams.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="n">${n}</td><td class="n">${got[t] || 0}</td></tr>`).join("")}</table></div>`;
  })() : "";

  const und = s.undecided || [];
  const undSec = und.length ? (() => {
    const per = {}; for (const u of und) per[u.team || "No team"] = (per[u.team || "No team"] || 0) + 1;
    const oldest = [...und].sort((a, b) => b.ageDays - a.ageDays).slice(0, 8);
    const cap = s.undecidedScope?.capped;
    return `<h2>Nobody has decided</h2><p>${cap ? "At least " : ""}${und.length} requests have no decision yet (open, ${s.undecidedScope?.minAge ?? 14}+ days, no assignee, milestone or decision label)${cap ? `; only the newest ${s.undecidedScope.read} open issues were read` : ""}: ${Object.entries(per).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)} ${n}`).join(" · ")}.</p>
<div class="sc"><table><tr><th>Oldest</th><th>Team</th><th>Waiting</th></tr>${oldest.map(u => `<tr><td><span class="ref">${esc(u.ref)}</span> ${esc(u.title)}</td><td>${esc(u.team || "—")}</td><td class="n">${u.ageDays} d</td></tr>`).join("")}</table></div>`;
  })() : "";

  // Decided but nothing landed yet (source "decisions"): the decision-log counterpart of "Nobody has decided".
  const wait = s.waiting || [];
  const waitSec = wait.length ? `<h2>Decided, nothing landed yet</h2><p>${wait.length} decisions from this window have no commit or PR on <code>${esc(s.branch)}</code> that names them.</p>
<div class="sc"><table><tr><th>Decision</th><th>Decided</th><th>Waiting</th></tr>${[...wait].sort((a, b) => b.ageDays - a.ageDays).map(w => `<tr><td><span class="ref">${esc(w.ref)}</span> ${esc(w.title)}</td><td>${day(w.opened)}</td><td class="n">${w.ageDays} d</td></tr>`).join("")}</table></div>` : "";

  const bets = (sc?.bets || []).filter(b => b.origin !== "backfill");
  const betSec = sc ? (() => {
    const settled = bets.filter(b => b.status !== "open" && b.status !== "dropped");
    const cal = sc.calibration && sc.calibration.n >= n0 ? sc.calibration : null;
    const calLine = cal ? `Estimates: ${cal.onTarget} of ${cal.n} on target, ${cal.under} took longer, ${cal.over} took less.`
                        : `Estimates: too few to say (${settled.length} settled, needs ${n0}).`;
    const outcome = b => b.expected ? (b.expectedChecked ? esc(b.expected) : `${esc(b.expected)} <span class="m">(not checked: no usage source)</span>`) : "—";
    // PR refs arrive as strings: "#12" when a PR number is known, else a short commit hash (N3).
    const pr = r => esc(typeof r === "number" ? `#${r}` : r);
    const after = b => [b.revertedBy ? `<b class="bad">reverted</b> by ${pr(b.revertedBy)}` : "", ...(b.patchedBy || []).map(r => `patched by ${pr(r)}`), ...(b.possibleFollowUps || []).map(r => `<span class="m">${pr(r)}: possible follow-up, check</span>`)].filter(Boolean).join("<br>") || "—";
    return `<h2>Bets</h2><p>${calLine}</p>${bets.length ? `<div class="sc"><table><tr><th>Bet</th><th>Estimate</th><th>Status</th><th>Actual</th><th>After landing</th><th>Expected outcome</th></tr>${bets.map(b => `<tr class="${b.openTooLong ? "late" : ""}"><td><span class="ref">${esc(b.id)}</span> ${esc(b.bet)}<br><span class="m">placed ${day(b.placed)}</span></td><td>${esc(b.estimate)}</td><td>${esc(StatusLabel[b.status] || b.status)}${b.openTooLong ? "<br><b class=\"warn\">open too long</b>" : ""}</td><td>${b.landed ? `${esc(b.actual || "—")} · ${num(b.days)} active d${b.calendarDays != null ? ` <span class="m">(${num(b.calendarDays)} calendar)</span>` : ""}` : "—"}</td><td>${after(b)}</td><td>${outcome(b)}</td></tr>`).join("")}</table></div>` : `<p class="m">No bets placed yet. <code>/nosy:bet</code> records one; its id goes in the PR.</p>`}`;
  })() : "";

  const cant = [
    missing.length ? `<li><b>Work linked only through ${missing.map(k => MissingLabel[k] || k).join(" or ")}.</b> Not counted this run, so some shipped work is missing from the list.</li>` : "",
    `<li><b>Work that shipped with no link at all.</b> Only explicit links count here (${s.source === "decisions" ? "a commit or PR that names the decision" : "a PR that closes or mentions the request, the issue's own timeline"}, a bet id). Nothing is guessed from titles.</li>`,
    `<li><b>Whether shipped work got used.</b> That needs your analytics; nothing is read from it.</li>`,
    (sc?.bets || []).some(b => b.origin === "backfill") ? `<li><b>Past work reconstructed from history</b> isn't mixed into the bets or the estimate score.</li>` : "",
  ].join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>What shipped · ${esc(s.repo)}</title>
<style>
:root{--bg:#FBFAF6;--ink:#1C2541;--muted:#5A6053;--line:#D3D7CC;--card:#fff;--red:#D7263D;--ok:#2F6B4F;--warn:#9A6A12}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121411;--ink:#E7EAE2;--muted:#9AA191;--line:#2E332A;--card:#1B1E19;--red:#F0566A;--ok:#8FC7A4;--warn:#E0B25C}}
:root[data-theme="dark"]{--bg:#121411;--ink:#E7EAE2;--muted:#9AA191;--line:#2E332A;--card:#1B1E19;--red:#F0566A;--ok:#8FC7A4;--warn:#E0B25C}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:920px;margin:0 auto;padding:28px 16px 64px}
h1{font:400 clamp(30px,6vw,46px)/1 Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif;text-transform:uppercase;margin:0 0 6px}
h2{font:400 22px/1.1 Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif;text-transform:uppercase;margin:36px 0 10px}
h2::before{content:"psst · ";color:var(--red);font:600 14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-transform:none;vertical-align:middle}
h3{font-size:14px;margin:0 0 6px}
.sub,.m{color:var(--muted)} .m{font-size:13px}
code,.ref,.n,.tag{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
.ref{font-size:12.5px} .tag{font-size:12px;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:20px}
.st{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px}
.st b{display:block;font:400 30px/1.1 Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif} .st span{color:var(--muted);font-size:13px}
.ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--red)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px} @media(max-width:640px){.two{grid-template-columns:1fr}}
.sc{overflow-x:auto} table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12.5px;white-space:nowrap} td.n{white-space:nowrap}
tr.part td{opacity:.75} tr.late td:first-child{border-left:3px solid var(--warn)}
ul{margin:0;padding-left:18px} li{margin:3px 0}
footer{margin-top:40px;color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>What shipped</h1>
<p class="sub">${esc(s.repo)} · ${day(s.window?.from)} – ${day(s.window?.to)} · branch <code>${esc(s.branch)}</code> · from git and explicit links only</p>
<div class="stats">${stats}</div>
${recent}
${shippedSec}
${teamSec}
${betSec}
${waitSec}
${undSec}
<h2>What this page can't tell you</h2><ul>${cant}</ul>
<footer>Built ${esc(new Date(s.generated || Date.now()).toISOString().slice(0, 10))} by Nosy. Nosy was here.</footer>
</main></body></html>`;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const i = a.indexOf("--min-n"); const minN = i >= 0 ? a.splice(i, 2)[1] : undefined;
  const [pm = "pm", out] = a;
  if (!out) { console.error("Usage: node scoreboard.mjs <pm folder> <out.html> [--min-n 5]"); process.exit(1); }
  try { fs.writeFileSync(out, page(pm, { minN })); console.log(`wrote ${out}`); }
  catch (e) { console.error(e.message); process.exit(1); }
}
