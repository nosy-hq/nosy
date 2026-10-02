// Contract tests for tools/measure-size.mjs: for a single topic, JSON type:"size", estimate.size is one of
// K/O/B/?, a similar[] array, coverage 0-1; the topic's own ref (K12) is excluded from similar, shown in the
// "own" field instead. With --bulk, produces type:"size-bulk" from lowhanging.json with the same item count.
// Fake product "Cargo" (K12 has 3 sub-items).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, gh, tmp;

before(async () => { K = await fakeProductSetup(); gh = fakeGhSetup(K.gh); tmp = temporary("nosy-measuresize-"); });
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

test("single topic: JSON type:size, estimate.size is one of K/O/B/?, a similar array and coverage 0-1", () => {
  const jsonPath = path.join(tmp, "size-K12.json");
  const r = run(path.join(Tool, "measure-size.mjs"), [K.pm, "K12 file-move backend", "--day", "60", "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "size");
  assert.ok(["S", "M", "L", "?"].includes(j.estimate.size), `unexpected size: ${j.estimate.size}`);
  assert.ok(Array.isArray(j.similar));
  if (j.estimate.coverage != null) assert.ok(j.estimate.coverage >= 0 && j.estimate.coverage <= 1);

  // The topic's own ref (K12) shouldn't enter the similar-work list as its own group; it should show up in the "own" field.
  assert.ok(!j.similar.some(b => b.ref === "K12"), "K12 is its own ref, shouldn't appear in the 'similar' list");
  assert.ok(j.own, "the 'own' field (K12's history) shouldn't be empty");
  assert.equal(j.own.ref, "K12");
});

test("--bulk with lowhanging.json gives type:size-bulk, item count matches lowhanging's items", () => {
  const lowPath = path.join(tmp, "lowhanging.json");
  const rLow = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", lowPath], { env: gh.env });
  assert.equal(rLow.code, 0, `lowhanging failed: ${rLow.error}`);
  const low = JSON.parse(fs.readFileSync(lowPath, "utf8"));
  assert.ok(low.items.length > 0, "lowhanging produced no items, the bulk test would be meaningless");

  const jsonPath = path.join(tmp, "size-bulk.json");
  const r = run(path.join(Tool, "measure-size.mjs"), [K.pm, "--bulk", lowPath, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "size-bulk");
  assert.equal(j.items.length, low.items.length, "the bulk item count should match lowhanging's item count");
});

test("a candidate rejected with learn.mjs ret --type size drops out of similar on the next measure-size call in the SAME context", () => {
  const copyPm = path.join(tmp, "pm-reject");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  const topic = "K30 m.2 shipment bulk export";

  const previousPath = path.join(tmp, "size-before.json");
  const rBefore = run(path.join(Tool, "measure-size.mjs"), [copyPm, topic, "--day", "60", "--json", previousPath]);
  assert.equal(rBefore.code, 0, `stderr: ${rBefore.error}`);
  const beforeValue = JSON.parse(fs.readFileSync(previousPath, "utf8"));
  assert.ok(beforeValue.similar.length > 0, "precondition: at least one similar item should be found");
  const goalRef = beforeValue.similar[0].ref;

  const rReject = run(path.join(Tool, "learn.mjs"), [copyPm, "reject", goalRef, "--context", topic, "--type", "size", "--reason", "test: unrelated"]);
  assert.equal(rReject.code, 0, `ret failed: ${rReject.error}`);

  const afterPath = path.join(tmp, "size-after.json");
  const rAfter = run(path.join(Tool, "measure-size.mjs"), [copyPm, topic, "--day", "60", "--json", afterPath]);
  assert.equal(rAfter.code, 0, `stderr: ${rAfter.error}`);
  const afterValue = JSON.parse(fs.readFileSync(afterPath, "utf8"));

  assert.ok(!afterValue.similar.some(b => b.ref === goalRef), `${goalRef} shouldn't remain in the similar list after the ret`);
  assert.match(afterValue.estimate.justification, /removed by the owner's\/agent's rejection/);

  // In a different context, the same ref should still be able to count as similar (ret is context-specific, not a general blocklist).
  const anotherTopic = "K12 m.1 shipment list API";
  const anotherPath = path.join(tmp, "size-different-context.json");
  const rAnother = run(path.join(Tool, "measure-size.mjs"), [copyPm, anotherTopic, "--day", "60", "--json", anotherPath]);
  assert.equal(rAnother.code, 0, `stderr: ${rAnother.error}`);
});

// measure-size ran 4+ minutes on Twenty with no progress output, then got killed.
// Fix: stream the main `git log --numstat` pass (progress to stderr, throttled) instead of blocking on it,
// and persist the "suggested owner" git-shortlog results per (ref sha, directory set) so a second --bulk
// run against the same commit costs zero extra git calls. Both are checked here: a run produces the cache
// file, and re-running against the SAME lowhanging.json/commit gives byte-identical estimates/owners.
test("--bulk persists an ownership cache keyed by commit sha, and a second run gives identical output", () => {
  const lowPath = path.join(tmp, "lowhanging-120.json");
  const rLow = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", lowPath], { env: gh.env });
  assert.equal(rLow.code, 0, `lowhanging failed: ${rLow.error}`);

  const cacheFile = path.join(K.pm, "state", ".measure-size-ownership-cache.json");
  fs.rmSync(cacheFile, { force: true });

  const firstPath = path.join(tmp, "size-bulk-120-first.json");
  const rFirst = run(path.join(Tool, "measure-size.mjs"), [K.pm, "--bulk", lowPath, "--json", firstPath]);
  assert.equal(rFirst.code, 0, `stderr: ${rFirst.error}`);
  assert.ok(fs.existsSync(cacheFile), "expected a persisted ownership cache file after a --bulk run");
  const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  assert.ok(cache.sha && typeof cache.rows === "object", "the cache file should carry the ref's commit sha and cached rows");

  const secondPath = path.join(tmp, "size-bulk-120-second.json");
  const rSecond = run(path.join(Tool, "measure-size.mjs"), [K.pm, "--bulk", lowPath, "--json", secondPath]);
  assert.equal(rSecond.code, 0, `stderr: ${rSecond.error}`);

  const first = JSON.parse(fs.readFileSync(firstPath, "utf8")); first.generated = null;
  const second = JSON.parse(fs.readFileSync(secondPath, "utf8")); second.generated = null;
  assert.deepEqual(first, second, "a second --bulk run against the same commit should give byte-identical items");

  fs.rmSync(cacheFile, { force: true });
});

// on a partial (blobless) clone `git log --numstat` made git fetch every changed file's contents one by one (a real run wrote
// about 296 packs, 23 MiB, and hung). A partial clone is now read name-only with git's lazy fetching switched off; --force-fetch is the old way.
// The clones are real, made from a local repo over file:// (as facts.test.mjs and inventory.test.mjs do), and the object store is counted before and after.
import { execFileSync } from "node:child_process";
const sh = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } });
const objectIds = dir => new Set(sh(dir, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)").split("\n").filter(Boolean));
const packs = dir => fs.readdirSync(path.join(dir, ".git", "objects", "pack")).filter(f => f.endsWith(".pack")).length;
const lower = c => (c === "high" ? "medium" : "low");

// Six units of work (#11-#16) about "export report", in one area, on six days: a full clone calls that a high-confidence estimate.
function sizeRepo(root) {
  const g = (who, when, ...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: `${who}@x.test`, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: `${who}@x.test`, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  const ago = d => new Date(Date.now() - d * 864e5).toISOString();
  g("alice", ago(30), "init", "-q", "-b", "main");
  g("alice", ago(30), "config", "gc.auto", "0"); g("alice", ago(30), "config", "maintenance.auto", "false"); g("alice", ago(30), "config", "uploadpack.allowFilter", "true");
  const commit = (who, d, msg, files) => { for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); } g(who, ago(d), "add", "-A"); g(who, ago(d), "commit", "-q", "-m", msg); };
  commit("alice", 30, "init", { "README.md": "# x\n" });
  for (let i = 1; i <= 6; i++) {
    commit(i % 2 ? "alice" : "bob", 25 - i * 3, `feat: export report csv (#1${i})`, { [`apps/web/export/e${i}.ts`]: `export const e${i} = ${i};\nexport const more${i} = [${i}, ${i}];\nexport const last${i} = "x";\n`, "apps/web/export/index.ts": `export * from "./e${i}";\n`.repeat(i) });
    if (i % 3 === 0) commit("bob", 24 - i * 3, `fix: export report header (#1${i})`, { [`apps/web/export/e${i}.ts`]: `export const e${i} = ${i * 10};\n` });
  }
  return root;
}
const cloneOf = (origin, filter, into) => { execFileSync("git", ["clone", "-q", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "--no-local", `--filter=${filter}`, "--no-checkout", `file://${origin}`, into]); return into; };
function sizeRun(repo, ref, extra = [], dirs) {
  const pm = path.join(dirs, `pm-${Math.random().toString(36).slice(2, 8)}`); fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref }));
  const out = path.join(pm, "size.json"), r = run(path.join(Tool, "measure-size.mjs"), [pm, "export report", "--day", "90", "--json", out, ...extra]);
  return { ...r, json: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null };
}

