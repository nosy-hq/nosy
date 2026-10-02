// Contract tests for auto-section.mjs's language and shareable-output rules.
//  - the fixed phrases live in skill/data/lang/<code>/auto-section.json; English is the default and renders as before,
//    Turkish ships with it, `--lang` / sources.json `language` pick one, an unknown language is English with one stderr line;
//  - the block goes onto a page the team (and sometimes Cloud) reads: nothing from the owner's own unpushed work
//    (branch names, authors, commit subjects, psst's dropped list and correction text, detail lines) may appear in it.
// The input state is hand-written here, like auto-section.test.mjs: this test doesn't depend on the tools that write it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { section, phrases, generatedOf } from "../tools/auto-section.mjs";

const iso = "2026-09-30T10:15:00.000Z";
const slots = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
const flat = (o, prefix = "") => Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);
const unstamp = html => html.replace(/data-generated="[^"]*"/, 'data-generated="-"'); // the block's own generation time differs on every call
const textOf = html => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

// A pm/ whose state has every box the section can draw, with names that must never come out.
const SECRETS = ["zeynep-reporter", "ahmet-author", "wip/zeynep-private", "private-subject-xyz", "feat/ahmet-mine", "dropped-item-xyz", "detail-line-xyz", "correction-xyz", "OWNER-PRS-LEAK"];
function pmSetup(language) {
  const pm = path.join(temporary("nosy-autolang-"), "pm"), st = path.join(pm, "state");
  fs.mkdirSync(st, { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(st, f), JSON.stringify(o, null, 1));
  w("lowhanging.json", { type: "lowHanging", generated: iso, ref: "origin/main", items: [
    { score: 5, effort: "S", type: "Backend ready, not on screen", title: "Pricing plans", evidence: "src/a.ts:3", detail: ["detail-line-xyz"], ref: null },
    { score: 4, effort: "M", type: "Issue opened against us", title: "#12 Export", evidence: "zeynep-reporter · 2026-09-01", detail: ["detail-line-xyz"], ref: "#12" },
    { score: 3, effort: "S", type: "Matrix: backend ready", title: "Parked thing", evidence: "x", detail: [], ref: null },
    { score: 2, effort: "S", type: "Matrix: backend ready", title: "Started thing", evidence: "y", detail: [], ref: null }] });
  w("status.json", { type: "state", generated: iso, range: "--since 2026-09-01 00:00 origin/main", main: 4, pr: 2, lastMain: "abc1234",
    prs: [{ n: 7, t: "Add SSO", a: "ahmet-author", draft: true, count: 2, last: "01.10 09:00" }],
    groups: [{ ref: "K99", n: 2, where: ["main", "#7"], who: ["ahmet-author"], last: "01.10 10:00", topic: "sso topic" }], dependency: 0, withoutReference: 3,
    noRemote: true, localBranches: [{ branch: "wip/zeynep-private", ahead: 2, last: "01.10", author: "zeynep-reporter", subject: "private-subject-xyz", refs: [] }] });
  w("stale.json", { type: "stale", generated: iso, page: "page.html", findings: [{ type: "PR status", ref: "#7", lines: [10], not: "#7 merged; the page says open." }] });
  w("waves.json", { type: "waves", generated: iso, waves: [{ name: "Now", tasks: [{ title: "Pricing plans", checked: "weakened", effort: "M",
    reason_now: "checked by psst (corrected: correction-xyz, written on feat/ahmet-mine) · a.ts:1" }] }] });
  w("psst-final.json", { type: "psstFinal", generated: iso, stats: { stands: 2, weakened: 1, refuted: 1, fromReading: 1 },
    items: [{ title: "Pricing plans", verdict: "weakened", fix: "correction-xyz: already written on a local unpushed branch feat/ahmet-mine", size: "M" }, { title: "Export", verdict: "stands", size: "S" }],
    dropped: [{ title: "dropped-item-xyz", why: "refuted: branch wip/zeynep-private already has it" }] });
  w("receipts.json", { type: "psstReceipts", generated: iso, items: [
    { title: "Parked thing", gate: { held: true, because: [{ at: "src/m.ts:2", refs: ["#385"], decisions: ["K3"] }] }, local: [] },
    { title: "Started thing", gate: null, inProgress: true, local: [{ branch: "feat/ahmet-mine", author: "ahmet-author", strength: "strong" }] }] });
  w("team-next.json", { found: "found automatically", files: ["docs/NEXT.md"], items: [{ title: "Ship the thing", file: "docs/NEXT.md", line: 4, date: "2026-09-29" }] });
  // The checked list must be newer than the raw list, or it isn't shown as checked.
  const now = Date.now() / 1000; fs.utimesSync(path.join(st, "lowhanging.json"), now - 100, now - 100); fs.utimesSync(path.join(st, "psst-final.json"), now, now);
  if (language) fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ language }));
  return pm;
}
const pageOf = pm => { const page = path.join(path.dirname(pm), "page.html"); fs.writeFileSync(page, "<h1>X</h1>\n<!-- pm:auto -->\nold\n<!-- /pm:auto -->\n<footer>f</footer>"); return page; };

