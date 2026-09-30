// Contract test for skill/tools/scoreboard.mjs (wave N4). Inputs are hand-made shipped.json/score.json in the
// agreed shape; this test doesn't depend on the tools that produce them. Each rule from the kill-criteria
// evidence gets its own check: withheld headline count (83), "too few to say" (84), link labels / no guessing (72),
// the undecided section (85), bets with unscored outcomes and explicit-only patches (N3).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { page } from "../tools/scoreboard.mjs";

const dirs = [];
after(() => dirs.forEach(clean));

const item = (i, over = {}) => ({ ref: `#${100 + i}`, title: `Feature ${i}`, kind: "request", team: i % 2 ? "Alpha" : "Beta", opened: "2026-08-01", landed: "2026-08-11", days: 10 + i, prs: [{ n: 500 + i, title: `pr ${i}`, merged: "2026-08-11" }], link: "closes", partly: false, ...over });

function pmWith(shipped, score, sources) {
  const root = temporary("nosy-scoreboard-"); dirs.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const base = { repo: "acme/app", branch: "main", window: { from: "2026-07-01", to: "2026-09-28" }, generated: "2026-09-28T10:00:00Z", linkTypes: ["closes", "mentions", "timeline", "bet"], shipped: [], counts: { requests: 40, open: 30, closedNoLink: 2 } };
  fs.writeFileSync(path.join(pm, "state", "shipped.json"), JSON.stringify({ ...base, ...shipped }));
  if (score) fs.writeFileSync(path.join(pm, "state", "score.json"), JSON.stringify(score));
  if (sources) fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(sources));
  return pm;
}

test("complete links and enough items: headline count and median are shown", () => {
  const pm = pmWith({ shipped: Array.from({ length: 6 }, (_, i) => item(i)) });
  const h = page(pm, { minN: 5 });
  assert.match(h, /<b class="ok">6<\/b><span>shipped to <code>main<\/code>, linked/);
  assert.match(h, /12\.5 d<\/b><span>median from opened to shipped/); // days 10..15 → median 12.5
  assert.doesNotMatch(h, /withheld/);
});

