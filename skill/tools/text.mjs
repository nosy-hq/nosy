// Shared text helper (internal request 41+42): gather-evidence/measure-size/collect-signals (and, at lower
// risk, canwe/build-waves/audit-prd) were each doing this work separately - lowercasing, a rough Turkish
// stem, a word-start match regex, TR<->EN glossary expansion, idf, a penalty for long blocks. Consolidated
// here as pure functions (no side effects, no file/network reads). Fixed along the way: consonant softening
// (takip/takibi, kitap/kitabi), ASCII-typed Turkish (gonderim <-> gonderim), and the toLocaleLowerCase("tr-TR")
// slowdown on large text (same pattern as the measure-size fix: 107s -> 6.7s).
//
// This module also analyzes the PRODUCT's own content on the user's behalf (a Nosy feature, not Nosy's own
// UI language, which stays English): the ASCII-fold table and the consonant-softening table below live in
// skill/data/lang/tr/text.json and are loaded at runtime.
//
// Any-language tokenizing (the language audit): the product a Nosy user connects
// can be written in ANY language, not just English/Turkish - Nosy must never go silent or claim something's
// wrong just because it isn't. Two changes from the EN/TR-only version:
//  - words(): CJK/Hangul/Thai scripts (Chinese/Japanese Han characters, Hiragana, Katakana, Hangul, Thai)
//    have no spaces between words, so the old "split on non-letter/digit, drop length<=minLength" approach
//    either produces one giant run per sentence or (for genuinely 1-2 character content words, the norm in
//    Japanese: 配送/移動/請求) drops them before anything can ever match them - the single highest-leverage
//    bug found in the audit. Text carrying any of those scripts is now tokenized with Intl.Segmenter (word
//    granularity) - verified on this machine (Node 22, full ICU) to split "配送ファイルをステージ間で移動する"
//    into ["配送","ファイル","を","ステージ","間","で","移動する",...] correctly, matching real words rather than
//    sentence-length runs. If Intl.Segmenter isn't available (an ICU-lite Node build), falls back to
//    character bigrams over the CJK/Thai run (see bigramFallback) - cruder, but still produces short,
//    matchable tokens instead of one giant string or nothing. Latin/Cyrillic/etc. text is untouched: same
//    regex split as before, same minLength cutoff, same output for every existing (EN/TR) caller and test.
//  - root(): the EN/TR suffix-trim + consonant-softening reversal is a Turkish-shaped heuristic. Applying it
//    to any other language mangles the word (e.g. it turned the German "Sendung" into "Send"), degrading
//    word-overlap matching rather than helping it. It now only runs when the product's language is en/tr
//    (or unset and the word is Latin-script, the previous implicit default - unaffected, so EN output is
//    identical). For a known OTHER language, root() instead returns the word NFKC-normalized and
//    locale-lowercased (Unicode-aware, via toLocaleLowerCase(lang)) - correct casing, no stemming, since
//    Nosy has no stemmer for arbitrary languages and a wrong one is worse than none.
//  - Product language comes from sources.json's `language` (BCP-47, e.g. "de", "ja", "tr") via langOfLoad()
//    below - a module-level setter, the same pattern refs.mjs's patternsOfLoad/aliases already uses for
//    sources.json-driven config, chosen over threading an options object through all 13 importers' whole
//    call graphs (gather-evidence/measure-size/collect-signals/canwe/build-waves/dresscode/frontyard/
//    ledger/interview-themes/demand/bet/rival-language/audit-prd): most of those pass words()/root() output
//    through several more layers (conceptGroupsOf, idf, synonym tables) before it reaches anything language-
//    sensitive, so a positional/options param would have to be threaded through every one of those, not just
//    the entry point. A caller that already reads sources.json only needs one added line
//    (`langOfLoad(K)` / `langOfLoad(pm)`) right after it reads K; words()/root()/conceptGroupsOf() still also
//    take an explicit optional `lang` argument (used directly by tests and any caller that wants to be
//    explicit rather than relying on the module-level default). If sources.json has no `language`, per-text
//    detection kicks in instead (see langOfText) - a cheap dominant-script heuristic, not a real language
//    identifier: enough to pick "should this behave like CJK/Thai" and "should EN/TR stemming apply", not to
//    tell German from French (which don't need telling apart - neither stems, both fall in the "no
//    stemming" branch either way).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSources } from "./sources-file.mjs";

