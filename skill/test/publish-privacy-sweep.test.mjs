// The privacy sweep for `nosy publish` ("Nosy about your product. Never your data").
// A synthetic product whose pm/ holds EVERYTHING sensitive, each secret planted as a unique marker string: branch names, commit
// subjects, author names, issue and PR titles, a customer's name and quote, the refuter's notes (`checked`, `fix`, `why`, the `dropped`
// list), local-work text, a decision, a person's name in a to-do. Then the real tool runs against it, a dry run with --full and a real send
// to a local HTTP server that records the body (no network), and by test:
//   - no planted secret reaches the payload (the JSON body, every file in it, the dry run's printout, anything left on disk);
//   - what is meant to be sent IS sent (so the test cannot pass by sending nothing);
//   - the privacy scan still stops what it should (an e-mail, a key, a commit author's name in the text that leaves);
//   - `--dry-run --full` prints exactly what the real send sends.
// Planted markers look like `zq-<name>`; they are not words anyone would put on a public page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";

const PUBLISH = path.join(Tool, "publish.mjs");
let tmp, pm, home, sandbox, server, url, got;

const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v, null, 1)); };
// Async child: spawnSync would block the in-process server. TMPDIR is a private folder, so a temp file the tool leaves behind can be seen.
const run = (args, env = {}) => new Promise(resolve => {
  const c = spawn(process.execPath, [PUBLISH, ...args], { env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  c.stdout.on("data", d => (output += d)); c.stderr.on("data", d => (error += d));
  c.on("close", code => resolve({ code, output, error }));
});
const tree = dir => { const out = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(`${path.relative(dir, p)}:${fs.statSync(p).size}:${fs.statSync(p).mtimeMs}`); } })(dir); return out.sort(); };

// ---- what must never leave: one marker each ----
const S = {
  branchStatus: "side/zq-branch-status", branchReceipt: "side/zq-branch-receipt", branchFacts: "side/zq-branch-facts", branchFix: "side/zq-branch-fix",
  authorPr: "zqauthorpr", authorBranch: "Zelda Quillbranch", authorOne: "Zorba Quendar", authorTwo: "Ines Vaughn", authorReceipt: "Quill Receiptman", authorFacts: "Factor Authorson",
  commitOne: "zq-commit-subject-one", commitLanded: "zq-landed-subject", commitShipped: "zq-shipped-subject", localSubject: "zq-local-subject", receiptSubject: "zq-receipt-subject", factsSubject: "zq-facts-subject",
  prTitle: "zq-pr-title", issueTitle: "zq-issue-title", issueAuthor: "zqissueauthor", ghIssueTitle: "zq-gh-issue-title",
  customer: "zq-customer-acme", quote: "zq-customer-quote", theme: "zq-theme-word",
  checkedOne: "zq-checked-note-one", checkedTwo: "zq-checked-note-two", claim: "zq-claim-text", fix: "zq-fix-text", why: "zq-why-text",
  droppedTitle: "zq-dropped-title", droppedWhy: "zq-dropped-why", droppedChecked: "zq-dropped-checked", heldTitle: "zq-held-title", receiptCode: "zq-receipt-code-line",
  decision: "zq-decision-text", decisionSummary: "zq-decision-summary", request: "zq-request-text", rivalNote: "zq-rival-internal-note", laterSummary: "zq-later-summary-section",
  todoTitle: "zq-todo-title", todoPerson: "Zelda Todoperson", demandExample: "zq-demand-example", matrixNot: "zq-matrix-private-not", teamNote: "zq-team-private-note",
};
// What IS meant to be sent (the product's own structure): proves the pipeline carried data, so "nothing leaked" is not "nothing sent".
const OWN = { rowOne: "Export data", rowTwo: "Share links", rival: "RivalOne", listItem: "Bulk import", decided: "Not for this audience", price: "$10 per seat", teamItem: "Own team list item" };

