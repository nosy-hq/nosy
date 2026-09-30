// Contract tests for skill/tools/lowhanging.mjs: five signals + references that are in an open PR
// dropping down with " · in PR". Runs against the fake product "Cargo" + a fake `gh` (no network).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean as cleanValue, Tool } from "./helpers.mjs";

let K, gh, tmp, output;

before(async () => {
  K = await fakeProductSetup();
  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-low-hanging-");
  const jsonPath = path.join(tmp, "lowhanging.json");
  const r = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", jsonPath], { env: gh.env });
  assert.equal(r.code, 0, `lowhanging: unexpected exit code, stderr: ${r.error}`);
  output = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { cleanValue(K.root); cleanValue(gh.dir); cleanValue(tmp); });

const find = (titlePart) => output.json.items.find(m => m.title.includes(titlePart));

test("--json carries the expected keys", () => {
  assert.equal(output.json.type, "lowHanging");
  assert.ok(Array.isArray(output.json.items));
});

test("signal 1 - opportunity line comes through as 'Backend ready, not on screen'", () => {
  const m = find("§21");
  assert.ok(m, "§21 (clean opportunity) item not found");
  assert.equal(m.type, "Backend ready, not on screen");
});

test("signal 1 - a line marked knowingly (intentionally) never appears", () => {
  assert.ok(!find("§23"), "§23 was left intentionally, should not be in the list");
  assert.ok(!output.json.items.some(m => /bulk billing UI/.test(m.title) || /intentionally/i.test(JSON.stringify(m))),
    "the knowingly line's text must not appear in any item");
});

test("signal 2 - 'Served, no screen' (exists but no UI)", () => {
  const m = find("§3");
  assert.ok(m, "§3 bulk export item not found");
  assert.match(m.type, /^Served, no screen/);
});

test("signal 2 - not triggered if the UI is already built (§1)", () => {
  assert.ok(!output.json.items.some(m => m.title.includes("§1 ")), "§1 UI is already wired, should not appear");
});

test("signal 3 - 'Status may be stale' (dated + related commit in recent days)", () => {
  const m = find("§7");
  assert.ok(m, "§7 barcode report item not found");
  assert.equal(m.type, "Status may be stale");
  assert.match(m.title, /partial/);
});

test("signal 3 - not triggered when dated but no related commit (§5), or when undated (§9)", () => {
  assert.ok(!find("§5"), "§5: no related commit in recent days, should not appear");
  assert.ok(!find("§9"), "§9: has no date at all, should not appear");
});

test("signal 4 (bonus, with the OLD Acme Books-format matrix.json) - 'Matrix: backend ready' and 'Common among rivals'", () => {
  // Note: not searching by title — "Bulk export" appears as a substring both in this item and in signal 2's
  // "§3 Bulk export" item; we distinguish by the type field.
  const b = output.json.items.find(m => m.type === "Matrix: backend ready");
  assert.ok(b, "matrix 'b'-coded row (Matrix: backend ready) not found");
  assert.match(b.title, /Bulk export/);
  const s = output.json.items.find(m => m.type === "Common among rivals, partial for us");
  assert.ok(s, "'s'-coded row present in 3+ rivals not found");
  assert.match(s.title, /SLA report/);
  assert.ok(!output.json.items.some(m => /Route optimization/.test(m.title)),
    "a decision: notDoing row must never enter the list");
});

test("signal 5 - 'Issue opened against us' only picks up matches for its own pattern", () => {
  const m = find("#701");
  assert.ok(m, "#701 [cargo] issue not found");
  assert.equal(m.type, "Issue opened against us");
  assert.ok(!find("#702"), "#702 doesn't match the [cargo] pattern, should not appear");
});

test("a reference present in an open PR drops down with ' · in PR' and shows the PR number", () => {
  const m = find("§22");
  assert.ok(m, "§22 item not found");
  assert.equal(m.type, "Backend ready, not on screen · in PR");
  assert.match(m.title, /in #601/);
  // Compared to its sibling not in a PR (§21) for the same signal, its score should be lower (value is reduced).
  const clean = find("§21");
  assert.ok(m.score <= clean.score, "an item that's in PR should score at most as high as one that isn't");
});

test("item.ref written in JSON: signals 1/2/5 carry their own ref, and the ref inside the matrix note also comes out", () => {
  assert.equal(find("§21").ref, "§21", "signal 1 (dropped field) should carry its own ref");
  assert.equal(find("§3").ref, "§3", "signal 2 (request document) should carry its own ref");
  assert.equal(find("#701").ref, "#701", "signal 5 (issue opened against us) should carry its own ref");
  // The matrix row's note is "§3 backend ready, no screen" — the "Matrix: backend ready" item should carry this ref too.
  const b = output.json.items.find(m => m.type === "Matrix: backend ready");
  assert.equal(b.ref, "§3");
});

test("null when there's no ref (inventory/unmeasurable signals never leave it out, they write null explicitly)", () => {
  const s = output.json.items.find(m => m.type === "Common among rivals, partial for us");
  // The SLA report row's note has no ref pattern in it (see fake-product.mjs matrix.json) → should be null, not undefined.
  assert.ok(s, "SLA report item not found");
  assert.equal(s.ref, null);
  assert.ok("ref" in s, "the ref key must not be missing from the JSON (even when null)");
});
