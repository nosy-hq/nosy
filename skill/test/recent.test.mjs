// Contract tests for skill/tools/recent.mjs (wave N2: recency). Runs against the fake product "Cargo"
// (fake-product.mjs), with a fake `gh` (no network). --branch main is passed explicitly in every test so
// integration-branch.mjs's own detection call (which would otherwise also read F.prListMerged) never fires;
// that detection has its own tests (integration-branch.test.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

const Day = 86400000;
const iso = day => new Date(Date.now() - day * Day).toISOString();

// --- merged since the last run: default window, then incremental from a recorded run ---
let K, gh, jsonPath, output;

before(async () => {
  K = await fakeProductSetup();
  K.gh.prListMerged = [
    // within the default 7d window, tied to K12 (ref found in the title).
    { number: 900, title: "K12 m.9 extend the file-move backend", author: { login: "alice" }, mergedAt: iso(3), body: "", baseRefName: "main" },
    // within the window too, but no ref anywhere in title/body -> "no tie".
    { number: 902, title: "chore: repo cleanup", author: { login: "ben" }, mergedAt: iso(2), body: "", baseRefName: "main" },
    // outside the default 7d window -> must not appear.
    { number: 901, title: "K20 old route work", author: { login: "cara" }, mergedAt: iso(20), body: "", baseRefName: "main" },
    // a dependency bump whose body is the dependency's OWN changelog, full of unrelated issue numbers -
    // must never show up as a tied "merged" row (no false ties from body noise).
    { number: 903, title: "chore(deps): bump left-pad from 1.0.0 to 1.0.1", author: { login: "dependabot" },
      mergedAt: iso(1), body: "- Fixes #9001\n- See also #9002 #9003", baseRefName: "main" },
  ];
  gh = fakeGhSetup(K.gh);
  jsonPath = path.join(K.pm, "state", "recent.json");
  const r = run(path.join(Tool, "recent.mjs"), [K.pm, "--branch", "main", "--json", jsonPath], { env: gh.env });
  assert.equal(r.code, 0, `recent: unexpected exit code, stderr: ${r.error}`);
  output = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(K.root); clean(gh.dir); });

test("merged PRs inside the default 7-day window are listed, older ones are not", () => {
  const ns = output.json.merged.map(p => p.n);
  assert.ok(ns.includes(900), "PR #900 (3 days ago) should be inside the default window");
  assert.ok(ns.includes(902), "PR #902 (2 days ago) should be inside the default window");
  assert.ok(!ns.includes(901), "PR #901 (20 days ago) should be outside the default 7d window");
});

