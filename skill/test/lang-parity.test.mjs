// Language-independence parity harness (28 Sep 2026, pm/log.md "language independence audit").
//
// Nosy's OWN output is English (fine). This file checks something different: when the PRODUCT Nosy is
// managing writes its own docs/commits/decisions in a language other than English or Turkish, do Nosy's
// scripts still find the same things? skill/test/fake-product.mjs's fakeProductSetup() builds a fake
// product "Cargo" with English content; buildFakeProductDe()/buildFakeProductJa() build the SAME repo
// (same K/§/# numbers, same file paths, same git history shape) with the product's own free text
// translated into German ("Kargo") and Japanese ("カーゴ") - see fake-product.mjs's top comment for exactly
// what's translated vs kept structural.
//
// For every command below we run English, German and Japanese through the real script (no shelling
// around the engine - these are the actual tools/*.mjs entry points, same as every other *.test.mjs here)
// and diff the key outputs. Where German/German and/or Japanese silently diverge from English - this
// reproduces the language audit's findings - the gap is recorded as `test.todo(...)`, not fixed or
// papered over: this file's job is to make the bug reproducible and visible in the suite, not to fix
// skill/tools/*.mjs's language handling (that's the follow-up work tracked in pm/log.md). Where the
// signal is genuinely structural (git metadata, K-number extraction, code shape) - and therefore SHOULD be
// language-independent - it's asserted for real; those assertions must keep passing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fakeProductSetup, buildFakeProductDe, buildFakeProductJa } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";
import { decisionsOfRead } from "../tools/read-decisions.mjs";
import { words } from "../tools/text.mjs";
import { read } from "../tools/read-design.mjs";
import { score, report } from "../tools/dresscode.mjs";

let Ken, Kde, Kja, tmp;
const copies = [];
before(async () => {
  Ken = await fakeProductSetup();
  Kde = await buildFakeProductDe();
  Kja = await buildFakeProductJa();
  tmp = temporary("nosy-lang-parity-");
});
after(() => { clean(Ken.root); clean(Kde.root); clean(Kja.root); clean(tmp); copies.forEach(clean); });

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function jsonFor(label) { return path.join(tmp, `${label}-${Math.random().toString(36).slice(2)}.json`); }

// --- helper: minimal standalone git repos for frontyard/plan-gates/dresscode (their own fixture shape,
// same pattern dresscode.test.mjs/plan-gates.test.mjs/frontyard.test.mjs already use - not fake-product.mjs,
// since none of these three read Cargo's decisions/request doc at all). ---
function gitRepo(dir, files) {
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (!fs.existsSync(path.join(dir, ".git"))) g("init", "-q", "-b", "main");
  g("add", "."); g("commit", "-q", "-m", "x");
}
function productOf(prefix) { const root = temporary(prefix); copies.push(root); const repo = path.join(root, "repo"), pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true }); return { root, repo, pm }; }

// =========================================================================================================
// text.mjs - the shared helper 13 tools import (canwe/gather-evidence/audit-prd/build-waves/collect-signals/
// measure-size/dresscode/frontyard/ledger/interview-themes/demand/bet/rival-language). words() drops any
// token with length <= 2 (`w.length > minLength`, minLength defaults to 2) - a reasonable cutoff for
// English/Turkish short stopwords, but most Japanese content words (no spaces, 2-character compounds like
// 配送/移動/請求) are exactly 2 characters and get silently thrown away before any matching happens.
// the language audit cites this as the single highest-leverage fix (text.mjs:41-42).
test("text.mjs words(): a Latin-script phrase keeps its content words (English and German both tokenize fine)", () => {
  assert.deepEqual(words("shipment move"), ["shipment", "move"]);
  assert.deepEqual(words("Sendung verschieben"), ["sendung", "verschieben"]);
});
test.todo("text.mjs words(): Japanese 2-character content words (配送, 移動, 請求) are silently dropped by the default minLength=2 filter, unlike equal-weight English/German words - this is the root cause of every empty Japanese result below (text.mjs:41-42)");

// =========================================================================================================
// read-decisions.mjs - decisionsOfRead(): the shared decision reader canwe/audit-prd/build-waves/
// shipped-record/preread all go through.
test("read-decisions.mjs: the K-number list itself (structural - pulled from '## K<no>' headings) is identical across English/German/Japanese", () => {
  const nums = K => decisionsOfRead(readJson(K.sources), "DECISIONS.md").map(b => b.no);
  const en = nums(Ken), de = nums(Kde), ja = nums(Kja);
  assert.deepEqual(en, ["K10", "K11", "K12", "K20", "K30", "K40"]);
  assert.deepEqual(de, en, "the heading pattern '## K<no>' is language-independent; German should find the same K-numbers");
  assert.deepEqual(ja, en, "the heading pattern '## K<no>' is language-independent; Japanese should find the same K-numbers");
});
test.todo("read-decisions.mjs: NEGATION_RE ('not doing' detection, read-decisions.mjs:22-30) correctly flags K11.notDoing=true in English ('We're not doing route optimization'), but silently returns notDoing=false for the SAME decision in German ('Wir machen die Routenoptimierung vorerst nicht') and Japanese ('ルート最適化は当面やらない') - NEGATION_RE has no German/Japanese phrase family, only English+Turkish");

// =========================================================================================================
// gather-evidence.mjs - rarity-weighted word/concept-group overlap ranking (via text.mjs conceptGroupsOf).
function decisionsSectionOf(output) { return output.split("## Decisions")[1]?.split("## Request doc")[0] || ""; }
test("gather-evidence.mjs (English): the two-word topic 'shipment move' correctly ranks K12 (mentions both words) before K10 (mentions only one)", () => {
  const r = run(path.join(Tool, "gather-evidence.mjs"), [Ken.pm, "shipment move"]);
  assert.equal(r.code, 0, r.error);
  const sec = decisionsSectionOf(r.output);
  const iK12 = sec.indexOf("K12"), iK10 = sec.indexOf("K10");
  assert.ok(iK12 >= 0 && iK10 >= 0 && iK12 < iK10, "K12 should rank before K10");
});
// internal request 103 fix: gather-evidence.mjs's own topic split now goes through text.mjs's words() (script-
// aware length filter, CJK-tokenized via Intl.Segmenter) instead of a hand-rolled ".split(/[\s,]+/).filter(w
// => w.length > 2)" that silently dropped 2-character Japanese query words before anything could be searched
// for. Kept to the weaker "non-empty" claim (not "ranks correctly") - that's what the fix guarantees; a full
// idf-ranking-quality claim for German would need more than this pass's scope.
test("gather-evidence.mjs (German): the equivalent topic 'Sendung verschieben' still finds decisions evidence (not empty)", () => {
  const r = run(path.join(Tool, "gather-evidence.mjs"), [Kde.pm, "Sendung verschieben"]);
  assert.equal(r.code, 0, r.error);
  const sec = decisionsSectionOf(r.output).trim();
  assert.ok(sec && sec !== "—", `expected non-empty Decisions section, got: ${JSON.stringify(sec)}`);
});
test("gather-evidence.mjs (Japanese): the equivalent topic '配送 移動' now finds decisions evidence instead of an EMPTY pack (0 keywords, every section '—') - words() no longer drops the two 2-character query tokens (text.mjs finding above)", () => {
  const r = run(path.join(Tool, "gather-evidence.mjs"), [Kja.pm, "配送 移動"]);
  assert.equal(r.code, 0, r.error);
  const sec = decisionsSectionOf(r.output).trim();
  assert.ok(sec && sec !== "—", `expected non-empty Decisions section, got: ${JSON.stringify(sec)}`);
});

