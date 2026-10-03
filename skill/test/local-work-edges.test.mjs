// local-work.mjs and facts.mjs `paths`, the edges (review of 2 Oct): a repo with no commits or no remote, a detached HEAD, branch names
// with slashes and accents, files with spaces and accents, worktrees (one on the same drive, one whose folder is gone), a remote that isn't called
// origin, a blobless clone that must not be asked for file contents, 300+ branches, and a cap on the path lists so memory stays sensible.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pushedNames, workingTreeEdits, matchBranchesDetailed, formatLocal } from "../tools/local-work.mjs";
import { capPaths, branchFacts, PATHS_EACH, PATHS_TOTAL } from "../tools/facts.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const env = { ...process.env, GIT_AUTHOR_NAME: "Selim", GIT_AUTHOR_EMAIL: "s@t.test", GIT_COMMITTER_NAME: "Selim", GIT_COMMITTER_EMAIL: "s@t.test", GIT_TERMINAL_PROMPT: "0" };
const tmp = p => { const d = temporary(p); dirs.push(d); return fs.realpathSync(d); };
const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
const put = (root, f, body = "x\n") => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); };
function repo({ commit = true } = {}) { const root = tmp("nosy-lw-edge-"); g(root, "init", "-q", "-b", "main"); if (commit) { put(root, "a.txt"); g(root, "add", "."); g(root, "commit", "-qm", "init"); } return root; }

test("a repo with no commits and no remote: nothing is pushed, nothing is edited, nothing throws", () => {
  const r = repo({ commit: false });
  assert.deepEqual([...pushedNames(r)], []);
  assert.deepEqual(workingTreeEdits(r, ["a.txt"]), []);
  put(r, "a.txt", "changed");
  assert.deepEqual(workingTreeEdits(r, ["a.txt"]).map(e => e.hit), [["a.txt"]], "an untracked file in a repo with no commits is still 'someone is on it'");
  assert.deepEqual(workingTreeEdits(path.join(r, "no-such-folder"), ["a.txt"]), []);
  assert.deepEqual([...pushedNames(path.join(r, "no-such-folder"))], []);
});

test("pushedNames strips whatever the remote is called, keeps slashes and accents in the branch name, and ignores HEAD", () => {
  const origin = tmp("nosy-lw-origin-"), fork = tmp("nosy-lw-fork-"); execFileSync("git", ["init", "-q", "--bare", origin]); execFileSync("git", ["init", "-q", "--bare", fork]);
  const r = repo();
  g(r, "remote", "add", "origin", origin); g(r, "remote", "add", "my-fork", fork);
  for (const b of ["feat/ünal-ödeme", "fix/a/b/c", "plain"]) { g(r, "branch", b); }
  g(r, "push", "-q", "origin", "main", "feat/ünal-ödeme"); g(r, "push", "-q", "my-fork", "fix/a/b/c", "plain");
  const names = pushedNames(r);
  for (const n of ["main", "feat/ünal-ödeme", "fix/a/b/c", "plain"]) assert.ok(names.has(n), n);
  assert.ok(![...names].some(n => /HEAD|my-fork|origin/.test(n)), [...names].join(","));
  const L = { branches: [{ name: "fix/a/b/c", filesDiffer: 1, paths: ["x.ts"], ahead: 1, date: "2026-10-01" }, { name: "feat/ünal-ödeme", filesDiffer: 1, paths: ["x.ts"], ahead: 1, date: "2026-10-02" }], prs: new Map() };
  const { list } = matchBranchesDetailed(L, { paths: ["x.ts"], pushed: names });
  assert.deepEqual(list.map(x => [x.branch, x.where]).sort(), [["feat/ünal-ödeme", "pushed, no PR"], ["fix/a/b/c", "pushed, no PR"]], "a branch on a remote that isn't origin is pushed too");
});