test("a blobless clone is read name-only without fetching anything: files, active days and owners match the full clone, lines are n/a, confidence one level lower", () => {
  const root = temporary("nosy-size-origin-"), dir = temporary("nosy-size-clones-");
  try {
    sizeRepo(root);
    const full = sizeRun(root, "main", [], dir);
    assert.equal(full.code, 0, full.error); assert.equal(full.json.lines_counted, true); assert.equal(full.json.partial_clone, false);
    assert.doesNotMatch(full.output + full.error, /lines not counted|partial clone/, "a full clone says nothing new");
    assert.ok(full.json.similar.length >= 5, "the fixture finds the six units of work");
    assert.ok(full.json.similar.every(b => typeof b.add === "number" && b.add > 0));
    assert.notEqual(full.json.estimate.confidence, "low", "precondition: a full clone has confidence to lower");

    const clone = cloneOf(root, "blob:none", path.join(dir, "blobless"));
    const [ids0, packs0] = [objectIds(clone), packs(clone)];
    const part = sizeRun(clone, "origin/main", [], dir);
    assert.equal(part.code, 0, part.error);
    assert.deepEqual([...objectIds(clone)].filter(id => !ids0.has(id)), [], "no object written into the clone");
    assert.equal(packs(clone), packs0, "no pack fetched");
    assert.match(part.error, /partial clone: line counts are skipped/);
    assert.match(part.output, /Lines not counted \(partial clone; --force-fetch reads them, slowly\)/);
    const J = part.json;
    assert.deepEqual([J.lines_counted, J.partial_clone], [false, true]);
    assert.ok(J.similar.every(b => b.add === null && b.remove === null), "unknown lines are null, never 0");
    assert.match(part.output, /\| n\/a \|/);
    const by = j => Object.fromEntries(j.similar.map(b => [b.ref, [b.active_day, b.commit, b.file, b.first, b.last, b.who.join(), b.directorys.join()]]));
    assert.deepEqual(by(J), by(full.json), "files touched, active days, commits and directories match the full clone");
    assert.deepEqual(J.owner, full.json.owner, "ownership still works");
    assert.equal(J.estimate.size, full.json.estimate.size);
    assert.equal(J.estimate.confidence, lower(full.json.estimate.confidence), "confidence one level lower");
    assert.match(J.estimate.justification, /lines not counted \(partial clone; --force-fetch reads them, slowly\)/);

    // Control: --force-fetch restores the old behaviour, and on this clone that really does fetch, so the checks above would have caught it.
    const forced = sizeRun(clone, "origin/main", ["--force-fetch"], dir);
    assert.equal(forced.code, 0, forced.error);
    assert.equal(forced.json.lines_counted, true); assert.equal(forced.json.partial_clone, false);
    assert.deepEqual(forced.json.similar.map(b => [b.ref, b.add, b.remove]), full.json.similar.map(b => [b.ref, b.add, b.remove]), "the line counts are the full clone's");
    assert.equal(forced.json.estimate.confidence, full.json.estimate.confidence);
    assert.ok([...objectIds(clone)].some(id => !ids0.has(id)), "--force-fetch is the one that fetches blobs");
    assert.doesNotMatch(forced.error, /line counts are skipped/);
  } finally { clean(root); clean(dir); }
});

