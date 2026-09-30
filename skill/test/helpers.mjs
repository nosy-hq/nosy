// Shared test helpers: running a script, setting up a fake `gh`, temp folder management.
// Doesn't modify any existing file; only tests under skill/test/ use it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Hints name the command that runs on THIS machine (hints.mjs nosyCommand); the suite pins it so its expectations read `nosy <command>`.
// The resolution itself is tested in command-hint.test.mjs.
process.env.NOSY_COMMAND ??= "nosy";

export const Tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools");

// Runs a tool; doesn't throw, returns {code, output, error} (code = exit code).
export function run(file, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: "utf8", maxBuffer: 64 << 20, ...opts });
  if (r.error) return { code: null, output: "", error: String(r.error) };
  return { code: r.status, output: r.stdout || "", error: r.stderr || "" };
}

// Opens a temp folder (under os.tmpdir()); tests should remove it with clean() in after().
export function temporary(prefix = "nosy-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
export function clean(dir) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

// --- Fake `gh` -------------------------------------------------------
// The 7 call shapes the scripts actually make (worked out by reading skill/tools/*.mjs):
//   1. gh pr view <n> -R <repo> --json state,mergedAt,closedAt,title        (find-stale)
//   2. gh repo view <repo> --json name                                     (verify-setup)
//   3. gh pr list -R <repo> --state open --author @me --json ...           (lowhanging, signal 1)
//   4. gh issue list -R <repo> --state open --limit 60 --json ...          (lowhanging, signal 5)
//   5. gh pr list -R <repo> --state open --limit 50 --json ...             (preread)
//   6. gh issue list -R <repo> --state all --limit 60 --json ...           (preread)
//   7. gh pr list --state open --limit 30 --json ... (cwd=repo, no -R)     (collect-status)
//   8. gh pr list -R <repo> --state merged --search ... --json baseRefName,mergedAt (integration-branch)
//   9. gh api graphql -f query=... -F q=... (backfill-history: PR search / issue search)
//  10. gh pr diff <n> -R <repo>                                            (preread --diff)
//  11. gh api repos/<repo>/pulls/<n>/files --paginate --jq .[].filename    (preread --diff --fetch;
//      scopes the --fetch git-grep fallback to the PR's own changed files)
//  12. gh pr list -R <repo> --state open --json ...,reviewDecision,...    (recent.mjs "close to merging";
//      the reviewDecision field in --json tells it apart from preread's own open-PR query, shape 5)
//  13. gh pr list -R <repo> --state merged --search "merged:>=... base:..." --json ...  (recent.mjs
//      "merged since the last run"; reuses shape 8's prListMerged fixture - recent.mjs reads more fields
//      from the same objects, integration-branch.mjs only reads baseRefName/mergedAt)
// "pr checks" isn't called by any script (confirmed with grep) - so it's not here.
//  14. fixture.fail: true - simulates gh being entirely unreachable (no remote, not a GitHub repo,
//      offline): every call exits 1, whatever it is. Used by collect-status/recent's no-remote fallback
//      tests instead of leaving specific fixture keys undefined (that only fails
//      the ONE call shape that key covers, not gh as a whole).
//  15. gh api graphql -f query=... (batched form: several "i<n>: issue(number: ...) {...}" aliases in one
//      query, shipped-links.mjs's timelineBatchQuery) - answered from the SAME
//      issueTimeline fixture as shape 9's single-issue timeline query, keyed by each alias's own number;
//      issueTimelineFail names issues whose own alias should fail (matches gh's real partial-failure shape:
//      a non-zero exit with the OTHER aliases' data still in stdout); issueTimelineMorePages names issues
//      whose first page should report hasNextPage (forces the single-issue pagination fallback).
const FAKE_GH = `#!/usr/bin/env node
import fs from "node:fs";
const fixturePath = process.env.FAKE_GH_FIXTURE;
if (!fixturePath) { process.stderr.write("fake gh: FAKE_GH_FIXTURE is not set\\n"); process.exit(1); }
let F;
try { F = JSON.parse(fs.readFileSync(fixturePath, "utf8")); }
catch (e) { process.stderr.write("fake gh: could not read fixture: " + e.message + "\\n"); process.exit(1); }
if (F.fail) { process.stderr.write("fake gh: simulated failure (no remote / offline)\\n"); process.exit(1); }
const a = process.argv.slice(2);
const has = f => a.includes(f);
const val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const write = x => { process.stdout.write(JSON.stringify(x)); process.exit(0); };
const unknown = () => { process.stderr.write("fake gh: unrecognized call: gh " + a.join(" ") + "\\n"); process.exit(1); };

if (a[0] === "pr" && a[1] === "view") {
  const n = a[2], v = F.prView && F.prView[n];
  if (!v) { process.stderr.write("fake gh: pr view " + n + ": not found\\n"); process.exit(1); }
  write(v);
} else if (a[0] === "repo" && a[1] === "view") {
  write(F.repoView || { name: "repo" });
} else if (a[0] === "pr" && a[1] === "list") {
  if (!has("-R")) { if (F.prListNoR) write(F.prListNoR); unknown(); }
  else if (has("--author")) { if (F.prListAuthorMe) write(F.prListAuthorMe); unknown(); }
  else if (val("--state") === "merged") { if (F.prListMerged) write(F.prListMerged); unknown(); }
  // recent.mjs's "close to merging" query asks for reviewDecision (preread.mjs's open-PR query doesn't) -
  // a separate fixture so the two open-PR shapes don't collide in tests.
  else if ((val("--json") || "").includes("reviewDecision")) { if (F.prListApprovable) write(F.prListApprovable); unknown(); }
  else { if (F.prListFull) write(F.prListFull); unknown(); }
} else if (a[0] === "issue" && a[1] === "list") {
  const state = val("--state");
  if (state === "open") { if (F.issueListOpen) write(F.issueListOpen); unknown(); }
  else if (state === "all") { if (F.issueListAll) write(F.issueListAll); unknown(); }
  else unknown();
} else if (a[0] === "pr" && a[1] === "diff") {
  const n = a[2], d = F.prDiff && F.prDiff[n];
  if (d === undefined) { process.stderr.write("could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300).\\n"); process.exit(1); }
  process.stdout.write(d); process.exit(0);
} else if (a[0] === "api" && a[1] === "graphql") {
  const q = val("-f") || "";
  const fVars = {};
  for (let i = 0; i < a.length; i++) if (a[i] === "-F") { const kv = a[i + 1] || ""; const eq = kv.indexOf("="); if (eq >= 0) fVars[kv.slice(0, eq)] = kv.slice(eq + 1); }
  const page = nodes => write({ data: { search: { issueCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
  if (F.searchLog && fVars.q) fs.appendFileSync(F.searchLog, fVars.q + "\\n");
  // shipped-record.mjs's canonical-name lookup (repository(owner:, name:) { nameWithOwner }, no search, no
  // timeline). Without F.repoCanonical it stays unrecognized, so the tool keeps the configured name.
  if (/repository\\(owner:/.test(q) && !/search\\(|timelineItems/.test(q)) {
    if (F.repoCanonical) write({ data: { repository: { nameWithOwner: F.repoCanonical } } });
    unknown();
  }
  // Checked BEFORE "on PullRequest" (below): shipped-links.mjs's TIMELINE_QUERY itself contains an
  // "... on PullRequest" fragment (inside CrossReferencedEvent's source), so it would otherwise be
  // misrouted to the PR-search fixture.
  if (/timelineItems/.test(q)) {
    // Batched form: "i<idx>: issue(number: <n>) { timelineItems ... }" aliases, many
    // in one query - shipped-links.mjs's timelineBatchQuery. Checked first since the old single-issue form
    // (below) is a strict subset of this pattern's shape otherwise.
    const aliasMatches = [...q.matchAll(/i(\\d+): issue\\(number: (\\d+)\\)/g)];
    if (aliasMatches.length) {
      // F.issueTimelineFail: ["<issue number>", ...] - simulates that ONE issue's own alias failing to
      // resolve (GitHub's real behavior: repository[alias] is null, an errors[] entry names it, gh still
      // exits non-zero) without failing every OTHER issue in the same batch.
      const fail = new Set((F.issueTimelineFail || []).map(String));
      const repository = {};
      let anyFail = false;
      for (const pair of aliasMatches) {
        const idx = pair[1], numStr = pair[2];
        if (fail.has(numStr)) { repository["i" + idx] = null; anyFail = true; continue; }
        const nodes = (F.issueTimeline && F.issueTimeline[numStr]) || [];
        const hasNextPage = !!(F.issueTimelineMorePages && F.issueTimelineMorePages.includes(numStr));
        repository["i" + idx] = { timelineItems: { pageInfo: { hasNextPage: hasNextPage, endCursor: hasNextPage ? "cursor1" : null }, nodes: nodes } };
      }
      const errPart = anyFail ? { errors: [{ message: "Could not resolve to an Issue" }] } : {};
      const body = JSON.stringify(Object.assign({ data: { repository: repository } }, errPart));
      process.stdout.write(body);
      process.exit(anyFail ? 1 : 0);
    }
    const num = fVars.number;
    const nodes = (F.issueTimeline && F.issueTimeline[num]) || [];
    write({ data: { repository: { issue: { timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } });
  }
  else if (/on PullRequest/.test(q)) { if (F.searchPRs) page(F.searchPRs); unknown(); }
  else if (/on Issue/.test(q)) { if (F.searchIssues) page(F.searchIssues); unknown(); }
  else unknown();
} else if (a[0] === "api") {
  const m = (a[1] || "").match(/\\/pulls\\/(\\d+)\\/files$/);
  const files = m && F.prFiles && F.prFiles[m[1]];
  if (!files) { process.stderr.write("fake gh: api " + (a[1] || "") + ": not found\\n"); process.exit(1); }
  process.stdout.write(files.map(f => f + "\\n").join(""));
  process.exit(0);
} else unknown();
`;

// fixture: { fail (every call exits 1 - simulated total gh failure),
//            prView, repoView, prListNoR, prListAuthorMe, prListMerged, prListFull, prListApprovable,
//            issueListOpen, issueListAll,
//            searchPRs, searchIssues (backfill-history's "gh api graphql" search results),
//            issueTimeline: {"<issue number>": [ {__typename, ...}, ... ]} (shipped-links.mjs's
//              fetchIssueTimeline / timelineBatchQuery: one issue's raw timelineItems nodes, matched by the
//              "-F number=" value (single-issue form) or by its own alias's number (batched form, shape 15);
//              a missing key returns an empty node list, not an error),
//            issueTimelineFail: ["<issue number>", ...] (batched form only: this issue's own alias fails to
//              resolve — the other issues in the same batch still get their issueTimeline data, shape 15),
//            issueTimelineMorePages: ["<issue number>", ...] (batched form only: this issue's first page
//              reports hasNextPage — forces shipped-record.mjs's single-issue pagination fallback),
//            prDiff: {"<n>": "<diff text>"} (missing entry -> simulates gh's "too large" failure),
//            prFiles: {"<n>": ["path", ...]} (the PR's own changed-file list, for the --fetch fallback),
//            repoCanonical: "<owner/name>" (answer to shipped-record's repository(owner:, name:) lookup —
//              simulates a renamed repo; unset -> that call fails, the configured name is kept),
//            searchLog: "<file>" (every graphql "-F q=" search string is appended there, one per line) }
// prListApprovable: recent.mjs's "close to merging" query - objects need isDraft, reviewDecision,
// statusCheckRollup, updatedAt, number, title, author, body.
// Returns: { env } - passed to run() as { env }; found BEFORE the real `gh` (prepended to PATH).
export function fakeGhSetup(fixture) {
  const dir = temporary("nosy-gh-");
  const fixturePath = path.join(dir, "fixture.json");
  fs.writeFileSync(fixturePath, JSON.stringify(fixture ?? {}));
  const ghPath = path.join(dir, "gh");
  fs.writeFileSync(ghPath, FAKE_GH);
  fs.chmodSync(ghPath, 0o755);
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, FAKE_GH_FIXTURE: fixturePath };
  return { dir, env };
}