const STATUS = { type: "state", generated: "2026-10-01T20:00:00Z", range: "--since 2026-09-22 00:00 origin/main", main: 12, pr: 5, prCommits: 3, openPrs: 2, lastMain: "abc1234",
  prs: [{ n: 7, t: S.prTitle, a: S.authorPr, draft: false, count: 2, last: "09.30 10:00 AM" }],
  localBranches: [{ branch: S.branchStatus, ahead: 3, last: "09.30 09:00 AM", author: S.authorBranch, subject: S.localSubject, refs: ["K1"] }], noRemote: false,
  groups: [{ ref: "#12", n: 3, where: ["main", "#7"], who: [S.authorOne, S.authorTwo], last: "09.30 10:00 AM", topic: `${S.commitOne}: fix export` },
    { ref: "K5", n: 1, where: ["main"], who: [S.authorOne], last: "09.29 10:00 AM", topic: "K5: second one" }] };
const LOW = { type: "lowHanging", generated: "2026-10-01T10:00:00Z", ref: "main", items: [
  { score: 5, effort: "S", type: "Issue opened against us", title: `#321 ${S.issueTitle} login broken`, evidence: `${S.issueAuthor} · 2026-09-30`, detail: ["3 items"], ref: "#321", demand: { customers: [S.customer] } },
  { score: 4, effort: "S", type: "Shipped, not tied to any plan", title: "billing · 3 features in the last 14 days", evidence: `abc1234 ${S.commitShipped}`, detail: [`2026-09-30 abc1234 ${S.commitShipped}`, "Plan gate example: x"], ref: null },
  { score: 6, effort: "M", type: "Matrix: backend ready", title: OWN.listItem, evidence: "the owner's own note", detail: [], ref: null },
  { score: 3, effort: "S", type: "Matrix: backend ready", title: S.heldTitle, evidence: "held on purpose", detail: [], ref: null }] };
const RECEIPTS = { ref: "main", localWork: { checked: true }, items: [
  { rank: 1, title: S.heldTitle, gate: { held: true, because: [{ at: "src/held.ts:4", refs: ["#385"], decisions: [] }] },
    local: [{ branch: S.branchReceipt, author: S.authorReceipt, ahead: 2, date: "2026-09-30", hit: ["a.ts"], where: "written locally, not on origin, no PR", subject: S.receiptSubject }],
    code: [{ at: "src/held.ts:4", text: [S.receiptCode] }], decisions: [{ no: "K9", date: "2026-09-01", at: "decisions.md:3" }] }] };
// psst-final.json as psst-refute.mjs apply writes it: the draft items (id, title, claim, size, evidence, receipt) plus verdict, checked, fix, why; and `dropped`.
const FINAL = { type: "psstFinal", generated: "2026-10-01T12:00:00Z", stats: { drafted: 3, stands: 1, weakened: 1, refuted: 1, precision: 0.33, fromList: 2, fromReading: 0 }, items: [
  { id: 1, title: OWN.listItem, claim: S.claim, size: "S", evidence: ["src/import.ts:12"], receipt: 1, verdict: "stands", checked: [`${S.checkedOne} at src/import.ts:12`] },
  { id: 2, title: OWN.rowTwo, claim: S.claim, size: "M", size_before: "S", evidence: ["src/share.ts:3"], receipt: null, verdict: "weakened", fix: `M: ${S.fix}, already written on ${S.branchFix}`, why: S.why, checked: [S.checkedTwo] }],
  dropped: [{ id: 3, title: S.droppedTitle, claim: S.claim, size: "S", evidence: ["src/x.ts:1"], receipt: null, why: S.droppedWhy, checked: [S.droppedChecked] }] };
const WAVES = { generated: "2026-10-01T13:00:00Z", waves: [{ name: "Now", tasks: [
  { title: OWN.rowTwo, effort: "M", checked: "weakened", reason_now: `checked by psst (corrected: M: ${S.fix}, already written on ${S.branchFix}) · src/share.ts:3` }] }],
  owner_decision_of: [],
  outside: [{ title: S.droppedTitle, reason: `refuted after checking: ${S.droppedWhy}`, source: "psst refuter" },
    { title: "An old idea", reason: `decision: ${S.decisionSummary}`, source: "decisions.md" },
    { title: "Another idea", reason: `matrix: decided not doing — ${S.matrixNot}`, source: "matrix.json" }] };
