// local-work.mjs + its use in psst-receipts / psst-refute. First run on a real product: 3 of 5 psst draft items were
// already done on the owner's own local, unpushed branches, and nothing joined an item to them. Each case here is a way that went
// (or could go) wrong, in a temp repo with invented names:
//   local-only branch touching the item's file        → "Already written locally … local only, not pushed"
//   branch pushed to a remote, no PR                   → "pushed, no PR"
//   a branch with a PR (github.json)                   → says which PR
//   a big branch that only shares one file             → weak, said differently, never a verdict
//   a documentation file, or a file 4+ focused branches touch → weak too (first run on a real product: a handoff doc and a mapper made 5 "strong" each)
//   the most focused branch is listed first; the rest are counted
//   a branch whose commit subjects carry the item ref  → strong without a file in common
//   uncommitted edits in a worktree                    → named
//   work already in main (squash-style)                → no match
//   no facts yet                                       → receipts say local work wasn't checked
//   the refuter packet carries the block
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { receipts, formatMd } from "../tools/psst-receipts.mjs";
import { pack } from "../tools/psst-refute.mjs";
import { matchBranches, loadLocalWork } from "../tools/local-work.mjs";
import { temporary, clean, run, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const env = { ...process.env, GIT_AUTHOR_NAME: "Selim", GIT_AUTHOR_EMAIL: "s@t.test", GIT_COMMITTER_NAME: "Selim", GIT_COMMITTER_EMAIL: "s@t.test", GIT_TERMINAL_PROMPT: "0" };

function product({ withFacts = true, withPr = false } = {}) {
  const root = temporary("nosy-localwork-"); dirs.push(root);
  const remote = temporary("nosy-localwork-remote-"); dirs.push(remote);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env });
  const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); };
  const commit = m => { git("add", "."); git("commit", "-qm", m); };
  execFileSync("git", ["init", "-q", "--bare", remote], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  for (const f of ["pricing", "gazette-page", "chat", "profile", "mapper", "already"]) put(`apps/web/${f}.tsx`, `export const ${f} = 1;\n`);
  for (let i = 0; i < 50; i++) put(`apps/web/gen/g${i}.ts`, `export const g${i} = ${i};\n`);
  commit("init"); git("remote", "add", "origin", remote); git("push", "-q", "origin", "main");

  // Local only: edits the pricing screen.
  git("checkout", "-q", "-b", "plans-screen"); put("apps/web/pricing.tsx", "export const pricing = 2; // plans\n"); commit("pricing: plan cards"); git("checkout", "-q", "main");
  // Pushed, no PR: the gazette page.
  git("checkout", "-q", "-b", "gazette-tab"); put("apps/web/gazette-page.tsx", "export const gazette = 2;\n"); commit("gazette tab"); git("push", "-q", "origin", "gazette-tab"); git("checkout", "-q", "main");
  // Big branch that merely shares chat.tsx.
  git("checkout", "-q", "-b", "regen-everything"); put("apps/web/chat.tsx", "export const chat = 2;\n");
  for (let i = 0; i < 50; i++) put(`apps/web/gen/g${i}.ts`, `export const g${i} = ${i + 100};\n`);
  commit("regenerate"); git("checkout", "-q", "main");
  // The reference in a commit subject, no file in common with the item.
  git("checkout", "-q", "-b", "k77-work"); put("apps/web/other-place.ts", "export const o = 1;\n"); commit("K77 first part"); git("checkout", "-q", "main");
  // Already in main by a squash-style re-commit: same content, different commits.
  git("checkout", "-q", "-b", "done-already"); put("apps/web/already.tsx", "export const already = 2;\n"); commit("already, on a branch"); git("checkout", "-q", "main");
  put("apps/web/already.tsx", "export const already = 2;\n"); commit("already (squash)");
  // A file four focused branches touch (a shared mapper), a doc every branch edits, and one focused branch with a file of its own.
  put("apps/web/hot.tsx", "export const hot = 1;\n"); put("docs/NEEDS.md", "# needs\n"); put("apps/web/own.tsx", "export const own = 1;\n"); commit("add shared files");
  for (let i = 1; i <= 4; i++) { git("checkout", "-q", "-b", `hot-${i}`, "main"); put("apps/web/hot.tsx", `export const hot = ${i + 1};\n`); put("docs/NEEDS.md", `# needs ${i}\n`); commit(`hot ${i}`); git("checkout", "-q", "main"); }
  git("checkout", "-q", "-b", "owns-it", "main"); put("apps/web/own.tsx", "export const own = 2;\n"); put("apps/web/own-extra.tsx", "export const x = 1;\n"); commit("own"); git("checkout", "-q", "main");
  // Uncommitted edit in a second worktree.
  const wt = path.join(root, "..", path.basename(root) + "-wt"); dirs.push(wt);
  git("worktree", "add", "-q", "-b", "wip", wt, "main");
  fs.writeFileSync(path.join(wt, "apps/web/profile.tsx"), "export const profile = 99;\n");

  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", refs: ["\\bK\\d+\\b", "#\\d+"] }));
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ items: [
    { score: 3, type: "Screen built, waiting for backend", title: "Plans", evidence: "apps/web/pricing.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Gazette", evidence: "apps/web/gazette-page.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Chat context", evidence: "apps/web/chat.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "K77 · something", ref: "K77", evidence: "apps/web/mapper.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Already done", evidence: "apps/web/already.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Profile", evidence: "apps/web/profile.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Hot file", evidence: "apps/web/hot.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Doc only", evidence: "docs/NEEDS.md:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Own file", evidence: "apps/web/own.tsx:1", detail: [] },
    { score: 3, type: "Backend ready, not on screen", title: "Untouched", evidence: "apps/web/gen/g3.ts:1", detail: [] },
  ] }));
  if (withFacts) {
    if (withPr) {
      // facts writes github.json only with gh; the shape is its own (facts.mjs githubFacts), so seed it after the build.
    }
    const r = run(path.join(Tool, "facts.mjs"), [pm, "build", "--no-gh"]);
    assert.equal(r.code, 0, r.error);
    if (withPr) fs.writeFileSync(path.join(pm, "state", "facts", "github.json"), JSON.stringify({ generated: new Date().toISOString(), items: [{ n: 12, kind: "pr", state: "open", branch: "gazette-tab", by: "selim", title: "t" }] }));
  }
  return { pm, root };
}

