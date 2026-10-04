// The core shipped-record writer: builds pm/state/shipped.json (N4's output contract, rendered by
// scoreboard.mjs) from a repo's actual git/GitHub history — no LLM, no title similarity, explicit
// links only. Two source modes, chosen by the caller (nosy.mjs's `shipped` command):
//   - GitHub-issue mode (default, needs `gh` + an owner/repo): "decisions" are GitHub issues; shipped
//     is decided from skill/tools/shipped-links.mjs's closes/mentions/timeline link kinds.
//   - decisions-log mode (`--decisions <path>`, N1): "decisions" are blocks read by read-decisions.mjs
//     from a KARARLAR.md/ADR-style log (no GitHub issue tracker at all); shipped is decided from
//     shipped-links.mjs's `decisionShippedBy` — a commit whose OWN message names the decision's id, that
//     also touches a file that isn't the decisions log or another doc-only file (thresholds.mjs's
//     `shippedIgnoreDocs`). See the "--- decisions-log mode ---" section below.
// History: started as an experiment (kill criterion 1 for pm/decisions.md's "product bets ledger" open
// decision — backfilling GitHub issues/PRs accepted in the last N days onto main) and was promoted to
// skill/tools/ once internal requests 83/84 (pm/log.md "comprehension check instead of kill criterion 3")
// made the shipped-headline/too-few-to-say rules load-bearing; the decisions-log mode was added for N1
// (a decision-log product like a real legal-tech product, which uses no GitHub issues as its record at all).
// GitHub-issue mode's decision definition (derived from the GitHub issue/PR archive, no DECISIONS.md;
// used to be ANY issue opened in the window that had a feature/enhancement label OR
// was opened by a team member, which made every issue on a busy repo with no curated label convention count
// as a "decision", 133/133 on Twenty): an issue opened in the last N days counts ONLY when at least one of
// these three EXPLICIT signals is present (can be closed or open):
//   (a) a label the product's OWN sources.json names in `issue.decisionLabels` (never a guessed word —
//       "feature"/"enhancement" are GitHub defaults many repos slap on every request, not a decision marker);
//   (b) a milestone (GitHub's own "this was actually planned" signal, no configuration needed);
//   (c) an explicit link to a merged PR (skill/tools/shipped-links.mjs: closes, mentions, or timeline).
// Entry into main: for (c), the linked PR's merge commit; for (a)/(b) alone, the first commit on main that
// mentions the issue number. Which signal(s) fired is printed every run ("decisions: N issues (...); M
// other issues not counted as decisions") — when NONE of the three ever fires, that's said plainly instead
// of printing a headline count next to the full issue total (a fake denominator).
// kill criterion 1, pm/log.md "second run": the manual check on explicit links (closing
// ref + an explicit "#N" mention) scored 95% correct. A third tier tried elsewhere (title similarity, no
// explicit link at all) scored 5/57. On purpose, this script has NO title-similarity fallback: `mainEntry` is
// only ever set from an explicit link. If a text/word-similarity tier is ever added here, it must be kept
// out of `main_entry`/`mapped_count`/`summary` (which the "shipped to main" line is built from) and reported
// separately as a labeled "candidate — confirm" list instead.
// pm/log.md "comprehension check instead of kill criterion 3": the linking logic
// itself now lives in skill/tools/shipped-links.mjs (closes / mentions / timeline, same-repo, integration-
// branch-only — this script no longer owns it), a shipped headline is suppressed unless every kind was
// actually checked this run, and any rate/count built on fewer than `thresholds.mjs`'s `minN` rows prints
// "too few to say" instead of the number.
// Usage (GitHub-issue mode): node shipped-record.mjs <repo-folder> <owner/repo> [--day 90] [--json output.json]
//   [--shipped-json pm/state/shipped.json] [--no-timeline] [--timeline-limit 150] [--pm <pm folder>]
//   --pm, if given, loads that product's sources.json for `issue.decisionLabels` (
//   falls back to no configured labels, i.e. only milestone/explicit-link signals, if omitted or unreadable).
// Usage (decisions-log mode): node shipped-record.mjs <repo-folder> --decisions <path> [--pm <pm folder>]
//   [--day 90] [--json output.json] [--shipped-json pm/state/shipped.json]
//   <path> is K.preread.decisions (a single file, a directory, or a glob — see read-decisions.mjs);
//   --pm, if given, loads that product's sources.json for refs.mjs's reference patterns and
//   thresholds.mjs's `shippedIgnoreDocs` (falls back to the defaults otherwise).
import { localDay, localDayOf } from "./today.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { integrationBranchOf, partialCloneNoticeOf } from "./integration-branch.mjs";
import {
  linksFromMergedPRs, fetchIssueTimeline, timelineBatchQuery, timelineBatchParse, timelineLink,
  shippedLinkOf, missingKinds, hasEnoughN, tooFewToSay, toShippedRecord, toShippedFile, LinkKinds,
  decisionShippedBy, commentOnlyByFile, hashMentionNumbers,
} from "./shipped-links.mjs";
import { thresholds } from "./thresholds.mjs";
import { decisionsOfRead, eventRefOf } from "./read-decisions.mjs";
import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs";
import { compute as metricsCompute } from "./scan-metrics.mjs";
import { readSources } from "./sources-file.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const dayN = +(opt("--day") || 90);
const jsonOut = opt("--json");
const shippedJsonOut = opt("--shipped-json");
const noTimeline = flag("--no-timeline");
const timelineLimit = +(opt("--timeline-limit") || 300);
const decisionsPath = opt("--decisions"); // decisions-log mode (N1): K.preread.decisions, e.g. "KARARLAR.md"
const pmFolder = opt("--pm"); // decisions-log mode: loads refs.mjs patterns + thresholds.mjs's shippedIgnoreDocs
const noPr = flag("--no-pr"); // decisions-log mode: skip the "merged PR names it" link kind entirely
const prLimit = +(opt("--pr-limit") || 500); // decisions-log mode: gh pr list --limit
const MIN_N = thresholds(pmFolder).minN;
const [repoDir, ownerRepo] = argv;
if (!repoDir || (!ownerRepo && !decisionsPath)) {
  console.error("usage: shipped-record.mjs <repo-folder> <owner/repo> [--day 90] [--json output.json] [--shipped-json f] [--no-timeline] [--timeline-limit 300] [--pm <pm folder>]\n" +
    "   or: shipped-record.mjs <repo-folder> --decisions <path> [--pm <pm folder>] [--day 90] [--json output.json] [--shipped-json f] [--no-pr] [--pr-limit 500]");
  process.exit(1);
}

const sinceDate = localDayOf(Date.now() - dayN * 86400000);
// A partial/shallow clone makes the comment-only diff reads fetch blobs: say so up front.
{ const p = partialCloneNoticeOf(repoDir); if (p) process.stderr.write(`shipped-record: ${p}\n`); }

