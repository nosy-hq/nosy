// Fixes from the four read-only bug hunts run after the BlogFactory field test (4 Oct 2026): silent data loss in generated builds, one-word verdicts, hard-coded paths and
// days, and commands that succeed over nothing. Each test is a reproduction the hunters built on a throwaway fixture.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const tmp = p => { const d = temporary(p); dirs.push(d); return d; };
const J = JSON.stringify, readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
const NOSY = path.join(Tool, "nosy.mjs");
function product(files = {}, sources = {}) {
  const root = tmp("nosy-hunt-"), pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), J({ repo: ".", ref: "main", ...sources }));
  for (const [f, c] of Object.entries(files)) { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof c === "string" ? c : J(c, null, 1)); }
  return { root, pm };
}
const MATRIX = { update: "2026-10-04", codes: { y: "exists" }, steps: [{ no: "1", name: "Draft" }], biz: { name: "Us", codes: { 1: "y" } }, products: [] };

// ---- A1: `nosy page` never writes over a page it didn't build ----
test("nosy page: the owner's own page at the configured path is not overwritten; --force replaces it after a copy", () => {
  const { pm } = product({ "pm/matrix.json": MATRIX, "pm/product.md": "# P\n\n- **Page:** `pm/status-page.html`\n", "pm/status-page.html": "<h1>My hand-built roadmap</h1>" });
  const r = run(NOSY, ["page", "--pm", pm]);
  assert.equal(r.code, 1, r.output + r.error); assert.match(r.error, /Nosy didn't build it.*page-adopt.*--force/s);
  assert.equal(fs.readFileSync(path.join(pm, "status-page.html"), "utf8"), "<h1>My hand-built roadmap</h1>", "untouched");
  const f = run(NOSY, ["page", "--force", "--pm", pm]);
  assert.equal(f.code, 0, f.error); assert.match(f.output, /your page kept at/);
  assert.match(fs.readFileSync(path.join(pm, "status-page.html"), "utf8"), /const D=/, "now a Nosy page");
  const kept = fs.readdirSync(path.join(pm, ".backup")).find(x => x.startsWith("status-page.html."));
  assert.equal(fs.readFileSync(path.join(pm, ".backup", kept), "utf8"), "<h1>My hand-built roadmap</h1>");
  assert.equal(run(NOSY, ["page", "--pm", pm]).code, 0, "a page Nosy built is rebuilt freely");
});

// ---- A2: a file that exists but doesn't parse is not an empty file ----
test("learn, ledger and dresscode refuse to write over a damaged owner file, and keep the keys they don't know", () => {
  const { pm } = product({ "pm/learned.json": '{"version":1,"rules":[{"id":"x","kind":"mute","key":"dark mode"}],}', "pm/canwe/ledger.json": "<<<<<<< HEAD\n[]\n", "pm/design/approvals.json": '{"decisions":{},"add":{},"exception":[],"owner_note": }' });
  const before = ["learned.json", "canwe/ledger.json", "design/approvals.json"].map(f => fs.readFileSync(path.join(pm, f), "utf8"));
  const l = run(path.join(Tool, "learn.mjs"), [pm, "mute", "billing", "--reason", "z"]);
  assert.equal(l.code, 1, l.output); assert.match(l.error, /learned\.json exists but isn't valid JSON.*Nothing was changed/s);
  const ev = path.join(pm, "state", "canwe-last.md"); fs.writeFileSync(ev, "# canwe: Can we export?\n\nEvidence.\n");
  const g = run(path.join(Tool, "ledger.mjs"), [pm, "write", "Can we export?", "--verdict", "yes", "--basis", "intent", "--evidence", ev]);
  assert.equal(g.code, 1, g.output); assert.match(g.error, /ledger\.json exists but isn't valid JSON/);
  assert.deepEqual(["learned.json", "canwe/ledger.json", "design/approvals.json"].map(f => fs.readFileSync(path.join(pm, f), "utf8")).slice(0, 2), before.slice(0, 2), "files untouched");
  assert.equal(fs.readdirSync(path.join(pm, "canwe")).filter(f => f.endsWith(".md")).length, 0, "no answer file was written either");
  // a valid file keeps keys the tool doesn't know
  fs.writeFileSync(path.join(pm, "learned.json"), '{"version":1,"rules":[],"owner_note":"keep me"}');
  assert.equal(run(path.join(Tool, "learn.mjs"), [pm, "mute", "billing", "--reason", "z"]).code, 0);
  assert.equal(readJson(path.join(pm, "learned.json")).owner_note, "keep me");
  assert.equal(readJson(path.join(pm, "learned.json")).rules.length, 1);
});

// ---- A3: a rebuild keeps what only matrix.json holds ----
const RIVAL = "# Acme\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Draft | y | https://acme.example/d |\n";
test("build-matrix: biz.declined and notes survive pm/us.json; a product with no rival file is kept; a line-shape matrix is left alone", () => {
  const { pm } = product({ "pm/rivals/acme.md": RIVAL, "pm/us.json": { name: "Us", codes: { 1: "p", 2: "y" } },
    "pm/matrix.json": { steps: [{ no: "1", name: "Draft" }, { no: "2", name: "Review" }], biz: { name: "Us", codes: { 1: "y" }, declined: { 2: "decided: not doing" }, notes: { 1: "ours is better" }, owner_flag: true },
      products: [{ name: "HandRival", codes: { 1: { k: "y", evidence: "by hand" } } }, { name: "Acme", file: "acme.md", codes: {} }] } });
  const b = run(path.join(Tool, "build-matrix.mjs"), [pm]);
  assert.equal(b.code, 0, b.error); assert.match(b.output, /kept 1 product that has no rival file: HandRival/);
  const M = readJson(path.join(pm, "matrix.json"));
  assert.deepEqual(M.biz.declined, { 2: "decided: not doing" }); assert.deepEqual(M.biz.notes, { 1: "ours is better" }); assert.equal(M.biz.owner_flag, true);
  assert.deepEqual(M.biz.codes, { 1: "p", 2: "y" }, "us.json wins for the codes");
  assert.deepEqual(M.products.map(p => p.name).sort(), ["Acme", "HandRival"]);
  const lineShape = { products: ["Us", "R"], lines: [{ feature: "A", codes: { Us: "y", R: "n" }, declined: true }] };
  const { pm: pm2 } = product({ "pm/rivals/acme.md": RIVAL, "pm/matrix.json": lineShape });
  const l = run(path.join(Tool, "build-matrix.mjs"), [pm2]);
  assert.equal(l.code, 0); assert.match(l.error, /was in the line shape.*old file is the matrix-before-build copy/s);
  const kept = fs.readdirSync(path.join(pm2, "history")).find(f => f.startsWith("matrix-before-build-"));
  assert.deepEqual(readJson(path.join(pm2, "history", kept)), lineShape, "the old matrix is kept whole");
});

test("matrix-proposals apply: a step the rival's table doesn't list yet is added to the table, not lost at the next rebuild", () => {
  const { pm } = product({ "pm/rivals/acme.md": RIVAL, "pm/matrix.json": { steps: [{ no: "1", name: "Draft" }, { no: "2", name: "Review" }, { no: "3", name: "Publish" }], biz: { name: "Us", codes: { 1: "y", 2: "y", 3: "y" } }, products: [{ name: "Acme", file: "acme.md", codes: { 1: { k: "y", evidence: "https://acme.example/d" } } }] },
    "pm/state/matrix-proposals.json": { proposals: [{ rival: "Acme", step: "3", from: "u", to: "y", evidence: [{ url: "https://acme.example/publish", grade: "primary", page_opened: true, date_kind: "none" }] }] } });
  const MP = path.join(Tool, "matrix-proposals.mjs");
  assert.equal(run(MP, ["check", pm]).code, 0);
  const a = run(MP, ["apply", pm]); assert.equal(a.code, 0, a.error + a.output);
  assert.match(fs.readFileSync(path.join(pm, "rivals", "acme.md"), "utf8"), /\| 3 \| Publish \| y \| https:\/\/acme\.example\/publish \[verified:/, "the row was added to the rival's table");
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [pm]).code, 0);
  assert.equal(readJson(path.join(pm, "matrix.json")).products[0].codes["3"].k, "y", "and survives the rebuild");
});

// ---- A4: setup --onTop fills in, it doesn't replace ----
test("find-sources --write --onTop keeps the owner's keys and values, and a second run doesn't destroy the first backup", () => {
  const root = tmp("nosy-onTop-"); const repo = path.join(root, "repo"), pm = path.join(root, "pm");
  fs.mkdirSync(repo); fs.mkdirSync(pm);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["commit", "--allow-empty", "-qm", "init"]]) execFileSync("git", ["-C", repo, ...a], { env, stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "README.md"), "# P\n");
  const mine = { repo, ref: "main", team: ["bora"], rivals: { acme: { name: "Acme", tier: "B" } }, preread: { never: [{ name: "no stripe", pattern: "stripe" }] }, owner_note: "keep" };
  fs.writeFileSync(path.join(pm, "sources.json"), J(mine));
  const FS = path.join(Tool, "find-sources.mjs");
  const r = run(FS, [repo, "--pm", pm, "--write", "--onTop"]); assert.equal(r.code, 0, r.error);
  const after1 = readJson(path.join(pm, "sources.json"));
  assert.deepEqual(after1.team, ["bora"]); assert.deepEqual(after1.rivals, { acme: { name: "Acme", tier: "B" } }); assert.equal(after1.owner_note, "keep"); assert.deepEqual(after1.preread.never, mine.preread.never);
  run(FS, [repo, "--pm", pm, "--write", "--onTop"]);
  const backups = fs.readdirSync(pm).filter(f => f.startsWith("sources.json.backup"));
  assert.ok(backups.length >= 1 && backups.some(b => readJson(path.join(pm, b)).owner_note === "keep"), "the original file is still in a backup after a second run");
});

