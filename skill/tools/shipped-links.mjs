// Reusable core: decides whether an issue/decision "shipped" using an EXPLICIT link only, and in what way.
// Built for internal requests 83/84 (pm/log.md "comprehension check instead of kill criterion 3"): both
// simulated readers of a shipped-count page distrusted a headline that skipped comment-linked PRs. The fix
// is to count every explicit link kind before showing a count at all, and to hide any stat built on too few
// rows. This module owns the counting; `shipped-record.mjs` (the shipped.json writer) and `score`/`shipped`
// commands call it rather than each re-implementing their own version.
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
//
// Three link kinds, checked in this priority order (an issue counts once, under the strongest kind that
// applies — this is also the order `pm/state/shipped.json`'s `linkTypes` and each row's `link` use):
//   1. closes    — GitHub's own closingIssuesReferences on a merged PR, OR a close/fix/resolve(s|d)? #N
//                   keyword found in that PR's own title/body (GitHub's closing-keyword convention; some
//                   older PRs or non-GitHub-App merges don't populate the GraphQL field even though the
//                   keyword is right there in the text).
//   2. mentions   — a literal "#N" anywhere in a merged PR's title, body, or commit messages, with no
//                   closing keyword needed.
//   3. timeline   — the issue's OWN GraphQL timelineItems: a CROSS_REFERENCED_EVENT sourced from a merged
//                   PR, or an IssueComment whose text names "#N" for a merged PR.
// Same-repo only everywhere: a reference to/from a different repo never counts.
// Only PRs merged into the detected integration branch count (skill/tools/integration-branch.mjs) — callers
// filter `mergedPRs` to that branch before calling `linksFromMergedPRs`; this module does not fetch or
// second-guess which branch a PR merged into.
//
// NEVER TEXT SIMILARITY (decisions.md "kill criterion 1"): nothing in this file
// compares titles or words. Every kind resolves to a literal GitHub relationship or a literal "#N" digit
// match — the same distinction that took explicit links from 9% correct (title matching) to 95% correct
// (closing ref + "#N") in kriter1/SONUC.md.

// The three kinds, in priority order. Matches pm/state/shipped.json's `linkTypes`/`link` vocabulary
// ("bet" is a fourth value reserved for N3's bet id; this module never produces it).
export const LinkKinds = ["closes", "mentions", "timeline"];

const CLOSE_KEYWORD = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)\b/gi;
// An optional "owner/repo" right before the "#" is captured: "Fixes twentyhq/core-team-issues#2926" in a
// twentyhq/twenty PR names ANOTHER repo's #2926, never twenty's own (seen on Twenty, 29 Sep).
const HASH_MENTION = /(?:\b([\w.-]+\/[\w.-]+))?#(\d+)\b/g;

// All issue numbers a merged PR closes via GitHub's own keyword convention, read from its title+body.
export function closingKeywordNumbers(text) {
  const out = new Set(); let m;
  CLOSE_KEYWORD.lastIndex = 0;
  while ((m = CLOSE_KEYWORD.exec(text || ""))) out.add(+m[2]);
  return out;
}

// All literal "#N" numbers mentioned anywhere in a text (a title, a body, or one commit message) that
// refer to THIS repo: a bare "#N", or "owner/repo#N" naming ownerRepo itself. A cross-repo "other/repo#N"
// is skipped (also when ownerRepo isn't given — a qualified ref can't be confirmed as ours then).
export function hashMentionNumbers(text, ownerRepo) {
  const out = new Set(); let m;
  const self = (ownerRepo || "").toLowerCase();
  HASH_MENTION.lastIndex = 0;
  while ((m = HASH_MENTION.exec(text || ""))) {
    if (m[1] && m[1].toLowerCase() !== self) continue;
    out.add(+m[2]);
  }
  return out;
}

function setEarliest(map, key, pr) {
  const cur = map.get(key);
  if (!cur || new Date(pr.mergedAt) < new Date(cur.mergedAt)) map.set(key, pr);
}