// --- git helpers + integration-branch detection (local, shallow clone; main branch instead of --all) ---
// Moved ahead of the GitHub-issue-mode fetches below (internal request 73's detection needs only repoDir/
// ownerRepo, never the fetched PR/issue nodes) so decisions-log mode — which needs MAIN but none of the
// GitHub fetches — can run and exit before any `gh api graphql` call is made.
function defaultBranchLocal() {
  try { return execFileSync("git", ["-C", repoDir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8" }).trim().replace(/^origin\//, "origin/"); }
  catch { for (const b of ["origin/main", "origin/master", "origin/develop"]) { try { execFileSync("git", ["-C", repoDir, "rev-parse", "--verify", b], { encoding: "utf8" }); return b; } catch {} } return "HEAD"; }
}
// Integration branch: some projects merge to a branch other than the default one
// before releasing (e.g. Hoppscotch -> next, Plane -> preview). Falls back to the local default branch if
// gh is unavailable, the branch isn't fetched locally, or detection is inconclusive — never throws.
const DEFAULT_BRANCH = defaultBranchLocal();
let MAIN = DEFAULT_BRANCH, mainReason = "default branch";
{
  const localDefaultName = DEFAULT_BRANCH.replace(/^origin\//, "");
  const det = integrationBranchOf({ ghRepo: ownerRepo, defaultBranch: localDefaultName, days: dayN });
  if (det.branch !== localDefaultName) {
    const candidate = `origin/${det.branch}`;
    try { execFileSync("git", ["-C", repoDir, "rev-parse", "--verify", candidate], { encoding: "utf8" }); MAIN = candidate; mainReason = det.reason; }
    catch { mainReason = `${det.reason} — but ${candidate} isn't fetched locally, kept ${DEFAULT_BRANCH}`; }
  }
}
const mainShort = MAIN.replace(/^origin\//, "");
console.log(`Integration branch: ${MAIN} (${mainReason})`);

if (decisionsPath) { runDecisionsMode(); process.exit(process.exitCode || 0); }

function ghGraphQL(query, vars) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push("-F", `${k}=${v}`);
  const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 << 20 });
  return JSON.parse(out);
}
// the batched timeline query (shipped-links.mjs's timelineBatchQuery) intentionally
// asks for several issues at once, so ONE bad issue number among the batch (a real, not hypothetical, case —
// GitHub's GraphQL API returns a NOT_FOUND-shaped error for that one alias, not a null-without-error) makes
// `gh api graphql` exit non-zero for the WHOLE call, same as it always has for a single bad number — except
// now the good aliases' data is sitting right there in the same response, alongside the error. `gh` still
// prints that response to stdout before exiting non-zero; `execFileSync`'s thrown error carries it as
// `.stdout`. This is the same "partial success, non-zero exit" shape GraphQL always returns for a nullable
// field that failed to resolve — recovering it here is not "ignoring an error", it's reading the SAME data
// the one-issue-at-a-time path would have gotten for every OTHER issue in the batch.
function ghGraphQLTolerant(query, vars) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push("-F", `${k}=${v}`);
  try { return JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 << 20 })); }
  catch (e) {
    if (e.stdout) { try { return JSON.parse(e.stdout); } catch {} }
    throw e;
  }
}

const [owner, repo] = ownerRepo.split("/");

// GitHub's Search API is scoped by the repo name AS INDEXED, and it does NOT follow a rename: after
// calcom/cal.com became calcom/cal.diy, "repo:calcom/cal.com" returns 0 results, while `repository(owner,
// name)` (and `gh issue list -R`, REST) redirect to the new name. So resolve the canonical nameWithOwner
// once, search by THAT, and compare cross-references against it (a closingIssuesReferences /
// CrossReferencedEvent node carries the repo's CURRENT name, never the old one). Any failure (offline,
// no permission, a fake gh) keeps the configured name — exactly the old behaviour.
function canonicalRepoOf(o, r) {
  try {
    const res = ghGraphQL(`query($o: String!, $n: String!) { repository(owner: $o, name: $n) { nameWithOwner } }`, { o, n: r });
    return res?.data?.repository?.nameWithOwner || `${o}/${r}`;
  } catch { return `${o}/${r}`; }
}
const searchRepo = canonicalRepoOf(owner, repo);
if (searchRepo.toLowerCase() !== ownerRepo.toLowerCase())
  console.log(`issue repo: ${ownerRepo} was renamed to ${searchRepo} on GitHub — reading ${searchRepo} (update issue.repo in sources.json to silence this).`);
const sameRepo = (nwo) => (nwo || "").toLowerCase() === searchRepo.toLowerCase();

// --- Fetch PRs: merged, within dayN+30 days (an issue may close late; buffer) ---
const prSince = localDayOf(Date.now() - (dayN + 60) * 86400000);
const PR_Q = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title body baseRefName mergedAt createdAt
        repository { nameWithOwner }
        mergeCommit { oid }
        closingIssuesReferences(first: 15) { nodes { number repository { nameWithOwner } } }
        commits(first: 50) { nodes { commit { message } } }
      }
    }
  }
}`;
function fetchAllSearch(query, qString) {
  let cursor = null, nodes = [];
  for (let page = 0; page < 30; page++) {
    const vars = { q: qString }; if (cursor) vars.cursor = cursor;
    const resource = ghGraphQL(query, vars);
    const s = resource.data.search;
    nodes.push(...s.nodes);
    if (!s.pageInfo.hasNextPage) break;
    cursor = s.pageInfo.endCursor;
  }
  return onlyThisRepo(nodes, qString);
}
// GitHub search ORs its scope qualifiers ("org:a repo:a/b" means "anything in org a, OR in repo a/b"), so
// an extra scope — or GitHub widening one — silently mixes in OTHER repos' issues and PRs, whose numbers
// then collide with this repo's own: on Twenty, "org:twentyhq repo:twentyhq/twenty" returned ~40% of its
// issues from twentyhq/core-team-issues (#2901 "Call Recorder: …", Sep 2026), while twentyhq/twenty's own
// #2901 is an unrelated 2023 issue — so the commit-grep "#2901" link and every #N lookup pointed at the
// wrong thing. Every search node carries its own repository, so drop (and count) anything not from this
// one; a node without the field (older fixtures) is kept, as before.
function onlyThisRepo(nodes, qString) {
  const kept = nodes.filter(n => n && (!n.repository || sameRepo(n.repository.nameWithOwner)));
  const dropped = nodes.length - kept.length;
  if (dropped) {
    const from = [...new Set(nodes.filter(n => n && n.repository && !sameRepo(n.repository.nameWithOwner)).map(n => n.repository.nameWithOwner))];
    console.error(`search "${qString}": dropped ${dropped} result${dropped === 1 ? "" : "s"} from other repos (${from.join(", ")}) — their #numbers are not ${searchRepo}'s.`);
  }
  return kept;
}
// Scoped by repo: alone (see onlyThisRepo for why never "org:"). The old "org:<owner>" prefix was a
// workaround for cal.com returning 0 — that was the rename above, not a dot-parsing quirk; org: only
// "fixed" it by pulling in the whole org: the renamed repo (calcom/cal.diy) AND its siblings (calcom/sans).
const searchPrefix = `repo:${searchRepo}`;
let prSearchOk = true, prNodesRaw = [];
try { prNodesRaw = fetchAllSearch(PR_Q, `${searchPrefix} is:pr is:merged merged:>=${prSince}`); }
catch (e) { prSearchOk = false; console.error(`PR search failed (closes/mentions can't be checked): ${e.message}`); }