const DIFF = { type: "diff", generated: "2026-10-01T20:00:00Z", previous: "2026-09-28", current: "2026-10-01", changes: [
  { area: "state", type: "fresh", severity: "medium", title: `PR #7 opened: ${S.prTitle}`, detail: `${S.authorPr} · 2 commits`, reason: "New open PR; the content isn't on main yet.", source: "#7" },
  { area: "state", type: "fresh", severity: "medium", title: `#12: ${S.commitOne}`, detail: `3 commits · main, #7 · ${S.authorOne}, ${S.authorTwo}`, reason: "First time a commit was seen for this reference.", source: "#12" },
  { area: "state", type: "changed", severity: "high", title: "K5: landed on main", detail: S.commitLanded, reason: "Used to only be in an open PR.", source: "K5" },
  { area: "signal", type: "fresh", severity: "medium", title: `${S.customer} wants a thing`, detail: `2 requests · ${S.customer}`, reason: "New demand target.", source: "signals.json" },
  { area: "psst", type: "fresh", severity: "medium", title: `#321 ${S.issueTitle} login broken`, detail: "score 5 · Issue opened against us", reason: "A new low-hanging item.", source: `${S.issueAuthor} · 2026-09-30` },
  { area: "matrix", type: "changed", severity: "low", title: `${OWN.rival} × ${OWN.rowOne}`, detail: "n → y", reason: "Changed.", source: "matrix.json" }] };

