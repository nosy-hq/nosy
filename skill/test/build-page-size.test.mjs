// Contract tests for internal request 93 (build-page.mjs's size guardrail):
// - the "Cycle log" section only inlines the tail of log.md (thresholds.mjs's logTailKB budget), with a
//   note naming how many earlier entries were omitted; the full history stays in pm/log.md, untouched.
// - a matrix cell's evidence, embedded in the page's <script> for tooltips, is capped per cell.
// - when the built page is still over thresholds.mjs's pageMaxKB, build-page.mjs prints a warning (stderr)
//   listing the biggest blocks, but always writes the page (never blocks).
// Fake product "Cargo"; build-matrix.mjs runs first so matrix.json is in the shape build-page.mjs reads
// (products:[{file,codes:{no:{k,evidence}}}]), same pattern as matrix-page.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let K, htmlPath, output;

before(async () => {
  K = await fakeProductSetup();
  const r1 = run(path.join(Tool, "build-matrix.mjs"), [K.pm]);
  assert.equal(r1.code, 0, `build-matrix: ${r1.error}`);

  // A log.md with many sections, each comfortably over thresholds.mjs's default logTailKB (40 KB) once
  // they're all added up, so only the most recent ones should make it onto the page.
  const sections = [];
  for (let i = 0; i < 40; i++) sections.push(`## Cycle ${i}\n- ${"filler ".repeat(200)}entry ${i} marker.\n`);
  fs.writeFileSync(path.join(K.pm, "log.md"), `# Cycle log\n\n${sections.join("\n")}`);

  // A single very long evidence string on a real matrix cell (build-matrix's own output already has real
  // cells; stretch one of them so the tooltip-cap has something to actually cap).
  const M = JSON.parse(fs.readFileSync(path.join(K.pm, "matrix.json"), "utf8"));
  const longEvidence = "https://example.test/evidence " + "word ".repeat(200) + "END-OF-EVIDENCE";
  M.products[0].codes["1"] = { k: "y", evidence: longEvidence };
  fs.writeFileSync(path.join(K.pm, "matrix.json"), JSON.stringify(M, null, 1));

  // Force the guardrail to fire regardless of the fake product's actual size.
  const kj = JSON.parse(fs.readFileSync(path.join(K.pm, "sources.json"), "utf8"));
  kj.threshold = { pageMaxKB: 1 };
  fs.writeFileSync(path.join(K.pm, "sources.json"), JSON.stringify(kj, null, 1));

  htmlPath = path.join(temporary("nosy-page-size-"), "cargo.html");
  const r2 = run(path.join(Tool, "build-page.mjs"), [K.pm, htmlPath]);
  output = r2;
  output.html = fs.readFileSync(htmlPath, "utf8");
});
after(() => { clean(K.root); clean(path.dirname(htmlPath)); });

test("build-page.mjs still writes the page and exits 0 even though the guardrail is tripped", () => {
  assert.equal(output.code, 0, `unexpected exit code: ${output.error}`);
  assert.ok(fs.existsSync(htmlPath));
});

test("the Cycle log section only inlines the tail of log.md, with a note naming the omitted count; the file itself is untouched", () => {
  assert.match(output.html, /earlier one(?:s)? omitted from the page/, "expected an 'omitted' note in the Cycle log section");
  assert.match(output.html, /pm\/log\.md/);
  // The most recent section should be on the page, the earliest shouldn't.
  assert.match(output.html, /Cycle 39/, "the latest cycle should be inlined");
  assert.doesNotMatch(output.html, /Cycle 0</, "the earliest cycle shouldn't be inlined");
  const rawLog = fs.readFileSync(path.join(K.pm, "log.md"), "utf8");
  assert.match(rawLog, /Cycle 0\b/, "pm/log.md itself should still have the full history");
  assert.match(rawLog, /Cycle 39\b/);
});

test("a matrix cell's tooltip evidence is capped, not the full string, in the page's <script> data", () => {
  assert.doesNotMatch(output.html, /END-OF-EVIDENCE/, "the full long evidence string shouldn't be inlined verbatim");
  assert.match(output.html, /example\.test\/evidence/, "the start of the evidence should still be there (for the tooltip)");
  assert.match(output.html, /…/, "a truncated evidence string should end with an ellipsis");
});

test("over thresholds.mjs's pageMaxKB, build-page.mjs warns on stderr with the biggest blocks", () => {
  assert.match(output.error, /warning:.*over the 1 KB guardrail \(thresholds\.mjs pageMaxKB\)/);
  assert.match(output.error, /KB — /, "expected at least one named block in the warning");
});

test("without the threshold override, the default pageMaxKB (300) doesn't warn on Cargo's normal small page", async () => {
  const K2 = await fakeProductSetup();
  const r1 = run(path.join(Tool, "build-matrix.mjs"), [K2.pm]);
  assert.equal(r1.code, 0, `build-matrix: ${r1.error}`);
  const htmlPath2 = path.join(temporary("nosy-page-size-default-"), "cargo.html");
  try {
    const r2 = run(path.join(Tool, "build-page.mjs"), [K2.pm, htmlPath2]);
    assert.equal(r2.code, 0, `build-page: ${r2.error}`);
    assert.doesNotMatch(r2.error, /warning:/, `didn't expect a size warning on the small fake product: ${r2.error}`);
  } finally { clean(K2.root); clean(path.dirname(htmlPath2)); }
});
