// Contract test for tools/text.mjs: pure, side-effect-free functions. The shared need of six scripts
// (lowercase, rough stem, ASCII fold, concept groups, idf/score) is tested here in one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { small, ascii, root, words, conceptGroupsOf, matchRe, smallAscii, idfSetup, score } from "../tools/text.mjs";

test("small: gets I/i right, fixes the built-in toLowerCase's Turkish mistake", () => {
  assert.equal(small("Istanbul"), "istanbul");
  assert.equal(small("Isik"), "isik");
  assert.equal(small("Decisions"), "decisions");
  assert.equal(small("Çöp Şişe Öğün Ğıdı Üzüm"), "çöp şişe öğün ğıdı üzüm");
});

test("ascii: folds Turkish letters to their closest ASCII equivalent", () => {
  assert.equal(ascii("gonderim"), "gonderim");
  assert.equal(ascii("İstanbul çöğü şu üç"), "istanbul cogu su uc");
});

test("root: existing rough trim + reverses trailing b/c/d/g softening back to p/c/t/k", () => {
  assert.equal(root("kitabi"), root("kitap")); // consonant softening: p->b reversed
  assert.equal(root("takip"), root("takibi")); // takip/takibi
  assert.equal(root("path"), "path"); // <=4 letters: not trimmed
});

test("words: lowercase, short words dropped, deduplicated", () => {
  // Note: "aşaması" (from the lowercase source word) and "aşamasi" (from lowercasing "AŞAMASI", where
  // small() turns capital I into a plain i, not dotless i) are genuinely different strings - small()
  // doesn't merge the dotted/dotless-i distinction, so both survive deduplication.
  assert.deepEqual(words("Dosya aşaması dosya AŞAMASI taşıma"), ["dosya", "aşaması", "aşamasi", "taşıma"]);
  assert.deepEqual(words("bir iki üç", 2), ["bir", "iki"]); // "üç" (2 letters) doesn't clear minLength=2, dropped
});

test("words: minLength parameter works", () => {
  const w = words("ab cde fghi", 2);
  assert.deepEqual(w, ["cde", "fghi"]);
});

test("conceptGroupsOf: groups sharing a stem merge, glossary expands TR<->EN", () => {
  const glossary = { bulk: ["bulk"] };
  const gs = conceptGroupsOf("toplu dışa aktarma bulk export", glossary);
  const common = gs.find(g => g.includes(root("bulk")) || g.some(x => x === root("bulk")));
  assert.ok(common, "bulk/bulk group not found: " + JSON.stringify(gs));
  assert.ok(common.includes(root("bulk")) && gs.some(g => g.includes(root("bulk"))));
});

test("matchRe: ASCII-folded word-start match - gonderim <-> gönderim", () => {
  const reTr = matchRe("gonderim");
  assert.ok(reTr.test(smallAscii("gonderim işlemi")), "did not match in the ASCII-typed text");
  assert.ok(reTr.test(smallAscii("gönderim işlemi")), "did not match in the original spelling");
  const reAscii = matchRe("gonderim");
  assert.ok(reAscii.test(smallAscii("gönderim işlemi")), "did not match the other way round (ASCII query, TR text)");
});

test("matchRe: matches from a word start, not a random substring inside a word", () => {
  const re = matchRe("last");
  assert.ok(re.test(smallAscii("last delivery")));
  assert.ok(!re.test(smallAscii("outlast")), "\"last\" inside \"outlast\" matched by mistake");
});

test("idfSetup + score: a group carrying a rare word scores higher, coverage is 0-1", () => {
  const docs = ["dosya aşaması taşıma işlemi", "dosya aşaması", "başka bir konu", "yine başka"].map(smallAscii);
  const groups = conceptGroupsOf("dosya aşaması taşıma");
  const { idf, re } = idfSetup(docs, [...new Set(groups.flat())]);
  const p1 = score(smallAscii("dosya aşaması taşıma işlemi tam eşleşme"), groups, { idf, re });
  const p2 = score(smallAscii("alakasız bir metin"), groups, { idf, re });
  assert.ok(p1.score > p2.score);
  assert.ok(p1.coverage > 0 && p1.coverage <= 1);
  assert.equal(p2.score, 0);
});

test("score: synonyms in the same concept aren't double-counted (coverage doesn't inflate)", () => {
  const glossary = { bulk: ["bulk"] };
  const groups = conceptGroupsOf("toplu dışa aktarma", glossary);
  const docs = ["toplu bulk dışa aktarma işlemi tam"].map(smallAscii);
  const { idf, re } = idfSetup(docs, [...new Set(groups.flat())]);
  const p = score(smallAscii("toplu bulk dışa aktarma"), groups, { idf, re });
  assert.ok(p.coverage <= 1.0001, `coverage should not exceed 1: ${p.coverage}`);
});