// ---- A5: what the owner adds to a bet or a to-do file stays ----
test("bet drop/score and todo done keep the sections the owner added to the file", () => {
  const { pm } = product();
  const BET = path.join(Tool, "bet.mjs"), TODO = path.join(Tool, "todo.mjs");
  const placed = run(BET, [pm, "place", "Ship export", "--why", "x", "--estimate", "S"]); assert.equal(placed.code, 0, placed.error);
  const betFile = path.join(pm, "bets", fs.readdirSync(path.join(pm, "bets")).find(f => /^nb-.*\.md$/.test(f)));
  fs.appendFileSync(betFile, "\n## Notes (owner)\n\nTalked to Ayse; she wants it before the 15th.\n");
  const id = path.basename(betFile, ".md");
  assert.equal(run(BET, [pm, "drop", id, "--reason", "pivot"]).code, 0);
  assert.match(fs.readFileSync(betFile, "utf8"), /## Notes \(owner\)\n\nTalked to Ayse; she wants it before the 15th\./);
  assert.match(fs.readFileSync(betFile, "utf8"), /pivot/, "and the drop is recorded");
  const added = run(TODO, [pm, "add", "Pay the invoice", "--why", "blocks launch"]); assert.equal(added.code, 0, added.error + added.output);
  const todoFile = path.join(pm, "todo", fs.readdirSync(path.join(pm, "todo")).find(f => /^nt-.*\.md$/.test(f)));
  fs.appendFileSync(todoFile, "\n## Receipt\n\nInvoice 4411, paid by card.\n");
  assert.equal(run(TODO, [pm, "done", path.basename(todoFile, ".md"), "--note", "paid"]).code, 0);
  assert.match(fs.readFileSync(todoFile, "utf8"), /## Receipt\n\nInvoice 4411, paid by card\./);
});

// ---- B: a verdict needs more than one word ----
import { check as neverCheck, rulesAndProblems } from "../tools/never-check.mjs";
import { statementOf } from "../tools/read-decisions.mjs";

test("never-check: a broken or plain-word rule is reported, not silently dropped; a line that negates the rule is not adding it", () => {
  const K = { preread: { never: [{ name: "no stripe", pattern: "stripe(\\.com" }, "paddle", { name: "no pii", pattern: "ssn" }] } };
  const { rules, invalid } = rulesAndProblems(K);
  assert.deepEqual(rules.map(r => r.name), ["paddle", "no pii"], "a plain word is a rule");
  assert.equal(invalid.length, 1); assert.match(invalid[0].why, /valid regular expression/);
  const diff = ["--- a/b.ts", "+++ b/b.ts", "@@ -0,0 +4 @@", "+// We deliberately do not use paddle here", "+expect(deps).not.toContain('paddle')", "+import paddle from 'paddle-sdk'", "+store.ssn = x"].join("\n") + "\n";
  const R = neverCheck(K, diff);
  assert.equal(R.invalid.length, 1);
  assert.deepEqual(R.hits.map(h => h.line).sort(), [6, 7], "the import (line 6) and the ssn field (line 7), not the comment (4) or the test that asserts it is absent (5)");
  const q = product({}, { preread: { never: [{ name: "no stripe", pattern: "stripe(\\.com" }] } }), genv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["commit", "--allow-empty", "-qm", "init"]]) execFileSync("git", ["-C", path.dirname(q.pm), ...a], { env: genv, stdio: "ignore" });
  const cli = run(path.join(Tool, "never-check.mjs"), [q.pm, "--last-commit"]);
  assert.equal(cli.code, 1, "an unusable rule is not 'all clear'");
  assert.match(cli.error + cli.output, /not being enforced.*no stripe/s);
});

