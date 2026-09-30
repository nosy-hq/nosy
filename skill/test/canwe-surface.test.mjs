// Contract test for tools/canwe.mjs: a question can name one surface
// ("calendar") while the only matching evidence sits on a different one that just happens to share a word
// with the question (a "records table" area). canwe's output must restate the question as asked on its
// first line, and flag the surface mismatch instead of letting the answer quietly drift to a neighbor.
// Fake product "Cargo"; canwe.mjs reads a hand-written pm/state/inventory.json here (inventory.mjs's own
// repo scan isn't this test's subject) — `area` is set directly so it's independent of path wording.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, tmp;
before(async () => { K = await fakeProductSetup(); tmp = temporary("nosy-canwe-surface-"); });
after(() => { clean(K.root); clean(tmp); });

test("asking about 'calendar' but the only strong evidence sits on a 'tables' area: the mismatch is flagged", () => {
  const copyPm = path.join(tmp, "pm-mismatch");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  fs.mkdirSync(path.join(copyPm, "state"), { recursive: true });
  fs.writeFileSync(path.join(copyPm, "state", "inventory.json"), JSON.stringify({
    backend_missing: false,
    endpoints: [
      // matches only the "calendar" concept (1 group) - not enough for a strong match on its own.
      { method: "GET", path: "/calendar/summary", file: "backend/calendar/summary.js", line: 4, used: true, infrastructure: false, usage: "frontend/Calendar.jsx:9", area: "calendar" },
      // matches two concepts ("record", "count") - a strong match, but on a different area than the question names.
      { method: "GET", path: "/resources/record-count-summary", file: "backend/resources/recordCount.js", line: 7, used: false, infrastructure: false, usage: null, area: "tables" },
    ],
  }, null, 1));
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "calendar date range record count"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);

  const firstLine = r.output.split("\n")[0];
  assert.equal(firstLine, "Question: calendar date range record count", "the very first line must restate the question as asked");

  const secondLine = r.output.split("\n")[1];
  assert.match(secondLine, /^Asked about calendar; the evidence is on tables — confirm$/);

  // The strong match itself is still the "tables" endpoint, not the calendar one.
  const backend = r.output.match(/## Ready in the backend\n\n([\s\S]*?)\n\n## /)[1];
  assert.match(backend, /\/resources\/record-count-summary/);
});

test("asking about 'calendar' with evidence also on the calendar area: no surface-mismatch line", () => {
  const copyPm = path.join(tmp, "pm-match");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  fs.mkdirSync(path.join(copyPm, "state"), { recursive: true });
  fs.writeFileSync(path.join(copyPm, "state", "inventory.json"), JSON.stringify({
    backend_missing: false,
    endpoints: [
      // matches "calendar" + "record" + "count" (3 groups) on the calendar area itself - a strong match on the asked surface.
      { method: "GET", path: "/calendar/record-count", file: "backend/calendar/recordCount.js", line: 3, used: true, infrastructure: false, usage: "frontend/Calendar.jsx:14", area: "calendar" },
    ],
  }, null, 1));
  const r = run(path.join(Tool, "canwe.mjs"), [copyPm, "calendar record count"]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);

  const firstLine = r.output.split("\n")[0];
  assert.equal(firstLine, "Question: calendar record count");
  assert.doesNotMatch(r.output, /Asked about .*the evidence is on/, "no mismatch line when the evidence sits on the same area the question names");
});