const made = [];
const make = language => { const pm = pmSetup(language); made.push(path.dirname(pm)); return pm; };
after(() => made.forEach(clean));

test("the language files carry the same phrases with the same {slots}", () => {
  const en = flat(phrases("en")), tr = flat(phrases("tr"));
  assert.deepEqual(tr.map(([k]) => k), en.map(([k]) => k), "tr has the same keys as en, in the same order");
  for (const [k, v] of en) assert.equal(slots(tr.find(x => x[0] === k)[1]), slots(v), `slots of ${k}`);
  assert.equal(phrases("en").locale, "en-US");
  assert.equal(phrases("tr").locale, "tr-TR");
});

test("English is the default and renders English phrases; explicit en and en-US say the same", () => {
  const pm = make();
  const at = new Date("2026-10-02T13:15:00Z"), a = section(pm, { now: at }), b = section(pm, { lang: "en", now: at }), c = section(pm, { lang: "en-US", now: at });
  assert.equal(b, a); assert.equal(c, a);
  const t = textOf(a);
  for (const x of ["Automatic · script output", "What shipped today, what's cheap", "Next product decision", "Checked this week", "On the team's own list", "Delivery", "Low-hanging fruit (full list)", "May be stale", "since Sep 1"]) assert.ok(t.includes(x), x);
  assert.ok(!/tarihinden|Teslimat/.test(a));
});

test("--lang tr renders the Turkish phrases (and Turkish dates), keeps the data as it is", () => {
  const pm = make(), page = pageOf(pm);
  const r = run(path.join(Tool, "auto-section.mjs"), [pm, page, "--lang", "tr"]);
  assert.equal(r.code, 0, r.error); assert.equal(r.error, "");
  const fresh = fs.readFileSync(page, "utf8"), t = textOf(fresh);
  for (const x of ["Otomatik · betik çıktısı", "Sıradaki ürün kararı", "Bu hafta kontrol edilenler", "Ekibin kendi listesinde", "Teslimat", "Düşük asılan meyve (tam liste)", "Eskimiş olabilir", "tarihinden beri", "oluşturuldu"]) assert.ok(t.includes(x), x);
  assert.ok(t.includes("Pricing plans") && t.includes("K99") && t.includes("sso topic"), "titles and refs are data, not phrases");
  assert.ok(!t.includes("Next product decision") && !t.includes("Low-hanging fruit"), "no English heading is left");
  assert.ok(fresh.includes("<h1>X</h1>") && fresh.includes("<footer>f</footer>"), "the page outside the markers is untouched");
});

test("sources.json `language` is used when --lang is absent; the flag wins when both are there", () => {
  const pm = make("tr"), page = pageOf(pm);
  assert.equal(run(path.join(Tool, "auto-section.mjs"), [pm, page]).code, 0);
  assert.ok(fs.readFileSync(page, "utf8").includes("Teslimat"), "language: tr in sources.json gave the Turkish block");
  const r = run(path.join(Tool, "auto-section.mjs"), [pm, page, "--lang", "en"]);
  assert.equal(r.code, 0, r.error);
  assert.ok(fs.readFileSync(page, "utf8").includes("Delivery") && !fs.readFileSync(page, "utf8").includes("Teslimat"), "--lang en beats sources.json");
});

test("a language with no phrase file is English, with one line on stderr", () => {
  const pm = make(), page = pageOf(pm);
  const r = run(path.join(Tool, "auto-section.mjs"), [pm, page, "--lang", "de"]);
  assert.equal(r.code, 0, r.error);
  const lines = r.error.trim().split("\n");
  assert.equal(lines.length, 1, `one stderr line, got: ${r.error}`);
  assert.match(lines[0], /no phrases for language "de".*using English/);
  const written = fs.readFileSync(page, "utf8").match(/<!-- pm:auto -->[\s\S]*<!-- \/pm:auto -->/)[0];
  assert.equal(unstamp(written), unstamp(section(pm)), "the block is the English one");
  // A path-shaped code is never read as a file name.
  const bad = run(path.join(Tool, "auto-section.mjs"), [pm, page, "--lang", "../../etc"]);
  assert.equal(bad.code, 0); assert.match(bad.error, /using English/);
});