test("uncommitted edits: a name with spaces and accents is found as it is; a deleted worktree folder is skipped; a detached HEAD has no branch", () => {
  const r = repo(); put(r, "docs/Ürün planı (v2).tsx", "1"); put(r, "src/plain.ts", "1"); g(r, "add", "."); g(r, "commit", "-qm", "files");
  put(r, "docs/Ürün planı (v2).tsx", "2"); put(r, "src/new file.ts", "new");
  const edits = workingTreeEdits(r, ["docs/Ürün planı (v2).tsx", "src/new file.ts", "src/plain.ts"]);
  assert.equal(edits.length, 1); assert.deepEqual(edits[0].hit.sort(), ["docs/Ürün planı (v2).tsx", "src/new file.ts"]); assert.equal(edits[0].where, "the checkout"); assert.equal(edits[0].branch, "main");
  const wt = path.join(path.dirname(r), path.basename(r) + "-wt"); dirs.push(wt);
  g(r, "worktree", "add", "-q", "--detach", wt, "main"); put(wt, "src/plain.ts", "edited in the detached worktree");
  const both = workingTreeEdits(r, ["src/plain.ts"]);
  assert.deepEqual(both.map(e => [e.where, e.branch]), [[`worktree ${path.basename(wt)}`, null]], "detached: no branch");
  const gone = path.join(path.dirname(r), path.basename(r) + "-gone"); dirs.push(gone);
  g(r, "worktree", "add", "-q", "-b", "gone-branch", gone, "main"); fs.rmSync(gone, { recursive: true, force: true }); // a drive that was unplugged looks the same
  assert.doesNotThrow(() => workingTreeEdits(r, ["src/plain.ts"]));
  assert.equal(workingTreeEdits(r, ["src/plain.ts"]).length, 1);
  // Asked from inside a linked worktree: that one is "the checkout", the main folder is a worktree like any other.
  const fromWt = workingTreeEdits(wt, ["src/plain.ts", "src/new file.ts"]);
  assert.ok(fromWt.some(e => e.where === "the checkout" && e.hit.includes("src/plain.ts")), JSON.stringify(fromWt));
  assert.ok(fromWt.some(e => e.where === `worktree ${path.basename(r)}`), JSON.stringify(fromWt));
});

test("a worktree on another branch is named with that branch, including slashes and accents", () => {
  const r = repo(); put(r, "src/plain.ts", "1"); g(r, "add", "."); g(r, "commit", "-qm", "files");
  const wt = path.join(path.dirname(r), path.basename(r) + "-slash"); dirs.push(wt);
  g(r, "worktree", "add", "-q", "-b", "feat/öde/me", wt, "main"); put(wt, "src/plain.ts", "2");
  assert.deepEqual(workingTreeEdits(r, ["src/plain.ts"]).map(e => e.branch), ["feat/öde/me"]);
});

test("a blobless clone is never asked for file contents: reading refs, worktrees and status adds no pack", () => {
  const src = repo(); put(src, "src/plain.ts", "1"); g(src, "add", "."); g(src, "commit", "-qm", "files"); g(src, "config", "uploadpack.allowFilter", "true"); g(src, "config", "uploadpack.allowAnySHA1InWant", "true");
  const clone = path.join(tmp("nosy-lw-partial-"), "c");
  execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", `file://${src}`, clone], { env, stdio: "ignore" });
  g(clone, "checkout", "-q", "main");
  const packs = () => +g(clone, "count-objects", "-v").match(/^packs: (\d+)/m)[1], before = packs();
  put(clone, "src/plain.ts", "edited");
  assert.deepEqual(pushedNames(clone).has("main"), true);
  assert.equal(workingTreeEdits(clone, ["src/plain.ts"]).length, 1);
  assert.equal(packs(), before, "no lazy fetch");
});

