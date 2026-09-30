// Contract tests for internal request 77c: skill/tools/interview-themes.mjs (interview/call notes → themes with
// receipts), its use in canwe's Demand section, and `nosy interviews`. Fake product "Cargo"; the three interview
// notes below are synthetic. No network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";
import { parseInterview } from "../tools/interview-themes.mjs";

let K, gh, pm, R, md;
const NOTES = {
  "2026-09-01-acme-freight.md": `# Interview — Acme Freight, ops lead. Synthetic.
Participants: us, ops lead
- Bulk export of shipments to CSV at month end would save us hours of copying.
- Barcode scanning at the dock is honestly what we need most.
- We'd love SMS alerts when a delivery is delayed, drivers never read email.
`,
  "call-2026-09-10-beta-logistics.md": `# Call — Beta Logistics. Synthetic.
Q: Do you export shipments today? Would a bulk export of shipments to CSV help?
A: Every month we export all shipments in bulk to CSV for accounting, by hand; call me on ops@beta.test.
Q: Anything about delays?
A: SMS alerts for delayed delivery would keep our drivers informed.
`,
  "2026-09-20-gamma-cargo.md": `# Interview — Gamma Cargo. Synthetic.
Date: 2026-09-20
- Interviewer: what about exports?
- A monthly bulk export of shipments to CSV would help our accounting team a lot.
- Delayed delivery SMS alerts, please, email alerts are ignored by drivers.
`,
};

before(async () => {
  K = await fakeProductSetup(); gh = fakeGhSetup(K.gh);
  pm = K.pm; fs.mkdirSync(path.join(pm, "signal", "interviews"), { recursive: true });
  for (const [f, t] of Object.entries(NOTES)) fs.writeFileSync(path.join(pm, "signal", "interviews", f), t);
  const r = run(path.join(Tool, "interview-themes.mjs"), [pm, "--json", path.join(pm, "state", "interviews.json")]);
  assert.equal(r.code, 0, r.error);
  md = r.output; R = JSON.parse(fs.readFileSync(path.join(pm, "state", "interviews.json"), "utf8"));
});
after(() => { clean(K.root); clean(gh.dir); });

const theme = re => R.themes.find(t => re.test(t.key) || re.test(t.target?.title || ""));

test("reads one interview per file, with dates from the name or a Date: line", () => {
  assert.equal(R.interviews.length, 3);
  assert.deepEqual(R.interviews.map(i => i.date).sort(), ["2026-09-01", "2026-09-10", "2026-09-20"]);
});

test("interviewer lines, headings and meta lines are not customer statements", () => {
  const p = parseInterview(NOTES["call-2026-09-10-beta-logistics.md"], "x.md");
  assert.equal(p.statements.length, 2);
  assert.ok(p.statements.every(s => !/^Do you export|Anything about/.test(s.text)));
  assert.equal(parseInterview(NOTES["2026-09-20-gamma-cargo.md"], "y.md").statements.length, 2, "'Interviewer:' bullet and 'Date:' skipped");
  assert.equal(parseInterview("- Bulk export is essential: at year end it takes two days.", "z.md").statements.length, 1, "a colon inside a sentence isn't a speaker label");
});

test("a theme raised in every interview is matched to our request doc item, with receipts", () => {
  const t = theme(/Bulk export/);
  assert.ok(t, md);
  assert.equal(t.target?.kind, "request"); assert.equal(t.target.id, "§3");
  assert.equal(t.interviews, 3);
  assert.equal(t.quotes.length, 2);
  for (const q of t.quotes) { assert.match(q.file, /^signal\/interviews\//); assert.ok(Number.isInteger(q.line) && q.line > 1); }
});

test("a theme not in the matrix, roadmap or request doc is a candidate, named in the customers' words", () => {
  const t = R.themes.find(t => !t.target && /sms/i.test(t.key));
  assert.ok(t, md);
  assert.equal(t.interviews, 3);
  assert.match(md, /## Not on the matrix, roadmap or request doc — candidates/);
});

test("quotes are masked", () => {
  assert.ok(!JSON.stringify(R).includes("ops@beta.test"));
  assert.ok(md.includes("[email]") || !md.includes("@"), "email masked in output");
});

test("canwe shows the interview theme in its Demand section and verdict", () => {
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "bulk export", "export"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /### In interviews\n\n- \*\*§3 Bulk export\*\*: raised in 3 of 3 interviews/);
  assert.match(r.output, /In interviews: 3 of 3\./);
});

test("nosy interviews writes state; with no notes it says where to put them", () => {
  const r = run(path.join(Tool, "nosy.mjs"), ["interviews", "--pm", pm], { env: gh.env });
  assert.equal(r.code, 0, r.error); assert.match(r.output, /# Interview themes · 3 interviews/);
  const empty = temporary("nosy-iv-empty-"); fs.cpSync(pm, empty, { recursive: true }); fs.rmSync(path.join(empty, "signal"), { recursive: true });
  const e = run(path.join(Tool, "interview-themes.mjs"), [empty]);
  assert.match(e.output, /No interview notes found/); clean(empty);
});