const TR = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/text.json", import.meta.url), "utf8"));

// --- product language: sources.json's `language`, a module-level setter (refs.mjs's patternsOfLoad/aliases
// pattern) ------------------------------------------------------------------------------------------------
let LANG = null;
// `source`: a pm folder path, an already-parsed sources.json object, or null/undefined. Returns the language
// it set (or null). Safe to call more than once (e.g. once per script run); safe to not call at all (LANG
// stays null, same as today - every function below already has a sensible null-language fallback).
export function langOfLoad(source) {
  let K = null;
  if (source && typeof source === "object") K = source;
  else if (source) { try { K = readSources(source); } catch {} }
  LANG = (K && typeof K.language === "string" && K.language.trim()) ? K.language.trim().toLowerCase() : null;
  return LANG;
}
// Read-only accessor (tests, or a caller that wants to log/branch on the currently-loaded language).
export const langOf = () => LANG;

// --- script detection: cheap, not a real language identifier - just enough to tell "this word/text needs
// CJK/Thai-shaped handling" from "this is Latin/Cyrillic/other space-separated script" -------------------
const RE_HAN = /\p{Script=Han}/u, RE_KANA = /\p{Script=Hiragana}|\p{Script=Katakana}/u,
  RE_HANGUL = /\p{Script=Hangul}/u, RE_THAI = /\p{Script=Thai}/u, RE_LATIN = /\p{Script=Latin}/u;
const RE_ANY_CJK_OR_THAI = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
// A handful of common single-Han characters that read as grammatical/generic rather than a content word on
// their own (documented, deliberately small and not exhaustive - internal request 103 says "keep it simple"
// for the Han-1-char exception; multi-character Han/Hiragana/Katakana/Hangul/Thai tokens are never filtered
// this way).
const HAN_PARTICLE_LIKE = new Set(["的", "化", "性", "者", "様", "中", "内", "外", "上", "下", "前", "後", "間", "等"]);
function scriptOf(w) {
  if (RE_HAN.test(w)) return "han";
  if (RE_KANA.test(w)) return "kana";
  if (RE_HANGUL.test(w)) return "hangul";
  if (RE_THAI.test(w)) return "thai";
  if (RE_LATIN.test(w)) return "latin";
  return "other";
}
const CJK_SCRIPTS = new Set(["han", "kana", "hangul", "thai"]);
// Per-text detection (no sources.json `language` set): dominant-script heuristic, used only to decide
// whether EN/TR stemming applies in root() - NOT a real language identifier (can't and doesn't need to tell
// German from French; both take the "no stemming" branch, correctly, either way).
function langOfText(w) {
  const s = scriptOf(w);
  if (s === "han" || s === "kana") return "ja"; // closest of Nosy's known languages; only used for toLocaleLowerCase, harmless either way
  if (s === "hangul") return "ko";
  if (s === "thai") return "th";
  return null; // latin/other: no per-text guess, EN/TR fallback rule in root() applies instead
}

// Fast lowercase: only gets the Turkish I/i pair right (capital I-with-dot -> i, capital I -> i), everything
// else is handled by the built-in toLowerCase() (c-cedilla/g-breve/o-umlaut/s-cedilla/u-umlaut already round-trip
// correctly through the built-in - the only Turkish-specific case is dotted/dotless I). toLocaleLowerCase("tr-TR")
// was very slow on large text (Intl collation/localization overhead); this function gives the same result at
// plain toLowerCase() speed. Safe for any language/script: only touches the three Turkish I/İ codepoints,
// leaves everything else (Latin, CJK, Thai, ...) untouched.
export const small = s => String(s).replace(/İ/g, "i").replace(/I/g, "i").toLowerCase();

// ASCII fold: reduces Turkish-specific letters to their closest ASCII equivalent, uppercase included. Used
// so that text typed on an ASCII keyboard ("gonderim") and text typed correctly ("gönderim") fold to the
// same stem (see matchRe). Only replaces the exact Turkish-diacritic codepoints in TR.asciiFold - every other
// character (German ü/ö/ß, Japanese/Chinese/Korean/Thai script, anything else) passes through byte-for-byte
// unchanged, so this never destroys or corrupts non-Latin text (verified: ascii("配送") === "配送").
export const ascii = s => String(s).replace(/[çÇğĞıIİöÖşŞüÜ]/g, c => TR.asciiFold[c] || c);

