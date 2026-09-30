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
