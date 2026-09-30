// Contract tests for skill/tools/diff.mjs: calling `save` twice in a row with the same content says "no change" and
// doesn't open a new folder; between two snapshots a resolved psst item gets type:"resolved", a new one type:"fresh";
// without --all, low-severity ones drop into the hidden count; --clean 1 deletes the oldest. Fake product "Cargo".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, pm;

before(async () => {
  K = await fakeProductSetup();
  pm = temporary("nosy-diff-pm-");
  fs.cpSync(K.pm, pm, { recursive: true });
});
after(() => { clean(K.root); clean(pm); });

function lowHangingWrite(items) {
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ type: "lowHanging", generated: new Date().toISOString(), items }, null, 1));
}

test("save twice in a row with the same content: the second says 'no change', doesn't open a new folder", () => {
  lowHangingWrite([{ title: "§21 sevkiyat toplu iptal endpoint'i", type: "Backend ready, not on screen", evidence: "BACKEND-NEEDS.md §1", score: 2.5, effort: "S" }]);
  const r1 = run(path.join(Tool, "diff.mjs"), [pm, "save"]);
  assert.equal(r1.code, 0, `1st save failed: ${r1.error}`);
  const historyDirectory = path.join(pm, "history");
  const sayFolder = () => fs.readdirSync(historyDirectory, { withFileTypes: true }).filter(d => d.isDirectory()).length;
  const n1 = sayFolder();
  assert.equal(n1, 1, "the first save should open 1 folder");

  const r2 = run(path.join(Tool, "diff.mjs"), [pm, "save"]);
  assert.equal(r2.code, 0);
  assert.match(r2.output, /no change/, `the second save should have said 'no change': ${r2.output}`);
  assert.equal(sayFolder(), n1, "a second save with the same content should not open a new folder");
});

