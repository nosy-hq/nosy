// Tests for skill/tools/shipped-record.mjs's decisions-log mode (N1: a decision-log product like the first product,
// with no GitHub issue tracker used as the record at all — "decisions" come from read-decisions.mjs's
// blocks, "shipped" comes from shipped-links.mjs's decisionShippedBy).
// Runs against the fake product "Cargo" (fake-product.mjs), which already ships a DECISIONS.md with K10,
// K11, K12 (m.1/m.4/m.6, real code commits), K20, K30 (m.2, a real code commit) and K40 — plus a handful
// of extra commits added here for the cases fake-product.mjs's own fixture doesn't cover: a
// self-referential-only decision, a doc-only (non-decisions-file) decision, and a "K<no> m.N" grouping
// commit on a fresh decision id, so this test doesn't have to touch the shared fixture other callers rely on.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean } from "./helpers.mjs";

const Script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools", "shipped-record.mjs");

let K, tmp, shippedJsonPath, jsonPath, output;

function git(repoDir, args, env) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", env: { ...process.env, ...env } });
}
// A commit dated `daysAgo` days before "now" (kept well inside the default --day 90 window; the window-
// boundary test below uses a much larger offset to fall clearly outside a small --day).
function commitAt(repoDir, daysAgo, message, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(repoDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const iso = new Date(Date.now() - daysAgo * 86400000).toISOString();
  git(repoDir, ["add", "-A"]);
  git(repoDir, ["commit", "-q", "-m", message], {
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@cargo.test", GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@cargo.test", GIT_COMMITTER_DATE: iso,
  });
}

before(async () => {
  K = await fakeProductSetup();
  const decisions = fs.readFileSync(path.join(K.repo, "DECISIONS.md"), "utf8");
  const extra = decisions + `
## K50 (2 Sep, Alex): Self-referential-only test decision — recorded, never actually shipped.

## K60 (2 Sep, Alex): Doc-only test decision — only a planning doc names it, never real code.

## K70 (2 Sep, Alex): Grouping test decision, worked in milestones.
- m.3: the milestone commit that should ship it
`;
  // Rewrites DECISIONS.md at the SAME relative position/day as fake-product.mjs's original first commit
  // would have (so every decision, old and new, blames to a date inside the default --day 90 window).
  commitAt(K.repo, 24, "docs: add K50/K60/K70 test decisions", { "DECISIONS.md": extra });
  // K50: cites the decision, touches ONLY DECISIONS.md itself -> self-referential-only -> waiting.
  commitAt(K.repo, 20, "docs: K50 recorded as decided, nothing built yet", { "DECISIONS.md": extra + "\n" });
  // K60: cites the decision, touches ONLY a planning doc (ROADMAP.md, a doc extension but NOT the
  // decisions file itself) -> still doc-only under the shippedIgnoreDocs rule -> waiting.
  commitAt(K.repo, 18, "docs(ROADMAP): K60 planning notes, no code yet", { "ROADMAP.md": "# Roadmap\n\nK60: planned, not started.\n" });
  // K70: the "K70 m.3" milestone form (refs.mjs/groupKeyOf should fold it under "K70"), touches REAL code.
  commitAt(K.repo, 15, "feat: K70 m.3 the milestone commit that ships it", { "backend/k70.js": "export function k70() { return true; }\n" });
  // Window-boundary case: a decision recorded, and shipped, far outside a small --day window.
  const farExtra = extra + `
## K90 (way outside the window): far-past test decision.
`;
  commitAt(K.repo, 400, "docs: add K90 far-past test decision", { "DECISIONS.md": farExtra });
  commitAt(K.repo, 395, "feat: K90 far-past real work", { "backend/k90.js": "export function k90() { return true; }\n" });

  git(K.repo, ["push", "-q", "origin", "main"]);
  git(K.repo, ["fetch", "-q", "origin"]);

  tmp = temporary("nosy-shipped-decisions-");
  jsonPath = path.join(tmp, "decisions.json");
  shippedJsonPath = path.join(tmp, "shipped.json");
  const r = run(Script, [K.repo, "--decisions", "DECISIONS.md", "--day", "90", "--json", jsonPath, "--shipped-json", shippedJsonPath]);
  assert.equal(r.code, 0, `shipped-record.mjs --decisions: unexpected exit code, stderr: ${r.error}`);
  output = { text: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
});
after(() => { clean(K.root); clean(tmp); });

function rowOf(ref) { return output.json.decisions.find(d => d.ref === ref); }

test("a code commit naming a plain id (K12, real backend commits) ships it", () => {
  const row = rowOf("K12");
  assert.ok(row, "K12 should be a decision row");
  assert.ok(row.landed, "K12 has real backend commits (m.1/m.4/m.6) and should be shipped");
  assert.ok(row.commits >= 3);
});

test("self-referential decision commit (only touches the decisions log itself) stays waiting", () => {
  const row = rowOf("K50");
  assert.ok(row, "K50 should be a decision row");
  assert.equal(row.landed, null, "every commit naming K50 touches only DECISIONS.md — none should count as shipped");
  assert.equal(row.commits, 2, "both commits naming K50 (the batch add + its own note) touch only the decisions log");
});

test("doc-only commit (a planning doc, not the decisions file itself) also stays waiting", () => {
  const row = rowOf("K60");
  assert.ok(row, "K60 should be a decision row");
  assert.equal(row.landed, null, "K60's only commit touches ROADMAP.md (a doc extension) — still doc-only, not shipped");
});

test("a 'K<no> m.N' milestone commit groups under the base id and ships it (refs.mjs groupKeyOf)", () => {
  const row = rowOf("K70");
  assert.ok(row, "K70 should be a decision row");
  assert.ok(row.landed, "K70 m.3's real code commit should ship K70");
  assert.equal(row.commits, 2, "the batch add (doc-only) plus the K70 m.3 milestone commit (real code)");
});

test("window boundary: a far-past decision is excluded with a small --day, included with a large one", () => {
  const small = run(Script, [K.repo, "--decisions", "DECISIONS.md", "--day", "5", "--json", path.join(tmp, "small.json")]);
  assert.equal(small.code, 0, small.error);
  const smallJson = JSON.parse(fs.readFileSync(path.join(tmp, "small.json"), "utf8"));
  assert.equal(smallJson.decisions.find(d => d.ref === "K90"), undefined, "K90 (400 days ago) must not appear in a --day 5 window");

  const big = run(Script, [K.repo, "--decisions", "DECISIONS.md", "--day", "500", "--json", path.join(tmp, "big.json")]);
  assert.equal(big.code, 0, big.error);
  const bigJson = JSON.parse(fs.readFileSync(path.join(tmp, "big.json"), "utf8"));
  const k90 = bigJson.decisions.find(d => d.ref === "K90");
  assert.ok(k90, "K90 should appear once the window is wide enough");
  assert.ok(k90.landed, "K90's real commit should ship it");
});

test("pm/state/shipped.json contract: source, linkTypes, shipped/waiting rows, counts", () => {
  const j = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  assert.equal(j.source, "decisions");
  assert.deepEqual(j.linkTypes, ["commit"]);
  const k12 = j.shipped.find(r => r.ref === "K12");
  assert.ok(k12, "K12 should be in the shipped rows");
  assert.equal(k12.kind, "decision");
  assert.equal(k12.link, "commit");
  assert.ok(k12.days != null || k12.days === 0);
  const waitingRefs = j.waiting.map(r => r.ref);
  assert.ok(waitingRefs.includes("K50"), "K50 (self-referential-only) should be in `waiting`");
  assert.ok(waitingRefs.includes("K60"), "K60 (doc-only) should be in `waiting`");
  assert.equal(j.counts.requests, output.json.decisions.length);
  assert.equal(j.counts.open, j.waiting.length);
});

test("pm/state/shipped.json: a second run read-modify-writes, keeping keys it doesn't own", () => {
  const before = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  before.recent = { note: "written by the N2 branch, not ours" };
  before.undecided = [{ ref: "#999" }];
  fs.writeFileSync(shippedJsonPath, JSON.stringify(before, null, 2));
  const r = run(Script, [K.repo, "--decisions", "DECISIONS.md", "--day", "90", "--json", path.join(tmp, "decisions2.json"), "--shipped-json", shippedJsonPath]);
  assert.equal(r.code, 0, r.error);
  const after = JSON.parse(fs.readFileSync(shippedJsonPath, "utf8"));
  assert.deepEqual(after.recent, { note: "written by the N2 branch, not ours" });
  assert.deepEqual(after.undecided, [{ ref: "#999" }]);
  assert.ok(after.shipped.length > 0, "this script's own keys should still be refreshed");
  assert.equal(after.source, "decisions");
});
