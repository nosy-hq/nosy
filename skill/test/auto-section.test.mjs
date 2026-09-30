// Contract test for skill/tools/auto-section.mjs: content BETWEEN the <!-- pm:auto --> markers changes,
// content OUTSIDE them is preserved byte for byte; if the marker is missing, content is inserted before <footer>.
// The input (status.json/lowhanging.json) is hand-produced here (this script's test shouldn't depend on
// collect-status/lowhanging's correctness).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

function pmSetup() {
  const pm = path.join(temporary("nosy-otobolum-"), "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "status.json"), JSON.stringify({
    type: "state", generated: new Date().toISOString(), range: "--since 2020-01-01 00:00 origin/main",
    main: 3, pr: 0, lastMain: "abc1234", prs: [],
    groups: [{ ref: "K99-IMZA", n: 1, where: ["main"], who: ["Test"], last: "01.01 10:00", topic: "imza-topic-XYZ" }],
    dependency: 0, withoutReference: 1,
  }, null, 1));
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({
    type: "lowHanging", generated: new Date().toISOString(), ref: "origin/main",
    items: [{ score: 2, effort: "S", type: "Test type", title: "imza-item-XYZ", evidence: "evidence", detail: [] }],
  }, null, 1));
  return pm;
}

let pm1;
before(() => { pm1 = pmSetup(); });
after(() => clean(path.dirname(pm1)));

test("content between the markers changes, content outside is preserved byte for byte", () => {
  const page = path.join(path.dirname(pm1), "page.html");
  const Before = "<header>DEGISMEMELI-BASLIK-12345</header>";
  const After = "<footer>DEGISMEMELI-ALTBILGI-67890</footer>";
  fs.writeFileSync(page, `${Before}\n<!-- pm:auto -->\nOLD-PLACEHOLDER\n<!-- /pm:auto -->\n${After}`);

  const r = run(path.join(Tool, "auto-section.mjs"), [pm1, page]);
  assert.equal(r.code, 0, `unexpected exit code: ${r.error}`);

  const fresh = fs.readFileSync(page, "utf8");
  assert.ok(fresh.includes(Before), "the header outside the marker must not change");
  assert.ok(fresh.includes(After), "the footer outside the marker must not change");
  assert.ok(!fresh.includes("old-placeholder"), "the old placeholder should have been deleted");
  assert.ok(fresh.includes("imza-topic-XYZ"), "status.json's data should appear in the new section");
  assert.ok(fresh.includes("imza-item-XYZ"), "lowhanging.json's data should appear in the new section");
  assert.ok(fresh.includes("<!-- pm:auto -->") && fresh.includes("<!-- /pm:auto -->"), "the markers should be preserved");
});

test("if the marker is missing, content is inserted before <footer>, the rest of the page is preserved", () => {
  const page = path.join(path.dirname(pm1), "page2.html");
  const Head = "<header>BASKA-DEGISMEMELI-BASLIK</header>";
  const FOOTER = "<footer>SON-ALTBILGI</footer>";
  fs.writeFileSync(page, `${Head}\n${FOOTER}`);

  const r = run(path.join(Tool, "auto-section.mjs"), [pm1, page]);
  assert.equal(r.code, 0, `unexpected exit code: ${r.error}`);
  assert.match(r.output, /no marker/);

  const fresh = fs.readFileSync(page, "utf8");
  assert.ok(fresh.includes(Head));
  assert.ok(fresh.includes(FOOTER));
  assert.ok(fresh.indexOf("imza-topic-XYZ") < fresh.indexOf(FOOTER), "content should be inserted before <footer>");
});

test("errors with exit code 1 when both the marker and <footer> are missing", () => {
  const page = path.join(path.dirname(pm1), "page3.html");
  fs.writeFileSync(page, "<p>neither marker nor footer</p>");
  const r = run(path.join(Tool, "auto-section.mjs"), [pm1, page]);
  assert.equal(r.code, 1);
});
