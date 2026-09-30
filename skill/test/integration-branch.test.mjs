// Contract tests for skill/tools/integration-branch.mjs. Runs in-process (it's a
// plain function, not a CLI); the fake `gh` is put on PATH for the duration of each test that needs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fakeGhSetup, clean, temporary } from "./helpers.mjs";
import { integrationBranchOf, partialCloneNoticeOf } from "../tools/integration-branch.mjs";

const originalPath = process.env.PATH, originalFixture = process.env.FAKE_GH_FIXTURE;
function withFakeGh(fixture, fn) {
  const gh = fakeGhSetup(fixture);
  process.env.PATH = gh.env.PATH;
  process.env.FAKE_GH_FIXTURE = gh.env.FAKE_GH_FIXTURE;
  try { return fn(); } finally { process.env.PATH = originalPath; process.env.FAKE_GH_FIXTURE = originalFixture; clean(gh.dir); }
}

test("picks the branch with the most merged PRs in the window over the default branch", () => {
  withFakeGh({
    prListMerged: [
      { baseRefName: "next", mergedAt: new Date().toISOString() },
      { baseRefName: "next", mergedAt: new Date().toISOString() },
      { baseRefName: "next", mergedAt: new Date().toISOString() },
      { baseRefName: "main", mergedAt: new Date().toISOString() },
    ],
  }, () => {
    const r = integrationBranchOf({ ghRepo: "hoppscotch/hoppscotch", defaultBranch: "main", days: 90 });
    assert.equal(r.branch, "next");
    assert.match(r.reason, /most merged PRs/);
  });
});

test("stays on the default branch when it has the most (or equal) merged PRs", () => {
  withFakeGh({
    prListMerged: [
      { baseRefName: "main", mergedAt: new Date().toISOString() },
      { baseRefName: "main", mergedAt: new Date().toISOString() },
      { baseRefName: "chore", mergedAt: new Date().toISOString() },
    ],
  }, () => {
    const r = integrationBranchOf({ ghRepo: "owner/repo", defaultBranch: "main", days: 90 });
    assert.equal(r.branch, "main");
  });
});

test("an explicit sources.json integrationBranch setting always wins, without calling gh", () => {
  // No fake gh on PATH at all: if the function tried to call gh, this would fail the process, not just
  // return a fallback - so this also proves the explicit setting short-circuits detection entirely.
  const r = integrationBranchOf({ ghRepo: "owner/repo", defaultBranch: "main", explicit: "develop" });
  assert.equal(r.branch, "develop");
  assert.match(r.reason, /integrationBranch setting/);
});

test("offline / no gh on PATH: falls back to the default branch, never throws", () => {
  const savedPath = process.env.PATH;
  process.env.PATH = "";
  try {
    assert.doesNotThrow(() => {
      const r = integrationBranchOf({ ghRepo: "owner/repo", defaultBranch: "main", days: 90 });
      assert.equal(r.branch, "main");
    });
  } finally { process.env.PATH = savedPath; }
});

test("no ghRepo given: falls back to the default branch without attempting a call", () => {
  const r = integrationBranchOf({ defaultBranch: "main" });
  assert.equal(r.branch, "main");
  assert.equal(r.reason, "default branch");
});

test("merged PRs outside the window don't count", () => {
  withFakeGh({
    prListMerged: [
      { baseRefName: "next", mergedAt: new Date(Date.now() - 400 * 864e5).toISOString() }, // way outside 90d
      { baseRefName: "main", mergedAt: new Date().toISOString() },
    ],
  }, () => {
    const r = integrationBranchOf({ ghRepo: "owner/repo", defaultBranch: "main", days: 90 });
    assert.equal(r.branch, "main");
  });
});

// --- partialCloneNoticeOf --------------------------------------------------------------
// A local file:// origin, so `--filter=blob:none`/`--depth` behave like a real partial/shallow clone without
// touching the network.
function originRepoSetup(root) {
  const origin = path.join(root, "origin");
  const git = (dir, a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git(root, ["init", "-q", "-b", "main", origin]);
  git(origin, ["config", "user.name", "T"]); git(origin, ["config", "user.email", "t@t.test"]);
  for (const n of [1, 2, 3]) { fs.writeFileSync(path.join(origin, `f${n}.txt`), `${n}\n`); git(origin, ["add", "-A"]); git(origin, ["commit", "-q", "-m", `commit ${n}`]); }
  return origin;
}

test("a full (non-partial, non-shallow) clone: no notice", () => {
  const root = temporary("nosy-partial-clone-");
  try {
    const origin = originRepoSetup(root);
    const full = path.join(root, "full");
    execFileSync("git", ["clone", "-q", origin, full], { encoding: "utf8" });
    assert.equal(partialCloneNoticeOf(full), null);
  } finally { clean(root); }
});

test("a partial clone (--filter=blob:none): notice names the filter and mentions git fetch --refetch", () => {
  const root = temporary("nosy-partial-clone-");
  try {
    const origin = originRepoSetup(root);
    const partial = path.join(root, "partial");
    execFileSync("git", ["clone", "-q", "--filter=blob:none", `file://${origin}`, partial], { encoding: "utf8" });
    const notice = partialCloneNoticeOf(partial);
    assert.match(notice, /partial clone \(blob:none\)/);
    assert.match(notice, /git fetch --refetch/);
  } finally { clean(root); }
});

test("a shallow clone (--depth 1): notice mentions git fetch --unshallow", () => {
  const root = temporary("nosy-partial-clone-");
  try {
    const origin = originRepoSetup(root);
    const shallow = path.join(root, "shallow");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, shallow], { encoding: "utf8" });
    const notice = partialCloneNoticeOf(shallow);
    assert.match(notice, /shallow clone/);
    assert.match(notice, /git fetch --unshallow/);
  } finally { clean(root); }
});

test("never throws on a repo path that doesn't exist / isn't a git repo", () => {
  assert.doesNotThrow(() => assert.equal(partialCloneNoticeOf("/nonexistent/not-a-repo"), null));
});