test("a PR whose title carries a decision ref is tied to it", () => {
  const p = output.json.merged.find(p => p.n === 900);
  assert.ok(p, "PR #900 missing from the merged list");
  assert.deepEqual(p.tie, ["K12"]);
  assert.match(output.markdown, /#900[^\n]*K12/);
});

test("a PR with no ref anywhere in title/body shows 'no tie', never a guessed match", () => {
  const p = output.json.merged.find(p => p.n === 902);
  assert.ok(p, "PR #902 missing from the merged list");
  assert.deepEqual(p.tie, []);
  assert.match(output.markdown, /#902[^\n]*no tie/);
});

test("a chore(deps) PR is split out, not tied from its (unrelated) changelog body", () => {
  assert.ok(!output.json.merged.some(p => p.n === 903), "dependency PR #903 must not appear in the tied 'merged' list");
  assert.equal(output.json.dependency, 1);
  assert.match(output.markdown, /#903/, "the dependency update should still be mentioned somewhere (just untied)");
});

test("this run is recorded in pm/history/runs.jsonl (diff.mjs's own line shape)", () => {
  const runsPath = path.join(K.pm, "history", "runs.jsonl");
  assert.ok(fs.existsSync(runsPath), "runs.jsonl was not written");
  const lines = fs.readFileSync(runsPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.equal(line.label, "recent");
  assert.ok("zaman" in line && "numbers" in line, "recorded line is missing diff.mjs's own fields");
});

test("a 'recent' key is merged into pm/state/shipped.json in the coordinated shape", () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(K.pm, "state", "shipped.json"), "utf8"));
  assert.ok(shipped.recent, "shipped.json has no 'recent' key");
  assert.equal(shipped.recent.since, output.json.since.slice(0, 10));
  const m900 = shipped.recent.merged.find(p => p.n === 900);
  assert.equal(m900.ref, "K12", "shipped.json's merged.ref should be the single first ref, not an array");
  const m902 = shipped.recent.merged.find(p => p.n === 902);
  assert.equal(m902.ref, null, "no-tie PR should carry ref: null in shipped.json");
});

test("shipped.json's existing keys survive a re-run (read-modify-write, not overwrite)", () => {
  const shippedPath = path.join(K.pm, "state", "shipped.json");
  const before2 = JSON.parse(fs.readFileSync(shippedPath, "utf8"));
  before2.someOtherKey = { untouched: true };
  fs.writeFileSync(shippedPath, JSON.stringify(before2, null, 1));
  const r2 = run(path.join(Tool, "recent.mjs"), [K.pm, "--branch", "main"], { env: gh.env });
  assert.equal(r2.code, 0, r2.error);
  const after2 = JSON.parse(fs.readFileSync(shippedPath, "utf8"));
  assert.deepEqual(after2.someOtherKey, { untouched: true }, "an unrelated key in shipped.json was clobbered");
});

// --- incremental: a recorded run narrows the window on the next call ---
let K2, gh2, json2Path, output2;

before(async () => {
  K2 = await fakeProductSetup();
  fs.mkdirSync(path.join(K2.pm, "history"), { recursive: true });
  // A run recorded 2 days ago: only PRs merged after that should show up on the next call.
  fs.writeFileSync(path.join(K2.pm, "history", "runs.jsonl"), JSON.stringify({
    zaman: iso(2), label: "recent", ref: "origin/main", lastMain: null, folder: null, numbers: { merged: 0, closeToMerging: 0 },
  }) + "\n");
  K2.gh.prListMerged = [
    { number: 910, title: "K20 report work merged before the last recorded run", author: { login: "alice" }, mergedAt: iso(3), body: "", baseRefName: "main" },
    { number: 911, title: "K20 report work merged after the last recorded run", author: { login: "ben" }, mergedAt: iso(1), body: "", baseRefName: "main" },
  ];
  gh2 = fakeGhSetup(K2.gh);
  json2Path = path.join(K2.pm, "state", "recent2.json");
  const r = run(path.join(Tool, "recent.mjs"), [K2.pm, "--branch", "main", "--json", json2Path], { env: gh2.env });
  assert.equal(r.code, 0, `recent (incremental): unexpected exit code, stderr: ${r.error}`);
  output2 = JSON.parse(fs.readFileSync(json2Path, "utf8"));
});
after(() => { clean(K2.root); clean(gh2.dir); });

test("incremental: only PRs merged after the last recorded run are shown", () => {
  const ns = output2.merged.map(p => p.n);
  assert.ok(ns.includes(911), "PR #911 (merged after the recorded run) should appear");
  assert.ok(!ns.includes(910), "PR #910 (merged before the recorded run) should be excluded");
});

test("incremental: the run is appended, not overwritten (runs.jsonl now has 2 lines)", () => {
  const lines = fs.readFileSync(path.join(K2.pm, "history", "runs.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "the previously recorded run should still be there, plus this one");
});

test("--since overrides the recorded marker", () => {
  const r = run(path.join(Tool, "recent.mjs"), [K2.pm, "--branch", "main", "--since", new Date(Date.now() - 25 * Day).toISOString().slice(0, 10)], { env: gh2.env });
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /#910/, "with a wider --since, the older PR should now be included");
});

// --- close to merging: ordering (approved+green first) and drafts always excluded ---
let K3, gh3, json3Path, output3;

before(async () => {
  K3 = await fakeProductSetup();
  K3.gh.prListApprovable = [
    { number: 920, title: "draft, approved and green but must never show up", author: { login: "x" },
      updatedAt: iso(1), isDraft: true, reviewDecision: "APPROVED", statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }] },
    { number: 921, title: "approved and every check green", author: { login: "a" },
      updatedAt: iso(2), isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }], body: "K30 m.2" },
    { number: 922, title: "approved, CI still running", author: { login: "b" },
      updatedAt: iso(3), isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [{ conclusion: null, status: "IN_PROGRESS" }] },
    { number: 923, title: "green, not yet approved", author: { login: "c" },
      updatedAt: iso(4), isDraft: false, reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }] },
    { number: 924, title: "neither approved nor green: excluded entirely", author: { login: "d" },
      updatedAt: iso(5), isDraft: false, reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [{ conclusion: "FAILURE", status: "COMPLETED" }] },
  ];
  gh3 = fakeGhSetup(K3.gh);
  json3Path = path.join(K3.pm, "state", "recent3.json");
  const r = run(path.join(Tool, "recent.mjs"), [K3.pm, "--branch", "main", "--json", json3Path], { env: gh3.env });
  assert.equal(r.code, 0, `recent (close-to-merging): unexpected exit code, stderr: ${r.error}`);
  output3 = JSON.parse(fs.readFileSync(json3Path, "utf8"));
});
after(() => { clean(K3.root); clean(gh3.dir); });

test("a draft PR never appears in 'close to merging', even if approved and green", () => {
  assert.ok(!output3.closeToMerging.some(p => p.n === 920), "draft PR #920 must be excluded");
});