// Builds the `closes` / `mentions` maps from a repo's merged PRs (ALREADY filtered by the caller to the
// integration branch). `prs`: [{ number, title, body, mergedAt, mergeCommit: {oid},
// commitMessages: [string]?, closingIssuesReferences: [{ number, repository: {nameWithOwner} }]? }] —
// `closingIssuesReferences` is left in GitHub's own GraphQL shape (repository.nameWithOwner) so callers
// can forward `closingIssuesReferences(first: N) { nodes { number repository { nameWithOwner } } }`
// straight through, unchanged.
// Returns { closes: Map<issueNumber, pr>, mentions: Map<issueNumber, pr> }.
export function linksFromMergedPRs(prs, ownerRepo) {
  const closes = new Map();
  const mentions = new Map();
  for (const pr of prs) {
    // (a) GitHub's own closingIssuesReferences (same-repo only).
    for (const ref of pr.closingIssuesReferences || []) {
      if ((ref.repository?.nameWithOwner || "").toLowerCase() !== ownerRepo.toLowerCase()) continue;
      setEarliest(closes, ref.number, pr);
      mentions.delete(ref.number);
    }
    // (b) close|fix|resolve #N keyword in the PR's OWN title/body — same repo by construction (the PR
    // itself lives in ownerRepo), so no repo check is needed here.
    for (const n of closingKeywordNumbers(`${pr.title}\n${pr.body || ""}`)) { setEarliest(closes, n, pr); mentions.delete(n); }
    // (c) any other "#N" mention (title, body, or a commit message) that isn't already a `closes` link.
    const text = [pr.title, pr.body, ...(pr.commitMessages || [])].join("\n");
    for (const n of hashMentionNumbers(text, ownerRepo)) {
      if (closes.has(n)) continue;
      setEarliest(mentions, n, pr);
    }
  }
  return { closes, mentions };
}

// The GraphQL query used to read one issue's timeline (paginated by the caller's own `ghGraphQL`).
// Exported so callers (and the fake `gh` in skill/test/helpers.mjs) recognize it the same way.
export const TIMELINE_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      timelineItems(first: 50, after: $cursor, itemTypes: [CROSS_REFERENCED_EVENT, ISSUE_COMMENT]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on CrossReferencedEvent { source { __typename ... on PullRequest { number mergedAt repository { nameWithOwner } } } }
          ... on IssueComment { body }
        }
      }
    }
  }
}`;

// pm/log.md, "shipped 7d took ~143s": the timeline check used to be one `gh api
// graphql` PROCESS + one network round trip PER CANDIDATE ISSUE (up to `--timeline-limit`, 300 by default;
// each an independent `gh` spawn) — the single biggest cost on a busy repo (a 30-day window with a couple
// hundred "closed as completed, no link" issues means a couple hundred round trips in serial). GraphQL
// supports querying several objects in ONE request via aliases; `timelineBatchQuery` builds one query that
// asks for many issues' first timeline page at once (`i0: issue(number: …) { timelineItems … } i1: …`), so
// the caller can turn N round trips into N/batchSize. Issue numbers are always integers straight from
// GitHub's own API (never user text), so inlining them as literals (no `-F` variable per alias) is safe and
// keeps the query itself the only thing that has to change per batch.
// Kept in this module (query text + response parsing only, no process calls) for the same testability
// reason as the rest of this file — the actual `gh` invocation and its tolerant-of-partial-failure handling
// live in the caller (shipped-record.mjs), since only it knows how to run `gh` and recover its stdout on a
// non-zero exit (GitHub's GraphQL API returns errors AND partial data in the same response for a batch
// where only some aliases resolve — see shipped-record.mjs's `ghGraphQLTolerant`).
export function timelineBatchQuery(numbers) {
  const items = numbers.map((n, i) => `    i${i}: issue(number: ${n}) {
      timelineItems(first: 50, itemTypes: [CROSS_REFERENCED_EVENT, ISSUE_COMMENT]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on CrossReferencedEvent { source { __typename ... on PullRequest { number mergedAt repository { nameWithOwner } } } }
          ... on IssueComment { body }
        }
      }
    }`).join("\n");
  return `query($owner: String!, $repo: String!) {\n  repository(owner: $owner, name: $repo) {\n${items}\n  }\n}`;
}

// Parses one batched response (`{ data: { repository: { i0: {...}|null, i1: ... } } }`, as `gh api graphql`
// returns it — possibly alongside a non-zero exit / an `errors` array, which the caller already tolerated to
// get this far) into `Map<issueNumber, { failed, nodes, hasNextPage }>`, in the SAME order as `numbers`.
// `repository[alias]` is null exactly when that one issue's own lookup failed (GitHub's GraphQL API returns
// an explicit NOT_FOUND-shaped error for a bad `issue(number:)`, never a silent empty object) — the same
// condition the old per-issue `fetchIssueTimeline` call used to throw on, so `failed: true` here is the
// batched equivalent of that catch block, one entry per issue instead of aborting the whole run.
export function timelineBatchParse(data, numbers) {
  const out = new Map();
  const repository = data?.repository;
  for (let i = 0; i < numbers.length; i++) {
    const n = numbers[i];
    const issue = repository ? repository[`i${i}`] : null;
    if (!issue) { out.set(n, { failed: true, nodes: [], hasNextPage: false }); continue; }
    const t = issue.timelineItems;
    out.set(n, { failed: false, nodes: t?.nodes || [], hasNextPage: !!t?.pageInfo?.hasNextPage });
  }
  return out;
}

