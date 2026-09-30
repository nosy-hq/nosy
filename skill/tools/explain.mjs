#!/usr/bin/env node
// explain: Nosy's promises are buried in code comments and pm/log.md internal requests. This is the
// named, checkable list of them (skill/data/rules.json), read straight, no LLM involved.
// Usage: node explain.mjs                 lists every rule: id, name, one-line rule
//        node explain.mjs <id>            the full rule: name, rule, why (evidence), enforcedBy, tests
//        node explain.mjs <unknown-id>    the closest ids, exit 1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const Tool = path.dirname(fileURLToPath(import.meta.url));
export const RulesPath = path.join(Tool, "..", "data", "rules.json");

export function loadRules(file = RulesPath) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Plain Levenshtein distance, for "did you mean" suggestions on an unknown id.
export function distance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
  }
  return d[m][n];
}

export function closest(id, rules, n = 3) {
  return rules
    .map(r => ({ id: r.id, dist: distance(id, r.id) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(r => r.id);
}

export function listing(rules) {
  return rules.map(r => `${r.id}: ${r.name} — ${r.rule}`).join("\n");
}

export function explainOne(rule) {
  const lines = [
    `${rule.id}: ${rule.name}`,
    "",
    rule.rule,
    "",
    `Why: ${rule.why}`,
    "",
    `Enforced by: ${rule.enforcedBy.join(", ")} (${{ code: "a script checks it", config: "set in the agent's own config", instruction: "an instruction the agent follows; no script checks it" }[rule.kind] || rule.kind})`,
    `Tests: ${rule.tests.length ? rule.tests.join(", ") : "none (nothing a test can check)"}`,
  ];
  return lines.join("\n");
}

function main() {
  const [id] = process.argv.slice(2);
  const rules = loadRules();
  if (!id) { console.log(listing(rules)); return; }
  const rule = rules.find(r => r.id === id);
  if (!rule) {
    console.error(`Unknown rule id: ${id}`);
    console.error(`Closest: ${closest(id, rules).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(explainOne(rule));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