const by = (R, title) => R.items.find(i => i.title.startsWith(title));

test("a local-only branch that changes the item's file: strong, local only", () => {
  const { pm } = product();
  const it = by(receipts(pm), "Plans");
  assert.equal(it.local.length, 1);
  assert.equal(it.local[0].branch, "plans-screen");
  assert.equal(it.local[0].strength, "strong");
  assert.equal(it.local[0].state, "local");
  assert.match(it.local[0].where, /local only, not pushed/);
  assert.equal(it.local[0].author, "Selim");
  assert.equal(it.inProgress, true);
  assert.match(formatMd(receipts(pm)), /Already written locally:\*\* branch `plans-screen` by Selim.*local only, not pushed.*This isn't new work/s);
});

test("a branch on the remote with no PR is 'pushed, no PR'; a PR in github.json is named", () => {
  const { pm } = product();
  assert.match(by(receipts(pm), "Gazette").local[0].where, /pushed, no PR/);
  const { pm: pm2 } = product({ withPr: true });
  const g = by(receipts(pm2), "Gazette").local[0];
  assert.equal(g.pr, 12);
  assert.match(g.where, /PR #12/);
});

test("a big branch that only shares a file is weak and says so; it never makes the item 'in progress' by itself", () => {
  const { pm } = product();
  const it = by(receipts(pm), "Chat context");
  assert.equal(it.local.length, 1);
  assert.equal(it.local[0].strength, "weak");
  assert.equal(it.inProgress, false);
  assert.equal(it.local[0].weakBecause, "a big branch");
  assert.match(formatMd(receipts(pm)), /Weak match \(a big branch\):\*\* `regen-everything`/);
});

test("a file four focused branches touch, and a documentation file, are weak for every branch; a focused branch with a file of its own is strong", () => {
  const { pm } = product();
  const R = receipts(pm);
  const hot = by(R, "Hot file");
  assert.equal(hot.local.length, 3, "at most 3 listed");
  assert.ok(hot.local.every(x => x.strength === "weak" && x.weakBecause === "a file many branches touch"));
  assert.equal(hot.localMore, 1, "the fourth is counted, not listed");
  assert.equal(hot.inProgress, false, "four branches on a shared file is not 'someone did this item'");
  assert.match(formatMd(R), /1 more branch also touch these files|1 more branch also touch/);
  const doc = by(R, "Doc only");
  assert.ok(doc.local.length && doc.local.every(x => x.strength === "weak" && x.weakBecause === "documentation file only"));
  const own = by(R, "Own file");
  assert.equal(own.local.length, 1);
  assert.equal(own.local[0].branch, "owns-it");
  assert.equal(own.local[0].strength, "strong");
});

test("a branch whose commit subjects carry the item's reference is strong with no file in common", () => {
  const { pm } = product();
  const it = by(receipts(pm), "K77");
  assert.equal(it.local[0].branch, "k77-work");
  assert.deepEqual(it.local[0].refs, ["K77"]);
  assert.equal(it.local[0].strength, "strong");
});

test("work already in main (same content, other commits) and an untouched file match nothing", () => {
  const { pm } = product();
  const R = receipts(pm);
  assert.deepEqual(by(R, "Already done").local, [], "done-already differs from main in no file");
  assert.deepEqual(by(R, "Untouched").local.filter(x => x.strength === "strong"), []);
});

test("uncommitted edits in another worktree are named", () => {
  const { pm } = product();
  const it = by(receipts(pm), "Profile");
  assert.equal(it.edits.length, 1);
  assert.match(it.edits[0].where, /^worktree /);
  assert.equal(it.edits[0].branch, "wip");
  assert.equal(it.inProgress, true);
  assert.match(formatMd(receipts(pm)), /Uncommitted edits\*\* in worktree .*profile\.tsx/);
});

test("no facts yet: receipts say local work wasn't checked, and match nothing", () => {
  const { pm } = product({ withFacts: false });
  const R = receipts(pm);
  assert.equal(R.localWork.checked, false);
  assert.ok(R.items.every(i => i.local.length === 0));
  assert.match(formatMd(R), /Local work not checked: no `pm\/state\/facts\/branches\.json` \(run `nosy facts`\)/);
});

test("the refuter's packet carries the block, and tells it to read the diff", () => {
  const { pm } = product();
  fs.writeFileSync(path.join(pm, "state", "receipts.json"), JSON.stringify(receipts(pm)));
  fs.writeFileSync(path.join(pm, "state", "psst-draft.json"), JSON.stringify({ items: [{ id: 1, title: "Plans", claim: "wire the plans screen", size: "S", evidence: ["apps/web/pricing.tsx:1"], receipt: 1 }] }));
  pack(pm);
  const packet = fs.readFileSync(path.join(pm, "state", "refute-packet.md"), "utf8");
  assert.match(packet, /Written locally:\*\* branch `plans-screen` by Selim.*local only, not pushed.*git diff <integration branch>\.\.\.plans-screen/s);
  assert.match(packet, /written on a local branch or in a working tree/);
});

test("matchBranches is pure: no facts → []; a local and its origin copy are one piece of work", () => {
  assert.deepEqual(matchBranches(null, { paths: ["a.ts"] }), []);
  const L = { branches: [
    { name: "feat", date: "2026-10-01", ahead: 2, filesDiffer: 1, paths: ["a.ts"], subjects: [], author: "x" },
    { name: "origin/feat", date: "2026-10-01", ahead: 2, filesDiffer: 1, paths: ["a.ts"], subjects: [], author: "x" },
  ], prs: new Map() };
  const m = matchBranches(L, { paths: ["a.ts"] });
  assert.equal(m.length, 1);
  assert.equal(m[0].state, "pushed");
});

test("loadLocalWork reads facts' branch list and PR heads", () => {
  const { pm } = product({ withPr: true });
  const L = loadLocalWork(pm);
  assert.ok(L.branches.some(b => b.name === "plans-screen" && Array.isArray(b.paths) && b.paths.includes("apps/web/pricing.tsx")), "facts keeps every path, not only the first 60");
  assert.equal(L.prs.get("gazette-tab").n, 12);
  assert.equal(loadLocalWork(path.join(pm, "nowhere")), null);
});