// --- Fetch issues: opened in the last dayN days ---
const ISSUE_Q = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        number title body createdAt closedAt state stateReason
        repository { nameWithOwner }
        author { login }
        authorAssociation
        labels(first: 15) { nodes { name } }
        milestone { title }
      }
    }
  }
}`;
const issueNodes = fetchAllSearch(ISSUE_Q, `${searchPrefix} is:issue created:>=${sinceDate}`);

// only PRs merged INTO the detected integration branch count as an explicit link's
// source (a PR merged into some other long-lived branch never shipped to what this repo actually ships).
const prNodes = prNodesRaw.filter(pr => pr.baseRefName === mainShort);
const mergedPRByNumber = new Map();
for (const pr of prNodes) if (pr.mergeCommit) mergedPRByNumber.set(pr.number, {
  number: pr.number, title: pr.title, mergedAt: pr.mergedAt,
  closingIssuesReferences: pr.closingIssuesReferences?.nodes || [],
  commitMessages: (pr.commits?.nodes || []).map(n => n.commit.message),
  mergeCommit: pr.mergeCommit,
});
const mergedPRList = [...mergedPRByNumber.values()];
const { closes, mentions } = linksFromMergedPRs(mergedPRList, searchRepo);

// without a decisions doc, `shipped` used to treat EVERY GitHub issue opened in the
// window as a "decision" (an issue with a feature/enhancement label, OR opened by a team member, OR linked
// to a merged PR) — on a busy repo with no curated label convention (Twenty: 133 issues in 30 days), that's
// not a decision signal, it's just "someone opened an issue". Now only three explicit signals count:
//   - a label the OWNER configured in sources.json's `issue.decisionLabels` (never a guessed word like
//     "feature"/"enhancement" — those are GitHub defaults many repos apply to every request, not a curated
//     decision marker; `decisionLabels` puts the choice in the product's own hands);
//   - a milestone (GitHub's own "this was actually planned/scheduled" signal, needs no configuration);
//   - an explicit link to a merged PR (closes/mentions — unchanged from before).
// Team authorship alone is dropped as a signal entirely (a team member can open a "just wondering" issue;
// that's not evidence a decision was made). `decisionLabelsOf` is read once per run.
function decisionLabelsOf(pm) {
  if (!pm) return [];
  try {
    const K = readSources(pm);
    const arr = K.issue?.decisionLabels;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}
const DECISION_LABELS = decisionLabelsOf(pmFolder);
const hasDecisionLabel = (labels) => DECISION_LABELS.length > 0 &&
  labels.some(l => DECISION_LABELS.some(d => d.toLowerCase() === l.name.toLowerCase()));

const decisions = issueNodes.filter(is => {
  const linkedByPR = closes.has(is.number) || mentions.has(is.number);
  return hasDecisionLabel(is.labels.nodes) || !!is.milestone || linkedByPR;
}).map(is => {
  const linkedByPR = closes.has(is.number) || mentions.has(is.number);
  const byLabel = hasDecisionLabel(is.labels.nodes);
  const byMilestone = !!is.milestone;
  return {
    number: is.number, title: is.title, body: (is.body || "").slice(0, 500),
    createdAt: is.createdAt, closedAt: is.closedAt, state: is.state, stateReason: is.stateReason,
    author: is.author?.login, authorAssociation: is.authorAssociation,
    labels: is.labels.nodes.map(l => l.name), milestone: is.milestone?.title || null,
    decision_signal: byLabel ? "label" : byMilestone ? "milestone" : "link",
  };
});
// Which source(s) actually produced the decision set this run, printed so the count is never read as if
// every opened issue were a "decision" (the bug this internal request fixes). When NOTHING signals at all
// (no decisionLabels configured, no milestones used, nothing linked to a merged PR), say so plainly instead
// of printing "0 decisions" next to the real issue count — that would still look like a fake, misleading
// denominator to a reader skimming past it.
{
  const byLabelOrMilestone = decisions.filter(d => d.decision_signal !== "link").length;
  const linkOnly = decisions.length - byLabelOrMilestone;
  const other = issueNodes.length - decisions.length;
  if (decisions.length === 0) {
    const configNote = DECISION_LABELS.length ? `labels configured (${DECISION_LABELS.join(", ")}) matched nothing` : "no issue.decisionLabels configured in sources.json";
    console.log(`decisions: no decision signal found in the last ${dayN} days (${configNote}, no milestones set, no issue linked to a merged PR) — ${issueNodes.length} issue${issueNodes.length === 1 ? "" : "s"} opened, none countable as a decision; showing the explicit-link record only, no fake denominator.`);
  } else {
    const parts = [];
    if (byLabelOrMilestone) parts.push(`${byLabelOrMilestone} labeled/milestoned`);
    if (linkOnly) parts.push(`${linkOnly} linked to a merged PR only`);
    console.log(`decisions: ${decisions.length} issue${decisions.length === 1 ? "" : "s"} (${parts.join(", ")}); ${other} other issue${other === 1 ? "" : "s"} not counted as decisions.`);
  }
}
// Every decision number that might need the commit-grep mention index below (mentionIndex): the "no link"
// ones (firstMainCommitMentioning) AND every mapped one (laterCommitsMentioning, checked regardless of
// which link kind mapped it) — simplest to just build the index for all of them once, in one combined git
// call, rather than track two different subsets.
const ALL_DECISION_NUMBERS = decisions.map(d => d.number);

// --- timeline check (internal request 83's 3rd link kind): only for issues CLOSED as completed, with no
// closes/mentions link — an open or "not planned" issue can't be shipped-via-timeline either, and this is
// exactly kriter1's "9 of 16 closed-as-completed, no-link issues had actually shipped" leak. Capped by
// --timeline-limit (one `gh` call per issue); --no-timeline skips this kind entirely (checked.timeline=false).
const timelineCandidates = decisions.filter(d =>
  !closes.has(d.number) && !mentions.has(d.number) && d.state === "CLOSED" && d.stateReason === "COMPLETED");
const timelineResultOf = new Map(); // issue number -> { pr, via } | null
let timelineOk = !noTimeline && prSearchOk;
// was one `gh api graphql` process (one network round trip) PER candidate issue —
// the single biggest cost in `shipped 7d` on a busy repo (a couple hundred round trips in serial). Now
// batched `timelineBatchSize` issues per request (shipped-links.mjs's timelineBatchQuery/timelineBatchParse);
// each issue's OUTCOME is unchanged — "failed" here is exactly the old per-issue catch block, just decided
// from one alias in a shared response instead of its own process. Multi-page issues (>50 timeline items,
// rare) fall back to the original single-issue fetchIssueTimeline for just that one issue, unchanged.
const timelineBatchSize = 20;
if (!noTimeline && prSearchOk) {
  const toCheck = timelineCandidates.slice(0, timelineLimit);
  if (toCheck.length < timelineCandidates.length) timelineOk = false; // capped — not every candidate was checked
  for (let i = 0; i < toCheck.length; i += timelineBatchSize) {
    const chunk = toCheck.slice(i, i + timelineBatchSize);
    const numbers = chunk.map(d => d.number);
    let byNumber;
    try {
      const res = ghGraphQLTolerant(timelineBatchQuery(numbers), { owner, repo });
      byNumber = timelineBatchParse(res?.data, numbers);
    } catch (e) {
      timelineOk = false;
      for (const n of numbers) console.error(`timeline read failed for #${n}: ${e.message}`);
      continue;
    }
    for (const d of chunk) {
      const r = byNumber.get(d.number);
      if (!r || r.failed) { timelineOk = false; console.error(`timeline read failed for #${d.number}: could not resolve the issue`); continue; }
      let nodes = r.nodes;
      if (r.hasNextPage) {
        // rare: more than one page of timeline items — the exact same single-issue path as before,
        // just only paid for when it's actually needed.
        try { nodes = fetchIssueTimeline(ghGraphQL, owner, repo, d.number); }
        catch (e) { timelineOk = false; console.error(`timeline read failed for #${d.number}: ${e.message}`); continue; }
      }
      timelineResultOf.set(d.number, timelineLink(nodes, searchRepo, mergedPRByNumber));
    }
  }
}
const checked = { closes: prSearchOk, mentions: prSearchOk, timeline: timelineOk };

