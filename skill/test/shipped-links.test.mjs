// Unit tests for skill/tools/shipped-links.mjs's pure functions (no `gh`, no git — the GraphQL-fetching and
// git-log parts are covered end-to-end by skill/test/backfill-history.test.mjs, which is the only current
// caller of this module).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closingKeywordNumbers, hashMentionNumbers, linksFromMergedPRs, timelineLink, shippedLinkOf,
  missingKinds, hasEnoughN, tooFewToSay, LinkKinds, toShippedRecord, toShippedFile, decisionShippedBy,
  isCommentOrBlankLine, commentOnlyByFile, timelineBatchQuery, timelineBatchParse,
} from "../tools/shipped-links.mjs";

test("closingKeywordNumbers: finds close/fix/resolve + #N, case-insensitive, ignores plain #N", () => {
  assert.deepEqual([...closingKeywordNumbers("Closes #12")], [12]);
  assert.deepEqual([...closingKeywordNumbers("This FIXES #34 and resolved #56")].sort(), [34, 56]);
  assert.deepEqual([...closingKeywordNumbers("see also #78, unrelated")], []);
});

test("hashMentionNumbers: every literal #N in a text, de-duplicated", () => {
  assert.deepEqual([...hashMentionNumbers("touches #1 and #2, also #1 again")].sort(), [1, 2]);
  assert.deepEqual([...hashMentionNumbers("no numbers here")], []);
});

test("linksFromMergedPRs: closingIssuesReferences is same-repo only", () => {
  const prs = [{ number: 10, title: "fix", body: "", mergedAt: "2026-01-02", mergeCommit: { oid: "aaa" },
    closingIssuesReferences: [{ number: 100, repository: { nameWithOwner: "acme/widgets" } }, { number: 101, repository: { nameWithOwner: "fork/widgets" } }] }];
  const { closes } = linksFromMergedPRs(prs, "acme/widgets");
  assert.ok(closes.has(100), "same-repo closing reference should count");
  assert.ok(!closes.has(101), "cross-repo closing reference must be ignored");
});

test("linksFromMergedPRs: a close/fix/resolve keyword in the PR's own text also counts as `closes`", () => {
  const prs = [{ number: 11, title: "fix: pagination", body: "Fixes #200", mergedAt: "2026-01-02", mergeCommit: { oid: "bbb" }, closingIssuesReferences: [] }];
  const { closes } = linksFromMergedPRs(prs, "acme/widgets");
  assert.equal(closes.get(200).number, 11);
});

test("linksFromMergedPRs: a bare #N with no closing keyword is `mentions`, not `closes`", () => {
  const prs = [{ number: 12, title: "docs: mention #300 in changelog", body: "", mergedAt: "2026-01-02", mergeCommit: { oid: "ccc" }, closingIssuesReferences: [] }];
  const { closes, mentions } = linksFromMergedPRs(prs, "acme/widgets");
  assert.ok(!closes.has(300));
  assert.equal(mentions.get(300).number, 12);
});

test("linksFromMergedPRs: `closes` wins over `mentions` for the same issue across different PRs", () => {
  const prs = [
    { number: 13, title: "mentions #400 in passing", body: "", mergedAt: "2026-01-01", mergeCommit: { oid: "ddd" }, closingIssuesReferences: [] },
    { number: 14, title: "fix: the thing", body: "Closes #400", mergedAt: "2026-01-02", mergeCommit: { oid: "eee" }, closingIssuesReferences: [] },
  ];
  const { closes, mentions } = linksFromMergedPRs(prs, "acme/widgets");
  assert.equal(closes.get(400).number, 14);
  assert.ok(!mentions.has(400), "an issue already resolved as `closes` should not also sit in `mentions`");
});

test("linksFromMergedPRs: reads commit messages too, not just title/body", () => {
  const prs = [{ number: 15, title: "chore", body: "", mergedAt: "2026-01-02", mergeCommit: { oid: "fff" },
    closingIssuesReferences: [], commitMessages: ["unrelated", "touches #500 as a side effect"] }];
  const { mentions } = linksFromMergedPRs(prs, "acme/widgets");
  assert.equal(mentions.get(500).number, 15);
});

