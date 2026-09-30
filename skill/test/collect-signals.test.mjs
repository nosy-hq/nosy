// Contract tests for skill/tools/collect-signals.mjs: a small CSV (quoted/multi-line field, fake email/phone)
// and a .md interview note; type:"signal", correct total, at least one of the fake product's matrix/request
// items is among the targets; no raw email/phone in the output (masking); --quote 0 gives empty examples.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, pm, tmp;
before(async () => {
  K = await fakeProductSetup();
  tmp = temporary("nosy-sinyaltopla-");
  // The matching threshold (K.signal.threshold, default 16) is idf-weighted; small/deterministic test data
  // makes it hard to clear a realistic threshold (the first product's calibration is based on 52 CSV + 14 interview signals)
  // — we lower the threshold in this test's own copy via collect-signals.mjs's own supported
  // sources.json.signal.threshold key (we don't touch the script).
  pm = temporary("nosy-sinyaltopla-pm-");
  fs.cpSync(K.pm, pm, { recursive: true });
  const kj = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  kj.signal = { threshold: 3 };
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(kj, null, 1));
});
after(() => { clean(K.root); clean(pm); clean(tmp); });

const Email = "customer.test@example-company.com";
const Phone = "0532 111 22 33";

function inputsOfWrite(dir) {
  fs.mkdirSync(dir, { recursive: true });
  // CSV: a quoted, multi-line "text" column with a fake email/phone.
  const csv = [
    "customer,email,phone,date,message",
    `"Grace Bennett","${Email}","${Phone}",2026-01-05,"We really want the bulk shipment\nexport feature, we need to be able to download CSV."`,
    `"James Cole","","",2026-01-06,"We're waiting on barcode scanning for the intake flow."`,
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "survey.csv"), csv);
  fs.writeFileSync(path.join(dir, "interview.md"),
    "# Interview note\n\n- Every week they ask when the export button for shipments will show up, spreadsheets matter to them.\n- Their warehouse crew keeps typing tracking numbers by hand since there is no scanner support yet.\n");
}

test("type:signal, total is counted correctly, at least one of the fake product's matrix/request items is among the targets", () => {
  const signalDir = path.join(tmp, "signal");
  inputsOfWrite(signalDir);
  const jsonPath = path.join(tmp, "signals.json");
  const r = run(path.join(Tool, "collect-signals.mjs"), [pm, signalDir, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "signal");
  // total = 2 csv rows + 2 md items = 4 raw signals (all unique before dedup).
  assert.equal(j.total, 4, `total signal count differs from expected: ${j.total}`);
  assert.ok(j.goals.length > 0, "at least one target should have matched");
  // The "Bulk export" row in pm/matrix.json, or BACKEND-NEEDS.md §3, should show up among the targets.
  assert.ok(j.goals.some(h => /export/i.test(h.title)), `expected an item mentioning 'export' among the targets: ${JSON.stringify(j.goals.map(h => h.title))}`);
});

test("no raw email/phone in the output (masking); --quote 0 gives empty examples", () => {
  const signalDir = path.join(tmp, "signal2");
  inputsOfWrite(signalDir);
  const jsonPath = path.join(tmp, "signals2.json");
  const r = run(path.join(Tool, "collect-signals.mjs"), [pm, signalDir, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const rawText = fs.readFileSync(jsonPath, "utf8");
  assert.ok(!rawText.includes(Email), "the output should not contain the raw email");
  assert.ok(!rawText.includes(Phone.replace(/\s/g, "")) , "the output should not contain the raw phone number");
  assert.ok(!r.output.includes(Email), "the markdown output should not contain the raw email either");

  const jsonPath0 = path.join(tmp, "signals2-quote0.json");
  const r0 = run(path.join(Tool, "collect-signals.mjs"), [pm, signalDir, "--quote", "0", "--json", jsonPath0]);
  assert.equal(r0.code, 0);
  const j0 = JSON.parse(fs.readFileSync(jsonPath0, "utf8"));
  assert.ok(j0.goals.every(h => (h.examples || []).length === 0), "with --quote 0, every target's examples should be empty");
});

test("native exports (Intercom, Zendesk, Slack, Gong): nested records are read, HTML stripped, our replies and join messages skipped, epoch dates parsed", () => {
  const nativeDir = path.join(Tool, "..", "examples", "signal", "native");
  const jsonPath = path.join(tmp, "signals-native.json");
  const r = run(path.join(Tool, "collect-signals.mjs"), [pm, nativeDir, "--json", jsonPath]);
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  // intercom 2 + zendesk 2 + slack 1 (join message and "ok" dropped) + gong 1 = 6
  assert.equal(j.total, 6, `total differs: ${j.total}`);
  const raw = fs.readFileSync(jsonPath, "utf8") + r.output;
  assert.ok(!/<p>|<b>/.test(raw), "HTML tags should be stripped");
  assert.ok(!raw.includes("Thanks Nora"), "the support agent's reply is not a demand signal");
  assert.ok(!raw.includes("has joined the channel"), "Slack join messages are skipped");
  assert.ok(!raw.includes("nora.price@example.com"), "emails nested in the export are masked");
  assert.ok(j.goals.some(h => /export/i.test(h.title)), `an export target should match: ${JSON.stringify(j.goals.map(h => h.title))}`);
  // Intercom's created_at is epoch seconds (2026-09-24 08:00 UTC); it must not be dropped as an unparseable date.
  assert.ok(!/1970/.test(JSON.stringify(j)), "epoch seconds must not become 1970");
  assert.ok(/2026-09-2[45]/.test(JSON.stringify(j)), "the Intercom epoch date should appear as a real date");
});