// Fetches the timeline nodes for one issue via the caller's own `ghGraphQL(query, vars)` runner (this
// module makes no process calls of its own, so it stays testable without a live `gh`). Never throws on a
// per-page basis in the sense that callers should wrap this call themselves — a failure here should be
// treated as "timeline not checked for this issue" (see `missingKinds` below), not as "no link found".
// Kept as the single-issue path: still used for the (rare) case a batched issue's first page has more than
// 50 timeline items (`hasNextPage`) — full multi-page pagination for just that one issue, exactly as before.
export function fetchIssueTimeline(ghGraphQL, owner, repo, number) {
  let cursor = null, nodes = [];
  for (let page = 0; page < 20; page++) {
    const vars = { owner, repo, number: String(number) };
    if (cursor) vars.cursor = cursor;
    const res = ghGraphQL(TIMELINE_QUERY, vars);
    const t = res?.data?.repository?.issue?.timelineItems;
    if (!t) break;
    nodes.push(...t.nodes);
    if (!t.pageInfo?.hasNextPage) break;
    cursor = t.pageInfo.endCursor;
  }
  return nodes;
}

// From one issue's raw timeline nodes, finds a same-repo MERGED PR referenced either by a
// CROSS_REFERENCED_EVENT or by a literal "#N" inside an IssueComment. `mergedPRByNumber`: Map<number, pr>
// of this repo's merged PRs (used to attach the PR's own title/mergedAt to a comment-only match).
// Returns { pr, via: "cross_reference" | "comment" } or null.
export function timelineLink(timelineNodes, ownerRepo, mergedPRByNumber) {
  for (const node of timelineNodes || []) {
    if (node.__typename !== "CrossReferencedEvent") continue;
    const src = node.source;
    if (!src || src.__typename !== "PullRequest" || !src.mergedAt) continue;
    if ((src.repository?.nameWithOwner || "").toLowerCase() !== ownerRepo.toLowerCase()) continue;
    const pr = mergedPRByNumber.get(src.number) || { number: src.number, mergedAt: src.mergedAt, title: null };
    return { pr, via: "cross_reference" };
  }
  for (const node of timelineNodes || []) {
    if (node.__typename !== "IssueComment") continue;
    for (const n of hashMentionNumbers(node.body, ownerRepo)) {
      const pr = mergedPRByNumber.get(n);
      if (pr) return { pr, via: "comment" };
    }
  }
  return null;
}

// Decides ONE issue's shipped link, given the maps from `linksFromMergedPRs` and (optionally) its
// already-fetched timeline link from `timelineLink`. Priority: closes > mentions > timeline.
// Returns { kind: "closes"|"mentions"|"timeline", pr, via? } or null (not shipped by any explicit link).
export function shippedLinkOf(issueNumber, { closes, mentions, timeline }) {
  if (closes.has(issueNumber)) return { kind: "closes", pr: closes.get(issueNumber) };
  if (mentions.has(issueNumber)) return { kind: "mentions", pr: mentions.get(issueNumber) };
  if (timeline) return { kind: "timeline", pr: timeline.pr, via: timeline.via };
  return null;
}

// a shipped-count HEADLINE is only trustworthy when every kind was actually checked
// this run (the comprehension check: both readers distrusted "4 shipped" once told comment-linked PRs
// weren't counted). `checked`: which kinds were actually looked at, e.g. { closes: true, mentions: true,
// timeline: false } when the timeline query failed or was skipped (no gh / rate limited / offline).
// Returns the list of kinds that were NOT checked — empty means the headline may be shown.
export function missingKinds(checked) {
  return LinkKinds.filter(k => !checked[k]);
}

// a rate/count built on fewer than `minimum` rows reads as padding (the comprehension
// check: "0 reverted" out of 4 read as padding to both simulated readers). `minimum` should come from
// thresholds.mjs's `minN` (sources.json's `threshold.minN`, default 10).
export function hasEnoughN(n, minimum) {
  return n >= minimum;
}
export function tooFewToSay(n) {
  return `too few to say (n=${n})`;
}