// pm/log.md: firstMainCommitMentioning/laterCommitsMentioning/revertedWithin used to
// each run their OWN `git log <MAIN> --grep=...` over the WHOLE branch history — one process spawn per
// decision (up to 3 per mapped decision), which is what made `shipped 7d` take ~143s on a busy repo (1324
// commits/7d, 232 decisions in the 30-day window this script actually reads). Replaced with ONE `git log`
// pass over MAIN (allMainCommits, cached), read once no matter how many decisions ask for it, plus one
// in-memory index (mentionIndex) built from that single pass. Every commit is kept in the SAME order git
// itself returns them (newest-first, MAIN's own traversal order) so the "earliest match" and "later matches"
// picks stay identical to the old --reverse / plain grep calls (see below) — no re-sorting by date, which
// could silently pick a different commit than git's own traversal order on a history with clock-skewed
// timestamps or non-linear merges.
const REC = "\x1e", SEP = "\x1f", ETX = "\x03";
let __mainCommitsCache = null;
function allMainCommits() {
  if (__mainCommitsCache) return __mainCommitsCache;
  let raw = "";
  try {
    raw = execFileSync("git", ["-C", repoDir, "log", MAIN,
      `--format=${REC}%H${SEP}%ad${SEP}%cI${SEP}%s${SEP}%b${ETX}`, "--date=format:%Y-%m-%dT%H:%M:%S"],
      { encoding: "utf8", maxBuffer: 512 << 20 });
  } catch {}
  __mainCommitsCache = raw.split(REC).filter(Boolean).map(chunk => {
    const i = chunk.indexOf(ETX);
    const header = i >= 0 ? chunk.slice(0, i) : chunk;
    const [hash, date, cdate, subject = "", body = ""] = header.replace(/^\n+/, "").split(SEP);
    return { hash, date, cdate, subject, body: (body || "").replace(/\n+$/, "") };
  });
  return __mainCommitsCache;
}
// `\b` is a PCRE/JS escape, not a POSIX ERE one — Apple Git's own regex engine
// (this worktree: Apple Git 2.39.5, no USE_LIBPCRE) silently treats `\b` in a `-E --grep` as a literal
// backspace-ish no-op that never matches ANYTHING, so the "mentions" kind found nothing on macOS, always
// (verified: `git log --perl-regexp --grep='internal\b' -1` finds a match on this same worktree; the plain
// `-E` form with `\b` never does — see gitPerlRegexSupported below). Fixed with a portable boundary, probed
// ONCE per run instead of assumed: when `git log --perl-regexp` actually works on this git build (probed
// with a real query, not just "does the flag exist" — a non-PCRE build still accepts the flag and then
// fails at grep time), `\b` is used for real via `--perl-regexp`; otherwise an ERE that means the same thing
// without `\b` — `#N` followed by a non-digit or end-of-string, `#N([^0-9]|$)` — is used instead. Either way
// this still asks git's OWN regex engine to decide the match (not a JS reimplementation, keeping the same
// "ask git, then JS only sorts already-confirmed commits by number" shape the comment below describes) —
// only WHICH portable pattern is handed to it changes.
let __gitPerlRegexSupported = null;
function gitPerlRegexSupported() {
  if (__gitPerlRegexSupported !== null) return __gitPerlRegexSupported;
  try {
    // A real query, not a no-op: `\b` only actually filters on a build that treats it as a word boundary.
    // If this doesn't throw, --perl-regexp is at least accepted and running (git log --grep never errors
    // on "no match" — it just prints nothing and exits 0 — so a thrown error here means the FLAG itself
    // failed, e.g. "fatal: cannot use Perl-compatible regexes when not compiled with USE_LIBPCRE").
    execFileSync("git", ["-C", repoDir, "log", "--perl-regexp", "--grep=test", "-1", "--format=%H"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    __gitPerlRegexSupported = true;
  } catch { __gitPerlRegexSupported = false; }
  return __gitPerlRegexSupported;
}
// issue number -> [commit, ...] (same order as allMainCommits: newest-first), for every commit whose OWN
// message names that number as "#N" with a trailing word boundary, once per number. Built in two steps,
// DELIBERATELY not a plain JS regex re-implementation:
//   1. ONE git call combining every number's boundary pattern into a single invocation (git OR's multiple
//      --grep flags together by default) — this is what actually decides "does this commit mention #N",
//      using git's OWN regex engine (with whichever portable pattern gitPerlRegexSupported() picked), so
//      the real behavior of THIS platform/build keeps deciding it.
//   2. For just the commits git's own call confirmed (typically a small set), a plain JS scan of that ONE
//      commit's already-fetched subject+body (allMainCommits) picks out exactly which of the requested
//      numbers it names — only to file an already-git-confirmed commit under the right number(s) (a
//      commit can name more than one issue), and to drop a cross-repo "other/repo#N" git's pattern also
//      matched (hashMentionNumbers, same rule as PR mentions): that names another repo's #N, not ours.
let __mentionIndexCache = null;
function mentionIndex(numbers) {
  if (__mentionIndexCache) return __mentionIndexCache;
  const idx = new Map();
  const uniq = [...new Set(numbers)];
  if (!uniq.length) { __mentionIndexCache = idx; return idx; }
  const perl = gitPerlRegexSupported();
  const args = perl ? uniq.map(n => `--grep=#${n}\\b`) : uniq.map(n => `--grep=#${n}([^0-9]|$)`);
  let raw = "";
  try { raw = execFileSync("git", ["-C", repoDir, "log", MAIN, ...args, perl ? "--perl-regexp" : "-E", "--format=%H"], { encoding: "utf8", maxBuffer: 256 << 20 }); }
  catch {}
  const matchedHashes = new Set(raw.split("\n").filter(Boolean));
  if (matchedHashes.size) {
    const numberSet = new Set(uniq);
    for (const c of allMainCommits()) {
      if (!matchedHashes.has(c.hash)) continue;
      const seen = [...hashMentionNumbers(`${c.subject}\n${c.body}`, searchRepo)].filter(n => numberSet.has(n));
      for (const n of seen) { if (!idx.has(n)) idx.set(n, []); idx.get(n).push(c); }
    }
  }
  __mentionIndexCache = idx;
  return idx;
}
// the first commit on main mentioning #N (chronologically earliest): allMainCommits is newest-first (git's
// own default order, same as before), so the oldest match — what `--reverse`'s first line used to give — is
// the LAST entry in the (already newest-first) per-number list, not the first.
function firstMainCommitMentioning(num) {
  const arr = mentionIndex(ALL_DECISION_NUMBERS).get(num);
  if (!arr || !arr.length) return null;
  const c = arr[arr.length - 1];
  return { hash: c.hash, date: c.date, title: c.subject };
}
// later commits on main after a given commit that also mention the same #N (candidate follow-up patches)
function laterCommitsMentioning(num, afterHash) {
  const arr = mentionIndex(ALL_DECISION_NUMBERS).get(num) || [];
  return arr.filter(c => c.hash !== afterHash).map(c => ({ hash: c.hash, date: c.date, title: c.subject }));
}
// whether a "Revert" commit within `days` days after a commit reverts it (mentions the short hash or the
// title). git's --since/--until filter by COMMITTER date (verified: author date is a display-only format,
// not what git's own date-range walk uses), so the boundary check below uses %cI (cdate), not %ad (date) —
// matching git's own semantics exactly, not just what the old call happened to also print.
function revertedWithin(hash, title, afterDate, days) {
  const since = new Date(afterDate);
  const until = new Date(since.getTime() + days * 86400000);
  const short = hash.slice(0, 7), shortTitle = title.slice(0, 40);
  return allMainCommits().some(c => {
    if (!c.subject.startsWith("Revert")) return false;
    const cd = new Date(c.cdate);
    if (!(cd > since && cd <= until)) return false;
    const hay = `${c.subject} ${c.body}`;
    return hay.includes(short) || hay.includes(shortTitle);
  });
}

const median = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const rows = decisions.map(d => {
  const link = shippedLinkOf(d.number, { closes, mentions, timeline: timelineResultOf.get(d.number) || null });
  let mainEntry = null, mainCommit = null, source = null, linkedPr = null, linkedVia = null;
  if (link) {
    mainEntry = link.pr.mergedAt; mainCommit = link.pr.mergeCommit?.oid || null; source = link.kind;
    linkedPr = link.pr.number; linkedVia = link.via || null;
  } else {
    const c = firstMainCommitMentioning(d.number);
    if (c) { mainEntry = c.date; mainCommit = c.hash; source = "commit-grep"; }
  }
  const dayDiffOf = mainEntry ? Math.round((new Date(mainEntry) - new Date(d.createdAt)) / 86400000) : null;
  const noneDidNotOutput = !mainEntry && (d.state === "OPEN" || (d.state === "CLOSED" && d.stateReason === "NOT_PLANNED"));
  let backReceived = false, patched = false, patchCount = 0;
  if (mainEntry && mainCommit) {
    backReceived = revertedWithin(mainCommit, link ? link.pr.title || d.title : d.title, mainEntry, 14);
    const laterOnes = laterCommitsMentioning(d.number, mainCommit).filter(c => new Date(c.date) > new Date(mainEntry));
    patchCount = laterOnes.length;
    patched = patchCount > 0;
  }
  return {
    issue: d.number, title: d.title, body: d.body, author: d.author, author_relation_of: d.authorAssociation,
    labels: d.labels, opening: d.createdAt, status: d.state, status_reason_of: d.stateReason,
    linked_pr: linkedPr, link_via: linkedVia, main_entry: mainEntry, main_commit: mainCommit, source,
    day_diff_of: dayDiffOf, none_did_not_output: noneDidNotOutput, back_received_14_day: backReceived,
    patched, patch_count: patchCount,
  };
});

const mapped = rows.filter(r => r.main_entry);
const byKind = { closes: 0, mentions: 0, timeline: 0, "commit-grep": 0 };
for (const r of mapped) if (r.source in byKind) byKind[r.source]++;
const dayDiffsOf = mapped.map(r => r.day_diff_of).filter(g => g !== null);

const missing = missingKinds(checked);
const headlineShown = missing.length === 0;

// any count/rate resting on fewer than MIN_N rows prints "too few to say" instead of
// the number — the same shape a page or a future `score` command should read (`display`), while `summary`
// itself always keeps the raw numbers for programmatic use.
const display = (n, valueText) => hasEnoughN(n, MIN_N) ? valueText : tooFewToSay(n);

const summary = {
  repo: ownerRepo, integration_branch: MAIN, integration_branch_reason: mainReason,
  window_day: dayN, decision_count: rows.length, mapped_count: mapped.length,
  mapped_by_kind: byKind,
  checked_kinds: checked, missing_kinds: missing, headline_shown: headlineShown,
  min_n: MIN_N,
  median_day: median(dayDiffsOf), none_did_not_output_count: rows.filter(r => r.none_did_not_output).length,
  back_received_count: rows.filter(r => r.back_received_14_day).length,
  patched_count: rows.filter(r => r.patched).length,
};
summary.display = {
  median_day: display(mapped.length, `${summary.median_day ?? "?"} days`),
  none_did_not_output_count: display(rows.length, String(summary.none_did_not_output_count)),
  back_received_count: display(mapped.length, String(summary.back_received_count)),
  patched_count: display(mapped.length, String(summary.patched_count)),
};
summary.line = headlineShown
  ? `Last ${dayN} days: ${summary.decision_count} decisions. ${display(mapped.length, `${summary.mapped_count} shipped (closes ${byKind.closes}, mentions ${byKind.mentions}, timeline ${byKind.timeline})`)}. Median ${summary.display.median_day} to main. Reverted within 14d: ${summary.display.back_received_count}. Patched after: ${summary.display.patched_count}.`
  : `Last ${dayN} days: ${summary.decision_count} decisions. No shipped headline shown — missing kind(s): ${missing.join(", ")}.`;

const out = { summary, decisions: rows };
console.log(summary.line);
console.log(`  mapped ${summary.mapped_count}/${summary.decision_count} (closes ${byKind.closes}, mentions ${byKind.mentions}, timeline ${byKind.timeline}, commit-grep ${byKind["commit-grep"]}) · patched ${summary.patched_count}`);
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log(`written: ${jsonOut}`); }

// --- pm/state/shipped.json contract (N4's output contract) ---------------------------------------------
if (shippedJsonOut) {
  const teamOf = (labels) => { const l = labels.find(x => /^team[:\-]/i.test(x)); return l ? l.replace(/^team[:\-]\s*/i, "") : null; };
  const anyTeamLabel = rows.some(r => teamOf(r.labels));
  let byTeam;
  if (anyTeamLabel) {
    byTeam = {};
    for (const r of rows) { const t = teamOf(r.labels); if (t) byTeam[t] = (byTeam[t] || 0) + 1; }
  }
  const shippedRows = mapped.map(r => toShippedRecord({
    ref: `#${r.issue}`, title: r.title, kind: "request", team: teamOf(r.labels),
    opened: r.opening, landed: r.main_entry,
    prs: r.linked_pr ? [{ n: r.linked_pr, title: mergedPRByNumber.get(r.linked_pr)?.title || null, merged: r.main_entry ? r.main_entry.slice(0, 10) : null }] : [],
    link: ["closes", "mentions", "timeline"].includes(r.source) ? r.source : "closes",
  }));
  const counts = { requests: rows.length, open: rows.filter(r => r.status === "OPEN").length, closedNoLink: rows.filter(r => r.status === "CLOSED" && !r.main_entry).length };
  if (byTeam) counts.byTeam = byTeam;
  const file = toShippedFile({ repo: ownerRepo, branch: mainShort, from: sinceDate, to: localDay(), checked, rows: shippedRows, counts });
  // Read-modify-write: another session's tool may already have written "recent"/"undecided" keys into the
  // same file — keep any key this script doesn't own.
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(shippedJsonOut, "utf8")); } catch {}
  const merged = { ...existing, ...file };
  fs.mkdirSync(path.dirname(shippedJsonOut), { recursive: true });
  fs.writeFileSync(shippedJsonOut, JSON.stringify(merged, null, 2));
  console.log(`written: ${shippedJsonOut}`);
}

