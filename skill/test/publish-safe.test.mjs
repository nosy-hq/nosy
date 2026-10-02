// `nosy publish` sends counts and structure, never quotes; it is opt-in (a configured target, and a yes); and a secret or
// personal data stops it unless --allow-sensitive is given. A local HTTP server stands in for Nosy Cloud; no real network.
// The fake repo history below is made of obviously fake people and titles.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";
import { safeStatus, safeDiff, safeLowhanging, safePsstFinal, finalIsCurrent, safeSummary, safeRuns, safeGlance, withoutIssueTitle, authorNames, branchNames, PayloadKeys } from "../tools/publish-safe.mjs";

const PUBLISH = path.join(Tool, "publish.mjs");
let tmp, pm, server, url, got;
const run = (args, env = {}) => new Promise(resolve => {
  const c = spawn(process.execPath, [PUBLISH, ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  c.stdout.on("data", d => (output += d)); c.stderr.on("data", d => (error += d));
  c.on("close", code => resolve({ code, output, error }));
});
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v, null, 1)); };

const SUBJECT = "feat: sparkle-widget for the zebra dashboard", AUTHOR = "Quincy Testperson", PR_TITLE = "Fix the flurbo export", ISSUE_TITLE = "Flurbo export crashes for Wendell";
const STATUS = { type: "state", generated: "2026-09-29T20:00:00Z", range: "--since 2026-09-22 main", main: 3, pr: 1, lastMain: "abc1234",
  prs: [{ n: 9, t: PR_TITLE, a: AUTHOR, draft: false, count: 1, last: "09.29" }],
  localBranches: [{ branch: "side/x", ahead: 1, last: "09.29", author: AUTHOR, subject: SUBJECT, refs: ["K7"] }],
  groups: [{ ref: "K7", n: 2, where: ["main"], who: [AUTHOR, "Rae Fakename"], last: "09.29 10:00 AM", topic: SUBJECT }, { ref: "(no ref)", n: 1, where: ["main"], who: [AUTHOR], last: "09.28", topic: "chore: tidy" }] };
const DIFF = { type: "diff", generated: "2026-09-29T20:00:00Z", previous: "a", current: "b", pendingOnes: [{ title: "Internal wave title", work: 2, day: 3, source: "decisions" }], hiddenOnes: 4,
  changes: [
    { area: "state", type: "fresh", severity: "medium", title: `K7: ${SUBJECT}`, detail: `2 commits · main · ${AUTHOR}`, reason: "First time a commit was seen for this reference.", source: "K7" },
    { area: "state", type: "fresh", severity: "medium", title: `PR #9 opened: ${PR_TITLE}`, detail: `${AUTHOR} · 1 commits`, reason: "New open PR.", source: "#9" },
    { area: "state", type: "changed", severity: "high", title: "K7: landed on main", detail: SUBJECT, reason: "Used to only be in an open PR.", source: "K7" },
    { area: "psst", type: "fresh", severity: "medium", title: `#12 ${ISSUE_TITLE}`, detail: "score 2 · Issue opened against us", reason: "A new low-hanging item.", source: `${AUTHOR} · 2026-09-29` },
    { area: "signal", type: "fresh", severity: "medium", title: "New theme: wendell zebra", detail: "3 records", reason: "New.", source: "signals.json" },
    { area: "matrix", type: "changed", severity: "low", title: "Rival One × Step", detail: "n → y", reason: "Changed.", source: "matrix.json" }] };
const LOW = { type: "lowHanging", generated: "2026-09-29T20:00:00Z", ref: "main", superseded_note: "x", risk_note: "y", demand: { goals: 1 }, items: [
  { score: 2, effort: "M", type: "Issue opened against us", title: `#12 ${ISSUE_TITLE}`, evidence: `wendell-login · 2026-09-29`, detail: ["3 items"], ref: "#12", demand: { count: 4 } },
  { score: 1, effort: "S", type: "Shipped, not tied to any plan", title: "web · 2 features in the last 30 days", evidence: `abc1234 ${SUBJECT}`, detail: [`2026-09-28 abc1234 ${SUBJECT}`], ref: null },
  { score: 3, effort: "S", type: "Backend ready, not on screen", title: "orders · 3 fields", evidence: "api/orders.go:10", detail: ["Total"], ref: null }] };