function plant(dir, { matrixExtra = {} } = {}) {
  write(path.join(dir, "sources.json"), { name: "Cargo", repo: ".", ref: "main", cloud: { project: "cargo" } });
  write(path.join(dir, "matrix.json"), { update: "2026-10-01", steps: [{ no: "1", name: OWN.rowOne }, { no: "2", name: OWN.rowTwo }],
    biz: { name: "Cargo", codes: { 1: "y", 2: "n" }, notes: { 1: "built" }, declined: { 2: OWN.decided } },
    products: [{ name: OWN.rival, category: "Competitor", statusType: "active", file: "rivalone.md", codes: { 1: { k: "y", evidence: "https://rival.test/export" }, 2: { k: "y", evidence: "https://rival.test/share" } } }], ...matrixExtra });
  write(path.join(dir, "rivals", "rivalone.md"), `# RivalOne\n\n- **Price:** ${OWN.price}\n- **Notes:** ${S.rivalNote}\n`);
  write(path.join(dir, "state", "status.json"), STATUS);
  write(path.join(dir, "state", "lowhanging.json"), LOW);
  write(path.join(dir, "state", "receipts.json"), RECEIPTS);
  write(path.join(dir, "state", "psst-final.json"), FINAL);
  write(path.join(dir, "state", "psst-draft.json"), { items: [{ id: 1, title: OWN.listItem, claim: S.claim }] });
  write(path.join(dir, "state", "refute.json"), { items: [{ id: 1, verdict: "stands", checked: [S.checkedOne], why: S.why }] });
  write(path.join(dir, "state", "refute-packet.md"), `# Refute\n${S.receiptCode} ${S.branchReceipt}\n`);
  write(path.join(dir, "state", "refute-log.jsonl"), JSON.stringify({ at: "x", dropped: [S.droppedTitle] }) + "\n");
  write(path.join(dir, "state", "waves.json"), WAVES);
  write(path.join(dir, "state", "diff.json"), DIFF);
  write(path.join(dir, "state", "team-next.json"), { items: [{ title: OWN.teamItem, text: `${OWN.teamItem}. ${S.teamNote}`, file: "docs/next.md", line: 3, date: "2026-09-30", refs: [] }] });
  write(path.join(dir, "state", "facts", "branches.json"), { generated: "2026-10-01T09:00:00Z", base: "main", branches: [{ branch: S.branchFacts, author: S.authorFacts, ahead: 4, date: "2026-09-30", files: ["a.ts"], subjects: [S.factsSubject] }] });
  write(path.join(dir, "state", "facts", "github.json"), { generated: "2026-10-01T09:00:00Z", items: [{ kind: "issue", n: 5, title: S.ghIssueTitle, author: S.issueAuthor }, { kind: "pr", n: 7, title: S.prTitle, branch: S.branchStatus, author: S.authorPr, state: "open" }] });
  write(path.join(dir, "state", "signals.json"), { generated: "2026-10-01T09:00:00Z", total: 6, matching: 3, sources: [{ format: "csv", signal: 6 }], themes: [{ key: S.theme, count: 2, examples: [S.quote] }],
    goals: [{ type: "matrix", title: OWN.rowOne, code: "y", count: 3, customer: 2, source: { csv: 3 }, trend: { last30: 2, previous30: 1 }, examples: [S.quote], customers: [S.customer] },
      { type: "signal", title: `${S.customer} wants a thing`, count: 2, customer: 1, source: { csv: 2 }, examples: [S.demandExample], trend: { last30: 2, previous30: 0 } }] });
  write(path.join(dir, "signal", "feedback.csv"), `customer,text\n${S.customer},${S.quote}\n`);
  write(path.join(dir, "decisions.md"), `# Decisions\n\n## K9\n${S.decision}\n`);
  write(path.join(dir, "requests", "requests.md"), `# Requests\n\n## 1. Something\n${S.request}\n`);
  write(path.join(dir, "todo", "nt-261001-zq.md"), `# Todo nt-261001-zq\n\n- **Todo:** ${S.todoTitle}\n- **Who:** ${S.todoPerson}\n- **Added:** 2026-10-01\n- **Status:** open\n`);
  write(path.join(dir, "history", "runs.jsonl"), '{"zaman":"2026-10-01T20:00:00Z","label":"stakeout","ref":"main","lastMain":"abc1234","folder":"2026-10-01T2000","numbers":{"psst":3,"pr":2}}\n');
  write(path.join(dir, "summary.md"), `## Summary · week\n\n- Two things shipped.\n\n## Older section\n\n- ${S.laterSummary}\n`);
  write(path.join(dir, "state", "watch.json"), { type: "watch", generated: "2026-10-01T08:00:00Z", rivals: [{ slug: "rivalone", name: OWN.rival, state: "same", pages: [{ url: "https://rival.test/pricing", status: "same", since: "2026-09-28T00:00:00Z" }] }] });
}

// Every planted secret that appears in `text`.
const leaks = text => Object.entries(S).filter(([, v]) => String(text).toLowerCase().includes(v.toLowerCase())).map(([k]) => k);
// The dry run's --full printout, cut into { key: text }.
const sections = (out, keys) => {
  const idx = keys.map(k => [k, out.indexOf(`\n--- ${k} ---\n`)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
  return Object.fromEntries(idx.map(([k, i], n) => { const start = i + `\n--- ${k} ---\n`.length, end = n + 1 < idx.length ? idx[n + 1][1] : out.length; return [k, out.slice(start, end).replace(/\n$/, "")]; })); // console.log adds one newline after each file's text
};
const stamp = s => String(s).replace(/"generated": ?"[^"]*"/g, '"generated":"T"');

before(async () => {
  tmp = temporary("nosy-privacy-sweep-");
  home = path.join(tmp, "home"); sandbox = path.join(tmp, "sandbox"); fs.mkdirSync(home); fs.mkdirSync(sandbox);
  pm = path.join(tmp, "cargo", "pm"); plant(pm);
  server = http.createServer((req, res) => {
    let body = ""; req.on("data", d => (body += d));
    req.on("end", () => { got = { url: req.url, raw: body, body: JSON.parse(body || "{}") }; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, url: "http://cloud/p/me/cargo" })); });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); server.unref();
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); clean(tmp); });

