// Contract test for tools/gather-evidence.mjs: the most relevant K-decision for the topic comes first
// (rarity-weighted ranking) - relevance order, not document order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, clean, Tool } from "./helpers.mjs";
import path from "node:path";

let K;
before(async () => { K = await fakeProductSetup(); });
after(() => clean(K.root));

// The "## Decisions" section itself has sub-headings like "## K12" INSIDE it (the blocks top(decisionB,4)
// merges); so we don't cut on the generic "## " but on the NEXT REAL section heading ("## Request doc") -
// otherwise it gets cut at the first K-block.
const decisionsSectionOfAl = output => output.split("## Decisions")[1]?.split("## Request doc")[0] || "";

test("a two-word topic surfaces the K-decision carrying both words first", () => {
  // In DECISIONS.md, K10 (mentions only "shipment") is written BEFORE K12 (mentions both "shipment" and
  // "moving"); the correct order should reflect relevance, not document order.
  const r = run(path.join(Tool, "gather-evidence.mjs"), [K.pm, "shipment move"]);
  assert.equal(r.code, 0, `gather-evidence: unexpected exit code: ${r.error}`);
  const decisionsSectionOf = decisionsSectionOfAl(r.output);
  const iK12 = decisionsSectionOf.indexOf("K12"), iK10 = decisionsSectionOf.indexOf("K10");
  assert.ok(iK12 >= 0, `K12 not found in the decisions section: ${decisionsSectionOf}`);
  assert.ok(iK10 >= 0, `K10 not found in the decisions section: ${decisionsSectionOf}`);
  assert.ok(iK12 < iK10, `K12 should come before K10 (more relevant); order: ${decisionsSectionOf.slice(0, 200)}`);
});

test("a single, rare word (barcode) surfaces only the decision containing it", () => {
  const r = run(path.join(Tool, "gather-evidence.mjs"), [K.pm, "barcode scanning"]);
  assert.equal(r.code, 0);
  const decisionsSectionOf = decisionsSectionOfAl(r.output);
  assert.match(decisionsSectionOf, /K40/);
  for (const missing of ["K10", "K11", "K20", "K30"]) assert.doesNotMatch(decisionsSectionOf, new RegExp(missing));
});

test("the request doc and rival sections also make it into the pack", () => {
  const r = run(path.join(Tool, "gather-evidence.mjs"), [K.pm, "barcode scanning"]);
  assert.match(r.output, /Barcode report/); // BACKEND-NEEDS.md §7
  assert.match(r.output, /sevkpro/i); // rival file
});

// kill criterion 1: the pack must say up front that its blocks are picked by
// word/title overlap, not an explicit reference, so a caller doesn't restate one as a confirmed shipped fact.
test("the pack states its blocks are word-matched candidates, not confirmed links", () => {
  const r = run(path.join(Tool, "gather-evidence.mjs"), [K.pm, "barcode scanning"]);
  assert.match(r.output, /Candidates — confirm/i);
  assert.match(r.output, /not an explicit reference/i);
});