test("a treeless clone has no trees to list either: commits and active days only, nothing fetched, still no crash", () => {
  const root = temporary("nosy-size-origin-"), dir = temporary("nosy-size-clones-");
  try {
    sizeRepo(root);
    const clone = cloneOf(root, "tree:0", path.join(dir, "treeless"));
    const [ids0, packs0] = [objectIds(clone), packs(clone)];
    const r = sizeRun(clone, "origin/main", [], dir);
    assert.equal(r.code, 0, r.error);
    assert.deepEqual([...objectIds(clone)].filter(id => !ids0.has(id)), [], "no object written into the clone");
    assert.equal(packs(clone), packs0);
    assert.match(r.error, /treeless clone: commits and active days only/);
    assert.equal(r.json.lines_counted, false);
    assert.ok(r.json.similar.length >= 5 && r.json.similar.every(b => b.active_day >= 1 && b.file === 0 && b.add === null), "units of work from the commit subjects, files unknown");
    assert.match(r.json.estimate.justification, /files not listed either/);
  } finally { clean(root); clean(dir); }
});

test("--bulk on a blobless clone also says lines weren't counted and fetches nothing", () => {
  const root = temporary("nosy-size-origin-"), dir = temporary("nosy-size-clones-");
  try {
    sizeRepo(root);
    const clone = cloneOf(root, "blob:none", path.join(dir, "blobless")), ids0 = objectIds(clone);
    const pm = path.join(dir, "pm"); fs.mkdirSync(pm); fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: clone, ref: "origin/main" }));
    const low = path.join(dir, "low.json"); fs.writeFileSync(low, JSON.stringify({ items: [{ title: "Export report as PDF" }, { title: "Export report scheduling" }] }));
    const out = path.join(dir, "bulk.json"), r = run(path.join(Tool, "measure-size.mjs"), [pm, "--bulk", low, "--json", out]);
    assert.equal(r.code, 0, r.error);
    assert.match(r.output, /Lines not counted \(partial clone; --force-fetch reads them, slowly\): sizes rest on files and active days/);
    const J = JSON.parse(fs.readFileSync(out, "utf8")); assert.deepEqual([J.type, J.lines_counted, J.items.length], ["size-bulk", false, 2]);
    assert.deepEqual([...objectIds(clone)].filter(id => !ids0.has(id)), []);
  } finally { clean(root); clean(dir); }
});

