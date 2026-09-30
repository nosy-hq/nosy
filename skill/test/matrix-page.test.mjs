// Contract test for the build-matrix.mjs + build-page.mjs pipeline:
// matrix.json is built from pm/rivals/*.md + pm/us.json, then a page is built from it;
// the page's <script> should pass `node --check` without depending on the DOM (syntax validity).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, gh, output, htmlPath;

before(async () => {
  K = await fakeProductSetup(); // pm/rivals/{sevkpro,yolcu360}.md + pm/us.json come ready
  gh = fakeGhSetup(K.gh); // only needed because the last (todo) test runs lowhanging; keep it off the network
  const r1 = run(path.join(Tool, "build-matrix.mjs"), [K.pm]);
  assert.equal(r1.code, 0, `build-matrix: unexpected exit code: ${r1.error}`);
  output = { matrixAggregate: r1.output };
  htmlPath = path.join(temporary("nosy-page-"), "cargo.html");
  const r2 = run(path.join(Tool, "build-page.mjs"), [K.pm, htmlPath]);
  assert.equal(r2.code, 0, `build-page: unexpected exit code: ${r2.error}`);
  output.pageGenerate = r2.output;
  output.html = fs.readFileSync(htmlPath, "utf8");
});
after(() => { clean(K.root); clean(gh.dir); clean(path.dirname(htmlPath)); });

test("build-matrix reads the two rivals and the shared step count correctly", () => {
  assert.match(output.matrixAggregate, /2 products/);
  const M = JSON.parse(fs.readFileSync(path.join(K.pm, "matrix.json"), "utf8"));
  assert.equal(M.products.length, 2);
  assert.equal(M.steps.length, 4);
  assert.ok(M.products.some(u => u.name === "SevkPro"));
});

test("a page is built, is a reasonable size, and contains the product/rival names", () => {
  assert.ok(fs.existsSync(htmlPath));
  assert.ok(output.html.length > 2000, "the page is much smaller than expected");
  assert.match(output.html, /Cargo/);
  assert.match(output.html, /SevkPro/);
});

test("the <script> inside the page is extracted and validated as valid syntax with node --check", () => {
  const m = output.html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, "no <script> block found on the page");
  const jsPath = path.join(temporary("nosy-js-"), "output.js");
  fs.writeFileSync(jsPath, m[1]);
  const r = spawnSync(process.execPath, ["--check", jsPath], { encoding: "utf8" });
  assert.equal(r.status, 0, `node --check failed: ${r.stderr}`);
  clean(path.dirname(jsPath));
});

// closed in cycle 5 with read-matrix.mjs: the step-shaped matrix.json build-matrix.mjs
// produces ({steps, biz, products:[{name,codes:{no:{k,evidence}}}]}) and Acme Books's line shape
// ({products:[name], lines}) now go through the same reader; lowhanging should also produce a matrix signal
// ("Matrix:" or "Common among rivals") from the step shape.
test("the matrix.json build-matrix produces feeds lowhanging's matrix signal",
  () => {
    // Work on a copy so the shared K.pm isn't changed (matrix.json is already in the NEW/build-matrix shape -
    // this test file's before() just produced it that way).
    const copyPm = temporary("nosy-matrix-compat-");
    try {
      fs.cpSync(K.pm, copyPm, { recursive: true });
      const kj = JSON.parse(fs.readFileSync(path.join(copyPm, "sources.json"), "utf8"));
      kj.matrix = path.join(copyPm, "matrix.json");
      fs.writeFileSync(path.join(copyPm, "sources.json"), JSON.stringify(kj, null, 1));
      const r = run(path.join(Tool, "lowhanging.mjs"), [copyPm], { env: gh.env });
      assert.match(r.output, /Matrix:|Common among rivals/, "expected at least one matrix signal from the step shape too");
    } finally {
      clean(copyPm);
    }
  });