// =========================================================================================================
// canwe.mjs - the "can we do this?" verdict, including read-decisions.mjs's NEGATION_RE via decisionText.
function verdictOf(output) { const m = output.split("Suggested verdict")[1]; return m ? m.split("\n").find(l => l.startsWith("**")) : null; }
test("canwe.mjs (English): asking about route optimization correctly surfaces 'There's a decision: not doing this' (K11)", () => {
  const r = run(path.join(Tool, "canwe.mjs"), [Ken.pm, "can we do route optimization", "route", "optimization"]);
  assert.equal(r.code, 0, r.error);
  assert.match(verdictOf(r.output) || "", /There's a decision: not doing this/);
});
// internal request 104 fix: read-decisions.mjs's decisionsOfRead()/canwe.mjs's negationRegexFor(K) now take
// sources.json's `glossary.notDoing` (the product's OWN not-doing words/phrases, in its own language) on top
// of the EN+TR core. Two cases per language, matching the fix's actual shape:
//  - a glossary is given -> canwe cites the not-doing decision by ref, same as English.
//  - no glossary is given -> read-decisions.mjs can't confirm K11's status in this language (statusReadable:
//    false), so canwe must say so explicitly - NEVER the old "Not now: no trace in the code" (a decision
//    genuinely exists right there in the evidence; the wrongness of claiming "no trace" is the worst failure
//    mode the audit found, because it reads as confident and specific, not as "nothing found").
function pmWithGlossary(K, glossary, tag) {
  const dir = temporary(`nosy-lang-canwe-${tag}-`); copies.push(dir);
  fs.cpSync(K.pm, dir, { recursive: true });
  const srcPath = path.join(dir, "sources.json");
  const src = readJson(srcPath);
  src.glossary = { ...(src.glossary || {}), ...glossary };
  fs.writeFileSync(srcPath, JSON.stringify(src, null, 1));
  return dir;
}
test("canwe.mjs (German, with a glossary): 'Routenoptimierung' cites the not-doing decision (K11), same as English, once sources.json has glossary.notDoing for the German phrasing", () => {
  const pm = pmWithGlossary(Kde, { notDoing: ["vorerst nicht"] }, "de-with");
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "können wir Routenoptimierung machen", "Routenoptimierung"]);
  assert.equal(r.code, 0, r.error);
  const v = verdictOf(r.output) || "";
  assert.match(v, /There's a decision: not doing this/);
  assert.doesNotMatch(v, /no trace/);
});
test("canwe.mjs (German, no glossary): 'Routenoptimierung' says the decision's status couldn't be read in this language - never 'no trace', since K11 is right there in the evidence", () => {
  const r = run(path.join(Tool, "canwe.mjs"), [Kde.pm, "können wir Routenoptimierung machen", "Routenoptimierung"]);
  assert.equal(r.code, 0, r.error);
  const v = verdictOf(r.output) || "";
  assert.match(v, /couldn't be read in this language/);
  assert.match(v, /K11/);
  assert.doesNotMatch(v, /no trace/);
});
test("canwe.mjs (Japanese, with a glossary): 'ルート最適化' cites the not-doing decision (K11), same as English, once sources.json has glossary.notDoing for the Japanese phrasing", () => {
  const pm = pmWithGlossary(Kja, { notDoing: ["当面やらない"] }, "ja-with");
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "ルート最適化はできますか", "ルート最適化"]);
  assert.equal(r.code, 0, r.error);
  const v = verdictOf(r.output) || "";
  assert.match(v, /There's a decision: not doing this/);
  assert.doesNotMatch(v, /no trace/);
});
test("canwe.mjs (Japanese, no glossary): 'ルート最適化' says the decision's status couldn't be read in this language - never 'no trace', since K11 is right there in the evidence", () => {
  const r = run(path.join(Tool, "canwe.mjs"), [Kja.pm, "ルート最適化はできますか", "ルート最適化"]);
  assert.equal(r.code, 0, r.error);
  const v = verdictOf(r.output) || "";
  assert.match(v, /couldn't be read in this language/);
  assert.match(v, /K11/);
  assert.doesNotMatch(v, /no trace/);
});

// =========================================================================================================
// canwe.mjs - REFUSAL_RE/ACCESS_WORDS (the language audit #8): a small standalone
// repo (not Cargo - these two checks read the CODE around the anchor term, not the decisions doc) with a
// German comment explaining a refusal, and a German-only access question. "Prefer code shape over words":
// a structural guard (an HTTP 404 status literal on the anchor's own line) drives the verdict even with zero
// glossary; sources.json's `glossary.refusal`/`glossary.access` (flat arrays, same shape as glossary.notDoing)
// let the WORDED line be read too, once given.
function canweCodeFixtureOf(prefix, extraSources = {}) {
  const { repo, pm } = productOf(prefix);
  gitRepo(repo, {
    "backend/kep.go": `package kep

// KEP wird hier absichtlich nicht unterstützt
func Provider(name string) (int, error) {
	if name == "kep" { return 404 }
	return 200
}
`,
    "backend/internal/access/zugang.go": `package access

// Der Zugang für externe Mandanten wird hier entschieden.
func Allowed() bool { return true }
`,
  });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", ...extraSources }, null, 1));
  return pm;
}
// The question is kept to just the anchor word(s) themselves (no surrounding German sentence): canwe.mjs's
// anchor picker keeps only the 3 RAREST topic-word groups (by file count, ascending), and a German filler
// word ("wir", "können", "für") that appears in ZERO code files is just as "rare" (0 files) as the real
// anchor - a full German sentence would crowd "kep"/"zugang" out of the top 3 with noise words, which is a
// property of the anchor picker itself (unaffected by this fix), not of the refusal/access detection under
// test here.
test("canwe.mjs (German, no glossary.refusal): a structural 404 guard on the anchor's OWN line drives 'not doing this' even though the German comment next to it matches no word list", () => {
  const pm = canweCodeFixtureOf("nosy-lang-canwe-code-de-none-");
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "KEP", "kep"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /kep\.go:\d+\s+if name == "kep" \{ return 404 \}/);
  assert.match(r.output, /structural: a status\/false\/disabled guard/);
  const v = verdictOf(r.output) || "";
  assert.match(v, /There's a decision: not doing this/);
});
test("canwe.mjs (German, with glossary.refusal): the German refusal COMMENT itself is now also read and ranks as a real (non-structural) hit", () => {
  const pm = canweCodeFixtureOf("nosy-lang-canwe-code-de-with-", { glossary: { refusal: ["nicht unterstützt"] } });
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "KEP", "kep"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /nicht unterstützt/);
  const v = verdictOf(r.output) || "";
  assert.match(v, /There's a decision: not doing this/);
});
test("canwe.mjs (German, no glossary.access, no ACCESS_WORDS in the question): the Access layer section still shows up from structural evidence (an authz-shaped file path near the anchor), marked as structural", () => {
  const pm = canweCodeFixtureOf("nosy-lang-canwe-access-de-none-");
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "Zugang Mandanten", "zugang", "mandanten"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /### Access layer/);
  assert.match(r.output, /didn't match an access\/portal pattern in this language/);
  assert.match(r.output, /internal\/access\/zugang\.go/);
});
test("canwe.mjs (German, with glossary.access): the same German access question is recognized by word directly, no structural-fallback note", () => {
  const pm = canweCodeFixtureOf("nosy-lang-canwe-access-de-with-", { glossary: { access: ["zugang"] } });
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "Zugang Mandanten", "zugang", "mandanten"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /### Access layer/);
  assert.doesNotMatch(r.output, /didn't match an access\/portal pattern/);
  assert.match(r.output, /internal\/access\/zugang\.go/);
});

// =========================================================================================================
// audit-prd.mjs --pm - "Refers to a rejected decision", driven by decisionByNo.get(k).notDoing,
// which is itself driven by read-decisions.mjs's statusReadable/glossary.notDoing.
function prdCheck(K, pmOverride, tag) {
  const p = path.join(tmp, `prd-${K.locale}${tag ? `-${tag}` : ""}.md`);
  fs.writeFileSync(p, "# PRD\n\n## Scope\nIn: K11 route optimization revisit.\n");
  const j = jsonFor(`audit-prd-${K.locale}${tag ? `-${tag}` : ""}`);
  run(path.join(Tool, "audit-prd.mjs"), [p, "--pm", pmOverride || K.pm, "--json", j]);
  return readJson(j).files[0].findings.map(f => f.name);
}
test("audit-prd.mjs --pm (English): a PRD referencing K11 (a 'not doing' decision) gets the 'Refers to a rejected decision: K11' warning", () => {
  const names = prdCheck(Ken);
  assert.ok(names.includes("Refers to a rejected decision: K11"), names.join(", "));
});
// internal request 104/106 fix: read-decisions.mjs's statusReadable is now surfaced by audit-prd.mjs itself -
// a language it can't recognize at all (no glossary.notDoing) gets an explicit "not verifiable" note instead
// of a silent pass; giving sources.json a glossary.notDoing gets the SAME "Refers to a rejected decision"
// warning English gets.
test("audit-prd.mjs --pm (German, with glossary.notDoing): the SAME PRD (referencing K11) gets the 'Refers to a rejected decision: K11' warning, same as English", () => {
  const pm = pmWithGlossary(Kde, { notDoing: ["vorerst nicht"] }, "de-prd-with");
  const names = prdCheck(Kde, pm, "with");
  assert.ok(names.includes("Refers to a rejected decision: K11"), names.join(", "));
  assert.ok(!names.includes("Decision status not verifiable in this language"), names.join(", "));
});
test("audit-prd.mjs --pm (German, no glossary): never a silent pass - says the decision status couldn't be verified in this language, instead of pretending K11 doesn't contradict the PRD", () => {
  const names = prdCheck(Kde, null, "without");
  assert.ok(!names.includes("Refers to a rejected decision: K11"), names.join(", "));
  assert.ok(names.includes("Decision status not verifiable in this language"), names.join(", "));
});
test("audit-prd.mjs --pm (Japanese, with glossary.notDoing): the SAME PRD gets the 'Refers to a rejected decision: K11' warning, same as English", () => {
  const pm = pmWithGlossary(Kja, { notDoing: ["当面やらない"] }, "ja-prd-with");
  const names = prdCheck(Kja, pm, "with");
  assert.ok(names.includes("Refers to a rejected decision: K11"), names.join(", "));
  assert.ok(!names.includes("Decision status not verifiable in this language"), names.join(", "));
});
test("audit-prd.mjs --pm (Japanese, no glossary): never a silent pass - says the decision status couldn't be verified in this language", () => {
  const names = prdCheck(Kja, null, "without");
  assert.ok(!names.includes("Refers to a rejected decision: K11"), names.join(", "));
  assert.ok(names.includes("Decision status not verifiable in this language"), names.join(", "));
});

// =========================================================================================================
// audit-prd.mjs's own PRD-quality checks - STRONG_RE/VAGUE_RE/SOLUTION_RE/SIZE_RE/
// AGAINST_RE had ZERO non-English coverage (not even Turkish, unlike every other check-list in the codebase).
function langPrdOf(problemLine, measurementLine, tag) {
  const p = path.join(tmp, `prd-quality-${tag}.md`);
  fs.writeFileSync(p, `# PRD\n\n## Problem\n${problemLine}\n\n## How rivals do it\nn/a\n\n## Scope\n- In: x\n- Out: y\n\n` +
    `## Backend ↔ screen\n| Piece | Owned by | Status |\n|---|---|---|\n| x | team | ready |\n\n## Measurement\n${measurementLine}\n\n## Open questions\n1. x?\n`);
  return p;
}
// glossaryPrd: { vague: [...], solution: [...] } - flattened to sources.json's actual "<check>:<word>" array
// shape (glossary.prd stays a flat array of strings, like glossary.notDoing/glossary.design - internal
// request 106; see audit-prd.mjs's prdGlossaryMap for why: K.glossary is read generically by other tools).
function pmLangOnly(glossaryPrd, lang, tag) {
  const dir = temporary(`nosy-lang-prd-${tag}-`); copies.push(dir);
  fs.mkdirSync(dir, { recursive: true });
  const flat = glossaryPrd ? Object.entries(glossaryPrd).flatMap(([k, ws]) => ws.map(w => `${k}:${w}`)) : null;
  fs.writeFileSync(path.join(dir, "sources.json"), JSON.stringify({ language: lang, ...(flat ? { glossary: { prd: flat } } : {}) }));
  return dir;
}
function auditRun(prdPath, pmDir) {
  const j = jsonFor(`audit-quality-${path.basename(prdPath)}`);
  const args = [prdPath, "--json", j]; if (pmDir) args.push("--pm", pmDir);
  const r = run(path.join(Tool, "audit-prd.mjs"), args);
  assert.equal(r.code, 0, r.error);
  return readJson(j).files[0].findings.map(f => f.name);
}
test("audit-prd.mjs (German, with glossary.prd): German vague/solution words are flagged the same way as their English equivalents, no 'not available' note", () => {
  const pm = pmLangOnly({ vague: ["einfach", "schnell"], solution: ["hinzufügen", "Schaltfläche", "Seite"] }, "de", "de-quality-with");
  const p = langPrdOf("Wir fügen eine Schaltfläche auf der Seite hinzu.", "Das muss einfach und schnell sein.", "de-with");
  const names = auditRun(p, pm);
  assert.ok(names.some(n => n.startsWith("Solution smuggling")), names.join(", "));
  assert.ok(names.some(n => n.startsWith("Vague measurement word")), names.join(", "));
  // only the two checks that WERE given a glossary run for real; the others (against/size, no glossary given,
  // no equivalent language in this PRD either) still honestly say they're not available - that's correct, not
  // a bug, so only these two specific notes are asserted absent.
  assert.ok(!names.includes("Vague-word check not available in de"), names.join(", "));
  assert.ok(!names.includes("Solution-smuggling check not available in de"), names.join(", "));
});
test("audit-prd.mjs (German, no glossary.prd): says the vague-word and solution-smuggling checks aren't available in German, instead of silently reporting a clean PRD full of vague/solution language", () => {
  const pm = pmLangOnly(null, "de", "de-quality-without");
  const p = langPrdOf("Wir fügen eine Schaltfläche auf der Seite hinzu.", "Das muss einfach und schnell sein.", "de-without");
  const names = auditRun(p, pm);
  assert.ok(names.includes("Vague-word check not available in de"), names.join(", "));
  assert.ok(names.includes("Solution-smuggling check not available in de"), names.join(", "));
  assert.ok(!names.some(n => n.startsWith("Vague measurement word")), names.join(", "));
  assert.ok(!names.some(n => n.startsWith("Solution smuggling")), names.join(", "));
});
test("audit-prd.mjs (Japanese, with glossary.prd): Japanese vague/solution words are flagged the same way as their English equivalents, no 'not available' note", () => {
  const pm = pmLangOnly({ vague: ["簡単", "速い"], solution: ["追加", "ボタン", "ページ"] }, "ja", "ja-quality-with");
  const p = langPrdOf("ページにボタンを追加します。", "簡単で速い必要があります。", "ja-with");
  const names = auditRun(p, pm);
  assert.ok(names.some(n => n.startsWith("Solution smuggling")), names.join(", "));
  assert.ok(names.some(n => n.startsWith("Vague measurement word")), names.join(", "));
  assert.ok(!names.includes("Vague-word check not available in ja"), names.join(", "));
  assert.ok(!names.includes("Solution-smuggling check not available in ja"), names.join(", "));
});
test("audit-prd.mjs (Japanese, no glossary.prd): says the vague-word and solution-smuggling checks aren't available in Japanese, instead of silently reporting a clean PRD", () => {
  const pm = pmLangOnly(null, "ja", "ja-quality-without");
  const p = langPrdOf("ページにボタンを追加します。", "簡単で速い必要があります。", "ja-without");
  const names = auditRun(p, pm);
  assert.ok(names.includes("Vague-word check not available in ja"), names.join(", "));
  assert.ok(names.includes("Solution-smuggling check not available in ja"), names.join(", "));
  assert.ok(!names.some(n => n.startsWith("Vague measurement word")), names.join(", "));
  assert.ok(!names.some(n => n.startsWith("Solution smuggling")), names.join(", "));
});

// =========================================================================================================
// measure-size.mjs - similar-work lookup (via text.mjs conceptGroupsOf) vs. the topic's OWN history (git-only).
function sizeCheck(K, topic) {
  const j = jsonFor(`size-${K.locale}`);
  const r = run(path.join(Tool, "measure-size.mjs"), [K.pm, topic, "--day", "60", "--json", j]);
  assert.equal(r.code, 0, r.error);
  return readJson(j);
}
test("measure-size.mjs: a topic's OWN history (git commit/active-day/file counts for K12, structural) is identical across English/German/Japanese", () => {
  const en = sizeCheck(Ken, "K12 file-move backend");
  const de = sizeCheck(Kde, "K12 Backend für Dateiverschiebung");
  const ja = sizeCheck(Kja, "K12 ファイル移動バックエンド");
  const strip = o => ({ active_day: o.own.active_day, commit: o.own.commit, file: o.own.file });
  assert.deepEqual(strip(de), strip(en), "K12's own commit history is read from git, not from the topic's language - should match English");
  assert.deepEqual(strip(ja), strip(en), "K12's own commit history is read from git, not from the topic's language - should match English");
});
test("measure-size.mjs (English/German): both find similar past work (word-overlap concept groups still resolve for Latin-script content)", () => {
  const en = sizeCheck(Ken, "K12 file-move backend");
  const de = sizeCheck(Kde, "K12 Backend für Dateiverschiebung");
  assert.ok(en.similar.length > 0, "English should find similar items");
  assert.ok(de.similar.length > 0, "German should also find similar items (Latin-script word overlap still works)");
});
// internal request 103 fix: measure-size.mjs's own conceptGroupsOf() wrapper calls text.mjs's shared
// conceptGroupsOf/words()/root(), which now tokenizes CJK script with Intl.Segmenter (keeping 2-character
// words) and matches CJK query words as a plain substring (text.mjs's matchRe: the old word-start lookbehind
// assumed a space-separated boundary before every word, which never exists between two adjacent CJK
// characters - see text.mjs's matchRe comment) instead of requiring one. Where English/German used to find
// several similar items and Japanese found zero, Japanese now finds at least one too.
test("measure-size.mjs (Japanese): the same topic in Japanese ('K12 ファイル移動バックエンド') now finds similar work (not zero, unlike before this fix)", () => {
  const ja = sizeCheck(Kja, "K12 ファイル移動バックエンド");
  assert.ok(ja.similar.length > 0, "Japanese should find at least one similar item");
});

// =========================================================================================================
// build-waves.mjs - the "outside" (deliberately-not-doing) list, driven by pm/matrix.json's own `decision:
// "notDoing"` FIELD (a structural JSON value fake-product.mjs sets directly, not parsed from prose) - a
// genuinely language-independent path, unlike canwe/audit-prd/read-decisions' prose-based NEGATION_RE above.
function wavesOutsideOf(K) {
  const gh = fakeGhSetup(K.gh);
  const lowJson = jsonFor(`low-${K.locale}`);
  const rLow = run(path.join(Tool, "lowhanging.mjs"), [K.pm, "--json", lowJson], { env: gh.env });
  assert.equal(rLow.code, 0, rLow.error);
  fs.mkdirSync(path.join(K.pm, "state"), { recursive: true });
  fs.copyFileSync(lowJson, path.join(K.pm, "state", "lowhanging.json"));
  const wavesJson = jsonFor(`waves-${K.locale}`);
  const r = run(path.join(Tool, "build-waves.mjs"), [K.pm, "--json", wavesJson]);
  assert.equal(r.code, 0, r.error);
  clean(gh.dir);
  return readJson(wavesJson);
}
test("build-waves.mjs: the matrix's structural decision:\"notDoing\" field (not prose) puts exactly one item in 'outside', in every language, with the same wave names", () => {
  const en = wavesOutsideOf(Ken), de = wavesOutsideOf(Kde), ja = wavesOutsideOf(Kja);
  const NAMES = ["Now", "When code lands", "Needs backend", "Open requests", "Documentation fix", "After"];
  for (const w of [en, de, ja]) { const names = w.waves.map(d => d.name); for (const n of NAMES) assert.ok(names.includes(n)); }
  assert.equal(en.outside.length, 1); assert.equal(de.outside.length, 1); assert.equal(ja.outside.length, 1);
  assert.equal(en.outside[0].source, "matrix.json"); assert.equal(de.outside[0].source, "matrix.json"); assert.equal(ja.outside[0].source, "matrix.json");
});

// =========================================================================================================
// dresscode.mjs / read-design.mjs - the design-doc reader: ~60 English-only heading/check regexes
// (dresscode.mjs:172-277) over the product's OWN design docs. Not part of fake-product.mjs (Cargo has no
// design system); mirrors dresscode.test.mjs's own small "apps/web" fixture, translated.
const DIRECTION_EN = `# Direction

## Goals

| # | Goal | Problem and evidence | Success signal |
|---|---|---|---|
| G1 | **An operator finds a shipment in one click.** | Support tickets, 12 Sep. | Search is on every page. |

### Non-goals

- A public component library.

## Principles, in the order they win

| # | Principle | What it decides | Kept | Broken |
|---|---|---|---|---|
| P1 | **A person approves.** | AI surfaces | A proposal card. | An auto-apply switch. |

## Scope

| Area | Status | Depth |
|---|---|---|
| apps/web | **Included** | Full |
`;
const DIRECTION_DE = `# Richtung

## Ziele

| # | Ziel | Problem und Beleg | Erfolgssignal |
|---|---|---|---|
| G1 | **Eine Bedienerin findet eine Sendung mit einem Klick.** | Support-Tickets, 12. Sep. | Suche ist auf jeder Seite. |

### Nicht-Ziele

- Eine öffentliche Komponentenbibliothek.

## Prinzipien, in der Reihenfolge, in der sie gewinnen

| # | Prinzip | Was es entscheidet | Eingehalten | Gebrochen |
|---|---|---|---|---|
| P1 | **Eine Person genehmigt.** | KI-Vorschläge | Eine Vorschlagskarte. | Ein Auto-Apply-Schalter. |

## Geltungsbereich

| Bereich | Status | Tiefe |
|---|---|---|
| apps/web | **Enthalten** | Voll |
`;
const DIRECTION_JA = `# 方向性

## 目標

| # | 目標 | 問題と根拠 | 成功シグナル |
|---|---|---|---|
| G1 | **オペレーターが一回のクリックで配送を見つける。** | サポートチケット、9月12日。 | 検索がすべてのページにある。 |

### 非目標

- 公開コンポーネントライブラリ。

## 原則(優先順位順)

| # | 原則 | 何を決めるか | 守られた例 | 破られた例 |
|---|---|---|---|---|
| P1 | **人が承認する。** | AI提案 | 提案カード。 | 自動適用スイッチ。 |

## 範囲

| 領域 | 状態 | 深さ |
|---|---|---|
| apps/web | **含む** | フル |
`;
function designProductOf(direction, prefix, glossaryDesign, lang) {
  const { repo, pm } = productOf(prefix);
  gitRepo(repo, { "apps/web/DESIGN.md": "# Design\n", "apps/web/docs/design-system/DIRECTION.md": direction });
  const src = { repo, ref: "main" };
  if (lang) src.language = lang;
  if (glossaryDesign) src.glossary = { design: glossaryDesign };
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(src));
  return pm;
}
test("read-design.mjs (English): finds the Goals/Principles/Scope headings and counts the Included scope row", () => {
  const m = read(designProductOf(DIRECTION_EN, "nosy-lang-dc-en-"));
  assert.deepEqual(m.goals.map(g => g.id), ["G1"]);
  assert.deepEqual(m.principles.map(p => p.id), ["P1"]);
  assert.equal(m.scope.included, 1);
  assert.equal(m.headings_unrecognized, false, "an English design doc is always recognized by the EN core");
});
// internal request 105 fix: read-design.mjs's goals/principles/scope extraction now takes sources.json's
// `glossary.design` (the product's own section-name words), merged with the EN+TR core - same shape as
// read-decisions.mjs's glossary.notDoing. glossary.design stays a FLAT array of
// "<field>:<word>" strings (see read-design.mjs's designGlossaryMap) - K.glossary is read generically by
// several other tools, so a nested object here would break them.
const DE_DESIGN_GLOSSARY = ["goals:Ziele", "principles:Prinzipien", "scope:Geltungsbereich", "included:Enthalten"];
test("read-design.mjs (German, with glossary.design): the SAME direction document, translated, finds Goals/Principles/Scope exactly like English", () => {
  const m = read(designProductOf(DIRECTION_DE, "nosy-lang-dc-de-with-", DE_DESIGN_GLOSSARY));
  assert.deepEqual(m.goals.map(g => g.id), ["G1"]);
  assert.deepEqual(m.principles.map(p => p.id), ["P1"]);
  assert.equal(m.scope.included, 1);
  assert.equal(m.headings_unrecognized, false);
});
test("read-design.mjs (German, no glossary): section names aren't recognized - goals/principles/scope stay empty/0, but the model says so and lists the doc's OWN headings (with line numbers), instead of silently claiming the system is undocumented", () => {
  const m = read(designProductOf(DIRECTION_DE, "nosy-lang-dc-de-without-", null, "de"));
  assert.deepEqual(m.goals, []);
  assert.deepEqual(m.principles, []);
  assert.deepEqual(m.scope, { included: 0, deferred: 0, excluded: 0, line: 0 });
  assert.equal(m.headings_unrecognized, true);
  assert.ok(m.all_headings.length > 0, "the doc's own headings should still be listed for the agent");
  assert.ok(m.all_headings.some(h => /Ziele/.test(h)), m.all_headings.join(" | "));
});
const JA_DESIGN_GLOSSARY = ["goals:目標", "principles:原則", "scope:範囲", "included:含む"];
test("read-design.mjs (Japanese, with glossary.design): the SAME direction document, translated, finds Goals/Principles/Scope exactly like English", () => {
  const m = read(designProductOf(DIRECTION_JA, "nosy-lang-dc-ja-with-", JA_DESIGN_GLOSSARY));
  assert.deepEqual(m.goals.map(g => g.id), ["G1"]);
  assert.deepEqual(m.principles.map(p => p.id), ["P1"]);
  assert.equal(m.scope.included, 1);
  assert.equal(m.headings_unrecognized, false);
});
test("read-design.mjs (Japanese, no glossary): section names aren't recognized - never a silent 'undocumented' claim, headings are listed instead", () => {
  const m = read(designProductOf(DIRECTION_JA, "nosy-lang-dc-ja-without-", null, "ja"));
  assert.deepEqual(m.goals, []);
  assert.equal(m.headings_unrecognized, true);
  assert.ok(m.all_headings.some(h => /目標/.test(h)), m.all_headings.join(" | "));
});

// =========================================================================================================
// dresscode.mjs itself - its ~60 area checks read m.goals/m.principles/m.scope (and,
// document-wide, m.headings_unrecognized) from read-design.mjs above; this proves the fix reaches dresscode's
// own report, not just the reader's model: "?" (unknown), never a false "missing" ✗, when the language isn't
// recognized, and the same ready/partial shape as English once a glossary is given.
test("dresscode.mjs (German, with glossary.design): Goals is never falsely 'missing' - it has real evidence, like English", () => {
  const pm = designProductOf(DIRECTION_DE, "nosy-lang-dc2-de-with-", DE_DESIGN_GLOSSARY);
  const P = score(pm, {});
  const goalsArea = P.fields.find(a => a.name === "Goals");
  assert.notEqual(goalsArea.status, "missing", JSON.stringify(goalsArea));
  assert.ok(goalsArea.done > 0);
});
test("dresscode.mjs (German, no glossary): Goals/Principles/Scope are marked unknown ('?'), never a false 'missing' claim, and the report lists the doc's headings for the agent to map", () => {
  const pm = designProductOf(DIRECTION_DE, "nosy-lang-dc2-de-without-", null, "de");
  const P = score(pm, {});
  assert.equal(P.headings_unrecognized, true);
  for (const name of ["Goals", "Principles", "Scope"]) {
    const a = P.fields.find(x => x.name === name);
    assert.equal(a.status, "unknown", `${name} should be unknown ("?"), not missing ("✗") - status was ${a.status}`);
    assert.ok(a.checks.every(c => c.unknown || c.evidence), `every unresolved ${name} check should carry unknown:true`);
  }
  const o = report(P);
  assert.match(o, /not recognized in de/);
  assert.match(o, /Ziele/);
});
test("dresscode.mjs (Japanese, no glossary): same unknown ('?') behavior as German - never a false 'missing' claim", () => {
  const pm = designProductOf(DIRECTION_JA, "nosy-lang-dc2-ja-without-", null, "ja");
  const P = score(pm, {});
  assert.equal(P.headings_unrecognized, true);
  const goalsArea = P.fields.find(a => a.name === "Goals");
  assert.equal(goalsArea.status, "unknown");
  const o = report(P);
  assert.match(o, /not recognized in ja/);
  assert.match(o, /目標/);
});

// =========================================================================================================
// frontyard.mjs - promise-language detection on the landing page (Phrase regex, frontyard.mjs:30): English +
// a Turkish glossary, now extended by sources.json's `glossary.landing`, plus
// structural signals (disabled controls, waitlist forms, dead #-anchors) that read the same in any language.
function frontyardCheckOf(readme, prefix, extraSources = {}) {
  const { repo, pm } = productOf(prefix);
  gitRepo(repo, { "README.md": readme, "src/feature.js": "export const x = 1;\n" });
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", frontyard: { path: "README.md", day: 60 }, ...extraSources }));
  const j = jsonFor(`fy-${prefix}`);
  const r = run(path.join(Tool, "frontyard.mjs"), [pm, "--json", j]);
  assert.equal(r.code, 0, r.error);
  return readJson(j);
}
test("frontyard.mjs (English): a 'coming soon' promise on the page is flagged", () => {
  const R = frontyardCheckOf("# Acme\n\nBulk export: coming soon.\n", "nosy-lang-fy-en-");
  assert.equal(R.phrases.length, 1);
  assert.match(R.phrases[0], /coming soon/);
  assert.equal(R.phrasesNote, null);
});
test("frontyard.mjs (German, with glossary.landing): 'demnächst verfügbar' is flagged the same as English 'coming soon', once sources.json has glossary.landing for it", () => {
  const R = frontyardCheckOf("# Acme\n\nMassenexport: demnächst verfügbar.\n", "nosy-lang-fy-de-with-",
    { language: "de", glossary: { landing: ["demnächst verfügbar"] } });
  assert.equal(R.phrases.length, 1);
  assert.match(R.phrases[0], /demnächst verfügbar/);
  assert.equal(R.phrasesNote, null);
});
test("frontyard.mjs (German, no glossary): the same promise isn't recognized by word (no built-in German phrase, no plain-text structural signal on a markdown page), but the script says so explicitly instead of silently reporting a clean page", () => {
  const R = frontyardCheckOf("# Acme\n\nMassenexport: demnächst verfügbar.\n", "nosy-lang-fy-de-without-", { language: "de" });
  assert.equal(R.phrases.length, 0);
  assert.deepEqual(R.structuralPromises, []);
  assert.match(R.phrasesNote || "", /checked in "de"/);
});
test("frontyard.mjs (Japanese, with glossary.landing): '近日公開' is flagged the same as English 'coming soon'", () => {
  const R = frontyardCheckOf("# Acme\n\n一括エクスポート: 近日公開。\n", "nosy-lang-fy-ja-with-",
    { language: "ja", glossary: { landing: ["近日公開"] } });
  assert.equal(R.phrases.length, 1);
  assert.match(R.phrases[0], /近日公開/);
  assert.equal(R.phrasesNote, null);
});
test("frontyard.mjs (Japanese, no glossary): the equivalent promise is never flagged by word, but the script says so explicitly instead of silently passing", () => {
  const R = frontyardCheckOf("# Acme\n\n一括エクスポート: 近日公開。\n", "nosy-lang-fy-ja-without-", { language: "ja" });
  assert.equal(R.phrases.length, 0);
  assert.match(R.phrasesNote || "", /checked in "ja"/);
});
test("frontyard.mjs: a disabled control / waitlist-only form / dead #-anchors is flagged STRUCTURALLY even with zero promise WORDS anywhere, in any language - no 'not checked' note once a structural signal fires", () => {
  const R = frontyardCheckOf(
    '# Acme\n\n<button disabled>Massenexport</button>\n\n<form><input type="email" name="subscribe"></form>\n\n<a href="#">Mehr</a><a href="#">Info</a>\n',
    "nosy-lang-fy-structural-", { language: "de" });
  assert.equal(R.phrases.length, 0);
  assert.ok(R.structuralPromises.length >= 2, JSON.stringify(R.structuralPromises));
  assert.equal(R.phrasesNote, null);
});

// =========================================================================================================
// plan-gates.mjs - billing/gate code detection is keyed off English library/identifier conventions
// (stripe/isPro/checkout/etc, which stay English by real-world convention regardless of product language) -
// a translated CODE COMMENT next to the same identifiers should not change the result. This is the
// "actually fine, because it reads code shape not prose" control case the language audit documents.
function planGatesOf(comment, prefix) {
  const { repo, pm } = productOf(prefix);
  gitRepo(repo, {
    "src/billing/stripe.ts": `${comment}\nimport Stripe from "stripe";\nexport const stripe = new Stripe(process.env.KEY);\n`,
    "src/features/export/ExportButton.tsx": 'export function ExportButton({ user }) {\n  if (!hasFeature(user, "export")) return null;\n  return "csv";\n}\n',
  });
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main" }));
  const j = jsonFor(`pg-${prefix}`);
  const r = run(path.join(Tool, "plan-gates.mjs"), [pm, "--json", j]);
  assert.equal(r.code, 0, r.error);
  return readJson(j).fields;
}
test("plan-gates.mjs: a translated code COMMENT next to the same (English-convention) billing identifiers doesn't change the result - English, German and Japanese comments all give the identical (empty) field list", () => {
  const en = planGatesOf("// billing setup", "nosy-lang-pg-en-");
  const de = planGatesOf("// Abrechnungseinrichtung", "nosy-lang-pg-de-");
  const ja = planGatesOf("// 請求設定", "nosy-lang-pg-ja-");
  assert.deepEqual(de, en, "a German code comment shouldn't change plan-gates' result - it reads identifiers, not comments");
  assert.deepEqual(ja, en, "a Japanese code comment shouldn't change plan-gates' result - it reads identifiers, not comments");
});

// =========================================================================================================
// scan-metrics.mjs - AARRR Steps' event/route-name detection (internal request 107, the language audit
// §1 "scan-metrics.mjs:28-40 Steps"): the analytics SDK CALL itself (posthog.capture(...) etc) is code shape,
// found regardless of language; only the MAPPING of the event/route NAME to a step (signup/activation/...) is
// language-dependent. sources.json's `glossary.metrics` is a flat "field:word" array (K.glossary is read
// generically by half a dozen other tools - a nested object would break them; see read-design.mjs's
// glossary.design for the same shape).
function metricsProductOf(routeFile, eventName, prefix, extra = {}) {
  const { repo, pm } = productOf(prefix);
  gitRepo(repo, {
    "package.json": '{"dependencies":{"posthog-js":"1.0.0"}}\n',
    [routeFile]: `export function Page() {\n  posthog.capture("${eventName}");\n}\n`,
  });
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", ...extra }));
  const j = jsonFor(`metrics-${prefix}`);
  const r = run(path.join(Tool, "scan-metrics.mjs"), [pm, "--json", j]);
  assert.equal(r.code, 0, r.error);
  return readJson(j);
}
const acquisitionOf = R => R.steps.find(a => a.id === "record");

test("scan-metrics.mjs (German, with glossary.metrics): 'Anmeldung' route/event maps to Acquisition, same as English - never '?'", () => {
  const R = metricsProductOf("src/pages/anmeldung.tsx", "benutzer_anmeldung_abgeschlossen", "nosy-lang-mx-de-with-",
    { language: "de", glossary: { metrics: ["signup:anmeldung"] } });
  const a = acquisitionOf(R);
  assert.equal(a.status, "measured", JSON.stringify(a));
  assert.ok(a.events.includes("benutzer_anmeldung_abgeschlossen"));
});
test("scan-metrics.mjs (German, no glossary): the SAME 'Anmeldung' route/event never maps to a step, but reads '?' (unknown) - never the confident 'not measured'", () => {
  const R = metricsProductOf("src/pages/anmeldung.tsx", "benutzer_anmeldung_abgeschlossen", "nosy-lang-mx-de-without-", { language: "de" });
  for (const a of R.steps) {
    assert.notEqual(a.status, "notMeasured", `${a.id} should never be confidently "not measured" in an unrecognized language`);
    assert.equal(a.status, "unknown", JSON.stringify(a));
    assert.match(a.note, /event.*found, none mapped to a step in de/);
  }
});
// The route FILE PATH is kept ASCII ("toroku.tsx" - romanized) since git quotes non-ASCII filenames as
// octal escapes in `ls-tree --name-only` output by default (core.quotepath) - an orthogonal git behavior,
// not something internal request 107 is about. The EVENT NAME (inside file CONTENT, unaffected by
// quotepath) carries the real 2-character Japanese content word "登録", which is what text.mjs's own
// Japanese finding (the language audit) is about; glossary.metrics carries both forms so either alone
// is enough to recognize the step.
test("scan-metrics.mjs (Japanese, with glossary.metrics): the 2-character event word '登録' maps to Acquisition, same as English - never '?'", () => {
  const R = metricsProductOf("src/pages/toroku.tsx", "ユーザー登録完了", "nosy-lang-mx-ja-with-",
    { language: "ja", glossary: { metrics: ["signup:toroku", "signup:登録"] } });
  const a = acquisitionOf(R);
  assert.equal(a.status, "measured", JSON.stringify(a));
  assert.ok(a.events.includes("ユーザー登録完了"));
});
test("scan-metrics.mjs (Japanese, no glossary): the SAME '登録' event never maps to a step, but reads '?' (unknown) - never the confident 'not measured'", () => {
  const R = metricsProductOf("src/pages/toroku.tsx", "ユーザー登録完了", "nosy-lang-mx-ja-without-", { language: "ja" });
  for (const a of R.steps) {
    assert.notEqual(a.status, "notMeasured", `${a.id} should never be confidently "not measured" in an unrecognized language`);
    assert.equal(a.status, "unknown", JSON.stringify(a));
    assert.match(a.note, /event.*found, none mapped to a step in ja/);
  }
});

// =========================================================================================================
// plan-gates.mjs - the folder/file-NAME mapping to "billing"/"plan" is language-dependent (internal request
// 108, the language audit §1 "plan-gates.mjs:21-46 Billing/Gate/Infrastructure"); the billing SDK import
// itself (structural: "import Stripe from 'stripe'") and gate-call shape (hasFeature(...)) are code identifiers,
// unaffected by product language, and stay untouched. sources.json's `glossary.billing` is a flat
// "billing:<word>" array, same shape as glossary.metrics above.
function planGatesGlossaryOf(prefix, extra = {}) {
  const { repo, pm } = productOf(prefix);
  fs.mkdirSync(repo, { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const write = files => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); } };
  git("init", "-q", "-b", "main");
  // Billing is detected structurally (a real "import Stripe from 'stripe'" - language-independent), so
  // billing_missing is false regardless of the glossary; only GATE/PLAN recognition is under test here. A
  // German-named plan/pricing file ("Preise" = "prices") isn't recognized by the English plans?/pricing/
  // tiers?/... file-name pattern unless glossary.billing adds "preise". Its CONTENT stays ordinary JS
  // identifiers (English, real-world SDK/code convention) - only the FILE NAME is German.
  write({
    "src/billing/stripe.ts": 'import Stripe from "stripe";\nexport const stripe = new Stripe(process.env.KEY);\n',
    "src/preise/Preise.ts": 'export const PLANS = { pro: { features: ["export"] } };\n',
  });
  git("add", "-A"); git("commit", "-q", "-m", "chore: skeleton");
  // A "feat:" commit (plan-gates.mjs only counts feat:/feature: commits as feature fields) with no gate
  // CALL anywhere (deliberately) - this field is gated only if the plan file above is recognized.
  write({ "src/features/export/ExportButton.tsx": 'export function ExportButton() {\n  return "csv";\n}\n' });
  git("add", "-A"); git("commit", "-q", "-m", "feat(export): CSV export");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", ...extra }));
  const j = jsonFor(`pg-gloss-${prefix}`);
  const r = run(path.join(Tool, "plan-gates.mjs"), [pm, "--json", j]);
  assert.equal(r.code, 0, r.error);
  return { R: readJson(j), md: r.output };
}
test("plan-gates.mjs (German, no glossary.billing): billing is found (structural stripe import), but the German plan file 'Preise.ts' isn't recognized - reads '?'/unknown for the export field, never a confident 'tied to no plan'", () => {
  const { R, md } = planGatesGlossaryOf("nosy-lang-pg-gloss-de-without-", { language: "de" });
  assert.equal(R.billing_missing, false);
  assert.equal(R.gate_count, 0);
  assert.equal(R.plan_files_of.length, 0);
  assert.equal(R.gatesUnknown, true);
  assert.match(R.gatesNote, /stripe\.ts:\d+/);
  assert.match(R.gatesNote, /no gate\/plan folder recognized in de/);
  const exportField = R.fields.find(a => a.area === "export");
  assert.equal(exportField.unknown, true);
  assert.equal(exportField.gated, false);
  assert.doesNotMatch(md, /\*\*no\*\*/, "a field that's merely unrecognized in this language should never render as a confident 'no' (tied to no plan)");
});
test("plan-gates.mjs (German, with glossary.billing): 'preise' recognizes the plan file, and the export field is gated (word match), same shape as English", () => {
  const { R } = planGatesGlossaryOf("nosy-lang-pg-gloss-de-with-", { language: "de", glossary: { billing: ["billing:preise"] } });
  assert.equal(R.billing_missing, false);
  assert.ok(R.plan_files_of.some(f => /Preise\.ts$/.test(f)), JSON.stringify(R.plan_files_of));
  assert.ok(!R.gatesUnknown);
  const exportField = R.fields.find(a => a.area === "export");
  assert.equal(exportField.gated, true, JSON.stringify(exportField));
  assert.equal(exportField.gateKind, "word");
  assert.match(exportField.evidence, /Preise\.ts/);
});

// =========================================================================================================
// collect-signals.mjs - field detection (the language audit #7): a support-ticket
// CSV/JSON export's HEADER words can be in any language ("Datum", "Beschreibung") - the shape of the VALUES
// underneath (dates, emails, ids, long free text) is checked FIRST, header words only break a tie. An export
// whose message column truly can't be determined is reported, never silently dropped to 0 signals.
function collectSignalsPmOf(prefix, extraSources = {}) {
  const pm = temporary(prefix); copies.push(pm);
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ signal: { threshold: 1000 }, ...extraSources }, null, 1));
  return pm;
}
function collectSignalsRun(pm, signalDir) {
  const j = jsonFor(`cs-${path.basename(pm)}`);
  const r = run(path.join(Tool, "collect-signals.mjs"), [pm, signalDir, "--json", j]);
  return { r, j: fs.existsSync(j) ? readJson(j) : null };
}
test("collect-signals.mjs (German headers, NO glossary): a support export whose headers are 'Datum/Kunde/Nachricht' is read correctly by VALUE SHAPE alone - the date column parses as dates, the long-prose column becomes the message, even with zero sources.json setup", () => {
  const pm = collectSignalsPmOf("nosy-lang-cs-de-");
  const dir = path.join(tmp, "cs-de-signal");
  fs.mkdirSync(dir, { recursive: true });
  const csv = [
    "Datum,Kunde,Nachricht",
    '2026-02-01,"Meier GmbH","Wir warten seit Wochen auf den Sammelexport der Sendungen als CSV-Datei, das wäre für unsere Buchhaltung sehr wichtig."',
    '2026-02-03,"Bauer AG","Unser Lager tippt Sendungsnummern noch von Hand ab, ein Barcode-Scanner fehlt komplett und das kostet uns viel Zeit."',
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "export.csv"), csv);
  const { r, j } = collectSignalsRun(pm, dir);
  assert.equal(r.code, 0, r.error);
  assert.equal(j.total, 2, `expected both German rows read as signals: ${JSON.stringify(j)}`);
  assert.deepEqual(j.unrecognized, []);
  // The message text (from "Nachricht") must have made it into an unmatched theme or a masked example -
  // never the short "Kunde" company-name column, which value-shape (short, low-variety) rules out as the
  // message even though it sits right next to a real German header word ("Kunde") collect-signals.json
  // (the TR-only field-name list) doesn't recognize.
  const everyText = JSON.stringify(j);
  assert.ok(everyText.includes("Sammelexport") || everyText.includes("Barcode-Scanner"), `expected German prose text to appear somewhere in the output: ${everyText}`);
  assert.ok(!everyText.includes("\"Meier GmbH\"") && !everyText.includes("Meier GmbH,"), "the short customer-name column should not have been read as the message text");
});
test("collect-signals.mjs (German headers, with glossary.signals): the same export, with the header words spelled out, reads identically (glossary only breaks ties - it doesn't change a shape-clear result)", () => {
  const pm = collectSignalsPmOf("nosy-lang-cs-de-glossary-", { glossary: { signals: ["date:Datum", "customer:Kunde", "text:Nachricht"] } });
  const dir = path.join(tmp, "cs-de-glossary-signal");
  fs.mkdirSync(dir, { recursive: true });
  const csv = [
    "Datum,Kunde,Nachricht",
    '2026-02-01,"Meier GmbH","Wir warten seit Wochen auf den Sammelexport der Sendungen als CSV-Datei, das wäre für unsere Buchhaltung sehr wichtig."',
    '2026-02-03,"Bauer AG","Unser Lager tippt Sendungsnummern noch von Hand ab, ein Barcode-Scanner fehlt komplett und das kostet uns viel Zeit."',
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "export.csv"), csv);
  const { r, j } = collectSignalsRun(pm, dir);
  assert.equal(r.code, 0, r.error);
  assert.equal(j.total, 2);
  assert.deepEqual(j.unrecognized, []);
});
test("collect-signals.mjs: an export whose columns are all id/date-shaped (no prose column at all) is reported as 'columns not recognized', never a silent 0-signal pass - exit code 2, headers+samples in the warning", () => {
  const pm = collectSignalsPmOf("nosy-lang-cs-unrecognized-");
  const dir = path.join(tmp, "cs-unrecognized-signal");
  fs.mkdirSync(dir, { recursive: true });
  const csv = [
    "id,ref,status",
    "10293,A-991,ok",
    "10294,A-992,ok",
    "10295,A-993,no",
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "weird.csv"), csv);
  const { r, j } = collectSignalsRun(pm, dir);
  assert.equal(r.code, 2, `expected exit code 2 for an unrecognized export, got ${r.code}: ${r.error}`);
  assert.equal(j.total, 0);
  assert.equal(j.unrecognized.length, 1);
  assert.match(j.unrecognized[0], /weird\.csv$/);
  assert.match(r.output, /columns not recognized — agent, map them/);
  assert.match(r.output, /id: /);
  assert.match(r.output, /10293/);
});
