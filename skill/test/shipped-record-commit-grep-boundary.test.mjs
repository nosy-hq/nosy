// Contract test for internal request 124 (pm/log.md): shipped-record.mjs's "mentions" commit-grep
// (mentionIndex) used `git log --grep='#N\b' -E` to decide whether a commit's OWN message names an issue.
// `\b` is a PCRE/JS word-boundary escape, not a POSIX ERE one — on a git build without USE_LIBPCRE (this
// machine's Apple Git, confirmed with `git --version` -> "Apple Git-154"), `-E --grep='#N\b'` matches
// NOTHING, ever, so the "mentions" kind silently found zero commits on macOS. This test runs against the
// REAL `git` binary installed on this machine (no fake git — only `gh` is faked) specifically so it fails
// against the old pattern instead of just asserting the new code path was called.
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

let K, tmp, gh, jsonPath, shippedJsonPath, output, matchHash, decoyHash;

before(async () => {
  K = await fakeProductSetup();

  // #966 is only ever named as a bare "#966" mention, with a trailing non-digit boundary — never closed
  // or mentioned by any PR, so it can ONLY reach main via the commit-grep path (firstMainCommitMentioning).
  matchHash = commitAt(K.repo, 5, "fix: apply the patch discussed in #966.", { "backend/k966.js": "export function k966() { return true; }\n" });
  // A decoy that must NOT match #966: "#9660" has a DIGIT right after "966", so the boundary must reject it.
  decoyHash = commitAt(K.repo, 4, "chore: unrelated change, ticket #9660 in another tracker", { "backend/decoy.js": "export const decoy = 1;\n" });
  git(K.repo, ["push", "-q", "origin", "main"]);
  git(K.repo, ["fetch", "-q", "origin"]);

  const sources = JSON.parse(fs.readFileSync(K.sources, "utf8"));
  sources.issue = { ...(sources.issue || {}), decisionLabels: ["decision"] };
  fs.writeFileSync(K.sources, JSON.stringify(sources, null, 1));

  const now = new Date().toISOString();
  K.gh.searchPRs = []; // nothing merged in this fixture — #966 has no PR link of any kind
  K.gh.searchIssues = [
    // Milestoned (internal request 118's signal), so it counts as a decision without any PR link.
    { number: 966, title: "Patch the shipment list edge case", body: "", createdAt: now, closedAt: null,
      state: "OPEN", stateReason: null, author: { login: "customer1" }, authorAssociation: "NONE",
      labels: { nodes: [] }, milestone: { title: "v61" } },
  ];

  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-commit-grep-boundary-");
  jsonPath = path.join(tmp, "out.json");
  shippedJsonPath = path.join(tmp, "shipped.json");
  const r = run(Script, [K.repo, K.issueRepo, "--day", "90", "--pm", K.pm, "--json", jsonPath, "--shipped-json", shippedJsonPath], { env: gh.env });
  assert.equal(r.code, 0, `shipped-record.mjs: unexpected exit code, stderr: ${r.error}`);
  output = { text: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

test("a bare '#N' mention with a real word boundary ships the issue via commit-grep, on this machine's real git", () => {
  const row = output.json.decisions.find(d => d.issue === 966);
  assert.ok(row, "#966 (milestoned) should be a decision row");
  assert.equal(row.source, "commit-grep", "no PR link exists; only the commit-grep path can have mapped it");
  assert.equal(row.main_commit, matchHash, "must map to the commit that actually names '#966', not the '#9660' decoy");
  assert.ok(row.main_entry, "main_entry (the landing date) must be set");
});

test("'#9660' (a longer number) does not falsely match issue #966 (boundary correctness)", () => {
  const row = output.json.decisions.find(d => d.issue === 966);
  assert.notEqual(row.main_commit, decoyHash);
});

test("summary counts this as a commit-grep mapping", () => {
  assert.equal(output.json.summary.mapped_by_kind["commit-grep"], 1);
});
