// Contract test for tools/canwe.mjs: an endpoint rejected with learn.mjs ret
// --type canwe drops out of the "Ready in the backend" section on the next canwe call in the same context.
// Fake product "Cargo"; canwe.mjs reads a hand-written pm/state/inventory.json here instead of computing its
// own inventory (inventory.mjs's actual repo scan isn't this test's subject).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, tmp;
before(async () => { K = await fakeProductSetup(); tmp = temporary("nosy-canwe-"); });
after(() => { clean(K.root); clean(tmp); });

// Isolates the "Ready in the backend" section: the same endpoint path also shows up in the "Request doc"
// section (BACKEND-NEEDS.md §3's Endpoint line), so the search must stay scoped to this section, not the whole output.
function backendSectionOf(output) {
  const m = output.match(/## Ready in the backend\n\n([\s\S]*?)\n\n## /);
  return m ? m[1] : "";
}

function inventoryWrite(pm) {
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "inventory.json"), JSON.stringify({
    backend_missing: false,
    endpoints: [{ method: "POST", path: "/api/shipments/export", file: "backend/shipments.js", line: 10, used: false, infrastructure: false, usage: null }],
  }, null, 1));
}

test("without a ret: the matching endpoint from the inventory shows up in 'Ready in the backend'", () => {
  const copyPm = path.join(tmp, "pm-before");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  inventoryWrite(copyPm);
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "bulk export", "export"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  assert.match(backendSectionOf(r.output), /\/api\/shipments\/export/);
});

test("learn.mjs ret --type canwe: the matching endpoint no longer shows up in the same context", () => {
  const copyPm = path.join(tmp, "pm-after");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  inventoryWrite(copyPm);

  const rReject = run(path.join(Tool, "learn.mjs"), [copyPm, "reject", "export", "--context", "bulk export", "--type", "canwe", "--reason", "test: unrelated"]);
  assert.equal(rReject.code, 0, `ret failed: ${rReject.error}`);

  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "bulk export", "export"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  assert.ok(!/\/api\/shipments\/export/.test(backendSectionOf(r.output)), "the rejected endpoint should no longer appear");
  assert.match(backendSectionOf(r.output), /no endpoint/i, "with no other matching endpoint, it should say so");
});

test("the same key still matches in a different context (ret is context-specific)", () => {
  const copyPm = path.join(tmp, "pm-another-context");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  inventoryWrite(copyPm);

  const rReject = run(path.join(Tool, "learn.mjs"), [copyPm, "reject", "export", "--context", "barcode report", "--type", "canwe", "--reason", "test: unrelated topic"]);
  assert.equal(rReject.code, 0);

  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "bulk export", "export"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  assert.match(backendSectionOf(r.output), /\/api\/shipments\/export/, "a ret in a different context shouldn't affect this topic");
});