test("timelineLink: a CrossReferencedEvent from a merged same-repo PR wins over a comment mention", () => {
  const mergedByNum = new Map([[900, { number: 900, mergedAt: "2026-02-01", title: "t" }]]);
  const nodes = [
    { __typename: "IssueComment", body: "see #900" },
    { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", number: 900, mergedAt: "2026-02-01", repository: { nameWithOwner: "acme/widgets" } } },
  ];
  const link = timelineLink(nodes, "acme/widgets", mergedByNum);
  assert.equal(link.via, "cross_reference");
  assert.equal(link.pr.number, 900);
});

test("timelineLink: an unmerged or cross-repo CrossReferencedEvent is ignored", () => {
  const mergedByNum = new Map();
  const nodes = [
    { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", number: 901, mergedAt: null, repository: { nameWithOwner: "acme/widgets" } } },
    { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", number: 902, mergedAt: "2026-02-01", repository: { nameWithOwner: "fork/widgets" } } },
  ];
  assert.equal(timelineLink(nodes, "acme/widgets", mergedByNum), null);
});

test("timelineLink: falls back to a comment's #N when it names a known merged PR", () => {
  const mergedByNum = new Map([[903, { number: 903, mergedAt: "2026-02-03", title: "t" }]]);
  const nodes = [{ __typename: "IssueComment", body: "Landed in #903, thanks!" }];
  const link = timelineLink(nodes, "acme/widgets", mergedByNum);
  assert.equal(link.via, "comment");
  assert.equal(link.pr.number, 903);
});

test("shippedLinkOf: priority is closes > mentions > timeline", () => {
  const closes = new Map([[1, { number: 1 }]]);
  const mentions = new Map([[1, { number: 2 }], [3, { number: 3 }]]);
  assert.equal(shippedLinkOf(1, { closes, mentions, timeline: { pr: { number: 9 }, via: "comment" } }).kind, "closes");
  assert.equal(shippedLinkOf(3, { closes, mentions, timeline: { pr: { number: 9 }, via: "comment" } }).kind, "mentions");
  assert.equal(shippedLinkOf(5, { closes, mentions, timeline: { pr: { number: 9 }, via: "comment" } }).kind, "timeline");
  assert.equal(shippedLinkOf(5, { closes, mentions, timeline: null }), null);
});

test("missingKinds / hasEnoughN / tooFewToSay", () => {
  assert.deepEqual(missingKinds({ closes: true, mentions: true, timeline: true }), []);
  assert.deepEqual(missingKinds({ closes: true, mentions: true, timeline: false }), ["timeline"]);
  assert.equal(LinkKinds.length, 3);
  assert.equal(hasEnoughN(9, 10), false);
  assert.equal(hasEnoughN(10, 10), true);
  assert.equal(tooFewToSay(4), "too few to say (n=4)");
});

test("toShippedRecord: computes `days` from opened/landed and passes kind/link through", () => {
  const r = toShippedRecord({ ref: "#12", title: "t", kind: "request", opened: "2026-01-01T00:00:00Z", landed: "2026-01-11T00:00:00Z", prs: [{ n: 1, title: "pr", merged: "2026-01-11" }], link: "closes" });
  assert.equal(r.ref, "#12");
  assert.equal(r.opened, "2026-01-01");
  assert.equal(r.landed, "2026-01-11");
  assert.equal(r.days, 10);
  assert.equal(r.link, "closes");
  assert.equal(r.partly, false);
});

test("decisionShippedBy: a commit that only touches the decisions log itself doesn't ship the decision", () => {
  const commits = [{ hash: "a1", date: "2026-09-17", files: ["KARARLAR.md"] }];
  assert.equal(decisionShippedBy(commits, "KARARLAR.md"), null);
});

test("decisionShippedBy: a commit that also touches another file ships it", () => {
  const commits = [{ hash: "a1", date: "2026-09-17", files: ["KARARLAR.md", "deploy/docker-compose.prod.yaml"] }];
  const r = decisionShippedBy(commits, "KARARLAR.md");
  assert.equal(r.hash, "a1");
});

test("decisionShippedBy: picks the EARLIEST commit that touches a real file, ignoring self-referential-only ones", () => {
  const commits = [
    { hash: "docs-only-1", date: "2026-09-01", files: ["KARARLAR.md"] },
    { hash: "real-later", date: "2026-09-05", files: ["KARARLAR.md", "apps/backend/x.go"] },
    { hash: "docs-only-2", date: "2026-09-10", files: ["KARARLAR.md"] },
  ];
  const r = decisionShippedBy(commits, "KARARLAR.md");
  assert.equal(r.hash, "real-later");
});

test("decisionShippedBy: no commits at all -> null (waiting, not shipped)", () => {
  assert.equal(decisionShippedBy([], "KARARLAR.md"), null);
  assert.equal(decisionShippedBy(undefined, "KARARLAR.md"), null);
});

// N1 polish round 2 (comment-only change): a commit that names a decision and touches a real (non-doc) file, but only
// changes a comment line inside it, must not ship the decision either — decisionShippedBy honors a
// caller-supplied `commentOnlyFiles` Set per commit.
test("isCommentOrBlankLine: blank and per-extension comment prefixes recognized; unknown extensions never are", () => {
  assert.equal(isCommentOrBlankLine("", "js"), true);
  assert.equal(isCommentOrBlankLine("   ", "go"), true);
  assert.equal(isCommentOrBlankLine("// a note", "js"), true);
  assert.equal(isCommentOrBlankLine("  * inside a block comment", "ts"), true);
  assert.equal(isCommentOrBlankLine("*/", "java"), true);
  assert.equal(isCommentOrBlankLine("# a shell comment", "sh"), true);
  assert.equal(isCommentOrBlankLine("-- a sql comment", "sql"), true);
  assert.equal(isCommentOrBlankLine("<!-- a note -->", "html"), true);
  assert.equal(isCommentOrBlankLine("export function f() {}", "js"), false);
  assert.equal(isCommentOrBlankLine("# looks like a comment", "rs"), false, "rs has no '#' entry in the table");
  assert.equal(isCommentOrBlankLine("anything", "weirdext"), false, "unknown extensions are never comment-only");
});

test("commentOnlyByFile: a diff that only adds/removes comment or blank lines is marked comment-only per file", () => {
  const diff = [
    "diff --git a/backend/k80.js b/backend/k80.js",
    "index 111..222 100644",
    "--- a/backend/k80.js",
    "+++ b/backend/k80.js",
    "@@ -1,1 +1,2 @@",
    " export function k80() { return true; }",
    "+// K80: recorded, not implemented yet",
  ].join("\n");
  const r = commentOnlyByFile(diff);
  assert.equal(r.get("backend/k80.js"), true);
});

test("commentOnlyByFile: a diff with even one real code line is NOT comment-only", () => {
  const diff = [
    "diff --git a/backend/k81.js b/backend/k81.js",
    "--- a/backend/k81.js",
    "+++ b/backend/k81.js",
    "@@ -1,1 +1,2 @@",
    "-export function k81() { return 0; }",
    "+// K81: implementing this now",
    "+export function k81() { return 42; }",
  ].join("\n");
  const r = commentOnlyByFile(diff);
  assert.equal(r.get("backend/k81.js"), false);
});

test("commentOnlyByFile: a binary-file diff is never comment-only; multiple files in one diff are judged separately", () => {
  const diff = [
    "diff --git a/assets/logo.png b/assets/logo.png",
    "Binary files a/assets/logo.png and b/assets/logo.png differ",
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1,0 +1,1 @@",
    "+// not really a comment in markdown, but this file isn't even checked by extension",
  ].join("\n");
  const r = commentOnlyByFile(diff);
  assert.equal(r.get("assets/logo.png"), false);
  // README.md has no entry in CommentPrefixes ("md" isn't a code extension in the table) -> not comment-only.
  assert.equal(r.get("README.md"), false);
});

test("decisionShippedBy: a commit's commentOnlyFiles Set excludes a real, non-doc file from counting as shipped", () => {
  const commits = [{ hash: "c1", date: "2026-09-01", files: ["KARARLAR.md", "backend/k80.js"], commentOnlyFiles: new Set(["backend/k80.js"]) }];
  assert.equal(decisionShippedBy(commits, "KARARLAR.md"), null, "the only non-doc file's change was comment-only");
});

test("decisionShippedBy: a commit with a REAL change in one file and a comment-only change in another still ships", () => {
  const commits = [{ hash: "c1", date: "2026-09-01", files: ["backend/k81.js", "backend/other.js"], commentOnlyFiles: new Set(["backend/other.js"]) }];
  const r = decisionShippedBy(commits, "KARARLAR.md");
  assert.equal(r.hash, "c1");
});

test("toShippedFile: linkTypes only lists kinds actually checked this run", () => {
  const f = toShippedFile({ repo: "acme/widgets", branch: "main", from: "2026-01-01", to: "2026-02-01",
    checked: { closes: true, mentions: true, timeline: false }, rows: [], counts: { requests: 0, open: 0, closedNoLink: 0 } });
  assert.deepEqual(f.linkTypes, ["closes", "mentions"]);
  assert.equal(f.repo, "acme/widgets");
  assert.equal(f.window.from, "2026-01-01");
});

// timelineBatchQuery/timelineBatchParse replace one `gh api graphql` call PER issue
// with several issues aliased into ONE call — this is the pure query-building/response-parsing half (no
// process calls; the actual `gh` invocation and its "still-parse-stdout-on-non-zero-exit" tolerance live in
// shipped-record.mjs, since only it knows how to run `gh`).
test("timelineBatchQuery: aliases each issue as i0, i1, ... with its own literal number, one query", () => {
  const q = timelineBatchQuery([101, 205, 9]);
  assert.match(q, /i0: issue\(number: 101\)/);
  assert.match(q, /i1: issue\(number: 205\)/);
  assert.match(q, /i2: issue\(number: 9\)/);
  assert.match(q, /\$owner: String!, \$repo: String!/);
});

test("timelineBatchParse: maps each alias back to its own issue number, in the given order", () => {
  const data = { repository: {
    i0: { timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ __typename: "IssueComment", body: "hi" }] } },
    i1: { timelineItems: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [] } },
  } };
  const r = timelineBatchParse(data, [101, 205]);
  assert.equal(r.get(101).failed, false);
  assert.equal(r.get(101).nodes.length, 1);
  assert.equal(r.get(101).hasNextPage, false);
  assert.equal(r.get(205).failed, false);
  assert.equal(r.get(205).hasNextPage, true, "a first page reporting hasNextPage must be surfaced, so the caller can fall back to full pagination for just that issue");
});