// Review of 2 Oct: on a full clone nothing changed. The default and `--force-fetch` (the old way) give the same report, line counts included.
// (Also checked once by hand against the previous version of the file, from `git show HEAD:`, on this repo: stdout and JSON the same but for the run time.)
test("a full clone: the default and --force-fetch give byte-identical output (but for the run time), with the line counts the old way gave", () => {
  const root = temporary("nosy-size-origin-"), dir = temporary("nosy-size-clones-");
  try {
    sizeRepo(root);
    const strip = o => o.replace(/_Duration: [\d.]+s\._/, "_Duration: Ns._");
    const a = sizeRun(root, "main", [], dir), b = sizeRun(root, "main", ["--force-fetch"], dir);
    assert.equal(a.code, 0, a.error); assert.equal(b.code, 0, b.error);
    assert.equal(strip(a.output), strip(b.output));
    for (const j of [a.json, b.json]) delete j.generated;
    assert.deepEqual(a.json, b.json);
    assert.equal(a.json.lines_counted, true); assert.equal(a.json.partial_clone, false);
    assert.ok(a.json.similar.every(s => s.add > 0), "real +/- counts, not n/a");
    assert.doesNotMatch(a.output, /n\/a|Lines not counted/);
    assert.doesNotMatch(a.error, /partial clone|line counts are skipped/);
  } finally { clean(root); clean(dir); }
});
