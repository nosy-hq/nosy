// Contract tests for skill/tools/local-branches.mjs: the local-branch fallback
// peek/recent use for "close to merging" when there's no remote to read PRs from. Builds its own small
// repo directly (a plain function, not a CLI - the integration-branch.test.mjs pattern), independent of
// fake-product.mjs's Cargo (which always has a bare "origin" remote; this needs a repo without one, and
// full control over which branches are merged, unmerged, or a worktree checkout).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { localBranchesCloseToMerging } from "../tools/local-branches.mjs";
import { temporary, clean } from "./helpers.mjs";

let repo, worktreeDir;
function git(...a) { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }); }
function commit(message) {
  fs.writeFileSync(path.join(repo, "file.txt"), message + "\n" + Math.random());
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

before(() => {
  repo = temporary("nosy-branches-");
  git("init", "-q", "-b", "main");
  git("config", "user.name", "T"); git("config", "user.email", "t@t.test");
  commit("main: first commit");

  git("checkout", "-q", "-b", "feature/ref");
  commit("K30 m.2 shipment bulk export screen wired up");
  commit("more work\n\nBet: nb-260101-example-thing");
  git("checkout", "-q", "main");

  git("checkout", "-q", "-b", "feature/noref");
  commit("chore: cleanup, no reference here");
  git("checkout", "-q", "main");

  git("checkout", "-q", "-b", "feature/merged");
  commit("work that will be merged");
  git("checkout", "-q", "main");
  git("merge", "--no-ff", "-q", "feature/merged", "-m", "merge feature/merged");

  // A branch checked out in another worktree ("worktree branches count as normal
  // branches") - `git branch --format=...` lists it like any other local branch either way, but this
  // proves it (a checkout marker on a NON-`--format` listing would otherwise be easy to mistake for a state
  // this script needs to special-case).
  worktreeDir = temporary("nosy-branches-wt-");
  fs.rmdirSync(worktreeDir);
  git("checkout", "-q", "-b", "feature/worktree");
  commit("K12 m.9 worktree branch work");
  git("checkout", "-q", "main");
  git("worktree", "add", "-q", worktreeDir, "feature/worktree");
});
after(() => { clean(repo); clean(worktreeDir); });

test("lists unmerged local branches, excludes the integration branch and fully-merged branches", () => {
  const out = localBranchesCloseToMerging({ repo, integrationBranch: "main" });
  const names = out.map(b => b.branch);
  assert.ok(names.includes("feature/ref"), "feature/ref should be listed");
  assert.ok(names.includes("feature/noref"), "feature/noref should be listed");
  assert.ok(!names.includes("feature/merged"), "a fully-merged branch must not appear");
  assert.ok(!names.includes("main"), "the integration branch itself must not appear");
});

test("a branch checked out in another worktree counts as a normal branch", () => {
  const out = localBranchesCloseToMerging({ repo, integrationBranch: "main" });
  const wt = out.find(b => b.branch === "feature/worktree");
  assert.ok(wt, "a branch checked out in a worktree should still be listed");
  assert.equal(wt.ahead, 1);
  assert.deepEqual(wt.refs, ["K12"]);
});

test("commits ahead is counted correctly", () => {
  const out = localBranchesCloseToMerging({ repo, integrationBranch: "main" });
  const ref = out.find(b => b.branch === "feature/ref");
  assert.equal(ref.ahead, 2);
});

test("refs are read from commit subjects and bodies across the whole branch, including a bet id", () => {
  const out = localBranchesCloseToMerging({ repo, integrationBranch: "main" });
  const ref = out.find(b => b.branch === "feature/ref");
  assert.ok(ref.refs.includes("K30"), `expected K30 in refs: ${ref.refs}`);
  assert.ok(ref.refs.includes("nb-260101-example-thing"), `expected the bet id in refs: ${ref.refs}`);
});

test("a branch with no ref still appears, with an empty refs list (not dropped)", () => {
  const out = localBranchesCloseToMerging({ repo, integrationBranch: "main" });
  const noref = out.find(b => b.branch === "feature/noref");
  assert.ok(noref, "a branch with no ref should still be listed");
  assert.deepEqual(noref.refs, []);
});

test("last commit's subject and author are reported", () => {
  const out = localBranchesCloseToMerging({ repo, integrationBranch: "main" });
  const ref = out.find(b => b.branch === "feature/ref");
  assert.equal(ref.subject, "more work");
  assert.equal(ref.author, "T");
});

test("no repo/integrationBranch, or a git failure, returns [] rather than throwing", () => {
  assert.deepEqual(localBranchesCloseToMerging({}), []);
  assert.deepEqual(localBranchesCloseToMerging({ repo: "/nonexistent/path/xyz", integrationBranch: "main" }), []);
});
