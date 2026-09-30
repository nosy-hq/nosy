// Contract tests for internal request 117: lowhanging.mjs (signal 5, "Issues opened against us") keeps
// security and bug reports out of the opportunity ranking, detected structurally (labels, CVE/GHSA ids in
// the body, the issue type field) — never by matching words in the title/body. Uses the shared fake product
// "Cargo" (for pm/sources.json, which already sets issue.repo + issue.our) but a fresh, self-contained fake
// `gh issue list` fixture so this test doesn't touch skill/test/fake-product.mjs (shared by locale-parity
// and other tests) at all.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean as cleanValue, Tool } from "./helpers.mjs";

let K, gh, tmp, output;

before(async () => {
  K = await fakeProductSetup();
  const issueListOpen = [
    // Labeled security issue: excluded from ranking, counted as "security".
    { number: 801, title: "[cargo] Rate limiter can be bypassed under concurrent load",
      author: { login: "researcher1" }, updatedAt: new Date().toISOString(),
      body: "Non-atomic read-modify-write lets concurrent requests slip past the limiter.",
      labels: [{ name: "security" }] },
    // No label, but a CVE id in the body: excluded, also counted as "security".
    { number: 802, title: "[cargo] SQL injection in the report filter",
      author: { login: "researcher2" }, updatedAt: new Date().toISOString(),
      body: "Reported upstream as CVE-2026-12345; the filter param isn't parameterized.",
      labels: [] },
    // Labeled bug (not security): excluded, counted as "bug".
    { number: 803, title: "[cargo] App crashes when uploading a large file",
      author: { login: "customer9" }, updatedAt: new Date().toISOString(),
      body: "1. Pick a file over 50MB\n2. Upload\n3. Crash", labels: [{ name: "bug" }] },
    // A genuine feature request with the word "security" in its TITLE and body, but no label and no
    // CVE/GHSA id: must still be ranked normally — proves psst isn't matching on the word.
    { number: 804, title: "[cargo] Add a security dashboard for the shipment audit trail",
      author: { login: "customer10" }, updatedAt: new Date().toISOString(),
      body: "Owners want a security-focused view of who touched which shipment.\n1. Filter by user\n2. Export",
      labels: [] },
  ];
  gh = fakeGhSetup({ issueListOpen });
  tmp = temporary("nosy-low-hanging-risk-");
  const jsonPath = path.join(tmp, "lowhanging.json");
  const r = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", jsonPath], { env: gh.env });
  assert.equal(r.code, 0, `lowhanging: unexpected exit code, stderr: ${r.error}`);
  output = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { cleanValue(K.root); cleanValue(gh.dir); cleanValue(tmp); });

test("a labeled security issue is excluded from the ranking", () => {
  assert.ok(!output.json.items.some(i => i.title.includes("#801")), "#801 (labeled security) must not be ranked");
});

test("a CVE id in the body excludes the issue even with no label", () => {
  assert.ok(!output.json.items.some(i => i.title.includes("#802")), "#802 (CVE in body) must not be ranked");
});

test("a labeled bug issue is excluded from the ranking", () => {
  assert.ok(!output.json.items.some(i => i.title.includes("#803")), "#803 (labeled bug) must not be ranked");
});

test("a feature request with the word 'security' in its title but no label is still ranked", () => {
  const m = output.json.items.find(i => i.title.includes("#804"));
  assert.ok(m, "#804 (word 'security' in title, no label) should still be ranked — proves no word matching");
  assert.equal(m.type, "Issue opened against us");
});

test("exactly one summary line reports the excluded risks, counted by kind", () => {
  assert.match(output.markdown, /Reported risks, not ranked: 3 \(security 2, bugs 1\) — Nosy doesn't triage code; see #801, #802, #803\.?/);
  // Only one such line in the whole output.
  const hits = (output.markdown.match(/Reported risks, not ranked:/g) || []).length;
  assert.equal(hits, 1);
});

test("the risk note and count also come through in the JSON", () => {
  assert.match(output.json.risk_note, /Reported risks, not ranked: 3 \(security 2, bugs 1\)/);
});

test("security/bug items never carry a 'ref' entry pointing at a ranked item (they're not items at all)", () => {
  assert.ok(!output.json.items.some(i => i.ref === "#801" || i.ref === "#802" || i.ref === "#803"));
});
