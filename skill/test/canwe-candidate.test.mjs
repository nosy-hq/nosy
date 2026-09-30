// Contract test for tools/canwe.mjs (internal request 72, kill criterion 1: a manual check found word/title
// similarity only 9% correct as a "shipped" signal — pm/log.md, "kill criterion 1, second run"). canwe's
// suggested verdict used to state "Already exists" / "backend ready" straight from the request doc's
// best WORD-MATCHED section (gather-evidence.mjs's top()), even though that section was picked by text
// overlap, not an explicit reference (a §ref, K-number, or #issue). A title-similar-but-unlinked item must
// now surface as "Candidate — confirm", not as a settled shipped/exists/backend-ready claim.
// Fake product "Cargo"; canwe.mjs is told there's no backend (inventory.backend_missing) so the request
// doc's text-matched section is the only signal driving the verdict.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, tmp;
before(async () => { K = await fakeProductSetup(); tmp = temporary("nosy-canwe-candidate-"); });
after(() => { clean(K.root); clean(tmp); });

function noBackendInventoryWrite(pm) {
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "inventory.json"), JSON.stringify({ backend_missing: true, endpoints: [] }, null, 1));
}

test("a request-doc section matched only by word overlap (status \"exists\", no ref) is a candidate, not a settled verdict", () => {
  const copyPm = path.join(tmp, "pm-word-match");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  noBackendInventoryWrite(copyPm);
  // BACKEND-NEEDS.md §1 "Shipment list" has Status: exists — nothing here is an explicit reference to the
  // question, only shared words ("shipment", "list").
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "shipment list"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  assert.match(r.output, /\*\*Candidate — confirm:/, "a text-matched \"exists\"/\"backend ready\" reading must be labeled a candidate");
  assert.match(r.output, /word overlap — not an explicit reference/);
  assert.doesNotMatch(r.output, /\*\*Already exists\*\*/, "must not be reported as a settled \"Already exists\"");
  assert.doesNotMatch(r.output, /\*\*We can: backend ready, no screen\*\*/, "must not be reported as settled \"backend ready\" either");
});

test("a request-doc section with status \"missing\" still states absence plainly (no existence claim to soften)", () => {
  const copyPm = path.join(tmp, "pm-missing");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  noBackendInventoryWrite(copyPm);
  // BACKEND-NEEDS.md §5 "Invoice PDF archive" has Status: missing, with no decision on the same topic
  // (route optimization's §9 also has Status: missing, but K11 explicitly decides not to do it — since
  // internal request 80 fixed canwe's Decisions-section parsing to actually see that decision, "route
  // optimization" now correctly answers "There's a decision: not doing this" instead; that's covered
  // separately below, this test isolates the plain-"missing" case on its own).
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "invoice pdf archive"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  assert.match(r.output, /\*\*Not now: no trace in the backend\*\*/);
});

test("a decision heading at the same level as gather-evidence's own section titles ('## K11') no longer hides the decision — 'route optimization' now answers with the actual not-doing decision", () => {
  const copyPm = path.join(tmp, "pm-decision-heading");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  noBackendInventoryWrite(copyPm);
  // K11 (DECISIONS.md): "We're not doing route optimization for now; manual assignment is enough." — its
  // own heading is "## K11 ...", the same Markdown level as gather-evidence.mjs's "## Decisions" section
  // title; canwe.mjs's section splitter used to cut the Decisions section open on that heading and always
  // read it back as empty, silently dropping this decision from view.
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "route optimization"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  assert.match(r.output, /\*\*Decisions\*\*\n\n## K11/, "the Decisions section must carry the actual K11 text, not be empty");
  assert.match(r.output, /\*\*There's a decision: not doing this\*\*/);
  assert.match(r.output, /Deliberately not built \(decision K11\)/, "the deliberate-not-built size line (internal request 80) should cite K11");
});

test("a real structural signal (inventory: endpoint used on screen) still earns a plain \"Already exists\"", () => {
  const copyPm = path.join(tmp, "pm-structural");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  fs.mkdirSync(path.join(copyPm, "state"), { recursive: true });
  // No request-doc text match for this made-up phrase, but a real endpoint used on screen (route <-> screen
  // link from the inventory) — this is the structural case internal request 72 says must stay plain.
  fs.writeFileSync(path.join(copyPm, "state", "inventory.json"), JSON.stringify({
    backend_missing: false,
    endpoints: [{ method: "GET", path: "/api/pallet-tracking", file: "backend/palletTracking.js", line: 3, used: true, infrastructure: false, usage: "frontend/PalletTracking.jsx:9" }],
  }, null, 1));
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "pallet tracking"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  assert.match(r.output, /\*\*Already exists\*\*/);
  assert.match(r.output, /All 1 matching endpoints/);
});