before(async () => {
  tmp = temporary("nosy-publish-safe-");
  pm = path.join(tmp, "cargo", "pm");
  write(path.join(pm, "matrix.json"), { steps: [{ no: "1", name: "Setup" }], biz: { name: "Cargo", codes: { 1: "y" } }, products: [] });
  write(path.join(pm, "state", "status.json"), STATUS);
  write(path.join(pm, "state", "diff.json"), DIFF);
  write(path.join(pm, "state", "lowhanging.json"), LOW);
  write(path.join(pm, "summary.md"), "## Summary · week\n\n- Two things shipped.\n\n## Older section\n\n- This second section stays home.\n");
  write(path.join(pm, "history", "runs.jsonl"), '{"zaman":"2026-09-29T20:00:00Z","label":"weekly","ref":"main","lastMain":"abc1234","numbers":{"group":2}}\n');
  server = http.createServer((req, res) => {
    let body = ""; req.on("data", d => (body += d));
    req.on("end", () => { got = { url: req.url, body: JSON.parse(body || "{}") }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, url: "http://cloud/p/me/cargo" })); });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); server.unref();
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); clean(tmp); });

test("unit: status keeps the shape Cloud reads and turns words into counts", () => {
  const S = safeStatus(STATUS);
  assert.deepEqual(Object.keys(S).sort(), ["generated", "groups", "lastMain", "main", "pr", "range", "type"]);
  assert.deepEqual(S.groups[0], { ref: "K7", n: 2, where: ["main"], last: "09.29 10:00 AM", who: ["2 authors"], topic: "2 commits" });
  assert.equal(S.groups[1].who[0], "1 author");
  const text = JSON.stringify(S);
  for (const w of [SUBJECT, AUTHOR, "Fakename", PR_TITLE]) assert.ok(!text.includes(w), `${w} must not survive`);
});

test("unit: diff and list drop commit subjects, author names, PR titles, issue titles and the fields Cloud does not read", () => {
  const D = safeDiff(DIFF), text = JSON.stringify(D);
  for (const w of [SUBJECT, AUTHOR, PR_TITLE, ISSUE_TITLE, "wendell", "Internal wave title", "signals.json"]) assert.ok(!text.includes(w), `${w} must not survive in the diff`);
  assert.deepEqual(D.changes.map(c => c.title), ["K7: first commit seen", "PR #9 opened", "K7: landed on main", "#12", "New theme in the demand data", "Rival One × Step"]);
  assert.equal(D.changes[0].detail, "2 commits · main");
  assert.equal(D.changes[1].detail, "1 commit");
  assert.deepEqual(Object.keys(D.changes[0]).sort(), ["area", "detail", "reason", "severity", "title", "type"]);
  const L = safeLowhanging(LOW), lt = JSON.stringify(L);
  for (const w of [SUBJECT, ISSUE_TITLE, "wendell", "risk_note", "abc1234"]) assert.ok(!lt.includes(w), `${w} must not survive in the list`);
  assert.equal(L.items[0].title, "#12"); assert.equal(L.items[0].evidence, "2026-09-29");
  assert.equal(L.items[2].title, "orders · 3 fields", "your own structural items stay");
});

test("unit: the summary keeps only the first section; issue titles reduce to #N; author names come from the shipped record", () => {
  assert.equal(safeSummary("## A\n- one\n\n## B\n- two\n"), "## A\n- one\n");
  assert.equal(withoutIssueTitle("#7 Something is broken"), "#7");
  assert.equal(withoutIssueTitle("PR #7 Something"), "PR #7");
  assert.equal(withoutIssueTitle("Plain title"), "Plain title");
  assert.deepEqual(authorNames(pm).sort(), [AUTHOR, "Rae Fakename"].sort());
});