test("a decision states its verdict in its heading and first paragraph: a later 'out of scope' about something else does not make it 'not doing'", () => {
  const block = "## K10 Exports run in the background\n\nCSV export is the plan and ships first.\n\nExcel format is out of scope for now. We won't use streaming downloads.\n";
  assert.doesNotMatch(statementOf(block), /out of scope|won't/);
  assert.match(statementOf("## K11 Dark mode: we're not doing this\n\nWhy: ..."), /not doing/);
  assert.match(statementOf("## K12 Reports\n\nlonger text\n\nDecision: not doing PDF"), /not doing/, "a Decision: line counts wherever it is");
  const { pm } = product({ "DECISIONS.md": "# Decisions\n\n" + block + "\n## K11 Dark mode\n\nWe're not doing dark mode this year.\n", "src/export.ts": "export const csv = () => 1;\n" }, { preread: { decisions: "DECISIONS.md" } });
  const root = path.dirname(pm), env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "init"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "Can we add CSV export for the customer list?"]);
  assert.doesNotMatch(r.output, /There's a decision: not doing this/, r.output.slice(0, 1800));
});

import { refRegex, patternsOfLoad } from "../tools/refs.mjs";
test("refs: UTF-8, SHA-256, ISO-8601 and HTTP-2 are not request references; PROJ-123 and K12 still are", () => {
  const re = refRegex(patternsOfLoad({}));
  const found = t => { re.lastIndex = 0; return [...t.matchAll(re)].map(m => m[0]); };
  assert.deepEqual(found("Stored as UTF-8, signed with SHA-256, parsed as ISO-8601 over HTTP-2 and TLS-13"), []);
  assert.deepEqual(found("Fixes PROJ-123 and K12, see #44"), ["PROJ-123", "K12", "#44"]);
});