test("300+ branches: matching 30 psst items against 400 branches of 500 paths each takes seconds at the very worst under load (0.02 to 0.2 s alone), and the list stays at 3 strong + 3 weak", () => {
  const branches = Array.from({ length: 400 }, (_, i) => ({ name: `feat/b${i}`, date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, ahead: 1 + (i % 5), filesDiffer: 1 + (i % 45), subjects: [`K${i} work`],
    paths: Array.from({ length: 500 }, (_, j) => `src/mod${j % 40}/f${(i + j) % 300}.ts`) }));
  const L = { branches, prs: new Map(), base: "main", generated: "2026-10-02" };
  const t0 = Date.now(); let strong = 0;
  for (let k = 0; k < 30; k++) { const { list, more } = matchBranchesDetailed(L, { paths: [`src/mod${k}/f${k}.ts`, `src/mod${k + 1}/f${k + 7}.ts`], refs: [`K${k}`], refRe: /K\d+/g }); assert.ok(list.length <= 6); strong += list.filter(x => x.strength === "strong").length; assert.ok(more >= 0); }
  assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0} ms`);
  assert.ok(strong > 0);
  assert.ok(formatLocal(matchBranchesDetailed(L, { paths: ["src/mod0/f0.ts"] }).list).length > 0);
});

test("capPaths: at most PATHS_EACH names per branch and PATHS_TOTAL in all, the most focused branches first, never fewer than the 60 `files` names", () => {
  const mk = (name, n) => ({ name, filesDiffer: n, paths: Array.from({ length: n }, (_, i) => `${name}/f${i}`) });
  const out = capPaths([mk("huge", 3000), mk("small", 10), mk("mid", 400)]);
  const by = n => out.find(b => b.name === n);
  assert.equal(by("small").paths.length, 10); assert.equal(by("small").pathsTruncated, undefined); assert.equal(by("small").pathsTotal, 10);
  assert.equal(by("mid").paths.length, 400);
  assert.equal(by("huge").paths.length, PATHS_EACH); assert.equal(by("huge").pathsTruncated, true); assert.equal(by("huge").pathsTotal, 3000);
  const many = capPaths(Array.from({ length: 200 }, (_, i) => mk(`b${i}`, 300 + i)), { each: 500, total: 1000 });
  assert.ok(many.every(b => b.paths.length >= 60), "every branch keeps what its `files` list shows");
  assert.ok(many.reduce((s, b) => s + b.paths.length, 0) <= 1000 + 200 * 60, "and the rest of the budget is respected");
  assert.equal(many.find(b => b.name === "b0").paths.length >= 300, true, "the most focused branch is served first");
  assert.ok(PATHS_TOTAL <= 100000 && PATHS_EACH <= 1000);
});

test("branchFacts on a real repo: a 700-file branch keeps 500 paths (flagged), `files` stays 60, and a file with accents and spaces is matched by its real name", () => {
  const r = repo(); g(r, "checkout", "-q", "-b", "wide");
  for (let i = 0; i < 700; i++) put(r, `gen/g${i}.ts`, `${i}\n`);
  put(r, "docs/Ürün planı.md", "x"); g(r, "add", "."); g(r, "commit", "-qm", "K1 wide"); g(r, "checkout", "-q", "main");
  g(r, "checkout", "-q", "-b", "accents"); put(r, "src/Ürün planı (v2).tsx", "x"); g(r, "add", "."); g(r, "commit", "-qm", "accents"); g(r, "checkout", "-q", "main");
  const list = branchFacts(r, "main", { days: 4000, now: "2026-10-02" });
  const wide = list.find(b => b.name === "wide"), acc = list.find(b => b.name === "accents");
  assert.equal(wide.filesDiffer, 701); assert.equal(wide.paths.length, 500); assert.equal(wide.pathsTruncated, true); assert.equal(wide.pathsTotal, 701); assert.equal(wide.files.length, 60);
  assert.deepEqual(acc.paths, ["src/Ürün planı (v2).tsx"], "not git's quoted \"src/\\303\\234r\\303\\274n…\"");
  const { list: hit } = matchBranchesDetailed({ branches: list, prs: new Map() }, { paths: ["src/Ürün planı (v2).tsx"] });
  assert.deepEqual(hit.map(x => x.branch), ["accents"]);
});

test("a branch that exists only on a remote that isn't called origin is 'pushed', never 'local only' (facts names the remote and the branch)", () => {
  const fork = tmp("nosy-lw-fork-"); execFileSync("git", ["init", "-q", "--bare", fork]);
  // `mine` is cloned from `author` before the branch exists, so both share one root commit (two separate repo() calls only share it when they
  // start in the same second: the test used to fail one run in three on the clock).
  const author = repo(), mine = tmp("nosy-lw-mine-"); execFileSync("git", ["clone", "-q", author, mine]);
  g(author, "remote", "add", "teammate", fork); g(author, "checkout", "-q", "-b", "feat/their-work"); put(author, "src/theirs.ts", "1"); g(author, "add", "."); g(author, "commit", "-qm", "theirs");
  g(author, "push", "-q", "teammate", "feat/their-work");
  g(mine, "remote", "add", "teammate", fork); g(mine, "fetch", "-q", "teammate");
  const list = branchFacts(mine, "main", { days: 4000, now: "2026-10-02" });
  const b = list.find(x => x.name === "teammate/feat/their-work");
  assert.ok(b, JSON.stringify(list.map(x => x.name)));
  assert.equal(b.remote, "teammate"); assert.equal(b.branch, "feat/their-work");
  const { list: hit } = matchBranchesDetailed({ branches: list, prs: new Map() }, { paths: ["src/theirs.ts"] });
  assert.equal(hit.length, 1); assert.equal(hit[0].branch, "feat/their-work"); assert.equal(hit[0].where, "pushed, no PR");
  // A local branch of the same name on the same work is one piece of work, not two.
  g(mine, "branch", "feat/their-work", "teammate/feat/their-work");
  const again = matchBranchesDetailed({ branches: branchFacts(mine, "main", { days: 4000, now: "2026-10-02" }), prs: new Map() }, { paths: ["src/theirs.ts"] });
  assert.equal(again.list.length, 1);
});
