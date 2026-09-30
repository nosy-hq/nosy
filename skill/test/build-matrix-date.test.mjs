// Announcement-date parsing bugs found while rebuilding pm/matrix.json from the English rival files
//:
//   1. "YYYY-MM" (month precision, no day - e.g. "2026-08 — ...") wasn't recognized by any date regex,
//      so it fell back to year-only precision even though the text states the month.
//   2. The MONTHS table's English word list had "range" instead of "december" - a leftover of the
//      mechanical Turkish "aralık" -> English translation ("aralık" means both "December" and
//      "interval/range"; the wrong sense was picked for this key), so "December 2026" parsed as
//      year-only, and any text containing the literal word "range" next to a year risked a false match.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let root, pm;
const rival = (name, announcement) => `# ${name}

- **Category:** AI PM agent
- **Status:** active
- **Latest major announcement:** ${announcement}

## Loop matrix

| # | Step | Code | Evidence |
|---|---|---|---|
| 1 | Product definition | y | (Sep 28) |
`;

before(() => {
  root = temporary("nosy-date-");
  pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pm, "rivals", "isomonth.md"), rival("IsoMonth", "2026-08 — a feature — example.com/changelog"));
  fs.writeFileSync(path.join(pm, "rivals", "isoday.md"), rival("IsoDay", "2026-08-05 — a feature — example.com/changelog"));
  fs.writeFileSync(path.join(pm, "rivals", "decword.md"), rival("DecWord", "December 2026 — a feature — example.com/changelog"));
  fs.writeFileSync(path.join(pm, "us.json"), JSON.stringify({ name: "Us", codes: { 1: "y" }, notes: { 1: "" } }));
  const r = run(path.join(Tool, "build-matrix.mjs"), [pm]);
  assert.equal(r.code, 0, r.error);
});
after(() => clean(root));

const M = () => JSON.parse(fs.readFileSync(path.join(pm, "matrix.json"), "utf8"));
const find = name => M().products.find(u => u.name === name);

test("'YYYY-MM' (no day) parses at month precision, not year", () => {
  const p = find("IsoMonth");
  assert.equal(p.announcementDate, "2026-08");
  assert.equal(p.announcementDateCertainty, "month");
});

test("'YYYY-MM-DD' still parses at day precision (not swallowed by the new month regex)", () => {
  const p = find("IsoDay");
  assert.equal(p.announcementDate, "2026-08-05");
  assert.equal(p.announcementDateCertainty, "day");
});

test("'December YYYY' parses as month 12, not year-only", () => {
  const p = find("DecWord");
  assert.equal(p.announcementDate, "2026-12");
  assert.equal(p.announcementDateCertainty, "month");
});

// Fresh-user run on twentyhq/twenty: rival files without a feature table made build-matrix write an empty stub
// over a hand-written pm/matrix.json. Now: no table anywhere → the file is left alone; otherwise its rows are
// kept and the old file is backed up to pm/history/ first.
test("build-matrix never loses the owner's matrix", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-bm-")), pm = path.join(d, "pm");
  try {
    fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
    const mine = JSON.stringify({ steps: [{ no: 1, name: "Pipelines" }, { no: 2, name: "Email sync" }], products: [] });
    fs.writeFileSync(path.join(pm, "matrix.json"), mine);
    fs.writeFileSync(path.join(pm, "rivals", "acme.md"), "# Acme\n\n- **Category:** CRM\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Pipelines | | |\n");
    const bm = path.join(Tool, "build-matrix.mjs");
    const r1 = run(bm, [pm]);
    assert.equal(r1.code, 0, r1.error); assert.match(r1.output, /No rival file has a feature table yet/);
    assert.equal(fs.readFileSync(path.join(pm, "matrix.json"), "utf8"), mine, "left alone");
    fs.writeFileSync(path.join(pm, "rivals", "acme.md"), "# Acme\n\n- **Category:** CRM\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Pipelines | y | docs |\n\n## Position relative to us\n- also a CRM\n");
    const r2 = run(bm, [pm]);
    assert.equal(r2.code, 0, r2.error); assert.match(r2.output, /previous matrix kept at/);
    const out = JSON.parse(fs.readFileSync(path.join(pm, "matrix.json"), "utf8"));
    assert.deepEqual(out.steps.map(s => s.name), ["Pipelines", "Email sync"], "the owner's row 2 survives");
    assert.equal(out.products[0].location, "- also a CRM", "the new heading is read");
    assert.equal(fs.readdirSync(path.join(pm, "history")).filter(f => f.startsWith("matrix-before-build-")).length, 1);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