test("the fixture really holds every secret, in the places the product keeps them", () => {
  const all = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : all.push(fs.readFileSync(p, "utf8")); } })(pm);
  const whole = all.join("\n");
  for (const [k, v] of Object.entries(S)) assert.ok(whole.toLowerCase().includes(v.toLowerCase()), `${k} is planted somewhere in pm/`);
});

test("a real send: nothing planted reaches the body, and what is meant to leave does", async () => {
  got = null;
  const before = tree(pm);
  const r = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.error);
  assert.ok(got, "the body arrived");
  // 1. each file on its own (the first failure names the file), then parsed, because JSON escaping can break a marker in the raw text
  for (const [key, text] of Object.entries(got.body.files)) assert.deepEqual(leaks(text), [], key);
  for (const [key, text] of Object.entries(got.body.files)) if (key.endsWith(".json")) assert.deepEqual(leaks(JSON.stringify(JSON.parse(text))), [], `${key} (parsed)`);
  // 2. the whole raw body, so a key, a header, a path or a nested value cannot hide
  assert.deepEqual(leaks(got.raw), [], "the request body");
  // 3. what the tool said to the owner
  assert.deepEqual(leaks(r.output + r.error), [], "stdout and stderr");
  // 4. nothing but the dashboard files, and nothing from pm/ outside the list
  assert.deepEqual(Object.keys(got.body.files).sort(), ["pm/history/runs.jsonl", "pm/matrix.json", "pm/state/demand.json", "pm/state/diff.json", "pm/state/glance.json", "pm/state/lowhanging.json", "pm/state/psst-final.json", "pm/state/rival-facts.json", "pm/state/status.json", "pm/state/watch.json", "pm/summary.md"]);
  // 5. nothing written into pm/, nothing left in the temp folder
  assert.deepEqual(tree(pm), before, "pm/ is untouched");
  assert.deepEqual(fs.readdirSync(sandbox), [], "no temp file left behind");
  // The pipeline carried the product's own structure (so the above is not "nothing was sent").
  const F = Object.fromEntries(Object.entries(got.body.files).map(([k, v]) => [k, v]));
  assert.match(F["pm/matrix.json"], new RegExp(OWN.rowOne));
  assert.match(F["pm/matrix.json"], new RegExp(OWN.rival));
  assert.match(F["pm/state/lowhanging.json"], new RegExp(OWN.listItem));
  assert.match(F["pm/state/psst-final.json"], new RegExp(OWN.listItem));
  assert.match(F["pm/state/rival-facts.json"], /\$10 per seat/);
  assert.match(F["pm/summary.md"], /Two things shipped/);
  const status = JSON.parse(F["pm/state/status.json"]);
  assert.equal(status.openPrs, 2); assert.equal(status.prCommits, 3);
  assert.deepEqual(status.groups.map(g => g.ref), ["#12", "K5"]);
  const low = JSON.parse(F["pm/state/lowhanging.json"]);
  assert.equal(low.leftOut, 1, "the held item is left out, counted");
  assert.ok(low.items.some(i => i.title === "#321"), "the issue is a reference, not its title");
  assert.ok(JSON.parse(F["pm/state/glance.json"]).tiles.length, "the first screen is computed");
});