test("a PR that is neither approved nor green is excluded", () => {
  assert.ok(!output3.closeToMerging.some(p => p.n === 924), "PR #924 (neither) must be excluded");
});

test("approved+green PRs are ordered before approved-only and green-only ones", () => {
  const ns = output3.closeToMerging.map(p => p.n);
  assert.deepEqual(ns, [921, 922, 923], `unexpected order: ${ns.join(", ")}`);
});

test("shipped.json's close list carries a single ref (or null) and a 'why' reason", () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(K3.pm, "state", "shipped.json"), "utf8"));
  const c921 = shipped.recent.close.find(p => p.n === 921);
  assert.equal(c921.ref, "K30", "PR #921's body carries K30 m.2, so its ref should be K30");
  assert.match(c921.why, /approved/);
  assert.match(c921.why, /checks green/);
});

// --- no remote / no gh -> a quiet note + local branches, never a hard exit ---
let K4, gh4, json4Path, output4;
before(async () => {
  K4 = await fakeProductSetup();
  const git = (...a) => execFileSync("git", ["-C", K4.repo, ...a], { encoding: "utf8" });
  git("checkout", "-q", "-b", "side/r54");
  fs.writeFileSync(path.join(K4.repo, "backend", "extra.js"), "export const extra = 1;\n");
  git("add", "-A"); git("commit", "-q", "-m", "K12 m.9 extend the file-move backend, local only");
  git("checkout", "-q", "main");
  K4.gh.fail = true;
  gh4 = fakeGhSetup(K4.gh);
  json4Path = path.join(K4.pm, "state", "recent4.json");
  const r = run(path.join(Tool, "recent.mjs"), [K4.pm, "--branch", "main", "--json", json4Path], { env: gh4.env });
  assert.equal(r.code, 0, `recent (no remote): unexpected exit code, stderr: ${r.error}`);
  output4 = { markdown: r.output, json: JSON.parse(fs.readFileSync(json4Path, "utf8")) };
});
after(() => { clean(K4.root); clean(gh4.dir); });

test("gh failing entirely doesn't exit or print raw gh errors - one quiet line instead", () => {
  assert.equal(output4.json.noRemote, true);
  assert.match(output4.markdown, /no remote: PRs not read; local branches used/);
  assert.doesNotMatch(output4.markdown, /couldn't read/);
});

test("'close to merging (local branches)' lists the unmerged local branch with its ref", () => {
  const b = output4.json.localBranches.find(b => b.branch === "side/r54");
  assert.ok(b, "side/r54 should be listed");
  assert.deepEqual(b.refs, ["K12"]);
  assert.match(output4.markdown, /Close to merging \(local branches\)/);
  assert.match(output4.markdown, /side\/r54/);
});

test("sources.json with no issue.repo at all also falls back (not a fatal error)", () => {
  const K5 = { ...JSON.parse(fs.readFileSync(K4.sources, "utf8")) };
  delete K5.issue;
  const pm5 = temporary("nosy-recent-noissue-");
  fs.mkdirSync(pm5, { recursive: true });
  fs.writeFileSync(path.join(pm5, "sources.json"), JSON.stringify({ ...K5, repo: K4.repo }));
  const r = run(path.join(Tool, "recent.mjs"), [pm5, "--branch", "main"]);
  assert.equal(r.code, 0, `recent (no issue.repo): unexpected exit code, stderr: ${r.error}`);
  assert.match(r.output, /no remote: PRs not read; local branches used/);
  clean(pm5);
});

// --- the tie column shows which wave (pm/waves.md's N-sections) a ref belongs to ---
let K6, gh6, output6;
before(async () => {
  K6 = await fakeProductSetup();
  fs.writeFileSync(path.join(K6.pm, "waves.md"), "# Waves\n\n## Direction\n\n- **N1 · Test wave** · size M · K12.\n");
  K6.gh.prListMerged = [
    { number: 950, title: "K12 m.9 extend the file-move backend", author: { login: "alice" }, mergedAt: iso(1), body: "", baseRefName: "main" },
    { number: 951, title: "K20 old route work", author: { login: "cara" }, mergedAt: iso(1), body: "", baseRefName: "main" },
  ];
  gh6 = fakeGhSetup(K6.gh);
  const r = run(path.join(Tool, "recent.mjs"), [K6.pm, "--branch", "main"], { env: gh6.env });
  assert.equal(r.code, 0, r.error);
  output6 = r.output;
});
after(() => { clean(K6.root); clean(gh6.dir); });

test("a ref a wave names shows the wave next to it in the tie column", () => {
  assert.match(output6, /#950[^\n]*K12 \(N1\)/);
});

test("a ref no wave names still shows '—' for the wave, not silently dropped", () => {
  assert.match(output6, /#951[^\n]*K20 \(—\)/);
});