// --- decisions-log mode (N1): no GitHub issue tracker at all — "decisions" come from read-decisions.mjs's
// blocks (a KARARLAR.md/ADR-style log). Two explicit link kinds now decide "shipped":
//   - "commit": a commit ON MAIN whose own message names the decision's id, that also touches a real,
//     non-doc-only, non-comment-only file (shipped-links.mjs's decisionShippedBy).
//   - "pr" (N1 polish round 2, K134): a MERGED PR whose title/body/branch name names the decision's id,
//     whether or not any of its individual commit messages do — this is what actually shipped K134 (the
//     decision moved a port in a same-day commit that never cited "K134" itself). Only tried when the
//     product's GitHub repo can be read without `gh api` (gh pr list --json, read-only): resolved from
//     `pm/sources.json`'s `issue.repo`, else the repo's own `origin` remote. The PR's merge commit (on
//     MAIN, read locally with `git diff`) must ALSO clear the same doc-only/comment-only bar as a commit
//     link — a PR that only edits the decisions log or a comment doesn't ship it either.
// Whichever kind lands EARLIEST wins (a decision can in principle be named by both). Writes the SAME
// pm/state/shipped.json contract as before; `linkTypes` lists "commit" always and "pr" only when the PR
// check actually ran this pass (matches scoreboard.mjs's `s.source === "decisions"` branch: the shipped
// headline is never withheld regardless, since there's no GitHub issue timeline to miss for this source).
// Resolves an owner/repo string for `gh pr list -R`, decisions mode's "pr" link kind: prefers
// pm/sources.json's `issue.repo` (the first product carries this even though it isn't used for GitHub-issue mode —
// pm/log.md's N1 hand check notes it), else parses the local repo's own `origin` remote URL. Returns
// null (never throws) when neither is available — the caller just turns the "pr" kind off.
function resolveGhRepo(pm, dir) {
  if (pm) {
    try {
      const K = readSources(pm);
      if (K.issue?.repo) return K.issue.repo;
    } catch {}
  }
  try {
    const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const m = /github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/.exec(url);
    if (m) return m[1];
  } catch {}
  return null;
}