test("--dry-run --full prints exactly what the real send sends", async () => {
  got = null;
  const sent = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(sent.code, 0, sent.error);
  const files = got.body.files, keys = Object.keys(files);
  const dry = await run([pm, "--url", url, "--dry-run", "--full"]);
  assert.equal(dry.code, 0, dry.error);
  assert.deepEqual(leaks(dry.output + dry.error), [], "the dry run's printout holds no secret either");
  const shown = sections(dry.output, keys);
  assert.deepEqual(Object.keys(shown).sort(), keys.slice().sort(), "the dry run lists the same files the send carried");
  for (const k of keys) assert.equal(stamp(shown[k]), stamp(files[k]), `${k}: what the dry run printed is what was sent`);
  const lines = dry.output.split("\n").filter(l => /^  pm\/\S+ \(/.test(l)).map(l => l.trim().split(" ")[0]);
  assert.deepEqual(lines.sort(), keys.slice().sort(), "the list above the files names the same files");
  assert.equal(got.url, "/api/publish");
});

test("the privacy scan still stops an e-mail, a key and a commit author's name, in each place a person could put one", async () => {
  const cases = {
    "an e-mail in a matrix evidence line": d => write(path.join(d, "matrix.json"), { steps: [{ no: "1", name: OWN.rowOne }], biz: { name: "Cargo", codes: { 1: "y" } },
      products: [{ name: OWN.rival, statusType: "active", codes: { 1: { k: "y", evidence: "ask jane.doe@acme-private.io about it" } } }] }),
    "a key in the summary": d => write(path.join(d, "summary.md"), `## Summary\n- deploy key: ${"ghp_" + "Zx8Qm2Lk9Rt4Vb7Nc1Hp5Jw3Ys6Fd0Ga2Ue4"}\n`),
    "a commit author's name in the checked list": d => { const F = JSON.parse(JSON.stringify(FINAL)); F.items[0].title = `Ask ${S.authorOne} about import`; write(path.join(d, "state", "psst-final.json"), F); },
    "a commit author's name in the matrix": d => { const M = JSON.parse(fs.readFileSync(path.join(d, "matrix.json"), "utf8")); M.biz.notes = { 1: `${S.authorTwo} built it` }; write(path.join(d, "matrix.json"), M); },
    "a private.json name in a summary bullet": d => { write(path.join(d, "private.json"), { names: ["Priscilla Hush"] }); write(path.join(d, "summary.md"), "## Summary\n- Priscilla Hush signed off.\n"); },
  };
  for (const [what, edit] of Object.entries(cases)) {
    const d = path.join(tmp, `scan-${Object.keys(cases).indexOf(what)}`, "pm");
    fs.cpSync(pm, d, { recursive: true }); edit(d);
    got = null;
    const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
    assert.equal(r.code, 1, `${what}: ${r.output}${r.error}`);
    assert.match(r.error, /privacy scan found/, what);
    assert.equal(got, null, `${what}: nothing may be sent`);
    assert.deepEqual(fs.readdirSync(sandbox), [], `${what}: no temp file left behind`);
  }
});

test("a dry run is stopped by the scan too, with the same exit code as a real send", async () => {
  const d = path.join(tmp, "dry-scan", "pm");
  fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "summary.md"), "## Summary\n- mail jane.doe@acme-private.io\n");
  const dry = await run([d, "--url", url, "--dry-run"]);
  assert.equal(dry.code, 1, "a dry run that would be refused says so");
  assert.match(dry.error, /privacy scan found/);
});

test("a file that cannot be read or cut down is left out, never sent raw", async () => {
  const d = path.join(tmp, "broken", "pm");
  fs.cpSync(pm, d, { recursive: true });
  // not JSON, and holding secrets: the cut-down throws, so the file must not leave as text
  fs.writeFileSync(path.join(d, "state", "status.json"), `{"groups": [ ${S.commitOne} ${S.authorOne}`);
  fs.writeFileSync(path.join(d, "state", "diff.json"), `<<<<<<< HEAD\n${S.prTitle}\n`);
  fs.writeFileSync(path.join(d, "state", "psst-final.json"), `{"items": [ ${S.fix}`);
  got = null;
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.error);
  assert.deepEqual(leaks(got.raw), [], "no marker in the body");
  assert.ok(!("pm/state/status.json" in got.body.files) && !("pm/state/diff.json" in got.body.files) && !("pm/state/psst-final.json" in got.body.files));
  assert.match(r.error, /state\/status\.json left out/);
  assert.match(r.error, /state\/diff\.json left out/);
  assert.deepEqual(leaks(r.output + r.error), [], "the message that says a file was left out does not quote it");
});