// Formats one shipped row into pm/state/shipped.json's row shape (N4's output contract). `kind` is the
// row's OWN kind ("decision" | "request" | "bet" — not the link kind); `ref` is how it's cited elsewhere
// (e.g. "#123" for a plain GitHub issue, "K180" for a decision id).
export function toShippedRecord({ ref, title, kind, team = null, opened, landed, prs, link, partly = false }) {
  const openedDate = opened ? new Date(opened) : null;
  const landedDate = landed ? new Date(landed) : null;
  const days = openedDate && landedDate ? +((landedDate - openedDate) / 86400000).toFixed(1) : null;
  return {
    ref, title, kind, team,
    opened: openedDate ? openedDate.toISOString().slice(0, 10) : null,
    landed: landedDate ? landedDate.toISOString().slice(0, 10) : null,
    days, prs: prs || [], link, partly,
  };
}

// The decision-log counterpart of `shippedLinkOf` (N1 hand check, pm/waves.md N1 "done when"):
// a decision-log source (KARARLAR.md, ADRs — no GitHub issue, so no closes/mentions/timeline) is
// "shipped" when some commit's OWN message names the decision's id (its `link` kind is "commit" — see
// scoreboard.mjs's LinkLabel). But a commit that names the decision while touching ONLY the decisions
// log file itself is just the sentence "we decided this" landing in the log; it never shipped the
// decision's content. Found on the first product: one decision ("the cleanup happens later, during the prod migration, not
// now") had exactly one matching commit — the one that wrote that sentence into KARARLAR.md — and
// nothing else, yet it scored "shipped same day" (0 days). Same shape for K36 (a table the decision
// says to drop, never dropped in any later migration) and K122 (a findings write-up with no code to
// ship, arguably fine on its own, but indistinguishable from that case by commit count alone).
// The fix: require at least one matching commit to touch a file OTHER than the decisions log itself.
// N1 (shipped-record.mjs's decisions mode, this same hand check re-run): the residual gap left after that
// first fix was K36 — their only naming commits touch OTHER planning docs (ROADMAP.md,
// docs/PLAN.md), not the decisions log itself, so the file-identity check alone let them through. The
// fix widens the check from "not the decisions log" to "not any doc-extension file" — a tunable
// `shippedIgnoreDocs` list (sources.json's `threshold.shippedIgnoreDocs`, default ["md","mdx","txt"],
// see thresholds.mjs) instead of a hardcoded product-specific path list.
// `commits`: [{ hash, date, files: [path,...] }] — every commit whose OWN message names this decision's
// id (already filtered by the caller, e.g. `git log --grep`). `decisionsPath`: the decisions log's own
// path (K.preread.decisions, e.g. "KARARLAR.md"), so it can be told apart from a real file even when its
// own extension isn't in the ignore list. `ignoreDocs`: extensions (no leading dot, case-insensitive)
// that never count as "real" on their own; defaults to DefaultIgnoreDocs.
// Returns the earliest qualifying commit, or null if every matching commit is self-referential-only /
// doc-only (the decision should stay "waiting", not "shipped").
export const DefaultIgnoreDocs = ["md", "mdx", "txt"];
const extOf = f => { const base = String(f).split("/").pop() || ""; const i = base.lastIndexOf("."); return i > 0 ? base.slice(i + 1).toLowerCase() : ""; };

// N1 polish round 2 (comment-only change): the file-identity/extension check above still let a self-referential commit
// through when it touched a REAL code file — but only its comments. one real case's single non-doc commit rewrote a
// code comment to cite the decision and never touched an executable line. A per-line, per-extension
// comment table catches this WITHOUT text similarity: a line counts as "comment or blank" only if it
// starts (after trimming) with a token this table lists for that file's extension; an unrecognized
// extension is never given the benefit of the doubt (`isCommentOrBlankLine` returns false for it, so the
// whole file's change is treated as real). Deliberately small and per-line only (no multi-line /* */
// state tracking) — the task's own "keep it a small table" / "keep it fast" bar.
export const CommentPrefixes = {
  js: ["//", "/*", "*", "*/"], mjs: ["//", "/*", "*", "*/"], cjs: ["//", "/*", "*", "*/"],
  ts: ["//", "/*", "*", "*/"], tsx: ["//", "/*", "*", "*/"], jsx: ["//", "/*", "*", "*/"],
  java: ["//", "/*", "*", "*/"], kt: ["//", "/*", "*", "*/"], swift: ["//", "/*", "*", "*/"],
  c: ["//", "/*", "*", "*/"], h: ["//", "/*", "*", "*/"], cpp: ["//", "/*", "*", "*/"], hpp: ["//", "/*", "*", "*/"],
  go: ["//", "/*", "*", "*/"], rs: ["//", "/*", "*", "*/"], css: ["/*", "*", "*/"], scss: ["//", "/*", "*", "*/"],
  sh: ["#"], bash: ["#"], zsh: ["#"], py: ["#"], rb: ["#"], yaml: ["#"], yml: ["#"], toml: ["#"],
  sql: ["--"],
  html: ["<!--", "-->"], htm: ["<!--", "-->"], vue: ["<!--", "-->"], svelte: ["<!--", "-->"], xml: ["<!--", "-->"],
};