test("publish: what arrives is counts and structure (no subject, name, PR title or issue title anywhere in the request)", async () => {
  got = null;
  const r = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.error);
  const all = JSON.stringify(got.body);
  for (const w of [SUBJECT, AUTHOR, "Fakename", PR_TITLE, ISSUE_TITLE, "Internal wave title", "This second section stays home"]) assert.ok(!all.includes(w), `${w} must not be sent`);
  const st = JSON.parse(got.body.files["pm/state/status.json"]);
  assert.equal(st.groups[0].topic, "2 commits");
  assert.ok(!("prs" in st) && !("localBranches" in st));
  const gl = JSON.parse(got.body.files["pm/state/glance.json"]);
  assert.ok(!JSON.stringify(gl).includes(SUBJECT));
});

test("publish is opt-in: no configured target, nothing is sent; dry run says so and still lists what would go", async () => {
  got = null;
  const real = await run([pm, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(real.code, 1);
  assert.match(real.error, /no target configured/);
  const dry = await run([pm, "--dry-run"]);
  assert.equal(dry.code, 0, dry.error);
  assert.match(dry.output, /Would publish \d+ file\(s\) to \(no target configured\)/);
  assert.match(dry.output, /pm\/state\/status\.json .*N authors/);
  assert.match(dry.output, /no commit subjects, author names, PR titles, issue titles or customer quotes/);
  assert.equal(got, null);
  // a target in pm/sources.json counts as configured
  const cfg = path.join(tmp, "cfg", "pm"); fs.cpSync(pm, cfg, { recursive: true });
  write(path.join(cfg, "sources.json"), { cloud: { url } });
  const viaFile = await run([cfg, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(viaFile.code, 0, viaFile.error);
  assert.ok(got, "cloud.url in sources.json is a configured target");
});

test("publish needs a yes: without --yes and without a terminal, it stops and sends nothing", async () => {
  got = null;
  const r = await run([pm, "--url", url], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 1);
  assert.match(r.error, /needs your yes/);
  assert.equal(got, null);
});

test("--dry-run --full prints the payload itself", async () => {
  const r = await run([pm, "--url", url, "--dry-run", "--full"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /--- pm\/state\/status\.json ---/);
  assert.match(r.output, /"topic": "2 commits"/);
  assert.ok(!r.output.includes(SUBJECT));
});

test("personal data blocks a send: an e-mail alone stops it, and --allow-sensitive is the way through", async () => {
  const mail = path.join(tmp, "mail", "pm"); fs.cpSync(pm, mail, { recursive: true });
  write(path.join(mail, "summary.md"), "## Summary\n\n- Ask jamie.fakeperson@mailbox.invalid about the export.\n");
  got = null;
  const stop = await run([mail, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(stop.code, 1);
  assert.match(stop.error, /E-mail/);
  assert.match(stop.error, /stop a send/);
  assert.match(stop.error, /--allow-sensitive/);
  assert.equal(got, null, "nothing may be sent");
  const through = await run([mail, "--url", url, "--yes", "--allow-sensitive"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(through.code, 0, through.error);
  assert.match(through.error, /sending although the scan found/);
  assert.ok(got, "with the override it goes");
});

test("a phone number, an IBAN and a person's name in free text stop a send too", async () => {
  for (const [what, line] of [["phone", "Call +44 7700 900123 today."], ["iban", "Account GB82 WEST 1234 5698 7654 32 for refunds."], ["name", `${AUTHOR} wrote this part.`]]) {
    const d = path.join(tmp, `p-${what}`, "pm"); fs.cpSync(pm, d, { recursive: true });
    write(path.join(d, "summary.md"), `## Summary\n\n- ${line}\n`);
    got = null;
    const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
    assert.equal(r.code, 1, `${what}: ${r.error}`);
    assert.equal(got, null, `${what}: nothing may be sent`);
  }
});

test("the summary's second section is never scanned or sent (only the first goes)", async () => {
  const d = path.join(tmp, "second", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "summary.md"), "## Summary\n\n- fine\n\n## Later\n\n- write to jamie.fakeperson@mailbox.invalid\n");
  got = null;
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.error);
  assert.ok(!got.body.files["pm/summary.md"].includes("jamie"));
});

// ---- honest labels, the checked list, the held items ----
// First run on a real product: "307 open PRs" (really 2), items the owner had held or the refuter had dropped under "Could come next".
const BRANCH = "side/quincy-secret-branch", CHECKED_AT = "src/zebra/secret-path.go:42", DROPPED = "Dropped zebra idea nobody should read";
const FINAL = { type: "psstFinal", generated: "2026-09-30T10:00:00Z", stats: { drafted: 4, stands: 1, weakened: 1, refuted: 2, precision: 0.25, fromList: 2, fromReading: 0 },
  items: [
    { id: 1, title: "orders · 3 fields", claim: "the long claim", size: "S", type: "Backend ready, not on screen", evidence: ["api/orders.go:10"], receipt: 3, verdict: "stands", checked: [CHECKED_AT] },
    { id: 2, title: `#12 ${ISSUE_TITLE}`, claim: "c", size: "M", size_before: "S", type: "Issue opened against us", evidence: [`${AUTHOR} · 2026-09-29`], receipt: 1, verdict: "weakened", fix: `M: partly on ${BRANCH}`, why: `${AUTHOR} wrote it on ${BRANCH}`, checked: [CHECKED_AT] }],
  dropped: [{ id: 3, title: DROPPED, why: `already on ${BRANCH}`, checked: [CHECKED_AT] }] };
const RECEIPTS = { type: "receipts", ref: "main", items: [
  { rank: 1, type: "Issue opened against us", title: `#12 ${ISSUE_TITLE}`, gate: null },
  { rank: 3, type: "Backend ready, not on screen", title: "Orders · 3 Fields", gate: { held: true, because: [{ at: "api/orders.go:9", refs: ["#385"], decisions: [] }] } },
  { rank: 2, type: "Shipped, not tied to any plan", title: "web · 2 features in the last 30 days", gate: null }] };

test("unit: status carries the honest PR numbers when it has them, and stays as it was when it does not", () => {
  const S = safeStatus({ ...STATUS, pr: 307, prCommits: 17, openPrs: 2 });
  assert.deepEqual([S.pr, S.prCommits, S.openPrs], [307, 17, 2]);
  assert.equal(safeStatus({ ...STATUS, openPrs: null }).openPrs, null, "gh could not be read: null stays null, never a made-up 0");
  assert.ok(!("prCommits" in safeStatus(STATUS)) && !("openPrs" in safeStatus(STATUS)), "an older status file adds nothing");
  assert.match(PayloadKeys["pm/state/status.json"], /pr \(commits on open PRs plus merges on main, not a PR count\), prCommits, openPrs/);
});

test("unit: the raw list leaves out what the receipts hold on purpose, and says how many (leftOut)", () => {
  const L = safeLowhanging(LOW, RECEIPTS);
  assert.equal(L.leftOut, 1);
  assert.deepEqual(L.items.map(i => i.title), ["#12", "web · 2 features in the last 30 days"], "matched by title, case does not matter");
  assert.equal(safeLowhanging(LOW).leftOut, 0);
  assert.equal(safeLowhanging(LOW).items.length, 3, "without receipts nothing is dropped: it cannot know");
  assert.equal(safeLowhanging(LOW, { items: [{ title: "orders · 3 fields", gate: { held: false } }, { title: "web · 2 features in the last 30 days", gate: null }] }).leftOut, 0, "only gate.held counts");
  assert.equal(safeLowhanging(LOW, { oops: true }).items.length, 3, "a receipts file in an unexpected shape drops nothing");
});

test("unit: the checked list leaves as title, size, type, verdict and evidence; never the check lists, dropped titles, free text, receipts or branches", () => {
  const F = safePsstFinal(FINAL), text = JSON.stringify(F);
  assert.deepEqual(Object.keys(F).sort(), ["generated", "items", "stats", "type"]);
  assert.deepEqual(F.stats, { drafted: 4, stands: 1, weakened: 1, refuted: 2 }, "only counts");
  assert.deepEqual(F.items[0], { title: "orders · 3 fields", size: "S", type: "Backend ready, not on screen", verdict: "stands", evidence: ["api/orders.go:10"] }, "evidence references as written");
  assert.deepEqual(F.items[1], { title: "#12", size: "M", type: "Issue opened against us", verdict: "weakened", evidence: ["2026-09-29"] }, "an issue title reduces to #N and its author goes");
  for (const w of [CHECKED_AT, DROPPED, BRANCH, AUTHOR, ISSUE_TITLE, "long claim", "receipt", "dropped", "checked\""]) assert.ok(!text.includes(w), `${w} must not leave`);
  assert.deepEqual(safePsstFinal({ items: [{ title: "x", type: "Shipped, not tied to any plan", evidence: [`abc1234 ${SUBJECT}`] }] }).items[0].evidence, [], "commit subjects never leave");
  assert.match(PayloadKeys["pm/state/psst-final.json"], /no file:line check lists, no dropped titles, no receipts/);
});

test("unit: the checked list counts as current only when it is as new as the raw list", () => {
  const d = path.join(tmp, "fresh-check", "pm"); const st = f => path.join(d, "state", f);
  write(st("lowhanging.json"), { ...LOW, generated: "2026-09-30T09:00:00Z" });
  assert.equal(finalIsCurrent(d), false, "no checked list yet");
  write(st("psst-final.json"), { ...FINAL, generated: "2026-09-30T10:00:00Z" });
  assert.equal(finalIsCurrent(d), true, "newer");
  write(st("psst-final.json"), { ...FINAL, generated: "2026-09-30T09:00:00Z" });
  assert.equal(finalIsCurrent(d), true, "as new as");
  write(st("psst-final.json"), { ...FINAL, generated: "2026-09-30T08:59:59Z" });
  assert.equal(finalIsCurrent(d), false, "older than the list it checked");
  fs.rmSync(st("lowhanging.json"));
  assert.equal(finalIsCurrent(d), true, "no raw list at all: the checked one stands");
});

test("publish: a current checked list goes (cut down), the held item is left out of the raw list, and the notes say both", async () => {
  const d = path.join(tmp, "checked", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "state", "lowhanging.json"), { ...LOW, generated: "2026-09-30T09:00:00Z" });
  write(path.join(d, "state", "psst-final.json"), FINAL);
  write(path.join(d, "state", "receipts.json"), RECEIPTS);
  got = null;
  const dry = await run([d, "--url", url, "--dry-run"]);
  assert.match(dry.output, /pm\/state\/psst-final\.json .*after the refuter checked it/);
  assert.match(dry.output, /1 item on the list is held on purpose \(pm\/state\/receipts\.json\), so it was left out of the list sent\./);
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.error);
  assert.ok("pm/state/psst-final.json" in got.body.files);
  const sent = JSON.stringify(got.body);
  for (const w of [CHECKED_AT, DROPPED, BRANCH, AUTHOR, ISSUE_TITLE]) assert.ok(!sent.includes(w), `${w} must not be sent`);
  assert.equal(JSON.parse(got.body.files["pm/state/lowhanging.json"]).leftOut, 1);
  assert.ok(!JSON.parse(got.body.files["pm/state/lowhanging.json"]).items.some(i => i.title === "orders · 3 fields"), "the held item is not in the raw list that is sent");
  assert.deepEqual(JSON.parse(got.body.files["pm/state/psst-final.json"]).items.map(i => i.title), ["orders · 3 fields", "#12"]);
});

test("publish: a checked list older than the raw list is not sent, and the note says to run psst again", async () => {
  const d = path.join(tmp, "stale-check", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "state", "lowhanging.json"), { ...LOW, generated: "2026-09-30T11:00:00Z" });
  write(path.join(d, "state", "psst-final.json"), FINAL);
  got = null;
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.error);
  assert.ok(!("pm/state/psst-final.json" in got.body.files), "stale: left out, so the dashboard shows the raw list");
  assert.match(r.output, /psst-final\.json is older than pm\/state\/lowhanging\.json, so it is not sent .* run psst again/);
});

test("publish: a name in the checked list stops the send like anywhere else (the scan covers the new file)", async () => {
  const d = path.join(tmp, "named-check", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "state", "psst-final.json"), { ...FINAL, items: [{ title: `${AUTHOR} should look at orders`, size: "S", type: "x", verdict: "stands", evidence: [] }] });
  got = null;
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 1, r.error);
  assert.equal(got, null, "nothing may be sent");
});

// ---- review of the 2 Oct 2026 change set ----
test("unit: a signal change keeps its count and loses the customer who rode along in the detail", () => {
  const D = safeDiff({ type: "diff", changes: [
    { area: "signal", type: "fresh", severity: "medium", title: "Acme Corp wants SSO", detail: "2 requests · Acme Corp", reason: "New demand target.", source: "signals.json" },
    { area: "signal", type: "changed", severity: "medium", title: "Acme Corp wants SSO", detail: "2 → 5 requests (+3)", reason: "Demand went up." }] });
  assert.deepEqual(D.changes.map(c => [c.title, c.detail]), [["New demand target", "2 requests"], ["Demand target changed", "2 → 5 requests (+3)"]]);
});

test("unit: the checked list as psst writes it (no `type`): an issue's words, a login and a commit subject do not ride along; references do", () => {
  const F = safePsstFinal({ generated: "g", stats: { drafted: 2, stands: 2 }, items: [
    { id: 1, title: "#44 Customer says export is slow", size: "S", evidence: ["src/export.ts:12", "octocat · 2026-09-30", "abc1234 fix: customer words", "side/branch-name", "pm/request.md §5"], verdict: "stands", checked: ["x"], fix: "y", why: "z", claim: "c" },
    { id: 2, title: "Plain title", size: "M", evidence: "api/a.go:3-9", verdict: "weakened" }] });
  assert.equal(F.items[0].title, "#44");
  assert.deepEqual(F.items[0].evidence, ["src/export.ts:12", "2026-09-30", "pm/request.md §5"]);
  assert.deepEqual(F.items[1].evidence, ["api/a.go:3-9"]);
  assert.deepEqual(Object.keys(F.items[0]).sort(), ["evidence", "size", "title", "type", "verdict"]);
});

test("unit: the first screen loses the decision's why; the shipped record's open-PR cap passes through", () => {
  assert.equal(safeGlance({ decision: { title: "#7 Words", why: "corrected: on side/x", checked: true, checks: [] }, tiles: [] }).decision.why, "");
  assert.equal(safeStatus({ groups: [], openPrs: 30, openPrsCapped: true, prCommits: 4 }).openPrsCapped, true);
  assert.ok(!("openPrsCapped" in safeStatus({ groups: [], openPrs: 2 })));
});

test("unit: run history keeps five fields and numbers only; branch names are the owner's unmerged ones, shaped like a branch", () => {
  assert.equal(safeRuns('{"zaman":"z","label":"l","ref":"main","lastMain":null,"folder":"f","extra":"x","numbers":{"a":1,"b":"two"}}\nnot json\n'), '{"zaman":"z","label":"l","ref":"main","lastMain":null,"numbers":{"a":1}}\n');
  assert.equal(safeRuns(""), "");
  const d = temporary("nosy-names-"); const q = path.join(d, "pm"); fs.mkdirSync(path.join(q, "state", "facts"), { recursive: true });
  fs.writeFileSync(path.join(q, "state", "facts", "branches.json"), JSON.stringify({ branches: [{ branch: "side/pricing", author: "Dana Branch" }, { branch: "origin/main" }, { branch: "release" }, { branch: "fix-login-flow" }, { branch: "wip" }, { branch: "a/b" }] }));
  fs.writeFileSync(path.join(q, "state", "receipts.json"), JSON.stringify({ items: [{ local: [{ branch: "side/receipt-one", author: "Quill Receiptman" }], edits: [{ branch: "side/edits" }] }] }));
  try {
    assert.deepEqual(branchNames(q).sort(), ["fix-login-flow", "side/edits", "side/pricing", "side/receipt-one"].sort());
    assert.deepEqual(authorNames(q).sort(), ["Dana Branch", "Quill Receiptman"]);
  } finally { clean(d); }
});

test("unit: a summary keeps nothing from before its first heading; a file with no heading is cut to 40 lines", () => {
  assert.equal(safeSummary("preamble\n- stray bullet\n## A\n- one\n## B\n- two\n"), "## A\n- one\n");
  assert.equal(safeSummary("\uFEFF## A\n- one\n"), "## A\n- one\n");
  assert.equal(safeSummary(Array.from({ length: 90 }, (_, i) => `l${i}`).join("\n")).split("\n").filter(Boolean).length, 40);
});
