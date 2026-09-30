// Contract tests for tools/thresholds.mjs: merging with the default when sources.json's `threshold` is
// missing/partial, sizeDays's partial override, and verify-setup catching an unknown `threshold` field.
// Fake product "Cargo".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { thresholds, Default } from "../tools/thresholds.mjs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, clean, Tool } from "./helpers.mjs";

test("no threshold (K.threshold undefined): every field comes from DEFAULT", () => {
  const e = thresholds({});
  assert.deepEqual(e, Default);
});

test("no source at all (null/undefined) still returns DEFAULT", () => {
  assert.deepEqual(thresholds(null), Default);
  assert.deepEqual(thresholds(undefined), Default);
});

test("partial threshold: the given field changes, the rest stays DEFAULT", () => {
  const e = thresholds({ threshold: { common: 5, signalThreshold: 10 } });
  assert.equal(e.common, 5);
  assert.equal(e.signalThreshold, 10);
  assert.equal(e.sizeCoverageLow, Default.sizeCoverageLow);
  assert.equal(e.waveSimilarity, Default.waveSimilarity);
});

test("sizeDays partial override: only the given letter changes, the rest comes from DEFAULT.sizeDays", () => {
  const e = thresholds({ threshold: { sizeDays: { L: 10 } } });
  assert.equal(e.sizeDays.L, 10);
  assert.equal(e.sizeDays.S, Default.sizeDays.S);
  assert.equal(e.sizeDays.M, Default.sizeDays.M);
});

test("given a pm folder path, reads it from sources.json", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-threshold-"));
  try {
    fs.writeFileSync(path.join(tmp, "sources.json"), JSON.stringify({ threshold: { common: 7 } }));
    const e = thresholds(tmp);
    assert.equal(e.common, 7);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

let K, gh;
before(async () => { K = await fakeProductSetup(); gh = fakeGhSetup(K.gh); });
after(() => { clean(K.root); clean(gh.dir); });

test("verify-setup: reports '-' when threshold is undefined", () => {
  const r = run(path.join(Tool, "verify-setup.mjs"), [K.pm], { env: gh.env });
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  const line = r.output.split("\n").find(l => l.includes("| threshold |"));
  assert.ok(line, "threshold row not found");
  assert.match(line, /–/);
});

test("verify-setup: a known field like threshold.common gets a check, a typo like threshold.widespread gets an x", () => {
  const copyPm = fs.mkdtempSync(path.join(os.tmpdir(), "nosy-threshold-verifysetup-"));
  try {
    fs.cpSync(K.pm, copyPm, { recursive: true });
    const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
    kj.threshold = { common: 4 };
    fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
    const r1 = run(path.join(Tool, "verify-setup.mjs"), [copyPm], { env: gh.env });
    assert.equal(r1.code, 0, `stderr: ${r1.error}`);
    assert.match(r1.output.split("\n").find(l => l.includes("| threshold |")), /✓/);

    kj.threshold = { widespread: 4 };
    fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
    const r2 = run(path.join(Tool, "verify-setup.mjs"), [copyPm], { env: gh.env });
    assert.equal(r2.code, 2, "an unknown threshold field is a ✗: exit code 2 (exit contract)");
    const line = r2.output.split("\n").find(l => l.includes("| threshold |"));
    assert.match(line, /✗/);
    assert.match(line, /widespread/);
  } finally { fs.rmSync(copyPm, { recursive: true, force: true }); }
});
