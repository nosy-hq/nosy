// Contract test for skill/tools/find-stale.mjs: on a hand-written page, finds a PR the page
// calls "open" that has actually merged, and a decision item the page calls "in flight" that has actually landed
// on main; produces no false positive for a mention already in a closed context like "(on main)".
// The fake page is written in Turkish on purpose: find-stale.mjs's own Turkish-language support (a user's
// product page may describe PR/decision status in Turkish; see skill/data/lang/tr/find-stale.json) is what's
// under test here. The `<!-- pm:auto -->` marker is a hardcoded literal in find-stale.mjs itself (not yet
// moved to that language-data file) — see this migration's final report.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, gh, tmp, output;

const BEFORE_TEXT = "MUST-NOT-CHANGE-title";
const AUTOMATIC_INSIDE = "#503 açık PR, inceleme bekliyor. (otomatik bölüm içi, taranmamalı)";

before(async () => {
  K = await fakeProductSetup();
  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-stale-");
  const page = path.join(tmp, "page.html");
  fs.writeFileSync(page, [
    `<!doctype html><html lang="tr"><body>`,
    `<h1>${BEFORE_TEXT}</h1>`,
    `<section><h2>Şimdi</h2><ul>`,
    `<li>Sevkiyat toplu iptal: #501 açık PR, inceleme bekliyor.</li>`,
    `<li>Fatura arşivi: #502 (main'de) tamamlandı.</li>`,
    `</ul></section>`,
    `<section><h2>Yol haritası</h2><ul>`,
    `<li>K12 m.4 dosya taşıma backend'i yolda, henüz yok.</li>`,
    `<li>K12 m.9 ekran tarafı hâlâ yolda, backend yok.</li>`,
    `</ul></section>`,
    `<!-- pm:auto -->`,
    `<p>${AUTOMATIC_INSIDE}</p>`,
    `<!-- /pm:auto -->`,
    `</body></html>`,
  ].join("\n"));
  const jsonPath = path.join(tmp, "stale.json");
  const r = run(path.join(Tool, "find-stale.mjs"), [K.pm, page, "--json", jsonPath], { env: gh.env });
  assert.equal(r.code, 0, `find-stale: unexpected exit code, stderr: ${r.error}`);
  output = { markdown: r.output, json: JSON.parse(fs.readFileSync(jsonPath, "utf8")), pageAfter: fs.readFileSync(page, "utf8") };
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

test("the page is never modified", () => {
  assert.match(output.pageAfter, new RegExp(BEFORE_TEXT));
  assert.match(output.pageAfter, new RegExp(AUTOMATIC_INSIDE.replace(/[.()#]/g, m => "\\" + m)));
});

test("a PR the page calls 'open' but has actually merged is found", () => {
  const b = output.json.findings.find(x => x.ref === "#501");
  assert.ok(b, "no #501 finding");
  assert.equal(b.type, "PR status");
  assert.match(b.not, /merged/);
});

test("a number in an already-closed context like '(on main)' doesn't produce a false positive", () => {
  assert.ok(!output.json.findings.some(x => x.ref === "#502"), "#502 (on main) produced a false positive");
});

test("a reference inside the auto section is never scanned", () => {
  assert.ok(!output.json.findings.some(x => x.ref === "#503"), "#503 was inside the auto section, should not have been scanned");
});

test("a decision item said to be 'in flight' but that has landed on main (K12 m.4) is found", () => {
  const b = output.json.findings.find(x => x.ref === "K12 m.4");
  assert.ok(b, "no K12 m.4 finding");
  assert.equal(b.type, "Said in flight, but on main");
});

test("an item genuinely still in flight (K12 m.9, no commits at all) produces no finding", () => {
  assert.ok(!output.json.findings.some(x => x.ref === "K12 m.9"), "K12 m.9 should produce no finding while it has no commits yet");
});