function runDecisionsMode() {
  const K = { repo: repoDir, ref: MAIN, preread: { decisions: decisionsPath } };
  let blocks;
  try { blocks = decisionsOfRead(K); }
  catch (e) { console.error(`decisions mode: couldn't read ${decisionsPath} at ${MAIN}: ${e.message}`); process.exitCode = 1; return; }

  // De-dupe by id (read-decisions.mjs's title regex can match more than once inside one written entry,
  // e.g. a decision whose own text quotes another "## K…" heading) — the first (earliest) block wins.
  const byId = new Map();
  for (const b of blocks) if (!byId.has(b.no)) byId.set(b.no, b);
  const decisions = [...byId.values()];

  // Decision date: git blame on the decisions file(s), read once per file (not once per decision) — the
  // commit that last touched a decision's own title line is, in practice, the commit that added it (a
  // "## K<no>" heading is essentially never edited after the fact). `${file}:${line}` -> ISO date.
  const dateOf = new Map();
  for (const file of new Set(decisions.map(d => d.file))) {
    let raw;
    try { raw = execFileSync("git", ["-C", repoDir, "blame", "--line-porcelain", MAIN, "--", file], { encoding: "utf8", maxBuffer: 256 << 20 }); }
    catch (e) { console.error(`decisions mode: git blame failed for ${file}: ${e.message}`); continue; }
    let curLine = null, curTime = null;
    for (const line of raw.split("\n")) {
      const head = /^[0-9a-f]{40} \d+ (\d+)/.exec(line);
      if (head) { curLine = +head[1]; continue; }
      if (line.startsWith("author-time ")) { curTime = +line.slice("author-time ".length); continue; }
      if (line.startsWith("\t")) {
        if (curLine != null && curTime != null) dateOf.set(`${file}:${curLine}`, new Date(curTime * 1000).toISOString());
        curLine = null; curTime = null;
      }
    }
  }
  const dated = decisions.map(d => ({ ...d, date: dateOf.get(`${d.file}:${d.line}`) || null }));
  const undated = dated.filter(d => !d.date).length;
  if (undated) console.error(`decisions mode: ${undated} decision(s) had no blame date (git blame gap) and are excluded from the window`);
  // A decision that says "not doing", or is rejected or superseded, did not ship: an unrelated commit that cites its id ("fix: crash in theme loader (K12 follow-up, no dark mode)")
  // used to make it "shipped" with a landed date (field-test hunt). They are left out of the record; the owner's own "not doing" list is where they live.
  const notShipped = d => d.notDoing || /^(rejected|superseded|dropped|declined|withdrawn)$/i.test(String(d.status || ""));
  const inWindow = dated.filter(d => d.date && d.date.slice(0, 10) >= sinceDate && !notShipped(d));

  // One pass over every commit on MAIN, with the files it touched (a single `git log --name-only` call
  // instead of one `git log --grep`/`git show` per decision — the task's own "prefer one pass for speed").
  const REC = "\x1e", SEP = "\x1f", ETX = "\x03";
  let rawLog = "";
  try {
    rawLog = execFileSync("git", ["-C", repoDir, "log", MAIN, `--format=${REC}%H${SEP}%ad${SEP}%s${SEP}%b${ETX}`,
      "--date=format:%Y-%m-%dT%H:%M:%S", "--name-only"], { encoding: "utf8", maxBuffer: 512 << 20 });
  } catch (e) { console.error(`decisions mode: git log failed: ${e.message}`); }
  const commits = rawLog.split(REC).filter(Boolean).map(chunk => {
    const i = chunk.indexOf(ETX);
    const header = i >= 0 ? chunk.slice(0, i) : chunk;
    const filesPart = i >= 0 ? chunk.slice(i + 1) : "";
    const [hash, date, subject = "", body = ""] = header.split(SEP);
    const files = filesPart.split("\n").map(s => s.trim()).filter(Boolean);
    return { hash, date, subject, body, files };
  });

  // Refs.mjs's own patterns (sources.json's `refs`, or DEFAULT — which already matches "K175", "K175 m.3",
  // "(K175)", "K175:" via the \bK\d{2,3}\b boundary) + groupKeyOf so "K175 m.3" groups under "K175".
  const patterns = patternsOfLoad(pmFolder || null);
  const refRe = refRegex(patterns);
  const idsIn = text => new Set(([...String(text || "").matchAll(refRe)].map(m => m[0])).map(groupKeyOf));
  const commitsByDecision = new Map();
  for (const c of commits) {
    for (const id of idsIn(`${c.subject}\n${c.body}`)) { if (!commitsByDecision.has(id)) commitsByDecision.set(id, []); commitsByDecision.get(id).push(c); }
  }

  const ignoreDocs = thresholds(pmFolder).shippedIgnoreDocs;

  // Comment-only check (N1 polish round 2): only for commits that actually name a decision AND
  // touch at least one file that isn't already excluded by decisionsPath/ignoreDocs — no point diffing a
  // commit that only ever touched DECISIONS.md/ROADMAP.md.
  // pm/log.md: used to be one `git show` PROCESS per qualifying commit; now every
  // qualifying commit across the WHOLE window is diffed in one (or a few, chunked) `git show` call —
  // `git show <hash1> <hash2> ...` concatenates each commit's own patch, each introduced by its own
  // "commit <hash>" line, which is exactly the boundary commentOnlyFilesBatch splits on below. Still cached
  // by hash (commentOnlyCache), so a commit named by more than one decision is still only diffed once.
  const ignoreSet = new Set((ignoreDocs || []).map(e => String(e).toLowerCase().replace(/^\./, "")));
  const extOf = f => { const base = String(f).split("/").pop() || ""; const i = base.lastIndexOf("."); return i > 0 ? base.slice(i + 1).toLowerCase() : ""; };
  const commentOnlyCache = new Map(); // hash -> Set<path>
  const COMMENT_SHOW_CHUNK = 200; // keeps each `git show` call's own diff output to a sane size
  function commentOnlyFilesBatch(hashes) {
    const need = hashes.filter(h => !commentOnlyCache.has(h));
    for (let i = 0; i < need.length; i += COMMENT_SHOW_CHUNK) {
      const chunk = need.slice(i, i + COMMENT_SHOW_CHUNK);
      let raw = "";
      try { raw = execFileSync("git", ["-C", repoDir, "show", "--unified=0", "--no-color", ...chunk], { encoding: "utf8", maxBuffer: 256 << 20 }); }
      catch (e) { console.error(`decisions mode: git show failed for a batch of ${chunk.length} commit(s): ${e.message}`); }
      const parts = raw.split(/^commit ([0-9a-f]{40})$/m); // [preamble, hash, body, hash, body, ...]
      for (let j = 1; j < parts.length; j += 2) {
        const byFile = commentOnlyByFile(parts[j + 1] || "");
        commentOnlyCache.set(parts[j], new Set([...byFile].filter(([, v]) => v).map(([f]) => f)));
      }
      for (const h of chunk) if (!commentOnlyCache.has(h)) commentOnlyCache.set(h, new Set()); // git show failed for this one — same as the old code's "diff stays empty" fallback
    }
  }
  function commentOnlyFilesOf(hash) {
    if (!commentOnlyCache.has(hash)) commentOnlyFilesBatch([hash]);
    return commentOnlyCache.get(hash) || new Set();
  }
  const needsCommentCheck = c => (c.files || []).some(f => f !== decisionsPath && !ignoreSet.has(extOf(f)));
  const withCommentCheck = c => needsCommentCheck(c) ? { ...c, commentOnlyFiles: commentOnlyFilesOf(c.hash) } : c;

  // "pr" link kind (K134): a merged PR whose title/body/branch names the decision, read-only via
  // `gh pr list` (never `gh api`) — resolved repo, non-fatal (offline/unauthorized/no repo just turns
  // this kind off, same shape as GitHub-issue mode's own PR-search failure handling above).
  let prShipOf = new Map(); // decision id -> { date, pr:{number,title}, files }
  let prChecked = false;
  if (!noPr) {
    const ghRepo = resolveGhRepo(pmFolder, repoDir);
    if (ghRepo) {
      try {
        const raw = execFileSync("gh", ["pr", "list", "-R", ghRepo, "--state", "merged", "--base", mainShort,
          "--json", "number,title,body,mergedAt,mergeCommit,headRefName", "--limit", String(prLimit)],
          { encoding: "utf8", maxBuffer: 256 << 20 });
        const prs = JSON.parse(raw);
        prChecked = true;
        const byId = new Map(); // decision id -> earliest merged PR naming it
        for (const pr of prs) {
          const ids = idsIn(`${pr.title}\n${pr.body || ""}\n${pr.headRefName || ""}`);
          for (const id of ids) {
            const cur = byId.get(id);
            if (!cur || new Date(pr.mergedAt) < new Date(cur.mergedAt)) byId.set(id, pr);
          }
        }
        for (const [id, pr] of byId) {
          const oid = pr.mergeCommit?.oid;
          if (!oid) continue;
          let files = null;
          try { files = execFileSync("git", ["-C", repoDir, "diff", "--name-only", `${oid}^`, oid], { encoding: "utf8" }).split("\n").map(s => s.trim()).filter(Boolean); }
          catch (e) { console.error(`decisions mode: PR #${pr.number}'s merge commit ${oid} isn't readable locally, skipping its "pr" link: ${e.message}`); continue; }
          if (!files.length) continue; // nothing readable -> can't clear the doc/comment bar, don't credit it
          let diff = "";
          try { diff = execFileSync("git", ["-C", repoDir, "diff", "--unified=0", "--no-color", `${oid}^`, oid], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch {}
          const byFile = commentOnlyByFile(diff);
          const commentOnlyFiles = new Set([...byFile].filter(([, v]) => v).map(([f]) => f));
          const ship = decisionShippedBy([{ hash: oid, date: pr.mergedAt, files, commentOnlyFiles }], decisionsPath, ignoreDocs);
          if (ship) prShipOf.set(id, { date: pr.mergedAt, pr: { number: pr.number, title: pr.title } });
        }
      } catch (e) { console.error(`decisions mode: gh pr list failed (repo ${ghRepo}), "pr" link kind skipped: ${e.message}`); }
    } else console.error(`decisions mode: no readable GitHub repo found (issue.repo / origin remote), "pr" link kind skipped`);
  }

  // `d.measure` (from decisionsOfRead, see read-decisions.mjs's measurementOf) is the
  // decision's own measurement/success line, if it has one — recorded here next to the shipped row, not
  // scored (same rule as a bet's "expected outcome": scoreboard.mjs shows it, never judges it). When the
  // line names a checkable event (eventRefOf: a backtick-quoted, identifier-shaped token), and this run has
  // a pm folder to read sources.json from, cross-check it against scan-metrics.mjs's own known event names
  // — an EXACT string match only, never a similarity guess. Run scan-metrics at most once, and only if some
  // decision's measurement line actually names a candidate event (no pm folder given -> never runs at all).
  let knownEventNames = null, metricsError = null;
  function knownEvents() {
    if (knownEventNames === null) {
      try { knownEventNames = new Set(metricsCompute(pmFolder).events.map(e => e.name)); }
      catch (e) { knownEventNames = new Set(); metricsError = e.message; }
    }
    return knownEventNames;
  }
  function measureOf(d) {
    if (!d.measure) return null;
    const eventName = eventRefOf(d.measure);
    if (!eventName || !pmFolder) return { line: d.measure };
    const known = knownEvents();
    if (metricsError) return { line: d.measure };
    return { line: d.measure, event: { name: eventName, existsInCode: known.has(eventName) } };
  }

  // Warm commentOnlyCache in ONE (or a few, chunked) `git show` call for every commit that will need the
  // check across the WHOLE window, instead of leaving each one to be discovered (and shown out one at a
  // time) while mapping `inWindow` below.
  {
    const toWarm = new Set();
    for (const d of inWindow) for (const c of (commitsByDecision.get(d.no) || [])) if (needsCommentCheck(c)) toWarm.add(c.hash);
    commentOnlyFilesBatch([...toWarm]);
  }

  const rows = inWindow.map(d => {
    const matching = (commitsByDecision.get(d.no) || []).map(withCommentCheck);
    const commitShip = decisionShippedBy(matching, decisionsPath, ignoreDocs);
    const prShip = prShipOf.get(d.no) || null;
    let landed = null, link = null, prInfo = null;
    if (commitShip && (!prShip || new Date(commitShip.date) <= new Date(prShip.date))) { landed = commitShip.date; link = "commit"; }
    else if (prShip) { landed = prShip.date; link = "pr"; prInfo = prShip.pr; }
    return { ref: d.no, title: d.title.trim(), opened: d.date, landed, link, prs: prInfo ? [prInfo] : [], commits: matching.length, measure: measureOf(d) };
  });

  const shippedRows = rows.filter(r => r.landed).map(r => ({
    ...toShippedRecord({
      ref: r.ref, title: r.title, kind: "decision", team: null, opened: r.opened, landed: r.landed,
      prs: r.prs.map(p => ({ n: p.number, title: p.title, merged: r.landed ? r.landed.slice(0, 10) : null })),
      link: r.link,
    }),
    commits: r.commits,
    measure: r.measure,
  }));
  const waitingRows = rows.filter(r => !r.landed).map(r => ({
    ref: r.ref, title: r.title, opened: r.opened.slice(0, 10),
    ageDays: Math.round((Date.now() - new Date(r.opened)) / 86400000),
  }));

  const byKind = { commit: shippedRows.filter(r => r.link === "commit").length, pr: shippedRows.filter(r => r.link === "pr").length };
  const label = ownerRepo || path.basename(path.resolve(repoDir));
  const summaryLine = `Last ${dayN} days: ${inWindow.length} decisions. ${shippedRows.length} shipped (commit names it: ${byKind.commit}, PR names it: ${byKind.pr}), ${waitingRows.length} decided with nothing landed.`;
  console.log(summaryLine);
  console.log(`  mapped ${shippedRows.length}/${inWindow.length} (commit ${byKind.commit}, pr ${byKind.pr})`);

  const out = { summary: { repo: label, integration_branch: MAIN, integration_branch_reason: mainReason, window_day: dayN, decision_count: inWindow.length, mapped_count: shippedRows.length, mapped_by_kind: byKind, pr_checked: prChecked, line: summaryLine }, decisions: rows };
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log(`written: ${jsonOut}`); }

  if (shippedJsonOut) {
    const file = {
      repo: label, branch: mainShort, source: "decisions",
      window: { from: sinceDate, to: localDay() },
      generated: new Date().toISOString(),
      linkTypes: prChecked ? ["commit", "pr"] : ["commit"],
      shipped: shippedRows,
      waiting: waitingRows,
      counts: { requests: inWindow.length, open: waitingRows.length },
    };
    // Read-modify-write: another session's tool (recent.mjs's `recent`, undecided) may already have written
    // keys into the same file — keep any key this script doesn't own.
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(shippedJsonOut, "utf8")); } catch {}
    const merged = { ...existing, ...file };
    fs.mkdirSync(path.dirname(shippedJsonOut), { recursive: true });
    fs.writeFileSync(shippedJsonOut, JSON.stringify(merged, null, 2));
    console.log(`written: ${shippedJsonOut}`);
  }
}
