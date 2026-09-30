// pm/log.md, "shipped 7d took ~143s": decisions-log mode's comment-only check
// (shipped-links.mjs's commentOnlyByFile, called from shipped-record.mjs's runDecisionsMode) used to run
// ONE `git show --unified=0 --no-color <hash>` PROCESS PER qualifying commit. shipped-record.mjs now warms
// the same check for every commit in the window with ONE (or a few, chunked) `git show --unified=0
// --no-color <hash1> <hash2> ...` call, splitting the concatenated output on git's own "commit <hash>"
// boundary line. This test proves that split-and-batch path gives the EXACT SAME per-commit comment-only
// result as the old one-call-per-commit path, on a small real git fixture — not a fake `git`, the real
// thing, so the splitting regex is checked against git's actual multi-commit `git show` output shape
// (including a merge commit, which still gets its own "commit <hash>" line in that output).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { commentOnlyByFile } from "../tools/shipped-links.mjs";
import { temporary, clean } from "./helpers.mjs";

let repo, hashes;

function git(args) { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }); }
function commitFile(rel, content, message) {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]).trim();
}

before(() => {
  repo = temporary("nosy-comment-batch-");
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);

  const h = {};
  // A: a real code change (not comment-only).
  h.real = commitFile("app.js", "function f() {\n  return 1;\n}\n", "K1: real code change");
  // B: comment-only change on top of A (only a JS comment line added).
  fs.writeFileSync(path.join(repo, "app.js"), "// K1: explains the return value\nfunction f() {\n  return 1;\n}\n");
  git(["add", "-A"]); git(["commit", "-q", "-m", "K1: comment-only follow-up"]);
  h.commentOnly = git(["rev-parse", "HEAD"]).trim();
  // C: doc-only change (KARARLAR.md itself — not part of app code at all).
  h.docOnly = commitFile("KARARLAR.md", "## K2\nSome decision text.\n", "K2: decision recorded");
  // D: a second real file touched, to exercise more than one file per commit.
  fs.writeFileSync(path.join(repo, "app.js"), "function f() {\n  return 2;\n}\n");
  fs.writeFileSync(path.join(repo, "util.js"), "// util\nfunction g() {}\n", );
  git(["add", "-A"]); git(["commit", "-q", "-m", "K3: real change touching two files"]);
  h.twoFiles = git(["rev-parse", "HEAD"]).trim();
  // E: a branch + merge commit, so the batch includes a merge (its own "commit <hash>" line still applies).
  git(["checkout", "-q", "-b", "side"]);
  fs.writeFileSync(path.join(repo, "side.js"), "function s() { return 3; }\n");
  git(["add", "-A"]); git(["commit", "-q", "-m", "K4: side branch change"]);
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--no-ff", "-m", "Merge side into main", "side"]);
  h.merge = git(["rev-parse", "HEAD"]).trim();

  hashes = h;
});
after(() => clean(repo));

// The OLD path: one `git show` per commit.
function commentOnlyPerCommit(hashList) {
  const result = new Map();
  for (const hash of hashList) {
    const diff = execFileSync("git", ["-C", repo, "show", "--unified=0", "--no-color", hash], { encoding: "utf8" });
    const byFile = commentOnlyByFile(diff);
    result.set(hash, new Set([...byFile].filter(([, v]) => v).map(([f]) => f)));
  }
  return result;
}
// The NEW path: one batched `git show`, split on git's own "commit <hash>" line — the same logic
// shipped-record.mjs's commentOnlyFilesBatch uses.
function commentOnlyBatched(hashList) {
  const result = new Map();
  const raw = execFileSync("git", ["-C", repo, "show", "--unified=0", "--no-color", ...hashList], { encoding: "utf8" });
  const parts = raw.split(/^commit ([0-9a-f]{40})$/m);
  for (let j = 1; j < parts.length; j += 2) {
    const byFile = commentOnlyByFile(parts[j + 1] || "");
    result.set(parts[j], new Set([...byFile].filter(([, v]) => v).map(([f]) => f)));
  }
  return result;
}
const sorted = set => [...set].sort();

test("batched git show gives the identical per-commit comment-only result as one-call-per-commit", () => {
  const all = [hashes.real, hashes.commentOnly, hashes.docOnly, hashes.twoFiles, hashes.merge];
  const perCommit = commentOnlyPerCommit(all);
  const batched = commentOnlyBatched(all);
  assert.deepEqual([...batched.keys()].sort(), [...perCommit.keys()].sort(), "batched path must cover every commit the per-commit path covers");
  for (const hash of all) {
    assert.deepEqual(sorted(batched.get(hash)), sorted(perCommit.get(hash)), `mismatch for ${hash}`);
  }
});

test("sanity: the fixture's own comment-only/real classification is what the test intends", () => {
  const perCommit = commentOnlyPerCommit([hashes.real, hashes.commentOnly, hashes.docOnly, hashes.twoFiles]);
  assert.deepEqual(sorted(perCommit.get(hashes.real)), [], "a real code change must not be flagged comment-only");
  assert.deepEqual(sorted(perCommit.get(hashes.commentOnly)), ["app.js"], "a comment-only JS change must be flagged for that file");
  assert.deepEqual(sorted(perCommit.get(hashes.twoFiles)), [], "a real change to two files must not be flagged comment-only for either");
});

test("batching still works with a single commit (no other alias in the same call)", () => {
  const perCommit = commentOnlyPerCommit([hashes.commentOnly]);
  const batched = commentOnlyBatched([hashes.commentOnly]);
  assert.deepEqual(sorted(batched.get(hashes.commentOnly)), sorted(perCommit.get(hashes.commentOnly)));
});
