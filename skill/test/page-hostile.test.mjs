// Everything the generated pages show comes from files in pm/ (matrix cells, rival names and evidence written from
// web research, state/*.json). It is text, never markup: a rival called `<img src=https://tracker...>` must show up as
// that text, load nothing, and run nothing. These tests feed hostile strings through the decision page (server side and
// the script that draws the matrix in the browser) and the scoreboard.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { page } from "../tools/scoreboard.mjs";
import { esc, safeUrl } from "../tools/html-safe.mjs";

const IMG = "<img src=https://tracker.example.test/p.png onerror=alert(1)>";
const SCRIPT = "<script>alert(2)</script>";
const QUOTE = "\"><svg onload=alert(3)>";
const HOSTILE = [IMG, SCRIPT, QUOTE, "x' onmouseover='alert(4)"];
const JS_LINK = "[click](javascript:alert(5))";

const dirs = [];
after(() => dirs.forEach(clean));

// What a browser fetches on load (same rule as pages-offline.test.mjs): stylesheets, scripts, images, fonts, frames, CSS url().
function requests(html) {
  const out = [];
  for (const m of html.matchAll(/<(link|script|img|iframe|source|video|audio|embed|object)\b[^>]*>/gi)) if (/\b(?:href|src|data)\s*=\s*["']?(?:https?:)?\/\//i.test(m[0])) out.push(m[0].slice(0, 120));
  for (const m of html.matchAll(/url\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi)) out.push(m[0]);
  for (const m of html.matchAll(/@import\s+(?:url\()?["']?(?:https?:)?\/\/[^;]*/gi)) out.push(m[0]);
  return out;
}
// Runs the page's inline script against a stub document; returns what it wrote into each table's innerHTML.
function drawn(html) {
  const m = html.match(/<script>([\s\S]*)<\/script>/); assert.ok(m, "no <script> block on the page");
  const els = {}; const document = { getElementById: id => (els[id] ||= { innerHTML: "" }) };
  vm.runInNewContext(m[1], { document });
  return Object.fromEntries(Object.entries(els).map(([k, v]) => [k, v.innerHTML]));
}
// Only the plain table markup the page itself writes, with plain quoted attributes: anything else is data that became markup.
const OK_TAG = /^<\/?(table|thead|tbody|tr|th|td|span|i|b|div)(\s+(class|title|style)="[^"<>]*")*\s*\/?>$/i;
function strayMarkup(html) {
  const bad = [...html.matchAll(/<[^>]*>/g)].map(m => m[0]).filter(t => !OK_TAG.test(t));
  if (html.replace(/<[^>]*>/g, "").includes("<")) bad.push("(a lone < in text)");
  return bad;
}

// An event-handler attribute on a real tag (attribute values are blanked first: "onerror=" inside a quoted title is text).
const handlers = html => [...html.matchAll(/<[a-z][^>]*>/gi)].map(m => m[0].replace(/"[^"]*"|'[^']*'/g, '""')).filter(t => /\son[a-z]+\s*=/i.test(t));

let K, out;
before(async () => {
  K = await fakeProductSetup(); dirs.push(K.root);
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [K.pm]).code, 0);
  const file = path.join(K.pm, "matrix.json"), M = JSON.parse(fs.readFileSync(file, "utf8"));
  M.steps[0].name = `Shipment ${IMG}`; M.steps[1].name = SCRIPT; M.steps[2].no = QUOTE;
  M.biz.name = `Cargo ${QUOTE}`; M.biz.notes["1"] = IMG;
  M.products[0].name = `Rival ${IMG}`; M.products[0].category = `logistics ${SCRIPT}`;
  M.products[0].codes["1"].evidence = QUOTE; M.products[0].codes["2"].k = `y" onmouseover="alert(6)`;
  M.products[0].announcementText = `${IMG} ${JS_LINK}`; M.products[0].announcementSeverity = "high"; M.products[0].announcementReason = SCRIPT;
  M.products[0].location = `${IMG}\n${JS_LINK}`;
  M.products[1].name = `${QUOTE}`; M.products[1].status = IMG; M.products[1].statusType = "closed";
  fs.writeFileSync(file, JSON.stringify(M));
  const riv = path.join(K.pm, "rivals", "sevkpro.md");
  fs.writeFileSync(riv, fs.readFileSync(riv, "utf8").replace("## Loop matrix", `**Price:** ${IMG} ${JS_LINK}\n**Delivery format:** ${SCRIPT}\n\n## Patterns we will take\n- ${IMG}\n- ${JS_LINK}\n\n## Loop matrix`));
  fs.appendFileSync(path.join(K.pm, "summary.md"), `\n\n## ${SCRIPT}\n- ${IMG}\n- ${JS_LINK}\n- [ok](https://example.com/ok)\n`);
  fs.appendFileSync(path.join(K.pm, "decisions.md"), `\n## ${IMG}\n${QUOTE} ${JS_LINK}\n`);
  fs.appendFileSync(path.join(K.pm, "log.md"), `\n## ${SCRIPT}\n${IMG}\n`);
  const st = path.join(K.pm, "state"); fs.mkdirSync(st, { recursive: true });
  fs.writeFileSync(path.join(st, "status.json"), JSON.stringify({ range: "--since 2026-09-01 x y", main: IMG, pr: 1, lastMain: SCRIPT, generated: "2026-09-28T10:00:00Z", withoutReference: SCRIPT,
    groups: [{ ref: IMG, n: QUOTE, topic: SCRIPT, where: [IMG], last: "09.28 10:29 PM" }], prs: [{ n: IMG, t: QUOTE, a: SCRIPT, count: IMG, draft: false, last: IMG }] }));
  fs.writeFileSync(path.join(st, "lowhanging.json"), JSON.stringify({ ref: IMG, generated: "2026-09-28T10:00:00Z", items: [{ type: SCRIPT, title: QUOTE, score: IMG, effort: IMG, evidence: SCRIPT }] }));
  fs.writeFileSync(path.join(st, "stale.json"), JSON.stringify({ page: IMG, generated: "2026-09-28T10:00:00Z", findings: [{ type: IMG, ref: SCRIPT, lines: [QUOTE], not: IMG }] }));
  fs.writeFileSync(path.join(st, "waves.json"), JSON.stringify({ waves: [{ name: "Now", tasks: [{ title: IMG, effort: SCRIPT, checked: true }] }], owner_decision_of: [{ title: QUOTE }], outside: [{ title: SCRIPT, reason: IMG }] }));
  fs.writeFileSync(path.join(st, "psst-final.json"), JSON.stringify({ generated: "2026-09-28T10:00:00Z", stats: { stands: IMG, weakened: 0, refuted: 0 }, items: [{ title: IMG, size: SCRIPT }], dropped: [] }));
  out = path.join(temporary("nosy-hostile-page-"), "page.html"); dirs.push(path.dirname(out));
  const r = run(path.join(Tool, "build-page.mjs"), [K.pm, out]);
  assert.equal(r.code, 0, r.error);
  out = fs.readFileSync(out, "utf8");
});

test("html-safe: esc covers & < > \" ' and safeUrl keeps only http(s)", () => {
  assert.equal(esc(`<a href="x" title='y'>&`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;");
  assert.equal(esc(null), ""); assert.equal(esc(7), "7");
  assert.equal(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  for (const u of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.example/x", "https://a.example/\" onclick=\"x", " ", null]) assert.equal(safeUrl(u), "", String(u));
});

test("decision page: hostile text never becomes an element, an attribute or a request", () => {
  const body = out.replace(/<script>[\s\S]*<\/script>/, "");
  assert.equal((out.match(/<script\b/gi) || []).length, 1, "the only script is the page's own");
  assert.doesNotMatch(body, /<img\b/i); assert.doesNotMatch(body, /<script/i);
  assert.equal((body.match(/<svg\b/gi) || []).length, 1, "the only svg is Nosy's own mark");
  assert.deepEqual(handlers(body), []);
  assert.doesNotMatch(body, /href\s*=\s*["']?\s*javascript:/i);
  assert.match(body, /&lt;img src=/, "the text itself is shown, as text");
  assert.deepEqual(requests(out), []);
  assert.doesNotMatch(out, /<link\b/i);
});

test("decision page: a real https link in markdown still works", () => {
  assert.match(out, /<a href="https:\/\/example\.com\/ok">ok<\/a>/);
});

test("decision page: the matrix script escapes names, evidence and codes when it draws the tables", () => {
  const d = drawn(out);
  assert.ok(d.mx.length > 500 && d.cov.length > 200 && d.h2h.length > 100, "the tables were drawn");
  for (const [id, html] of Object.entries(d)) assert.deepEqual(strayMarkup(html), [], `${id}: data became markup`);
  assert.match(d.mx, /&lt;img src=/); assert.match(d.cov, /&lt;svg onload=/);
  assert.deepEqual(handlers(d.mx + d.cov + d.h2h), []);
  assert.deepEqual(requests(d.mx + d.cov + d.h2h), []);
});

test("decision page: a clean matrix still draws the same tables with the same tag set", async () => {
  const C = await fakeProductSetup(); dirs.push(C.root);
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [C.pm]).code, 0);
  const f = path.join(temporary("nosy-clean-page-"), "p.html"); dirs.push(path.dirname(f));
  assert.equal(run(path.join(Tool, "build-page.mjs"), [C.pm, f]).code, 0);
  const d = drawn(fs.readFileSync(f, "utf8"));
  for (const html of Object.values(d)) assert.deepEqual(strayMarkup(html), []);
  assert.match(d.mx, /Shipment list/); assert.match(d.cov, /SevkPro/); assert.match(d.mx, /class="d d-y"/);
});

test("scoreboard: hostile request titles, teams, numbers and bets stay text", () => {
  const root = temporary("nosy-hostile-score-"); dirs.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "shipped.json"), JSON.stringify({ repo: `acme/${IMG}`, branch: QUOTE, window: { from: IMG, to: "2026-09-28" }, generated: "2026-09-28T10:00:00Z", linkTypes: ["closes", "mentions", "timeline"],
    counts: { requests: IMG, open: SCRIPT, byTeam: { [IMG]: QUOTE } },
    shipped: [{ ref: IMG, title: SCRIPT, team: QUOTE, link: IMG, prs: [{ n: IMG }], opened: "2026-09-01", landed: "2026-09-10", days: IMG, measure: { line: IMG, event: { name: SCRIPT, existsInCode: true } } }],
    undecided: [{ ref: IMG, title: SCRIPT, team: QUOTE, ageDays: IMG }], undecidedScope: { minAge: IMG, read: SCRIPT },
    waiting: [{ ref: IMG, title: QUOTE, ageDays: SCRIPT, opened: "2026-09-01" }],
    recent: { since: "2026-09-20", merged: [{ n: IMG, title: SCRIPT, ref: QUOTE, merged: "2026-09-21" }], close: [{ n: SCRIPT, title: IMG, why: QUOTE }] } }));
  fs.writeFileSync(path.join(pm, "state", "score.json"), JSON.stringify({ calibration: { n: 9, onTarget: IMG, under: SCRIPT, over: QUOTE },
    bets: [{ id: IMG, bet: SCRIPT, estimate: QUOTE, status: IMG, placed: "2026-09-01", landed: true, actual: SCRIPT, days: IMG, calendarDays: SCRIPT, revertedBy: IMG, patchedBy: [SCRIPT], possibleFollowUps: [QUOTE], expected: IMG }] }));
  const html = page(pm, { minN: 1 });
  for (const re of [/<img\b/i, /<svg\b/i, /<script\b/i, /javascript:/i]) assert.doesNotMatch(html, re, String(re));
  assert.deepEqual(handlers(html), []);
  assert.match(html, /&lt;img src=/);
  assert.deepEqual(requests(html), []);
});

test("auto-section and the first screen (glance) escape their numbers and text too", () => {
  const html = out.slice(out.indexOf("<!-- pm:auto -->"), out.indexOf("<!-- /pm:auto -->"));
  assert.ok(html.length > 500, "the auto section is on the page");
  assert.doesNotMatch(html, /<img\b/i); assert.doesNotMatch(html, /<script/i); assert.doesNotMatch(html, /<svg/i);
  const glance = out.slice(out.indexOf('<div class="glance">'), out.indexOf("<nav"));
  assert.ok(glance.length > 300);
  assert.doesNotMatch(glance, /<img\b/i); assert.doesNotMatch(glance, /<script/i); assert.doesNotMatch(glance, /<svg/i);
});
