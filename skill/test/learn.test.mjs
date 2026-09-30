// Contract tests for skill/tools/learn.mjs: mute+apply drops an item, knowingly moves it to items_knowingly,
// important pins it to the front, an expired rule isn't applied, apply doesn't modify its input file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let pm;
before(() => { pm = temporary("nosy-learn-"); });
after(() => clean(pm));

function inputWrite(file, items) {
  fs.writeFileSync(file, JSON.stringify({ type: "lowHanging", items }, null, 1));
}

test("mute + apply: a matching item is removed (drops out of what remains); apply doesn't modify its input file", () => {
  const r1 = run(path.join(Tool, "learn.mjs"), [pm, "mute", "§99", "--reason", "test: noise"]);
  assert.equal(r1.code, 0, `mute failed: ${r1.error}`);

  const inputPath = path.join(pm, "input.json");
  inputWrite(inputPath, [
    { title: "§99 noisy item", type: "Backend ready, not on screen", score: 1 },
    { title: "§10 real item", type: "Backend ready, not on screen", score: 2 },
  ]);
  const inputBefore = fs.readFileSync(inputPath, "utf8");

  const outputPath = path.join(pm, "output.json");
  const r2 = run(path.join(Tool, "learn.mjs"), [pm, "apply", inputPath, "--output", outputPath]);
  assert.equal(r2.code, 0, `apply failed: ${r2.error}`);
  const c = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(c.items.length, 1, "§99 should have been removed by the mute rule");
  assert.equal(c.items[0].title, "§10 real item");
  assert.equal(c.learn.muted, 1);

  assert.equal(fs.readFileSync(inputPath, "utf8"), inputBefore, "apply must NOT modify its input file");
});

test("knowingly: item moves to items_knowingly; important: item is pinned to the front", () => {
  const r1 = run(path.join(Tool, "learn.mjs"), [pm, "knowingly", "§23", "--reason", "test: left knowingly"]);
  assert.equal(r1.code, 0, `knowingly failed: ${r1.error}`);
  const r2 = run(path.join(Tool, "learn.mjs"), [pm, "important", "§10", "--reason", "test: always keep on top"]);
  assert.equal(r2.code, 0, `important failed: ${r2.error}`);

  const inputPath = path.join(pm, "input2.json");
  inputWrite(inputPath, [
    { title: "§1 ordinary item", type: "Backend ready, not on screen", score: 5 },
    { title: "§23 deliberately left", type: "Backend ready, not on screen", score: 3 },
    { title: "§10 important item", type: "Backend ready, not on screen", score: 1 },
  ]);
  const outputPath = path.join(pm, "output2.json");
  const r3 = run(path.join(Tool, "learn.mjs"), [pm, "apply", inputPath, "--output", outputPath]);
  assert.equal(r3.code, 0, `apply failed: ${r3.error}`);
  const c = JSON.parse(fs.readFileSync(outputPath, "utf8"));

  assert.ok(!c.items.some(m => m.title.includes("§23")), "§23 should not be among the remaining items (moved to knowingly)");
  assert.ok(c.items_knowingly.some(m => m.title.includes("§23")), "§23 should be in items_knowingly");
  assert.equal(c.items[0].title, "§10 important item", "the item flagged important should be pinned to the front (even with a low score)");
  assert.equal(c.learn.knowingly, 1);
  assert.equal(c.learn.important, 1);
});

test("an expired rule is not applied", () => {
  // Write a mute rule with a past end date directly to learned.json (hard to produce that with --duration today;
  // hand-writing the file is the path the README recommends).
  const learnedPath = path.join(pm, "learned.json");
  const existing = JSON.parse(fs.readFileSync(learnedPath, "utf8"));
  existing.rules.push({ id: "mute-expired", tip: "mute", key: "§77 expired", type: "all", reason: "test", who: null, date: "2020-01-01", end: "2020-02-01", match: 0, last_match: null });
  fs.writeFileSync(learnedPath, JSON.stringify(existing, null, 1));

  const inputPath = path.join(pm, "input3.json");
  inputWrite(inputPath, [{ title: "§77 expired rule here", type: "Backend ready, not on screen", score: 1 }]);
  const outputPath = path.join(pm, "output3.json");
  const r = run(path.join(Tool, "learn.mjs"), [pm, "apply", inputPath, "--output", outputPath]);
  assert.equal(r.code, 0, `apply failed: ${r.error}`);
  const c = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.ok(c.items.some(m => m.title.includes("§77")), "an expired rule should no longer apply, the item should remain");
  assert.equal(c.learn.muted, 0);
});

test("reject: --context is required, records a key+context-based entry", () => {
  const r0 = run(path.join(Tool, "learn.mjs"), [pm, "reject", "#71"]);
  assert.equal(r0.code, 1, "reject without --context should error");

  const r1 = run(path.join(Tool, "learn.mjs"), [pm, "reject", "#71", "--context", "client portal", "--type", "size", "--reason", "test: unrelated"]);
  assert.equal(r1.code, 0, `reject failed: ${r1.error}`);
  assert.match(r1.output, /tip.*reject|· reject/i);

  const { rules } = JSON.parse(fs.readFileSync(path.join(pm, "learned.json"), "utf8"));
  const k = rules.find(k => k.tip === "reject" && k.key === "#71");
  assert.ok(k, "the reject rule wasn't written to learned.json");
  assert.equal(k.context, "client portal");
  assert.equal(k.type, "size");

  // The same key under a different context should open a SEPARATE rule (the id derives from key+context).
  const r2 = run(path.join(Tool, "learn.mjs"), [pm, "reject", "#71", "--context", "a different topic", "--type", "canwe", "--reason", "test: different context"]);
  assert.equal(r2.code, 0);
  const afterValue = JSON.parse(fs.readFileSync(path.join(pm, "learned.json"), "utf8")).rules.filter(k => k.tip === "reject" && k.key === "#71");
  assert.equal(afterValue.length, 2, "the same key under a different context should open a separate rule, not overwrite");
});
