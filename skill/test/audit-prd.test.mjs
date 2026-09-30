// Contract tests for skill/tools/audit-prd.mjs: skill/examples/prd/{good,bad}.md — good scores higher than bad;
// bad has "Solution smuggling" and "Missing section" findings; --strict gives 1 for bad, 0 for good; a small PRD
// referring to a K-number that doesn't exist in the fake product's DECISIONS.md gets a "K-number not in
// DECISIONS" blocker with --pm.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_PRD = path.join(SKILL, "examples", "prd");

let K, tmp;
before(async () => { K = await fakeProductSetup(); tmp = temporary("nosy-audit-prd-"); });
after(() => { clean(K.root); clean(tmp); });

test("good.md scores higher than bad.md", () => {
  const jsonPath = path.join(tmp, "result.json");
  const r = run(path.join(Tool, "audit-prd.mjs"), [path.join(EXAMPLE_PRD, "good.md"), path.join(EXAMPLE_PRD, "bad.md"), "--json", jsonPath]);
  assert.equal(r.code, 0, `--strict wasn't given, should return 0: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const good = j.files.find(d => d.file.endsWith("good.md"));
  const bad = j.files.find(d => d.file.endsWith("bad.md"));
  assert.ok(good && bad, "results for good.md and bad.md not found");
  assert.ok(good.score > bad.score, `good (${good.score}) should score higher than bad (${bad.score})`);
});

test("bad.md has 'Solution smuggling' and 'Missing section' findings; --strict gives 1 for bad, 0 for good", () => {
  const jsonPath = path.join(tmp, "bad.json");
  const r1 = run(path.join(Tool, "audit-prd.mjs"), [path.join(EXAMPLE_PRD, "bad.md"), "--json", jsonPath, "--strict"]);
  assert.equal(r1.code, 2, `--strict should return 2 for a bad PRD: ${r1.output}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const findings = j.files[0].findings;
  assert.ok(findings.some(b => /Solution smuggling/.test(b.name)), "expected a Solution smuggling finding");
  assert.ok(findings.some(b => /Missing section/.test(b.name)), "expected a Missing section finding");

  const r2 = run(path.join(Tool, "audit-prd.mjs"), [path.join(EXAMPLE_PRD, "good.md"), "--strict"]);
  assert.equal(r2.code, 0, `--strict should return 0 for a good PRD: ${r2.output}`);
});

test("a PRD referring to a rejected ('not doing') decision gets a 'Refers to a rejected decision' warning", () => {
  // fake-product.mjs's DECISIONS.md has K11: "We're not doing route optimization for now; manual assignment is enough." (rejected).
  const prdPath = path.join(tmp, "rejected-prd.md");
  fs.writeFileSync(prdPath,
    "## Problem\n\nCustomers want route optimization despite decision K11.\n\n## Scope\n\n- In: Automatic routing per K11.\n- Out: <>\n\n## Measurement\n\n50%\n\n## Backend ↔ screen\n\n| Piece | Status |\n|---|---|\n| x | ready |\n\n## Open questions\n\n- ?\n");
  const jsonPath = path.join(tmp, "rejected-prd.json");
  const r = run(path.join(Tool, "audit-prd.mjs"), [prdPath, "--pm", K.pm, "--json", jsonPath]);
  assert.equal(r.code, 0, `--strict wasn't given, should return 0: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const findings = j.files[0].findings;
  assert.ok(findings.some(b => /Refers to a rejected decision/.test(b.name) && /K11/.test(b.name)),
    `expected "Refers to a rejected decision" for K11: ${JSON.stringify(findings)}`);
  assert.ok(findings.some(b => b.level === "warning" && /K11/.test(b.name) && /Refers to a rejected decision/.test(b.name)));
});

test("--pm: a PRD referring to a K-number that doesn't exist in DECISIONS.md is caught with a 'K-number not in DECISIONS' blocker", () => {
  const prdPath = path.join(tmp, "small-prd.md");
  // fake-product.mjs's DECISIONS.md has K10-K12/K20/K30/K40; K999 doesn't exist at all.
  fs.writeFileSync(prdPath,
    "## Problem\n\nCustomers want a feature per decision K999.\n\n## Scope\n\n- In: A screen per K999.\n- Out: <>\n\n## Measurement\n\n50%\n\n## Backend ↔ screen\n\n| Piece | Status |\n|---|---|\n| x | ready |\n\n## Open questions\n\n- ?\n");
  const jsonPath = path.join(tmp, "small-prd.json");
  const r = run(path.join(Tool, "audit-prd.mjs"), [prdPath, "--pm", K.pm, "--json", jsonPath]);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const findings = j.files[0].findings;
  assert.ok(findings.some(b => /K-number not in DECISIONS/.test(b.name) && /K999/.test(b.name)),
    `expected a blocker for K999: ${JSON.stringify(findings)}`);
  assert.ok(findings.some(b => b.level === "blocker" && /K999/.test(b.name)));
});