// Pure, unit-testable: a line (from a diff's + or - side, marker already stripped) counts as comment or
// blank for `ext`. An extension with no entry in the table never counts as comment-only (unknown code
// stays "real" rather than risk hiding a real change).
export function isCommentOrBlankLine(line, ext) {
  const t = String(line ?? "").trim();
  if (!t) return true;
  const prefixes = CommentPrefixes[String(ext || "").toLowerCase()];
  if (!prefixes) return false;
  return prefixes.some(p => t.startsWith(p));
}

// Parses ONE commit's unified diff text (`git show --unified=0 <hash>` or `git diff <a> <b>`) and decides,
// per touched file, whether every added/removed content line is comment-or-blank for that file's own
// extension. Pure — no child process — so it's directly testable with a literal diff string. Returns
// Map<path, boolean>: true = this file's change in this diff is comment/blank-only (or has no textual
// +/- lines at all, e.g. a pure rename); a "Binary files ... differ" line marks that file's change as
// real (a binary diff can't be judged comment-only, so it must not be waved through as one).
export function commentOnlyByFile(diffText) {
  const result = new Map();
  let curFile = null, allCommentOrBlank = true;
  const flush = () => { if (curFile != null) result.set(curFile, allCommentOrBlank); };
  for (const line of String(diffText || "").split("\n")) {
    const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (m) { flush(); curFile = m[2] || m[1]; allCommentOrBlank = true; continue; }
    if (curFile == null) continue;
    if (/^Binary files .* differ$/.test(line)) { allCommentOrBlank = false; continue; }
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      if (!isCommentOrBlankLine(line.slice(1), extOf(curFile))) allCommentOrBlank = false;
    }
  }
  flush();
  return result;
}

export function decisionShippedBy(commits, decisionsPath, ignoreDocs = DefaultIgnoreDocs) {
  const ignore = new Set((ignoreDocs || DefaultIgnoreDocs).map(e => String(e).toLowerCase().replace(/^\./, "")));
  // `c.commentOnlyFiles`, if the caller provides it (a Set<path>), names files whose OWN diff in commit
  // `c` is comment/blank-only per `commentOnlyByFile` above — those don't count as "real" either, even
  // though their extension isn't a doc extension. Callers that don't set it keep the old file-identity-
  // only behavior (every existing caller/test still passes).
  const isDocOnly = (f, c) => f === decisionsPath || ignore.has(extOf(f)) || (c.commentOnlyFiles instanceof Set && c.commentOnlyFiles.has(f));
  const real = (commits || []).filter(c => (c.files || []).some(f => !isDocOnly(f, c)));
  if (!real.length) return null;
  return real.reduce((a, b) => (new Date(a.date) <= new Date(b.date) ? a : b));
}

// Formats the full pm/state/shipped.json contract. `checked`: the same shape `missingKinds` takes — the
// file's `linkTypes` lists only the kinds actually checked this run (the headline is shown only when
// "timeline" — the most expensive kind to check — is present, per the coordinating N4 session's contract).
export function toShippedFile({ repo, branch, from, to, checked, rows, counts }) {
  return {
    repo, branch, window: { from, to }, generated: new Date().toISOString(),
    linkTypes: LinkKinds.filter(k => checked[k]),
    shipped: rows,
    counts,
  };
}

// Library, not a CLI: a misdirected `node shipped-links.mjs ...` would otherwise
// print nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "shipped-links.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy shipped\` or \`node skill/tools/shipped-record.mjs\`?`);
  process.exit(1);
}
