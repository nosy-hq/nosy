// facts.mjs: the hard facts once (commits by person/kind/area, branches with content not in base, issues/PRs)
// and find (any word anywhere). Throwaway repo; no network (--no-gh, and a hand-written github.json).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { termPattern, fold, find, branchFacts } from "../tools/facts.mjs";

const F = path.join(Tool, "facts.mjs"), dirs = [];
after(() => dirs.forEach(clean));

function repo() {
  const root = temporary("nosy-facts-"); dirs.push(root);
  const git = (who, date, ...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: "x@x", GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: "x@x", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).trim();
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  const commit = (who, date, msg) => { git(who, date, "add", "-A"); git(who, date, "commit", "-q", "-m", msg); };
  git("t", "2026-08-01T10:00:00+03:00", "init", "-q", "-b", "main");
  put("apps/api/a.go", "package a\n"); put("docs/x.md", "Bilirkişi raporu burada.\n"); commit("Selim", "2026-08-01T10:00:00+03:00", "init");
  // Squashed: the branch's change reached main as another commit; a merge would change nothing.
  git("t", "2026-09-20T10:00:00+03:00", "checkout", "-q", "-b", "squashed");
  put("apps/web/s.tsx", "export const s = 1;\n"); commit("Alex", "2026-09-20T10:00:00+03:00", "feat: s");
  put("apps/web/s.tsx", "export const s = 2;\n"); commit("Alex", "2026-09-20T11:00:00+03:00", "fix: s");
  git("t", "2026-09-21T10:00:00+03:00", "checkout", "-q", "main");
  put("apps/web/s.tsx", "export const s = 2;\n"); commit("Alex", "2026-09-23T10:00:00+03:00", "feat(web): s (squash)");
  // Real: content main doesn't have.
  git("t", "2026-09-24T10:00:00+03:00", "checkout", "-q", "-b", "real");
  put("apps/web/r.tsx", "export const r = 1;\n"); put("apps/web/r.png", "png"); commit("Alex", "2026-09-24T10:00:00+03:00", "feat: r");
  git("t", "2026-09-24T11:00:00+03:00", "checkout", "-q", "main");
  put("apps/api/a.go", "package a // 2\n"); commit("Selim", "2026-09-25T23:30:00+03:00", "fix(api): a");
  put("docs/y.md", "y\n"); commit("Selim", "2026-09-26T09:00:00+03:00", "docs: y");
  put("docs/z.md", "z\n"); commit("Emre", "2026-09-10T09:00:00+03:00", "backend: z");
  fs.mkdirSync(path.join(root, "pm")); fs.writeFileSync(path.join(root, "pm", "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  return { root, pm: path.join(root, "pm") };
}

test("build: last-7-days and month counts by person, kind, area; branches by what a merge would still change", () => {
  const r = repo();
  const out = run(F, [r.pm, "build", "--now", "2026-09-29", "--no-gh"]);
  assert.equal(out.code, 0, out.error);
  assert.match(out.output, /3 commits in the last 7 days, 1 branches with content not in main, GitHub not read/);
  const C = JSON.parse(fs.readFileSync(path.join(r.pm, "state", "facts", "commits.json"), "utf8"));
  assert.deepEqual([C.week.from, C.week.to, C.week.total], ["2026-09-22", "2026-09-28", 3]);
  assert.deepEqual(C.week.byPerson, { Selim: 2, Alex: 1 });
  assert.deepEqual(C.week.byKind, { feat: 1, fix: 1, docs: 1 });
  assert.equal(C.week.byArea["apps/web"], 1);
  assert.equal(C.week.byDay["2026-09-25"], 1, "author date in the author's own zone (23:30 +03 stays on the 25th)");
  assert.equal(C.month.total, 4); assert.equal(C.month.byKind.other, 1);
  const B = JSON.parse(fs.readFileSync(path.join(r.pm, "state", "facts", "branches.json"), "utf8")).branches;
  const by = Object.fromEntries(B.map(b => [b.name, b]));
  assert.equal(by.squashed.ahead, 2, "two commits ahead…");
  assert.equal(by.squashed.filesDiffer + by.squashed.images, 0, "…but nothing a merge would add");
  assert.equal(by.real.filesDiffer, 1); assert.equal(by.real.images, 1); assert.equal(by.real.files[0].file, "apps/web/r.tsx");
  const md = fs.readFileSync(path.join(r.pm, "state", "facts.md"), "utf8");
  assert.match(md, /## Last 7 days \(2026-09-22 – 2026-09-28\): 3 non-merge commits/);
  assert.match(md, /\| real \| 1 \(\+1 images\) \| 1 \(1\) \|/);
  assert.doesNotMatch(md, /\| squashed \|/);
  assert.match(md, /## GitHub: not read/);
});

test("find: Turkish letters either way, any case, any suffix; issues and PRs too; exit 2 when nowhere", () => {
  const r = repo();
  run(F, [r.pm, "build", "--now", "2026-09-29", "--no-gh"]);
  fs.writeFileSync(path.join(r.pm, "state", "facts", "github.json"), JSON.stringify({ items: [
    { n: 377, kind: "pr", state: "merged", merged: "2026-09-26", title: "official links", body: "bilirkisi raporu linki", comments: [] },
    { n: 12, kind: "issue", state: "open", title: "other", body: "", comments: [{ body: "BİLİRKİŞİ" }] }] }));
  const out = run(F, [r.pm, "find", "bilirkisi"]);
  assert.equal(out.code, 0, out.error);
  assert.match(out.output, /"bilirkisi": 1 line in 1 file, 0 commits on main, 2 issue\/PR/);
  assert.match(out.output, /docs\/x\.md:1 \[line written 2026-08-01\] {2}Bilirkişi raporu burada\./);
  assert.match(out.output, /#377 PR, merged 2026-09-26: official links \(in body\)/);
  assert.match(out.output, /#12 issue, open: other \(in comments\)/);
  const none = run(F, [r.pm, "find", "zzqq"]);
  assert.equal(none.code, 2); assert.match(none.output, /nowhere: every tracked file/);
});

test("find: commits that mention it, and a doc line older than the newest such commit is flagged before repeating", () => {
  const r = repo();
  const git = (...a) => execFileSync("git", ["-C", r.root, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-09-25T10:00:00+03:00", GIT_COMMITTER_DATE: "2026-09-25T10:00:00+03:00" } });
  fs.writeFileSync(path.join(r.root, "docs", "plan.md"), "Tracked changes: not built yet.\n");
  execFileSync("git", ["-C", r.root, "add", "-A"], { env: { ...process.env, GIT_AUTHOR_DATE: "2026-09-24T10:00:00+03:00", GIT_COMMITTER_DATE: "2026-09-24T10:00:00+03:00" } });
  execFileSync("git", ["-C", r.root, "commit", "-q", "-m", "docs: plan"], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-09-24T10:00:00+03:00", GIT_COMMITTER_DATE: "2026-09-24T10:00:00+03:00" } });
  fs.writeFileSync(path.join(r.root, "apps", "api", "w.go"), "package a\n");
  git("add", "-A"); git("commit", "-q", "-m", "feat(word): Uygula writes a tracked change");
  const out = run(F, [r.pm, "find", "tracked change"]);
  assert.equal(out.code, 0, out.error);
  assert.match(out.output, /1 line in 1 file, 1 commit on main/);
  assert.match(out.output, /docs\/plan\.md:1 \[line written 2026-09-24\]/);
  assert.match(out.output, /commits mentioning it \(newest first\):\n {2}- [0-9a-f]+ 2026-09-25 feat\(word\): Uygula writes a tracked change/);
  assert.match(out.output, /\*\*check before repeating:\*\* docs\/plan\.md:1 \(written 2026-09-24\) is older than [0-9a-f]+ \(2026-09-25/);
});

test("termPattern / fold: the pattern git grep gets covers ı/İ/ş/ğ/ü/ö/ç and â/î/û", () => {
  const re = new RegExp(termPattern("Resmî içtihat"));
  for (const s of ["Resmî içtihat", "RESMI ICTIHAT", "resmi İçtihat", "Resmi ictihat"]) assert.ok(re.test(s), s);
  assert.equal(fold("İÇTİHAT Şûrâ"), "ictihat sura");
  assert.equal(find(repo().root, null, ["package"])[0].files.length, 1);
});

test("unreadable sources.json or unknown command: exit 1", () => {
  const r = repo();
  assert.equal(run(F, [path.join(r.root, "nope"), "build"]).code, 1);
  assert.equal(run(F, [r.pm, "frobnicate"]).code, 1);
  assert.equal(run(F, [r.pm, "find"]).code, 1);
});

test("big repos: only recent branches, capped; nothing written to the repo; a blobless clone is compared by blob id without fetching", () => {
  const r = repo();
  const count = dir => { let n = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : n++; }; walk(dir); return n; };
  const before = count(path.join(r.root, ".git", "objects"));
  const out = run(F, [r.pm, "build", "--now", "2026-09-29", "--no-gh", "--branch-days", "7", "--max-branches", "5"]);
  assert.equal(out.code, 0, out.error);
  assert.equal(count(path.join(r.root, ".git", "objects")), before, "merge-tree wrote nothing into the repo");
  const B = JSON.parse(fs.readFileSync(path.join(r.pm, "state", "facts", "branches.json"), "utf8"));
  assert.deepEqual([B.scope.checked, B.scope.recent, B.scope.total, B.scope.partial, B.scope.farAhead], [2, 1, 3, false, 1], "the branch with a commit in the last 7 days, plus the older unmerged one furthest ahead");
  assert.deepEqual(B.branches.map(b => b.name).sort(), ["real", "squashed"]);
  assert.match(fs.readFileSync(path.join(r.pm, "state", "facts.md"), "utf8"), /Checked 2 branches of 3: those with a commit since 2026-09-22, and the 1 unmerged furthest ahead/);
  // A blobless clone of the same repo.
  execFileSync("git", ["-C", r.root, "config", "uploadpack.allowFilter", "true"]);
  const bare = temporary("nosy-facts-partial-"); dirs.push(bare);
  const clone = path.join(bare, "c");
  execFileSync("git", ["clone", "-q", "--no-local", "--filter=blob:none", "--no-checkout", `file://${r.root}`, clone]);
  execFileSync("git", ["-C", clone, "update-ref", "refs/heads/main", "origin/main"]);
  const pm2 = path.join(bare, "pm"); fs.mkdirSync(pm2); fs.writeFileSync(path.join(pm2, "sources.json"), JSON.stringify({ repo: clone, ref: "main" }));
  const b2 = count(path.join(clone, ".git", "objects"));
  const out2 = run(F, [pm2, "build", "--now", "2026-09-29", "--no-gh"]);
  assert.equal(out2.code, 0, out2.error);
  assert.equal(count(path.join(clone, ".git", "objects")), b2, "no lazy fetch into the partial clone");
  const B2 = JSON.parse(fs.readFileSync(path.join(pm2, "state", "facts", "branches.json"), "utf8"));
  assert.equal(B2.scope.partial, true);
  const real = B2.branches.find(b => /real$/.test(b.name));
  assert.deepEqual(real.files.map(f => f.file).sort(), ["apps/web/r.png", "apps/web/r.tsx"].filter(f => !/png$/.test(f)));
  assert.equal(real.images, 1);
  assert.equal(B2.branches.some(b => /squashed$/.test(b.name) && b.filesDiffer + b.images > 0), false, "squashed branch: same blobs, nothing missing");
  assert.match(fs.readFileSync(path.join(pm2, "state", "facts.md"), "utf8"), /This is a partial clone: files compared by blob id/);
});

test("a branch with an open PR is always checked, however old", () => {
  const r = repo();
  const B = branchFacts(r.root, "main", { now: "2026-09-29", days: 1, max: 0, big: 0, openPr: new Set(["squashed"]) });
  assert.deepEqual(B.map(b => b.name), ["squashed"]);
  assert.equal(B.meta.openPr, 1);
});

test("a treeless clone: missing trees are never fetched; those branches are reported as not in this clone", () => {
  const r = repo();
  execFileSync("git", ["-C", r.root, "config", "uploadpack.allowFilter", "true"]);
  const dir = temporary("nosy-facts-treeless-"); dirs.push(dir);
  const clone = path.join(dir, "c");
  execFileSync("git", ["clone", "-q", "--no-local", "--filter=tree:0", "--no-checkout", `file://${r.root}`, clone]);
  execFileSync("git", ["-C", clone, "update-ref", "refs/heads/main", "origin/main"]);
  const pm = path.join(dir, "pm"); fs.mkdirSync(pm); fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: clone, ref: "main" }));
  const packs = () => fs.readdirSync(path.join(clone, ".git", "objects", "pack")).length;
  const before = packs();
  const out = run(F, [pm, "build", "--now", "2026-09-29", "--no-gh"]);
  assert.equal(out.code, 0, out.error);
  assert.equal(packs(), before, "no lazy fetch: no new pack written");
  const B = JSON.parse(fs.readFileSync(path.join(pm, "state", "facts", "branches.json"), "utf8"));
  assert.ok(B.scope.notLocal >= 1, JSON.stringify(B.scope));
  assert.match(fs.readFileSync(path.join(pm, "state", "facts.md"), "utf8"), /trees aren't in this clone/);
});