test("--lang without a value is a usage error", () => {
  const pm = make(), page = pageOf(pm);
  const r = run(path.join(Tool, "auto-section.mjs"), [pm, page, "--lang"]);
  assert.equal(r.code, 1); assert.match(r.error, /Usage: node auto-section\.mjs .*\[--lang <code>\]/);
});

for (const lang of ["en", "tr"]) {
  test(`shareable (${lang}): no branch, author, commit subject, dropped item, correction text or detail line reaches the block`, () => {
    const pm = make(), html = section(pm, { lang });
    assert.ok(html.length > 1000, "the block was built");
    for (const s of SECRETS) assert.ok(!html.includes(s), `"${s}" must not appear`);
    assert.ok(!/unpushed|refuted|held|local/i.test(textOf(html)), "no local-work wording");
    // What stays: titles, sizes, counts.
    const t = textOf(html);
    assert.ok(t.includes("Pricing plans") && t.includes("Export") && t.includes("Add SSO") && t.includes("sso topic"), "titles of work stay");
    assert.ok(t.includes("2") && /\b1\b/.test(t));
  });
}

test("shareable: how many items a decision parks or that are already underway is a count; nothing says where or by whom", () => {
  const pm = make(), t = textOf(section(pm));
  assert.ok(t.includes("1 left off: a decision parks them."), t);
  assert.ok(t.includes("1 already in progress."), t);
  assert.ok(!t.includes("Parked thing"), "the parked item is off the list");
  const tr = textOf(section(pm, { lang: "tr" }));
  assert.ok(tr.includes("1 madde listede yok") && tr.includes("1 madde zaten yapılıyor"), tr);
});

test("shareable: the next decision shows title and size, not the reason text (it can carry a correction or a branch)", () => {
  const pm = make(), t = textOf(section(pm));
  assert.match(t, /Next product decision Pricing plans M Checked against the code\./);
  assert.ok(!t.includes("correction-xyz"));
});

// ---- the generation time: an ISO stamp on the block, the same in every language ----
for (const lang of ["en", "tr"]) {
  test(`the block carries its generation time as an ISO stamp (${lang}); the markers are the old ones`, () => {
    const pm = make(), at = new Date("2026-10-02T13:15:00Z"), html = section(pm, { lang, now: at });
    assert.ok(html.startsWith("<!-- pm:auto -->\n") && html.endsWith("\n<!-- /pm:auto -->"), "the old markers still wrap the block");
    assert.match(html, /<section id="auto" data-generated="2026-10-02T13:15:00\.000Z">/);
    assert.equal(generatedOf(html).toISOString(), "2026-10-02T13:15:00.000Z");
    assert.ok(Math.abs(generatedOf(section(pm, { lang })) - Date.now()) < 5000, "the default is the time of the call");
  });
}

test("generatedOf: null for a block from an older Nosy (no stamp), for text in words, and for a value that is not an ISO time", () => {
  assert.equal(generatedOf('<section id="auto"><p>generated 30 Sep 13:15 / oluşturuldu 30 Eyl 13:15</p></section>'), null);
  assert.equal(generatedOf('<section id="auto" data-generated="30 Eyl">x</section>'), null);
  assert.equal(generatedOf('<section id="auto" data-generated="2026-13-45T99:99:99Z">x</section>'), null);
  assert.equal(generatedOf(""), null); assert.equal(generatedOf(null), null);
  // A stamp-shaped attribute on something that is not the block's section is not read.
  assert.equal(generatedOf('<div data-generated="2026-10-02T13:15:00Z">x</div>'), null);
});

test("the CLI rewrites a page that carries the OLD marker without the attribute: the block is replaced and gets the stamp; the page around it is untouched", () => {
  const pm = make(), page = pageOf(pm), before = fs.readFileSync(page, "utf8");
  assert.ok(!before.includes("data-generated"), "the old page has no stamp");
  assert.equal(run(path.join(Tool, "auto-section.mjs"), [pm, page, "--lang", "tr"]).code, 0);
  const after = fs.readFileSync(page, "utf8");
  assert.ok(generatedOf(after.slice(after.indexOf("<!-- pm:auto -->"))), "the stamp is on the page now");
  assert.equal(after.split("<!-- pm:auto -->")[0], before.split("<!-- pm:auto -->")[0]);
  assert.equal(after.split("<!-- /pm:auto -->")[1], before.split("<!-- /pm:auto -->")[1]);
  // A second run replaces the block (one block, one stamp), it does not add another.
  assert.equal(run(path.join(Tool, "auto-section.mjs"), [pm, page]).code, 0);
  const twice = fs.readFileSync(page, "utf8");
  assert.equal((twice.match(/<!-- pm:auto -->/g) || []).length, 1); assert.equal((twice.match(/data-generated=/g) || []).length, 1);
});
