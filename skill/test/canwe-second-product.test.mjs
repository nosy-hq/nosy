// canwe on a second product (Twenty, 30 Sep): a shipped feature that isn't an endpoint (a cron trigger type)
// read as "no trace in the backend"; test titles about bad input read as "deliberately not done"; names that
// were only too common read as "no trace in the code". Throwaway repo; no network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let root, pm;
const CANWE = path.join(Tool, "canwe.mjs");
const put = (f, s) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const verdictOf = o => (o.match(/## Suggested verdict[^\n]*\n\n\*\*(.*?)\*\*/) || [])[1];

before(() => {
  root = temporary("nosy-canwe-2nd-");
  // "workflow" is everywhere; the cron trigger lives in a few files and a test that rejects bad patterns.
  for (let i = 0; i < 40; i++) put(`src/workflow/step${i}.ts`, `// workflow step ${i}\nexport const workflowStep${i} = {};\n`);
  put("src/workflow/trigger/cron-trigger.ts", "// Runs a workflow on a schedule.\nexport type WorkflowCronTrigger = { cronPattern: string };\nexport const computeCronPattern = (s: string) => s;\n");
  put("src/workflow/trigger/__tests__/cron-trigger.spec.ts", "it('should throw an exception for unsupported schedule type', () => { expect(() => computeCronPattern('x')).toThrow(); });\nit('should throw for invalid cronPattern', () => {});\n");
  // Translated docs mention the Turkish word; billing logs a runtime refusal of one "recurring" charge.
  for (let i = 0; i < 3; i++) put(`packages/acme-docs/tr/page${i}.json`, `{ "label": "Tekrarlayan tetikleyici ${i}" }\n`);
  put("src/billing/recurring-charge.service.ts", "import {\n  type RejectedRecurringCharge,\n} from './types';\n// recurring charges\nlogger.warn(`Refused recurring charge \"${key}\" from app ${appId}: ${reason}`);\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  fs.writeFileSync(path.join(pm, "state", "inventory.json"), JSON.stringify({ backend_missing: false, endpoints: [] }));
});
after(() => clean(root));

test("a feature in the code but not an endpoint is a candidate to confirm, not \"no trace in the backend\"; bad-input test titles aren't refusals", () => {
  const r = run(CANWE, [pm, "Can we add scheduled triggers to workflows", "WorkflowCronTrigger", "cronPattern"]);
  assert.equal(r.code, 0, r.error);
  assert.equal(verdictOf(r.output), "Candidate — confirm: the code has it, not as an endpoint");
  const deliberate = (r.output.match(/### Deliberately off\?[^\n]*\n\n([\s\S]*?)\n\n_/) || [])[1] || "";
  assert.doesNotMatch(deliberate, /should throw/, "a test title about bad input isn't listed as a refusal");
  assert.doesNotMatch(verdictOf(r.output), /decision: not doing this/);
});

test("names that are only too common give \"can't tell\", never \"no trace\"", () => {
  const r = run(CANWE, [pm, "zamanlanmış tetikleyici ekleyebilir miyiz", "workflow"]);
  assert.equal(r.code, 0, r.error);
  assert.match(verdictOf(r.output), /^Can't tell from these names/);
});

test("a word only in docs (even under packages/<name>-docs) doesn't take a code name's anchor slot; a logged runtime refusal and an imported type aren't decisions", () => {
  const r = run(CANWE, [pm, "tekrarlayan tetikleyici ekleyebilir miyiz", "WorkflowCronTrigger", "recurring"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /### "workflowcrontrigger" · [1-9]\d* code file/);
  assert.match(r.output, /### "recurring" · [1-9]\d* code file/);
  assert.doesNotMatch(r.output, /### "(?:tekrarlayan|tetikleyici)" · [1-9]/, "translated docs under acme-docs/ are docs");
  const deliberate = (r.output.match(/### Deliberately off\?[^\n]*\n\n([\s\S]*?)\n\n_/) || [])[1] || "";
  assert.doesNotMatch(deliberate, /Refused recurring charge|RejectedRecurringCharge/);
  assert.equal(verdictOf(r.output), "Candidate — confirm: the code has it, not as an endpoint");
});