// Rough Turkish stem: trims trailing suffixes (same pattern used in gather-evidence/measure-size/build-waves/
// canwe) and, if a b/c/d/g consonant-softening remains at the end, reverses it back to its hard counterpart
// (p/c/t/k) - so inflected forms stem in the same direction as their base form (a short stem doesn't resolve
// this on its own; see the word examples in the test).
//
// `lang`: only applies the trim above when the product's language is "en"/"tr", or
// unset AND the word is Latin-script (the previous implicit behavior - unaffected for every existing English
// caller/test). For any other KNOWN language (lang given and not en/tr - "de", "ja", ...), stemming is
// skipped entirely and the word is returned NFKC-normalized and locale-lowercased instead: applying the
// EN/TR suffix rule to e.g. German mangles the word ("Sendung" -> "Send") rather than helping it match: see
// the language audit's German gather-evidence finding.
export const root = (w, lang = LANG) => {
  const s = String(w);
  const stem = lang === "en" || lang === "tr" || (lang == null && scriptOf(s) === "latin");
  if (!stem) {
    try { return s.normalize("NFKC").toLocaleLowerCase(lang || langOfText(s) || undefined); }
    catch { return s.normalize("NFKC").toLowerCase(); }
  }
  let k = s.length > 5 ? s.slice(0, -2) : s.length === 5 ? s.slice(0, -1) : s;
  const last = k.slice(-1);
  if (TR.consonantSoftening[last]) k = k.slice(0, -1) + TR.consonantSoftening[last];
  return k;
};

// Character-bigram fallback tokenizer for CJK/Thai runs, used only when Intl.Segmenter isn't available (an
// ICU-lite Node build - full ICU, the default since Node 14+, always has it; this is a defensive fallback,
// not the normal path). Cruder than real word segmentation, but still produces short 1-2 character tokens
// that can match (both a lone character and each adjacent pair), instead of one giant run or nothing.
function bigramFallback(t, minLength) {
  const out = new Set();
  for (const m of t.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]+|[\p{L}\p{N}]+/gu)) {
    const chunk = m[0];
    if (RE_ANY_CJK_OR_THAI.test(chunk)) {
      const chars = [...chunk];
      for (const c of chars) out.add(c);
      for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1]);
    } else if (chunk.length > minLength) out.add(chunk);
  }
  return out;
}

// Splits text into words: lowercase, drop short words, deduplicate. Does not stem - the caller applies
// root() if it wants.
//
// `minLength` (default 2, unchanged): for Latin/Cyrillic/other space-separated scripts, same cutoff as
// before ("w.length > minLength"). `lang`: only changes behavior when the text
// carries CJK/Hangul/Thai script - Latin-only text takes the exact same regex-split path as before (byte-
// identical output, every existing EN/TR test keeps passing). CJK/Hangul/Thai text is instead tokenized with
// Intl.Segmenter (word granularity - verified to split Japanese compounds like 配送/移動 correctly on this
// Node 22/full-ICU install; falls back to bigramFallback if Intl.Segmenter is missing), and the length filter
// is applied PER SCRIPT rather than to the whole text: Han/Hiragana/Katakana/Hangul/Thai tokens keep 1-2
// character words (a single Han character is dropped only if it's in the small "particle-like" list above);
// any Latin/other token mixed into the same text still needs length > minLength, same as always.
export const words = (s, minLength = 2, lang = LANG) => {
  const text = small(String(s));
  if (!RE_ANY_CJK_OR_THAI.test(text)) return [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > minLength))];
  const segmentsOf = () => {
    if (typeof Intl.Segmenter === "function") {
      try { return [...new Intl.Segmenter(lang || "und", { granularity: "word" }).segment(text)].filter(x => x.isWordLike).map(x => x.segment); }
      catch {}
    }
    return [...bigramFallback(text, minLength)];
  };
  const out = new Set();
  for (const tok of segmentsOf()) {
    if (!/[\p{L}\p{N}]/u.test(tok)) continue; // punctuation/whitespace segment
    const scr = scriptOf(tok);
    if (CJK_SCRIPTS.has(scr)) { if (scr === "han" && tok.length === 1 && HAN_PARTICLE_LIKE.has(tok)) continue; out.add(tok); }
    else if (tok.length > minLength) out.add(tok);
  }
  return [...out];
};

