// Contract tests for tools/read-decisions.mjs: a single file (DECISIONS.md, today's
// pattern) and a directory (docs/adr/, a backward-compatible addition - see fake-product.mjs) reduce to the
// same shape: no/title/metin/file/line/status/notDoing. Also verify-setup.mjs's "decision titles" row and
// audit-prd.mjs's ADR-number check are tested against sources.json copied from this same fake product (Cargo).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";
import { decisionsOfRead } from "../tools/read-decisions.mjs";

let K, gh;
before(async () => { K = await fakeProductSetup(); gh = fakeGhSetup(K.gh); });
after(() => { clean(K.root); clean(gh.dir); });

function sourcesRead(pm) { return JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8")); }
function adrCopySetup() {
  const copyPm = temporary("nosy-readdecisions-adr-");
  fs.cpSync(K.pm, copyPm, { recursive: true });
  const kj = sourcesRead(copyPm);
  kj.preread.decisions = "docs/adr";
  fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
  return { copyPm, kj };
}

test("single file (DECISIONS.md): each '## K<no>' block is one decision, K11 (not doing for now) has notDoing:true", () => {
  const K1 = sourcesRead(K.pm);
  const decisionMaking = decisionsOfRead(K1);
  assert.ok(decisionMaking.length >= 5, `expected at least 5 decisions (K10/K11/K12/K20/K30/K40): ${decisionMaking.length}`);
  const no = decisionMaking.map(k => k.no);
  assert.ok(no.includes("K10") && no.includes("K11") && no.includes("K12") && no.includes("K40"));
  const k11 = decisionMaking.find(k => k.no === "K11");
  assert.ok(k11, "K11 not found");
  assert.equal(k11.notDoing, true, "K11's text says 'not doing this for now'");
  assert.equal(k11.status, null, "DECISIONS.md has no 'Status:' line; status should stay null");
  const k10 = decisionMaking.find(k => k.no === "K10");
  assert.equal(k10.notDoing, false);
  assert.equal(k10.file, "DECISIONS.md");
  assert.ok(k10.line >= 1);
});

test("directory (docs/adr/): three files, three decisions; Status: Accepted/Accepted/Rejected read correctly, the rejected one has notDoing:true", () => {
  const { copyPm, kj } = adrCopySetup();
  try {
    const decisionMaking = decisionsOfRead(kj);
    assert.equal(decisionMaking.length, 3, `there are 3 files under docs/adr/: ${JSON.stringify(decisionMaking.map(k => k.file))}`);
    const byNo = Object.fromEntries(decisionMaking.map(k => [k.no, k]));
    assert.ok(byNo["ADR-0001"] && byNo["ADR-0002"] && byNo["ADR-0003"], `no fields: ${Object.keys(byNo)}`);
    assert.equal(byNo["ADR-0001"].status, "accept");
    assert.equal(byNo["ADR-0002"].status, "accept");
    assert.equal(byNo["ADR-0003"].status, "rejected");
    assert.equal(byNo["ADR-0001"].notDoing, false);
    assert.equal(byNo["ADR-0002"].notDoing, false);
    assert.equal(byNo["ADR-0003"].notDoing, true, "Status: Rejected -> notDoing should be true");
    assert.match(byNo["ADR-0001"].file, /^docs\/adr\//);
    assert.match(byNo["ADR-0001"].title, /ADR-0001/);
  } finally { clean(copyPm); }
});

test("a glob (docs/adr/*.md) gives the same three decisions", () => {
  const { copyPm, kj } = adrCopySetup();
  try {
    kj.preread.decisions = "docs/adr/*.md";
    const decisionMaking = decisionsOfRead(kj);
    assert.equal(decisionMaking.length, 3);
  } finally { clean(copyPm); }
});

test("undefined/missing source: decisionsOfRead doesn't crash ([] or throws)", () => {
  assert.deepEqual(decisionsOfRead({ repo: K.repo, ref: "origin/main", preread: {} }), []);
  assert.throws(() => decisionsOfRead({ repo: K.repo, ref: "origin/main", preread: { decisions: "docs/missing" } }));
});

test("verify-setup.mjs: with the docs/adr/ source, the 'decision titles' row reports 3 decisions (3 ADR)", () => {
  const { copyPm } = adrCopySetup();
  try {
    const r = run(path.join(Tool, "verify-setup.mjs"), [copyPm]);
    const line = r.output.split("\n").find(l => l.includes("decision headings"));
    assert.ok(line, "'decision titles' row not found");
    assert.match(line, /\|\s*✓\s*\|/);
    assert.match(line, /3 decisions/);
    assert.match(line, /3 ADR/);
  } finally { clean(copyPm); }
});

test("verify-setup.mjs: robust patterns also print a checkmark row (dropped.opportunity/knowingly, never, issue.our)", () => {
  const r = run(path.join(Tool, "verify-setup.mjs"), [K.pm], { env: gh.env });
  assert.equal(r.code, 0, `stderr: ${r.error}\n${r.output}`);
  for (const ne of ["dropped.opportunity", "dropped.knowingly", "never: logging the card number", "issue.our"]) {
    const line = r.output.split("\n").find(l => l.includes(`| ${ne} |`));
    assert.ok(line, `"${ne}" row was never printed`);
    assert.match(line, /\|\s*✓\s*\|/, `"${ne}" row should have been ✓: ${line}`);
  }
});

test("audit-prd.mjs: with the docs/adr/ source, a reference to ADR-0002 is recognized, a non-existent ADR-0009 is blocked", () => {
  const { copyPm } = adrCopySetup();
  const tmp = temporary("nosy-readdecisions-prd-");
  try {
    const prdPath = path.join(tmp, "prd.md");
    fs.writeFileSync(prdPath,
      "## Problem\n\nCustomers want a feature per decisions ADR-0002 and ADR-0009.\n\n" +
      "## How rivals do it\n\nA rival ships something similar (pm/rivals/example.md).\n\n" +
      "## Scope\n\n- In: a screen per ADR-0002.\n- Out: <>\n\n## Measurement\n\n50%\n\n" +
      "## Backend ↔ screen\n\n| Part | Status |\n|---|---|\n| x | ready |\n\n## Open questions\n\n- ?\n");
    const jsonPath = path.join(tmp, "prd.json");
    const r = run(path.join(Tool, "audit-prd.mjs"), [prdPath, "--pm", copyPm, "--json", jsonPath]);
    const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const findings = j.files[0].findings;
    assert.ok(!findings.some(b => /ADR-0002/.test(b.name)), `ADR-0002 is a known decision, should not be a blocker/warning: ${JSON.stringify(findings)}`);
    assert.ok(findings.some(b => b.level === "blocker" && /Reference not in the decisions: ADR-0009/.test(b.name)),
      `expected a blocker for ADR-0009: ${JSON.stringify(findings)}`);
  } finally { clean(copyPm); clean(tmp); }
});