test("timeline links not counted: headline shipped count is withheld and the page says why (83)", () => {
  const pm = pmWith({ linkTypes: ["closes", "mentions"], shipped: Array.from({ length: 6 }, (_, i) => item(i)) });
  const h = page(pm, { minN: 5 });
  assert.match(h, /shipped count withheld: links on the issue's own timeline or in comments aren't counted yet/);
  assert.doesNotMatch(h, /<b class="ok">6<\/b>/);
  assert.match(h, /Work linked only through links on the issue's own timeline or in comments/);
  assert.match(h, /#100<\/span> Feature 0/, "the list itself still shows");
});

test("fewer items than minN: median says 'too few to say' (84); partly-shipped rows don't count", () => {
  const pm = pmWith({ shipped: [item(0), item(1), item(2, { partly: true })] });
  const h = page(pm, { minN: 5 });
  assert.match(h, /median time to ship: too few to say \(needs 5, have 2\)/);
  assert.match(h, /<b class="ok">2<\/b>/);
  assert.match(h, /Feature 2 <b>— partly<\/b>/);
});

test("minN comes from sources.json threshold.minN when not given", () => {
  const pm = pmWith({ shipped: Array.from({ length: 3 }, (_, i) => item(i)) }, null, { threshold: { minN: 3 } });
  assert.match(page(pm), /median from opened to shipped/);
});

test("without an explicit or configured minN, score.json's own minN is used", () => {
  const h = page(pmWith({ shipped: Array.from({ length: 6 }, (_, i) => item(i)) }, { minN: 10, bets: [], calibration: null }));
  assert.match(h, /too few to say \(needs 10, have 6\)/);
});

test("every shipped row says how it was linked; no row without a link kind label", () => {
  const pm = pmWith({ shipped: [item(0, { link: "closes" }), item(1, { link: "mentions" }), item(2, { link: "timeline" }), item(3, { link: "bet", ref: "nb-260928-x" })] });
  const h = page(pm, { minN: 5 });
  for (const l of ["PR closes it", "PR mentions it", "linked from the issue", "bet id in PR/commit"]) assert.ok(h.includes(l), l);
  assert.match(h, /Nothing is guessed from titles/);
});

test("recent merged and close-to-merge render when present", () => {
  const pm = pmWith({ recent: { since: "2026-09-21", merged: [{ n: 9, title: "Fast path", merged: "2026-09-25", ref: "K12" }], close: [{ n: 10, title: "Slow path", ref: null, why: "approved, checks green" }] } });
  const h = page(pm);
  assert.match(h, /Since 21 Sept?/);
  assert.match(h, /#9 Fast path <span class="tag">K12<\/span>/);
  assert.match(h, /#10 Slow path <span class="m">approved, checks green<\/span>/);
});

test("bets: unscored outcome is labelled, explicit patches vs possible follow-ups, backfill hidden, calibration gated", () => {
  const score = { generated: "2026-09-28T10:00:00Z", minN: 10, calibration: null, bets: [
    { id: "nb-260901-export", bet: "Bulk export", estimate: "M", status: "landed", placed: "2026-09-01", landed: "2026-09-10", days: 9, actual: "M", revertedBy: null, patchedBy: ["#77"], possibleFollowUps: ["a1b2c3d4e"], origin: "placed", calendarDays: 12, openTooLong: false, expected: "fewer support tickets", expectedChecked: false },
    { id: "nb-260902-portal", bet: "Client portal", estimate: "S", status: "open", placed: "2026-09-02", landed: null, days: null, actual: null, revertedBy: null, patchedBy: [], possibleFollowUps: [], origin: "placed", openTooLong: true, expected: "", expectedChecked: false },
    { id: "nb-260101-old", bet: "Old backfilled thing", estimate: "S", status: "landed", placed: "2026-01-01", landed: "2026-01-05", days: 4, actual: "S", origin: "backfill" },
  ] };
  const h = page(pmWith({}, score), { minN: 10 });
  assert.match(h, /fewer support tickets <span class="m">\(not checked: no usage source\)<\/span>/);
  assert.match(h, /patched by #77/);
  assert.match(h, /a1b2c3d4e: possible follow-up, check/);
  assert.match(h, /M · 9 active d <span class="m">\(12 calendar\)<\/span>/);
  assert.match(h, /open too long/);
  assert.match(h, /Estimates: too few to say \(1 settled, needs 10\)/);
  assert.doesNotMatch(h, /Old backfilled thing/);
  assert.match(h, /Past work reconstructed from history/);
});

test("calibration shows only at or above minN", () => {
  const score = { bets: [], calibration: { n: 12, onTarget: 7, under: 4, over: 1 } };
  assert.match(page(pmWith({}, score), { minN: 10 }), /Estimates: 7 of 12 on target, 4 took longer, 1 took less\./);
  assert.match(page(pmWith({}, score), { minN: 20 }), /Estimates: too few to say/);
});

test("no score.json: no bets section; undecided section groups by team and lists the oldest", () => {
  const pm = pmWith({ undecided: [{ ref: "#7", title: "Dark mode", team: "Alpha", opened: "2026-07-01", ageDays: 89 }, { ref: "#8", title: "SSO", team: "Alpha", opened: "2026-08-01", ageDays: 58 }, { ref: "#9", title: "CSV", team: null, opened: "2026-09-01", ageDays: 27 }] });
  const h = page(pm);
  assert.doesNotMatch(h, /<h2>Bets<\/h2>/);
  assert.match(h, /3 requests have no decision yet \(open, 14\+ days, no assignee, milestone or decision label\): Alpha 2 · No team 1/);
  assert.ok(h.indexOf("Dark mode") < h.indexOf("SSO"), "oldest first");
});

test("capped undecided read says 'at least' and how many were read", () => {
  const h = page(pmWith({ undecided: [{ ref: "#7", title: "X", team: null, opened: "2026-07-01", ageDays: 89 }], undecidedScope: { read: 1000, capped: true, minAge: 14 } }));
  assert.match(h, /At least 1 requests have no decision yet .*only the newest 1000 open issues were read/);
});

test("decision-log source: nothing withheld without timeline links; commit label; decided-not-landed section", () => {
  const pm = pmWith({ source: "decisions", linkTypes: ["commit"], shipped: [item(0, { ref: "K12", link: "commit" })], counts: { requests: 3, open: 2 },
    waiting: [{ ref: "K13", title: "Portal", opened: "2026-09-01", ageDays: 27 }, { ref: "K14", title: "Redline", opened: "2026-08-01", ageDays: 58 }] });
  const h = page(pm, { minN: 5 });
  assert.doesNotMatch(h, /withheld/);
  assert.match(h, /<b class="ok">1<\/b>/);
  assert.match(h, /commit names it/);
  assert.match(h, /decisions made in the window/);
  assert.match(h, /Decided, nothing landed yet<\/h2><p>2 decisions/);
  assert.ok(h.indexOf("Redline") < h.indexOf("Portal"), "longest wait first");
  assert.match(h, /a commit or PR that names the decision/);
});

test("titles are escaped", () => {
  const h = page(pmWith({ shipped: [item(0, { title: "<script>x</script>" })] }));
  assert.ok(!h.includes("<script>x</script>"));
  assert.ok(h.includes("&lt;script&gt;x&lt;/script&gt;"));
});

test("CLI: writes the page; exits 1 when shipped.json is missing", () => {
  const pm = pmWith({ shipped: [item(0)] });
  const out = path.join(path.dirname(pm), "page.html");
  const ok = run(path.join(Tool, "scoreboard.mjs"), [pm, out]);
  assert.equal(ok.code, 0, ok.error);
  assert.match(fs.readFileSync(out, "utf8"), /<title>What shipped · acme\/app<\/title>/);
  fs.rmSync(path.join(pm, "state", "shipped.json"));
  const bad = run(path.join(Tool, "scoreboard.mjs"), [pm, out]);
  assert.equal(bad.code, 1);
  assert.match(bad.error, /shipped\.json is missing/);
});
