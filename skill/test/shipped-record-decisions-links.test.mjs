// Tests for shipped-record.mjs's decisions-log mode, N1 polish round 2 (pm/log.md "N1 hand check; polish", the two documented residual gaps):
//   - comment-only case: a commit that names a decision and touches a real code file, but only changes a
//     COMMENT line, must not ship it (shipped-links.mjs's commentOnlyByFile/isCommentOrBlankLine).
//   - K134 case: a decision that really shipped, but whose landing commit never names the decision's id
//     — only a merged PR's title/body does — must still ship, via the new "pr" link kind (gh pr list,
//     read-only, no gh api), as long as the PR's merge commit ALSO clears the doc/comment bar.
// Runs against the fake product "Cargo" (fake-product.mjs) with extra decisions/commits this file adds
// itself, plus a fake `gh pr list --state merged` fixture (helpers.mjs's existing prListMerged dispatch).
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

let K, tmp, gh, shippedJsonPath, jsonPath, output;

before(async () => {
  K = await fakeProductSetup();
  const decisions = fs.readFileSync(path.join(K.repo, "DECISIONS.md"), "utf8");
  const extra = decisions + `
## K80 (2 Sep, Alex): Comment-only test decision — a code comment cites it, no real line changes.

## K81 (2 Sep, Alex): Mixed code+comment test decision.

## K91 (2 Sep, Alex): PR-naming test decision — no commit ever cites it by id, only the merged PR does.

## K92 (2 Sep, Alex): PR with only doc changes — the PR names it but never touches real code.
`;
  commitAt(K.repo, 24, "docs: add K80/K81/K91/K92 test decisions", { "DECISIONS.md": extra });

  // K80 (comment-only case): the file already has real code; the ONLY change in the naming commit
  // is a new comment line appended -> must stay waiting.
  commitAt(K.repo, 22, "chore: scaffold k80 helper file", { "backend/k80.js": "export function k80() { return true; }\n" });
  commitAt(K.repo, 20, "feat: K80 note added as a comment", {
    "backend/k80.js": "export function k80() { return true; }\n// K80: recorded, not implemented yet\n",
  });

  // K81 (mixed): the naming commit changes both a comment line AND a real code line -> must ship, "commit" link.
  commitAt(K.repo, 19, "chore: scaffold k81 helper file", { "backend/k81.js": "export function k81() { return 0; }\n" });
  commitAt(K.repo, 18, "feat: K81 implement + note", {
    "backend/k81.js": "// K81: implementing this now\nexport function k81() { return 42; }\n",
  });

  // K91/K92 (K134 case): these commits DELIBERATELY never mention "K91"/"K92" in their own message — only
  // the fake merged PR below does — so they can only ship via the new "pr" link kind, not "commit".
  const k91Hash = commitAt(K.repo, 15, "feat: export pipeline cleanup", { "backend/export.js": "export function cleanup() { return true; }\n" });
  const k92Hash = commitAt(K.repo, 12, "docs: roadmap notes", { "ROADMAP.md": "# Roadmap\n\nPlanning notes only, no code.\n" });

  git(K.repo, ["push", "-q", "origin", "main"]);
  git(K.repo, ["fetch", "-q", "origin"]);

  gh = fakeGhSetup({
    prListMerged: [
      { number: 501, title: "K91: export pipeline cleanup", body: "Closes the export cleanup decision.",
        mergedAt: new Date(Date.now() - 15 * 86400000).toISOString(), mergeCommit: { oid: k91Hash }, headRefName: "feat/k91" },
      { number: 502, title: "K92: roadmap notes", body: "Just planning, per K92.",
        mergedAt: new Date(Date.now() - 12 * 86400000).toISOString(), mergeCommit: { oid: k92Hash }, headRefName: "docs/k92" },
    ],
  });

  tmp = temporary("nosy-shipped-decisions-links-");
  jsonPath = path.join(tmp, "decisions.json");
  shippedJsonPath = path.join(tmp, "shipped.json");
  const r = run(Script, [K.repo, "--decisions", "DECISIONS.md", "--pm", K.pm, "--day", "90", "--json", jsonPath, "--shipped-json", shippedJsonPath], { env: gh.env });
  assert.equal(r.code, 0, `shipped-record.mjs --decisions: unexpected exit code, stderr: ${r.error}`);
  output = { text: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(K.root); clean(tmp); clean(gh.dir); });

function rowOf(ref) { return output.json.decisions.find(d => d.ref === ref); }

test("comment-only change to a real code file doesn't ship the decision (comment-only fix)", () => {
  const row = rowOf("K80");
  assert.ok(row, "K80 should be a decision row");
  assert.equal(row.landed, null, "K80's only naming commit adds one comment line to a .js file — no real change");
});

test("a commit mixing one comment line and one real code line ships the decision", () => {
  const row = rowOf("K81");
  assert.ok(row, "K81 should be a decision row");
  assert.ok(row.landed, "K81's commit has a real (non-comment) line change too");
  assert.equal(row.link, "commit");
});

test("a merged PR naming the decision ships it even when no commit cites the id (K134 case)", () => {
  const row = rowOf("K91");
  assert.ok(row, "K91 should be a decision row");
  assert.ok(row.landed, "the merged PR #501 names K91 and its merge commit touches real code");
  assert.equal(row.link, "pr");
  assert.equal(row.prs?.[0]?.number, 501);
});

test("a merged PR that only touches doc files doesn't ship the decision", () => {
  const row = rowOf("K92");
  assert.ok(row, "K92 should be a decision row");
  assert.equal(row.landed, null, "PR #502's merge commit only touches ROADMAP.md, a doc file");
});

test("pm/state/shipped.json: linkTypes includes \"pr\" once the check ran; K91 ships with link \"pr\"", () => {
  const j = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  assert.deepEqual(j.linkTypes, ["commit", "pr"]);
  const k91 = j.shipped.find(r => r.ref === "K91");
  assert.ok(k91, "K91 should be in the shipped rows");
  assert.equal(k91.link, "pr");
  assert.equal(k91.prs?.[0]?.n, 501);
  const k80 = j.waiting.find(r => r.ref === "K80");
  assert.ok(k80, "K80 (comment-only) should be in waiting");
  const k92 = j.waiting.find(r => r.ref === "K92");
  assert.ok(k92, "K92 (doc-only PR) should be in waiting");
});

test("--no-pr turns the pr link kind off entirely (linkTypes stays [\"commit\"], K91 falls back to waiting)", () => {
  const jsonPath2 = path.join(tmp, "decisions-nopr.json");
  const shippedJsonPath2 = path.join(tmp, "shipped-nopr.json");
  const r = run(Script, [K.repo, "--decisions", "DECISIONS.md", "--pm", K.pm, "--day", "90", "--no-pr",
    "--json", jsonPath2, "--shipped-json", shippedJsonPath2], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  const j = JSON.parse(fs.readFileSync(shippedJsonPath2, "utf8"));
  assert.deepEqual(j.linkTypes, ["commit"]);
  assert.ok(j.waiting.some(x => x.ref === "K91"), "with --no-pr, K91 has no commit link either, so it stays waiting");
});
