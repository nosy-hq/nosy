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
import { safeStatus, safeDiff, safeLowhanging, safeSummary, withoutIssueTitle, authorNames } from "../tools/publish-safe.mjs";

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