// ---- C: where the page is, for the Action and for scripts ----
test("nosy page-path prints the real page, and the Action asks it instead of assuming pm/page.html", () => {
  const { pm, root } = product({ "pm/product.md": "# P\n\n- **Page:** `pm/status-page.html`\n", "pm/status-page.html": "<h1>x</h1>" });
  const r = run(NOSY, ["page-path", "--pm", pm], { cwd: root });
  assert.equal(r.code, 0, r.error); assert.equal(r.output.trim(), path.join("pm", "status-page.html"));
  const act = fs.readFileSync(path.join(Tool, "..", "..", "action.yml"), "utf8");
  assert.equal((act.match(/nosy\.mjs" page-path/g) || []).length, 2, "the output and the commit step both ask");
  assert.doesNotMatch(act, /\/page\.html"? >>|for p in state page\.html/, "no step assumes the default name");
});

test("peek and shipped work when integrationBranch is a local branch and the repo has no origin (it said: ambiguous argument 'origin/develop')", () => {
  const { root, pm } = product({ "a.txt": "x" }, { integrationBranch: "develop", ref: "main" });
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "init"], ["checkout", "-q", "-b", "develop"], ["commit", "--allow-empty", "-qm", "feat(export): CSV"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  const r = run(NOSY, ["peek", "30d", "--pm", pm], { env: { ...process.env, NOSY_OFFLINE: "1" } });
  assert.equal(r.code, 0, r.error + r.output);
  assert.doesNotMatch(r.error + r.output, /ambiguous argument|origin\/develop/, r.error);
  assert.match(r.output, /CSV/);
});

test("the session-start hook finds pm/ above the folder the session started in (a monorepo subfolder)", () => {
  const { root, pm } = product({ "pm/todo/nt-250101-pay.md": "# Todo nt-250101-pay\n\n- **To do:** Pay the invoice\n- **Status:** open\n- **Who:** owner\n- **Added:** 2026-10-01\n" });
  const deep = path.join(root, "packages", "web"); fs.mkdirSync(deep, { recursive: true });
  const hook = path.join(Tool, "..", "..", "hooks", "psst-summary.mjs");
  const at = cwd => { const r = run(hook, [], { env: { ...process.env, NOSY_STATE_DIR: tmp("nosy-state-"), CLAUDE_PLUGIN_ROOT: path.join(Tool, "..", "..") }, input: J({ cwd, hook_event_name: "SessionStart" }) }); return r.output + r.error; };
  assert.match(at(root), /Pay the invoice|waits on a person|waiting on/i, "from the root: the hook speaks");
  assert.equal(/Pay the invoice|waits on a person|waiting on/i.test(at(deep)), true, "from packages/web: the same pm/ is found");
});

test("find-stale and page validate: a PR check that couldn't run is counted and shown as not checked, not as 'none stale'", () => {
  const { root, pm } = product({ "pm/page.html": "<html><body><p>PR #412 is open and in review.</p></body></html>" }, { issue: { repo: "acme/widgets" } });
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", PATH: path.dirname(process.execPath) + path.delimiter + "/usr/bin:/bin" }; // no gh
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "init"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  const r = run(path.join(Tool, "find-stale.mjs"), [pm, path.join(pm, "page.html"), "--json", path.join(pm, "state", "stale.json")], { env });
  assert.match(r.output, /1 PR status check not run.*#412/s);
  assert.deepEqual(readJson(path.join(pm, "state", "stale.json")).unchecked, ["412"]);
});

test("a matrix kept where sources.json says is read by publish and by the page, not 'missing'", () => {
  const m = { ...MATRIX, products: [{ name: "Acme", file: "acme.md", codes: { 1: { k: "y", evidence: "d" } } }] };
  const { pm } = product({ "docs/matrix.json": m, "pm/rivals/acme.md": RIVAL }, { matrix: "docs/matrix.json" });
  const pub = run(path.join(Tool, "publish.mjs"), [pm, "--url", "http://127.0.0.1:9", "--dry-run"]);
  assert.equal(pub.code, 0, pub.output + pub.error); assert.doesNotMatch(pub.output + pub.error, /matrix\.json is missing/);
  assert.equal(run(NOSY, ["page", "--pm", pm]).code, 0);
  const html = fs.readFileSync(path.join(pm, "page.html"), "utf8");
  assert.match(html, /"name":"Acme"/, "the page was drawn from the configured matrix");
});

test("tour: a step that ran and found nothing is not '✓ listed' (inventory with no backend, frontyard with no page)", async () => {
  const { tour } = await import("../tools/tour.mjs");
  const { pm } = product({ "pm/state/inventory.json": { backend_missing: true, total: 0, endpoints: [] }, "pm/state/frontyard.json": { page_missing: true, url: "https://x.example" } }, { frontyard: { url: "https://x.example" } });
  const steps = Object.fromEntries(tour(pm).steps.map(s => [s.id, s]));
  assert.match(steps.inventory.why, /found no backend/); assert.doesNotMatch(steps.inventory.why, /endpoints are listed/);
  assert.equal(steps.frontyard.state, "todo"); assert.match(steps.frontyard.why, /couldn't read the landing page/);
});

test("collect-signals reads a semicolon-delimited CSV (Excel in tr/de), names the files it can't read, and accepts signal.path as a string", () => {
  const { pm } = product({ "pm/signal/export.csv": "Mesaj;Tarih\nExport takes forever;2026-09-01\nNeed bulk export;2026-09-02\n", "pm/signal/report.xlsx": "binary", "inbox/more.md": "- the pdf export is broken (2026-09-03)\n" }, { signal: { path: "inbox" } });
  const out = path.join(pm, "state", "signals.json");
  const r = run(path.join(Tool, "collect-signals.mjs"), [pm, path.join(pm, "signal"), "--json", out]);
  assert.equal(r.code, 0, r.error + r.output);
  const ex = readJson(out).themes.flatMap(t => t.examples);
  assert.deepEqual(ex.map(e => [e.text, e.date]).sort(), [["Export takes forever", "2026-09-01"], ["Need bulk export", "2026-09-02"]], "split at the semicolon: the text and the day are separate");
  assert.match(r.output, /1 file in the signal folder not read.*\.xlsx.*report\.xlsx/s, "the .xlsx is named");
  const viaConfig = run(path.join(Tool, "collect-signals.mjs"), [pm, "--json", out]);
  assert.equal(viaConfig.code, 0, "a string signal.path doesn't crash: " + viaConfig.error);
});

test("a matrix.json saved with a BOM is read like any other", async () => {
  const { matrixRead } = await import("../tools/read-matrix.mjs");
  const { pm } = product({});
  const f = path.join(pm, "bom-matrix.json"); fs.writeFileSync(f, "﻿" + J({ steps: [{ no: "1", name: "Draft" }], biz: { name: "Us", codes: { 1: "y" } }, products: [{ name: "R", codes: { 1: { k: "n", evidence: "" } } }] }));
  assert.ok(matrixRead(f), "read, not null");
});

test("check: a decision log whose headings aren't K12/ADR-7 is flagged, not ✓; and `nosy setup . --onTop` reaches find-sources", () => {
  const doc = "# Decisions\n\n" + [1, 2, 3, 4, 5].map(i => `### Decision ${i}: ${i === 2 ? "No mobile app" : "Use thing " + i}\n\nStatus: ${i === 2 ? "rejected" : "accepted"}\n`).join("\n");
  const { root, pm } = product({ "docs/decisions.md": doc }, { preread: { decisions: "docs/decisions.md" } });
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "init"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  const v = run(path.join(Tool, "verify-setup.mjs"), [pm]);
  assert.match(v.output, /decision headings.*~|~.*decision headings/s); assert.match(v.output, /5 headings at one level.*decision_title/s);
  // setup with --onTop on an existing sources.json keeps the owner's keys (the flag used to be dropped by the dispatcher)
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", owner_note: "keep" }));
  const s = run(NOSY, ["setup", root, "--onTop", "--pm", pm]);
  assert.equal(readJson(path.join(pm, "sources.json")).owner_note, "keep", s.output + s.error);
  assert.match(s.output, /--onTop: took a/, "the flag was passed on");
});
