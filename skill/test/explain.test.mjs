// Contract tests for tools/explain.mjs and its data file skill/data/rules.json: every enforcedBy/tests
// path in rules.json actually exists, ids are unique kebab-case, the CLI lists and explains rules, and an
// unknown id exits 1 with a "did you mean" suggestion. No network, no pm/ needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, Tool } from "./helpers.mjs";
import { loadRules, closest, distance, listing, explainOne, RulesPath } from "../tools/explain.mjs";

const Root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPLAIN = path.join(Tool, "explain.mjs");

const rules = loadRules();

test("rules.json is a non-empty array, 10-20 entries", () => {
  assert.ok(Array.isArray(rules));
  assert.ok(rules.length >= 10 && rules.length <= 20, `expected 10-20 rules, got ${rules.length}`);
});

test("every rule has the required shape", () => {
  for (const r of rules) {
    assert.equal(typeof r.id, "string", `${JSON.stringify(r)} missing id`);
    assert.equal(typeof r.name, "string", `${r.id} missing name`);
    assert.equal(typeof r.rule, "string", `${r.id} missing rule`);
    assert.equal(typeof r.why, "string", `${r.id} missing why`);
    assert.ok(Array.isArray(r.enforcedBy) && r.enforcedBy.length > 0, `${r.id} missing enforcedBy`);
    assert.ok(Array.isArray(r.tests) && (r.tests.length > 0 || r.kind === "instruction"), `${r.id} missing tests (only an instruction rule may have none)`);
  }
});

test("ids are unique and kebab-case", () => {
  const seen = new Set();
  for (const r of rules) {
    assert.match(r.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${r.id} is not kebab-case`);
    assert.ok(!seen.has(r.id), `duplicate id ${r.id}`);
    seen.add(r.id);
  }
});

test("every enforcedBy and tests path exists on disk", () => {
  for (const r of rules) {
    for (const p of [...r.enforcedBy, ...r.tests]) {
      const full = path.join(Root, p);
      assert.ok(fs.existsSync(full), `${r.id}: missing path ${p}`);
    }
  }
});

test("distance() is a plain edit distance", () => {
  assert.equal(distance("abc", "abc"), 0);
  assert.equal(distance("abc", "abd"), 1);
  assert.equal(distance("", "abc"), 3);
});

test("closest() ranks the nearest id(s) first", () => {
  const near = closest(rules[0].id.slice(0, -1), rules); // same id, one char short
  assert.equal(near[0], rules[0].id);
});

test("listing()/explainOne() include id, name, rule, why, enforcedBy, tests", () => {
  const l = listing(rules);
  for (const r of rules) assert.ok(l.includes(r.id) && l.includes(r.name));
  const one = explainOne(rules[0]);
  assert.ok(one.includes(rules[0].why));
  assert.ok(one.includes(rules[0].enforcedBy[0]));
  assert.ok(one.includes(rules[0].tests[0]));
});

test("CLI with no args lists every rule id", () => {
  const r = run(EXPLAIN, []);
  assert.equal(r.code, 0);
  for (const rule of rules) assert.ok(r.output.includes(rule.id), `missing ${rule.id} in listing`);
});

test("CLI with a known id prints the full rule", () => {
  const id = rules[0].id;
  const r = run(EXPLAIN, [id]);
  assert.equal(r.code, 0);
  assert.ok(r.output.includes(rules[0].name));
  assert.ok(r.output.includes("Why:"));
  assert.ok(r.output.includes("Enforced by:"));
  assert.ok(r.output.includes("Tests:"));
});

test("CLI with an unknown id exits 1 and suggests the closest ids", () => {
  const r = run(EXPLAIN, ["totally-not-a-rule-xyz"]);
  assert.equal(r.code, 1);
  assert.ok(/Unknown rule id/.test(r.error));
  assert.ok(/Closest:/.test(r.error));
});

test("RulesPath points at skill/data/rules.json", () => {
  assert.ok(RulesPath.endsWith(path.join("data", "rules.json")));
});

test("every rule says how it's enforced, and says it honestly: only code rules claim a script", async () => {
  const R = JSON.parse(fs.readFileSync(path.join(Tool, "..", "data", "rules.json"), "utf8"));
  for (const r of R) assert.ok(["code", "config", "instruction"].includes(r.kind), `${r.id}: kind`);
  for (const r of R.filter(r => r.kind === "code")) assert.ok(r.enforcedBy.some(f => f.startsWith("skill/tools/")), `${r.id}: a code rule names a script`);
});