test("timelineBatchParse: a null alias (GitHub couldn't resolve that one issue) is 'failed', not silently empty", () => {
  const data = { repository: { i0: null, i1: { timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] } } } };
  const r = timelineBatchParse(data, [999999, 1]);
  assert.equal(r.get(999999).failed, true, "a not-found issue in the batch must be distinguishable from one with an empty timeline");
  assert.equal(r.get(1).failed, false);
});

test("timelineBatchParse: a missing repository (the whole call failed) marks every issue in the batch failed", () => {
  const r = timelineBatchParse(undefined, [1, 2, 3]);
  for (const n of [1, 2, 3]) assert.equal(r.get(n).failed, true);
});

test("hashMentionNumbers: a cross-repo 'owner/repo#N' names another repo's #N, never ours", () => {
  assert.deepEqual([...hashMentionNumbers("Fixes twentyhq/core-team-issues#2926", "twentyhq/twenty")], []);
  assert.deepEqual([...hashMentionNumbers("see #12, (#13), PR#15 and TwentyHQ/twenty#14", "twentyhq/twenty")].sort((a, b) => a - b), [12, 13, 14, 15]);
  assert.deepEqual([...hashMentionNumbers("x/y#1 #2")], [2], "without ownerRepo a qualified ref can't be confirmed as ours");
});

test("linksFromMergedPRs: 'Fixes other/repo#N' in a PR body is neither a close nor a mention of our #N", () => {
  const pr = { number: 26714, title: "Fix index metadata", body: "Fixes twentyhq/core-team-issues#2926", mergedAt: "2026-09-26T00:00:00Z", closingIssuesReferences: [] };
  const { closes, mentions } = linksFromMergedPRs([pr], "twentyhq/twenty");
  assert.ok(!closes.has(2926) && !mentions.has(2926));
});