// Concept groups (the "merged groups" pattern from measure-size): each word in the text starts its own
// group made of itself, its stem, and its glossary (TR<->EN) translations; groups that share a stem merge.
// `glossary` is shaped like sources.json's `{ "aşama": ["stage"], ... }` (if missing, expansion is skipped).
export function conceptGroupsOf(text, glossary = {}, lang = LANG) {
  const raw = words(text, 2, lang);
  const expand = w => { const out = new Set([w]);
    for (const [tr, ens] of Object.entries(glossary)) { const trl = small(tr);
      if (trl === w || trl.startsWith(w) || w.startsWith(trl)) for (const en of ens || []) out.add(small(en));
      else if ((ens || []).some(en => { const el = small(en); return el === w || el.startsWith(w) || w.startsWith(el); })) out.add(trl); }
    return out; };
  let gs = raw.map(w => new Set([...expand(w)].map(x => root(x, lang))));
  for (let changed = true; changed;) { changed = false;
    for (let i = 0; i < gs.length && !changed; i++) for (let j = i + 1; j < gs.length && !changed; j++)
      if ([...gs[j]].some(x => gs[i].has(x))) { gs[j].forEach(x => gs[i].add(x)); gs.splice(j, 1); changed = true; } }
  return gs.map(g => [...g]);
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Word-start match regex, ASCII-folded: matches both the word's own form and its ASCII form from a word
// boundary. Prefix match (needed for stems shortened from the end), doesn't anchor the end.
//
// CJK exception: the "(?<![\p{L}\p{N}])" lookbehind assumes a word boundary exists
// right before a word - true for space-separated scripts, but Han/Hiragana/Katakana/Hangul/Thai compounds
// run together with no delimiter at all ("移動バックエンド" - "移動" then "バック" directly, both \p{L}), so
// the lookbehind fails for every word except one that happens to sit at the very start of the target text.
// This is what made measure-size.mjs's/gather-evidence.mjs's idfSetup-based matching (both call this for
// every candidate document) silently find nothing for a Japanese query even after words()/root() started
// tokenizing it correctly - the query word was right there in the target text, just never at a "boundary".
// A CJK-scripted query word is matched as a plain substring instead (no lookbehind); Latin/Cyrillic/other
// words keep the exact same word-start behavior as before (byte-identical regex, so every existing EN/TR
// caller/test is unaffected).
export const matchRe = w => {
  const w1 = String(w), w2 = ascii(w1);
  const parts = [...new Set([w1, w2])].map(escRe);
  if (CJK_SCRIPTS.has(scriptOf(w1))) return new RegExp(`(?:${parts.join("|")})`, "u");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})`, "u");
};
// ASCII-folded lowercase text: needed so matchRe's ASCII branch also works in the target text - prepare
// comparison text with this function (small + ascii).
export const smallAscii = s => ascii(small(s));

// idf (rarity weight): for each word, log((N+1)/df) - weight by how many documents
// it appears in. `docs` should be lowercase + ASCII-folded text (prepared with smallAscii); `wordsList` is
// the (already-stemmed) words to weight. The match regex is built and cached once per word.
export function idfSetup(docs, wordsList) {
  const N = docs.length || 1;
  const re = Object.fromEntries(wordsList.map(w => [w, matchRe(w)]));
  const idf = Object.fromEntries(wordsList.map(w => { const df = docs.filter(d => re[w].test(d)).length; return [w, df ? Math.log((N + 1) / df) : 0]; }));
  return { idf, re };
}

// Scores a text against concept groups: for each group, the idf of the STRONGEST matching word is summed
// (synonyms aren't double-counted); coverage = score earned / the highest possible idf sum across the
// groups (0-1, 0 if nothing matches). `textSmallAscii` must be prepared with smallAscii(); `re`/`idf` are
// what idfSetup() returns.
export function score(textSmallAscii, groups, { idf, re }) {
  const hit = groups.reduce((s, g) => s + Math.max(0, ...g.map(w => (re[w] && re[w].test(textSmallAscii)) ? (idf[w] || 0) : 0)), 0);
  const maxPossible = groups.reduce((s, g) => s + (Math.max(0, ...g.map(w => idf[w] || 0)) || 0), 0) || 1;
  return { score: +hit.toFixed(4), coverage: +(hit / maxPossible).toFixed(4) };
}

// Library, not a CLI: a misdirected `node text.mjs ...` would otherwise print nothing
// and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "text.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy canwe\` or \`node skill/tools/canwe.mjs\`?`);
  process.exit(1);
}
