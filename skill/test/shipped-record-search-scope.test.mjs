// Contract test: shipped-record.mjs's GitHub search is scoped to the ONE issue repo. GitHub search ORs
// scope qualifiers, so the old "org:<owner> repo:<owner/name>" prefix returned every repo in the org — on
// Twenty, ~40% of "twentyhq/twenty" issues were really twentyhq/core-team-issues ones, whose #numbers
// collide with twenty's own (a commit naming twenty's old #2901 "shipped" core-team-issues#2901). And a
// renamed repo (calcom/cal.com -> calcom/cal.diy) returns 0 under its old name, while its cross-references
// carry the new name — so the canonical name is resolved first and used for both.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean } from "./helpers.mjs";

const Script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools", "shipped-record.mjs");

function git(repoDir, args, env) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", env: { ...process.env, ...env } });
}
function commitAt(repoDir, daysAgo, message, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const iso = new Date(Date.now() - daysAgo * 86400000).toISOString();
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", message], {
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@cargo.test", GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@cargo.test", GIT_COMMITTER_DATE: iso,
  });
  return git(repoDir, ["rev-parse", "HEAD"]).trim();
}
const issue = (number, repoName, title) => ({
  number, title, body: "", createdAt: new Date().toISOString(), closedAt: null, state: "OPEN", stateReason: null,
  repository: { nameWithOwner: repoName }, author: { login: "customer1" }, authorAssociation: "NONE",
  labels: { nodes: [] }, milestone: { title: "v61" },
});

let K, tmp, gh, collision, renamed;

function runOnce(fixture, name) {
  gh = fakeGhSetup(fixture);
  const jsonPath = path.join(tmp, `${name}.json`);
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--pm", K.pm, "--json", jsonPath, "--shipped-json", path.join(tmp, `${name}-shipped.json`)], { env: gh.env });
  clean(gh.dir);
  assert.equal(r.code, 0, `shipped-record.mjs (${name}): unexpected exit code, stderr: ${r.error}`);
  return { text: r.output, error: r.error, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
}

before(async () => {
  K = await fakeProductSetup();
  tmp = temporary("nosy-search-scope-");
  // This repo's commit names ITS OWN old "#2901" — never core-team-issues#2901.
  commitAt(K.repo, 5, "fix: the old #2901 regression.", { "backend/k2901.js": "export const k = 1;\n" });
  // A commit naming ANOTHER repo's #967 (milestoned in this repo, see searchIssues) must not ship ours.
  commitAt(K.repo, 4, "chore: follow-up for cargo-test/core-team-issues#967", { "backend/k967.js": "export const k = 2;\n" });
  git(K.repo, ["push", "-q", "origin", "main"]);
  git(K.repo, ["fetch", "-q", "origin"]);
  const mergeHash = git(K.repo, ["rev-parse", "HEAD"]).trim();

  const searchLog = path.join(tmp, "collision-queries.txt");
  collision = runOnce({ ...K.gh, searchLog, searchPRs: [],
    searchIssues: [issue(966, K.issueRepo, "Patch the shipment list edge case"), issue(967, K.issueRepo, "Archive old shipments"),
                   issue(2901, "cargo-test/core-team-issues", "Call Recorder: empty transcript")] }, "collision");
  collision.queries = fs.readFileSync(searchLog, "utf8").trim().split("\n");

  const newName = "cargo-test/cargo-renamed";
  renamed = runOnce({ ...K.gh, repoCanonical: newName, searchLog: path.join(tmp, "renamed-queries.txt"),
    searchPRs: [{ number: 900, title: "fix: shipment list pagination", body: "", baseRefName: "main",
      mergedAt: new Date().toISOString(), createdAt: new Date().toISOString(), repository: { nameWithOwner: newName },
      mergeCommit: { oid: mergeHash }, closingIssuesReferences: { nodes: [{ number: 966, repository: { nameWithOwner: newName } }] } }],
    searchIssues: [issue(966, newName, "Patch the shipment list edge case")] }, "renamed");
  renamed.queries = fs.readFileSync(path.join(tmp, "renamed-queries.txt"), "utf8").trim().split("\n");
});
after(() => { clean(K.root); clean(tmp); });

test("search is scoped by repo: alone, never org: (GitHub ORs the two)", () => {
  assert.ok(collision.queries.length >= 2, "both the PR and the issue search should have run");
  for (const q of collision.queries) {
    assert.ok(!/\borg:/.test(q), `no org: scope: ${q}`);
    assert.ok(q.includes(`repo:${K.issueRepo}`), `scoped to the issue repo: ${q}`);
  }
});

test("a search node from another repo in the org is dropped, even when its #number collides with a commit", () => {
  const nums = collision.json.decisions.map(d => d.issue);
  assert.ok(nums.includes(966), "this repo's own milestoned issue stays a decision");
  assert.ok(!nums.includes(2901), "core-team-issues#2901 must not become this repo's #2901 via the commit that names #2901");
  assert.match(collision.error, /dropped 1 result from other repos \(cargo-test\/core-team-issues\)/);
});

test("a commit naming 'other/repo#N' doesn't ship this repo's #N via commit-grep", () => {
  const row = collision.json.decisions.find(d => d.issue === 967);
  assert.ok(row, "#967 (milestoned) is a decision");
  assert.equal(row.main_commit, null, "only a cross-repo ref names 967 — nothing of ours shipped it");
});

test("a renamed repo is searched and cross-referenced under its current name", () => {
  assert.match(renamed.text, /was renamed to cargo-test\/cargo-renamed/);
  for (const q of renamed.queries) assert.ok(q.includes("repo:cargo-test/cargo-renamed"), `searched by the new name: ${q}`);
  const row = renamed.json.decisions.find(d => d.issue === 966);
  assert.ok(row, "#966 must survive the repo filter under the new name");
  assert.equal(row.linked_pr, 900, "PR #900's closingIssuesReferences (new name) must link #966");
});
