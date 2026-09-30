// Contract test for skill/tools/shipped-record.mjs (was experiments/backfill-history.mjs), now backed by skill/tools/shipped-links.mjs
// (pm/log.md "comprehension check instead of kill criterion 3"):
//   - every one of the 3 link kinds (closes, mentions, timeline) must independently establish "shipped";
//   - internal request 74's same-repo rule still holds for closing references;
//   - a missing kind (e.g. the PR search fails) suppresses the shipped headline entirely;
//   - a rate/count on too few rows prints "too few to say" instead of the number.
// Runs against the fake product "Cargo"'s local repo, with a fake `gh` answering the PR/issue search and
// per-issue timeline GraphQL calls the script makes (no network).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean } from "./helpers.mjs";

const Script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools", "shipped-record.mjs");

let K, gh, tmp, output, shippedJsonPath;

before(async () => {
  K = await fakeProductSetup();
  const ownerRepo = K.issueRepo; // "cargo-test/cargo"
  const now = new Date().toISOString();

  // Merged PRs, all into "main" (the fake product's default branch — internal request 83's branch filter).
  K.gh.searchPRs = [
    // 900: closes #950 IN this repo (GitHub's own closingIssuesReferences) -> `closes`.
    { number: 900, title: "fix: shipment list pagination", body: "", baseRefName: "main", mergedAt: now, createdAt: now,
      mergeCommit: { oid: K.commits.at(-1).hash },
      closingIssuesReferences: { nodes: [{ number: 950, repository: { nameWithOwner: ownerRepo } }] } },
    // 901: closes #951, but the reference is to an issue in a DIFFERENT (fork) repo -> must be ignored.
    { number: 901, title: "fix: upstream cherry-pick", body: "", baseRefName: "main", mergedAt: now, createdAt: now,
      mergeCommit: { oid: K.commits.at(-2).hash },
      closingIssuesReferences: { nodes: [{ number: 951, repository: { nameWithOwner: "someone-else/fork" } }] } },
    // 902: no closing keyword, no #N mention anywhere — only reachable through #953's OWN timeline.
    { number: 902, title: "feat: shipment archive cleanup", body: "", baseRefName: "main", mergedAt: now, createdAt: now,
      mergeCommit: { oid: K.commits.at(-3).hash }, closingIssuesReferences: { nodes: [] } },
    // 903: same — only reachable through #954's timeline, via an ISSUE COMMENT naming "#903".
    { number: 903, title: "feat: invoice numbering fix", body: "", baseRefName: "main", mergedAt: now, createdAt: now,
      mergeCommit: { oid: K.commits.at(-4).hash }, closingIssuesReferences: { nodes: [] } },
    // 904: a bare "#955" with no closing keyword -> `mentions`.
    { number: 904, title: "docs: mention #955 in the changelog", body: "", baseRefName: "main", mergedAt: now, createdAt: now,
      mergeCommit: { oid: K.commits.at(-5).hash }, closingIssuesReferences: { nodes: [] } },
  ];
  K.gh.searchIssues = [
    // 950: no feature label, not a team member -> only becomes a "decision" via the (same-repo) `closes` link.
    { number: 950, title: "Shipment list is slow to paginate", body: "", createdAt: now, closedAt: now,
      state: "CLOSED", stateReason: "COMPLETED", author: { login: "customer1" }, authorAssociation: "NONE", labels: { nodes: [] } },
    // 951: same shape, but its only closing reference is cross-repo -> must NOT become a decision.
    { number: 951, title: "Please cherry-pick this upstream fix", body: "", createdAt: now, closedAt: now,
      state: "CLOSED", stateReason: "COMPLETED", author: { login: "customer2" }, authorAssociation: "NONE", labels: { nodes: [] } },
    // 953/954/955: milestoned (a bare "enhancement" label no longer counts on its
    // own; a milestone is a signal that needs no sources.json configuration) so they qualify as decisions
    // on their own (independent of being pre-linked) — this is what lets the timeline check even look at them.
    { number: 953, title: "Archive cleanup for old shipments", body: "", createdAt: now, closedAt: now,
      state: "CLOSED", stateReason: "COMPLETED", author: { login: "customer3" }, authorAssociation: "NONE", labels: { nodes: [{ name: "enhancement" }] }, milestone: { title: "v60" } },
    { number: 954, title: "Invoice numbering off by one", body: "", createdAt: now, closedAt: now,
      state: "CLOSED", stateReason: "COMPLETED", author: { login: "customer4" }, authorAssociation: "NONE", labels: { nodes: [{ name: "enhancement" }] }, milestone: { title: "v60" } },
    { number: 955, title: "Changelog missing recent fixes", body: "", createdAt: now, closedAt: now,
      state: "CLOSED", stateReason: "COMPLETED", author: { login: "customer5" }, authorAssociation: "NONE", labels: { nodes: [{ name: "enhancement" }] }, milestone: { title: "v60" } },
  ];
  // #953's own timeline: a CROSS_REFERENCED_EVENT sourced from merged PR #902 (no keyword, no #N text at all).
  // #954's own timeline: an IssueComment naming "#903" (a merged PR, via a human note, not a keyword).
  K.gh.issueTimeline = {
    "953": [{ __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", number: 902, mergedAt: now, repository: { nameWithOwner: ownerRepo } } }],
    "954": [{ __typename: "IssueComment", body: "Fixed by #903, thanks for the report!" }],
  };

  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-backfill-");
  const jsonPath = path.join(tmp, "backfill.json");
  shippedJsonPath = path.join(tmp, "shipped.json");
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--json", jsonPath, "--shipped-json", shippedJsonPath], { env: gh.env });
  assert.equal(r.code, 0, `backfill-history: unexpected exit code, stderr: ${r.error}`);
  output = { text: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

test("closes: a same-repo closing reference maps the issue to main", () => {
  const row = output.json.decisions.find(d => d.issue === 950);
  assert.ok(row, "#950 (closed by an in-repo PR) should be a decision row");
  assert.equal(row.linked_pr, 900);
  assert.equal(row.source, "closes");
  assert.ok(row.main_entry, "main_entry should be set from the merging PR");
});

test("a cross-repo (fork) closing reference is ignored — the issue never becomes a decision", () => {
  const row = output.json.decisions.find(d => d.issue === 951);
  assert.equal(row, undefined,
    "#951's only closing reference is to a different repo; it must not be treated as linked, and has no " +
    "feature label or team authorship of its own, so it should not appear as a decision at all");
});

test("timeline (cross_reference): #953 ships via its OWN timeline's CrossReferencedEvent, with no keyword or #N text anywhere", () => {
  const row = output.json.decisions.find(d => d.issue === 953);
  assert.ok(row, "#953 should be a decision (feature-labeled)");
  assert.equal(row.source, "timeline");
  assert.equal(row.link_via, "cross_reference");
  assert.equal(row.linked_pr, 902);
  assert.ok(row.main_entry);
});

test("timeline (comment): #954 ships via a comment naming a merged PR on its OWN timeline", () => {
  const row = output.json.decisions.find(d => d.issue === 954);
  assert.ok(row);
  assert.equal(row.source, "timeline");
  assert.equal(row.link_via, "comment");
  assert.equal(row.linked_pr, 903);
});

test("mentions: a bare #N with no closing keyword still counts, labeled `mentions`", () => {
  const row = output.json.decisions.find(d => d.issue === 955);
  assert.ok(row);
  assert.equal(row.source, "mentions");
  assert.equal(row.linked_pr, 904);
});

test("prints which integration branch it used (falls back gracefully with no gh pr-list-merged fixture)", () => {
  assert.match(output.text, /Integration branch:/);
});

test("summary splits the mapped count by link kind and shows the headline once every kind was checked", () => {
  const s = output.json.summary;
  assert.deepEqual(s.checked_kinds, { closes: true, mentions: true, timeline: true });
  assert.deepEqual(s.missing_kinds, []);
  assert.equal(s.headline_shown, true);
  assert.equal(s.mapped_by_kind.closes, 1);
  assert.equal(s.mapped_by_kind.mentions, 1);
  assert.equal(s.mapped_by_kind.timeline, 2);
});

test("a rate on a handful of rows prints \"too few to say\" instead of the number", () => {
  const s = output.json.summary;
  assert.ok(s.mapped_count < s.min_n, "this fixture is deliberately smaller than min_n, to exercise the guard");
  assert.match(s.display.back_received_count, /too few to say \(n=\d+\)/);
  assert.match(s.display.patched_count, /too few to say \(n=\d+\)/);
  assert.match(output.text, /too few to say/);
});

test("pm/state/shipped.json contract: linkTypes lists every checked kind, rows carry ref/kind/link", () => {
  const j = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  assert.deepEqual(j.linkTypes, ["closes", "mentions", "timeline"]);
  assert.equal(j.repo, K.issueRepo);
  const row950 = j.shipped.find(r => r.ref === "#950");
  assert.ok(row950);
  assert.equal(row950.kind, "request");
  assert.equal(row950.link, "closes");
  assert.equal(row950.prs[0].n, 900);
  assert.equal(j.counts.requests, output.json.decisions.length);
});

test("pm/state/shipped.json: a second run read-modify-writes, keeping keys it doesn't own", () => {
  const before = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  before.recent = { note: "written by the N2 branch, not ours" };
  before.undecided = [{ ref: "#999" }];
  fs.writeFileSync(shippedJsonPath, JSON.stringify(before, null, 2));
  const jsonPath2 = path.join(tmp, "backfill2.json");
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--json", jsonPath2, "--shipped-json", shippedJsonPath], { env: gh.env });
  assert.equal(r.code, 0);
  const after = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  assert.deepEqual(after.recent, { note: "written by the N2 branch, not ours" });
  assert.deepEqual(after.undecided, [{ ref: "#999" }]);
  assert.ok(after.shipped.length > 0, "this script's own keys should still be refreshed");
});

// --- a separate run: the PR search itself fails -> closes/mentions/timeline all become "not checked" ------
test("no shipped headline is shown when a link kind couldn't be checked (PR search fails)", () => {
  const brokenGhFixture = { ...K.gh, searchPRs: undefined };
  const brokenGh = fakeGhSetup(brokenGhFixture);
  const jsonPath = path.join(tmp, "backfill-broken.json");
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--json", jsonPath], { env: brokenGh.env });
  assert.equal(r.code, 0, `should still exit cleanly, stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.summary.headline_shown, false);
  assert.deepEqual(j.summary.missing_kinds.sort(), ["closes", "mentions", "timeline"]);
  assert.match(r.output, /No shipped headline shown/);
  clean(brokenGh.dir);
});

// --- the batched timeline query's partial-failure handling — one issue in the SAME
// batch fails to resolve, the others in that batch must still get their real timeline result. -------------
test("timeline batching: one issue failing to resolve doesn't lose the others in the same batch, but does still suppress the headline", () => {
  const brokenGhFixture = { ...K.gh, issueTimelineFail: ["953"] }; // #953 ships via timeline in the base fixture (see `before`)
  const brokenGh = fakeGhSetup(brokenGhFixture);
  const jsonPath = path.join(tmp, "backfill-timeline-partial.json");
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--json", jsonPath], { env: brokenGh.env });
  assert.equal(r.code, 0, `should still exit cleanly, stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  // #953 (the one whose alias failed) must not be mapped via timeline.
  const row953 = j.decisions.find(d => d.issue === 953);
  assert.equal(row953.source, null, "#953's own timeline lookup failed; it must not show a main_entry from a stale/guessed result");
  // #954 (a DIFFERENT issue in the same batch) must still resolve normally.
  const row954 = j.decisions.find(d => d.issue === 954);
  assert.equal(row954.source, "timeline");
  assert.equal(row954.link_via, "comment");
  // one failed lookup this run still means "timeline" wasn't fully checked -> no shipped headline.
  assert.equal(j.summary.headline_shown, false);
  assert.ok(j.summary.missing_kinds.includes("timeline"));
  clean(brokenGh.dir);
});
