// End-to-end tests for internal request 4: shipped-record.mjs's decisions-log mode adds a `measure` field
// to a shipped row from the decision's own text (read-decisions.mjs's measurementOf), and cross-checks a
// checkable event name against scan-metrics.mjs's own known event names (exact match only). scoreboard.mjs
// then shows it as a "to check: <line>" line under the shipped row. Own small fixture repo (not the shared
// fake-product.mjs one) so it doesn't have to touch other callers' fixture.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { page } from "../tools/scoreboard.mjs";

const Script = path.join(Tool, "shipped-record.mjs");

function git(repoDir, args, env) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", env: { ...process.env, ...env } });
}
function commitAt(repoDir, daysAgo, message, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const iso = new Date(Date.now() - daysAgo * 86400000).toISOString();
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", message], {
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@measure.test", GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@measure.test", GIT_COMMITTER_DATE: iso,
  });
}

const DECISIONS_MD = `# Decisions

## K10 (recorded): signup flow gets a dedicated screen.

**Ölçüm:** \`signup_completed\` olayı haftada 500'ü geçerse tamam.

## K20 (recorded): bulk export ships as a button on the shipment list.

**Measurement:** the \`bulk_export_done\` event should fire at least 20 times a week.

## K30 (recorded): route report export is nice to have, no target set.
`;

let root, repo, pm, shippedJsonPath, out;

before(() => {
  root = temporary("nosy-measure-shipped-");
  repo = path.join(root, "repo");
  pm = path.join(root, "pm");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "user.email", "test@measure.test"]);

  commitAt(repo, 20, "docs: add DECISIONS.md (K10/K20/K30)", { "DECISIONS.md": DECISIONS_MD });
  // K10 ships with real code that ALSO fires the exact event its own measurement line names.
  commitAt(repo, 15, "feat: K10 signup screen wired to posthog", {
    "frontend/signup.js": 'import posthog from "posthog-js";\nexport function onSignup() {\n  posthog.capture("signup_completed");\n}\n',
  });
  // K20 ships with real code, but NEVER fires the event its own measurement line names (existsInCode: false).
  commitAt(repo, 10, "feat: K20 bulk export button wired up", {
    "frontend/bulk-export.js": "export function onExport() { return true; }\n",
  });
  // K30 ships with real code; no measurement line at all -> measure should be null.
  commitAt(repo, 5, "feat: K30 route report export backend", {
    "backend/routes.js": "export function reportExport() { return []; }\n",
  });

  const barePath = path.join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", barePath]);
  git(repo, ["remote", "add", "origin", barePath]);
  git(repo, ["push", "-q", "origin", "main"]);
  git(repo, ["fetch", "-q", "origin"]);

  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "origin/main" }, null, 1));

  shippedJsonPath = path.join(root, "shipped.json");
  const r = run(Script, [repo, "--decisions", "DECISIONS.md", "--pm", pm, "--day", "90", "--shipped-json", shippedJsonPath]);
  assert.equal(r.code, 0, `shipped-record.mjs: unexpected exit code, stderr: ${r.error}\n${r.output}`);
  out = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
});
after(() => clean(root));

function shippedOf(ref) { return out.shipped.find(r => r.ref === ref); }

test("K10: measurement line carried onto the shipped row, event checked against scan-metrics and found (existsInCode: true)", () => {
  const k10 = shippedOf("K10");
  assert.ok(k10, "K10 should be shipped");
  assert.ok(k10.measure, "K10 should carry a measure field");
  assert.match(k10.measure.line, /signup_completed/);
  assert.deepEqual(k10.measure.event, { name: "signup_completed", existsInCode: true });
});

test("K20: measurement line carried, event checked and NOT found in code (existsInCode: false) — recorded, not scored", () => {
  const k20 = shippedOf("K20");
  assert.ok(k20, "K20 should be shipped");
  assert.ok(k20.measure, "K20 should carry a measure field");
  assert.match(k20.measure.line, /bulk_export_done/);
  assert.deepEqual(k20.measure.event, { name: "bulk_export_done", existsInCode: false });
});

test("K30: no measurement line at all -> measure is null, no crash, no fabricated line", () => {
  const k30 = shippedOf("K30");
  assert.ok(k30, "K30 should be shipped");
  assert.equal(k30.measure, null);
});

test("without --pm, the event cross-check is skipped but the line itself is still recorded", () => {
  const noPmJson = path.join(root, "shipped-no-pm.json");
  const r = run(Script, [repo, "--decisions", "DECISIONS.md", "--day", "90", "--shipped-json", noPmJson]);
  assert.equal(r.code, 0, r.error);
  const j = JSON.parse(fs.readFileSync(noPmJson, "utf8"));
  const k10 = j.shipped.find(x => x.ref === "K10");
  assert.ok(k10.measure, "the line itself should still be recorded without --pm");
  assert.match(k10.measure.line, /signup_completed/);
  assert.equal(k10.measure.event, undefined, "no pm folder -> no event cross-check attempted");
});

test("scoreboard.mjs: renders 'to check: <line>' under the shipped row, with the exists-in-code fact when checked", () => {
  const scoreboardPm = temporary("nosy-measure-scoreboard-");
  try {
    fs.mkdirSync(path.join(scoreboardPm, "state"), { recursive: true });
    fs.copyFileSync(shippedJsonPath, path.join(scoreboardPm, "state", "shipped.json"));
    const h = page(scoreboardPm, { minN: 1 });
    assert.match(h, /to check: .*signup_completed.*event <code>signup_completed<\/code> exists in code: yes/);
    assert.match(h, /to check: .*bulk_export_done.*event <code>bulk_export_done<\/code> exists in code: no/);
    // K30 has no measurement line: its row must not print a "to check" line at all.
    const k3Row = h.slice(h.indexOf(">K30<")).slice(0, 400);
    assert.ok(!k3Row.includes("to check:"), "K30 has no measure, so no 'to check' line should render for it");
  } finally { clean(scoreboardPm); }
});