test("resolved and fresh psst items; without --all low-severity ones drop into the hidden count; --clean 1 deletes the oldest", async () => {
  // A fresh pm: independent of the previous test, starting with a clean history/.
  const pm2 = temporary("nosy-diff-pm2-");
  fs.cpSync(K.pm, pm2, { recursive: true });

  lowHangingWrite2(pm2, [
    { title: "§21 sevkiyat toplu iptal endpoint'i", type: "Backend ready, not on screen", evidence: "BACKEND-NEEDS.md §1", score: 2.5, effort: "S" },
    { title: "§3 Bulk export", type: "Served, no screen", evidence: "BACKEND-NEEDS.md §3", score: 1.2, effort: "S" },
  ]);
  const rk1 = run(path.join(Tool, "diff.mjs"), [pm2, "save"]);
  assert.equal(rk1.code, 0, `1st save: ${rk1.error}`);

  // §21 got resolved (removed), §3 stayed, §22 is new (high score, 3.0 so its "high" severity doesn't get dropped).
  lowHangingWrite2(pm2, [
    { title: "§3 Bulk export", type: "Served, no screen", evidence: "BACKEND-NEEDS.md §3", score: 1.2, effort: "S" },
    { title: "§22 rota raporu export'u", type: "Backend ready, not on screen", evidence: "K30 m.2", score: 3.0, effort: "S" },
  ]);
  const rk2 = run(path.join(Tool, "diff.mjs"), [pm2, "save"]);
  assert.equal(rk2.code, 0, `2nd save: ${rk2.error}`);

  const jsonPath = path.join(pm2, "diff.json");
  const rf = run(path.join(Tool, "diff.mjs"), [pm2, "--json", jsonPath]);
  assert.equal(rf.code, 0, `diff read: ${rf.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "diff");
  const resolved = j.changes.find(d => d.area === "psst" && d.type === "resolved" && /§21/.test(d.title));
  assert.ok(resolved, `§21 should have shown up as resolved: ${JSON.stringify(j.changes)}`);
  const fresh = j.changes.find(d => d.area === "psst" && d.type === "fresh" && /§22/.test(d.title));
  assert.ok(fresh, "§22 should have shown up as fresh");

  // Without --all: low-severity changes drop out of what's shown, and get added to the "hidden" count.
  const jsonPathAll = path.join(pm2, "diff-all.json");
  const rh = run(path.join(Tool, "diff.mjs"), [pm2, "--all", "--json", jsonPathAll]);
  assert.equal(rh.code, 0);
  const jh = JSON.parse(fs.readFileSync(jsonPathAll, "utf8"));
  assert.ok(jh.changes.length >= j.changes.length, "--all should show at least as many changes as without --all");
  if (jh.changes.length > j.changes.length) assert.ok(j.hiddenOnes > 0, "hidden count should have been > 0");

  // --clean 1: deletes the oldest record, keeps the newest.
  const historyDirectory = path.join(pm2, "history");
  const foldersBefore = fs.readdirSync(historyDirectory, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  assert.equal(foldersBefore.length, 2, "there should be 2 records at this point");
  const rt = run(path.join(Tool, "diff.mjs"), [pm2, "save", "--clean", "1"]);
  assert.equal(rt.code, 0, `--clean: ${rt.error}`);
  const foldersAfter = fs.readdirSync(historyDirectory, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  assert.equal(foldersAfter.length, 1, "only 1 record should remain after clean 1");
  assert.equal(foldersAfter[0], foldersBefore.at(-1), "the remaining record should be the newest");

  clean(pm2);
});

function lowHangingWrite2(pmDir, items) {
  fs.mkdirSync(path.join(pmDir, "state"), { recursive: true });
  fs.writeFileSync(path.join(pmDir, "state", "lowhanging.json"), JSON.stringify({ type: "lowHanging", generated: new Date().toISOString(), items }, null, 1));
}

test("a genuine first run (one snapshot, nothing before it) says 'first run: baseline saved', not a wall of 'fresh' changes", () => {
  const pm3 = temporary("nosy-diff-pm3-");
  fs.cpSync(K.pm, pm3, { recursive: true });
  lowHangingWrite2(pm3, [
    { title: "§21 sevkiyat toplu iptal endpoint'i", type: "Backend ready, not on screen", evidence: "BACKEND-NEEDS.md §1", score: 2.5, effort: "S" },
    { title: "§3 Bulk export", type: "Served, no screen", evidence: "BACKEND-NEEDS.md §3", score: 1.2, effort: "S" },
  ]);
  const rSave = run(path.join(Tool, "diff.mjs"), [pm3, "save"]);
  assert.equal(rSave.code, 0, `save: ${rSave.error}`);

  const jsonPath = path.join(pm3, "diff-first.json");
  const rDiff = run(path.join(Tool, "diff.mjs"), [pm3, "--json", jsonPath]);
  assert.equal(rDiff.code, 0, `diff: ${rDiff.error}`);
  assert.match(rDiff.output, /first run: baseline saved, \d+ references? recorded; changes start next run\./, `unexpected first-run output: ${rDiff.output}`);
  assert.doesNotMatch(rDiff.output, /first time (a )?(commit was seen|seen)/i, "shouldn't flag individual references as 'fresh' on a genuine first run");

  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.firstRun, true);
  assert.ok(j.baselineCount > 0, "baselineCount should count what got recorded");
  assert.deepEqual(j.changes, []);
  assert.deepEqual(j.top, []);

  clean(pm3);
});

test("markdown caps to the top N by priority (default 5, --top overrides); --all still shows everything; JSON gets a 'top' array alongside the full 'changes'", () => {
  const pm4 = temporary("nosy-diff-pm4-");
  fs.cpSync(K.pm, pm4, { recursive: true });

  // 8 psst items, high score (well above freshHigh=2.2) so every "fresh" one lands at "high" severity and
  // none get dropped by the default (non---all) severity filter - only --top should be trimming them.
  const first = Array.from({ length: 8 }, (_, i) => ({ title: `§${100 + i} item ${i}`, type: "Backend ready, not on screen", evidence: `E${i}`, score: 5, effort: "S" }));
  lowHangingWrite2(pm4, []);
  const r0 = run(path.join(Tool, "diff.mjs"), [pm4, "save"]);
  assert.equal(r0.code, 0, `0th save: ${r0.error}`);
  lowHangingWrite2(pm4, first);
  const r1 = run(path.join(Tool, "diff.mjs"), [pm4, "save"]);
  assert.equal(r1.code, 0, `1st save: ${r1.error}`);

  // Default (--top defaults to 5): markdown shows 5, notes "+3 more (use --all)".
  const rDefault = run(path.join(Tool, "diff.mjs"), [pm4]);
  assert.equal(rDefault.code, 0, `default diff: ${rDefault.error}`);
  const shownDefault = (rDefault.output.match(/^\d+\.\s+\*\*\[/gm) || []).length;
  assert.equal(shownDefault, 5, `expected 5 numbered items by default: ${rDefault.output}`);
  assert.match(rDefault.output, /\+3 more \(use `--all`\)\./, `expected a '+3 more' note: ${rDefault.output}`);

  // --top 3: markdown shows 3, "+5 more".
  const rTop3 = run(path.join(Tool, "diff.mjs"), [pm4, "--top", "3"]);
  assert.equal(rTop3.code, 0, `--top 3: ${rTop3.error}`);
  const shownTop3 = (rTop3.output.match(/^\d+\.\s+\*\*\[/gm) || []).length;
  assert.equal(shownTop3, 3, `expected 3 numbered items with --top 3: ${rTop3.output}`);
  assert.match(rTop3.output, /\+5 more \(use `--all`\)\./, `expected a '+5 more' note: ${rTop3.output}`);

  // --all: shows everything, no "+K more" note.
  const rAll = run(path.join(Tool, "diff.mjs"), [pm4, "--all"]);
  assert.equal(rAll.code, 0, `--all: ${rAll.error}`);
  const shownAll = (rAll.output.match(/^\d+\.\s+\*\*\[/gm) || []).length;
  assert.equal(shownAll, 8, `expected all 8 items with --all: ${rAll.output}`);
  assert.doesNotMatch(rAll.output, /more \(use `--all`\)/, "--all shouldn't itself say '+K more'");

  // JSON: "changes" keeps everything (8), "top" is the top-5 slice, independent of --top not being passed.
  const jsonPath = path.join(pm4, "diff-top.json");
  const rJson = run(path.join(Tool, "diff.mjs"), [pm4, "--json", jsonPath]);
  assert.equal(rJson.code, 0, `--json: ${rJson.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.changes.length, 8, `expected 'changes' to keep everything: ${JSON.stringify(j.changes)}`);
  assert.equal(j.top.length, 5, `expected 'top' to be the top-5 slice: ${JSON.stringify(j.top)}`);

  clean(pm4);
});
