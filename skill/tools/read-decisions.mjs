// Shared decision reader: `K.preread.decisions` can be a single file (today's
// Nosy pattern, one "## K180"-titled DECISIONS.md), a directory (docs/adr/, one file per decision), or a
// glob (docs/decisions/*.md) - preread.mjs, gather-evidence.mjs, audit-prd.mjs, build-waves.mjs and
// verify-setup.mjs all read through here now, instead of each repeating its own git-show-plus-split logic.
// Returns: [{ no, title, metin, file, line, status, notDoing, measure, statusReadable }, ...]
//   no: "K180" | "ADR-0007" | ... (pulled from the title if possible, otherwise from the filename, otherwise the filename itself)
//   status: "accept" | "rejected" | "proposed" | "superseded" | "unknown" | null (from the English ADR pattern
//     "Status: Accepted/Rejected/...", or "unknown" - see statusReadable below)
//   notDoing: matches the negation family in NEGATION_RE (English plus the Turkish family from
//     skill/data/lang/tr/read-decisions.json, plus the product's OWN words from sources.json's
//     `glossary.notDoing`, if given), OR status is "rejected". Always false when
//     statusReadable is false (see below) - a decision this function couldn't confidently read is never
//     reported as "not doing", which would be a false claim in the OTHER direction.
//   statusReadable: false when the WHOLE decisions doc (more than one block, none of
//     them carrying the language-independent "Status:" line) matches NONE of the negation family above -
//     i.e. read-decisions.mjs doesn't recognize this doc's language at all, not just this one decision. Never
//     silently reports "not doing this: false" (a confident, wrong claim - see the language audit) for a
//     doc it can't read; `status` becomes "unknown" instead of null/whatever STATUS_RE found, so a consumer
//     (canwe.mjs) can say "this decision exists, but I couldn't read its status in this language" rather than
//     "no trace of a decision". True (the default) for English/Turkish, and for any other language once
//     sources.json's `glossary.notDoing` gives read-decisions.mjs the product's own words for it.
//   measure: measurementOf(text, K) - a short "we'll check this" line, or null (cases like
//     "there's a verified quote but the model isn't writing" were only caught from a person's own note; `status`
//     should also read the measurement/success line a decision carries, if it has one). `K.glossary.measurement`
// extends the recognized label words ("Measurement"/"Success"/"Metric" + Turkish)
//     with the product's own, same idea as `glossary.notDoing` above.
// Reads from K.ref via `git show`/`git ls-tree`; DOES NOT READ THE WORKING TREE (see log.md internal request 15).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Title pattern: K.preread.decision_title (a regex source, optional) if given, otherwise DEFAULT_TITLE -
// recognizes both "## K<no>" (the Nosy pattern) and "# ADR-<no>" / "## ADR-<no>" (the ADR pattern) titles.
export const DEFAULT_TITLE = "^##\\s+K\\d+\\b|^#+\\s*ADR-\\d+\\b";

// Negation family for a decision's free text: an English core plus, for decisions written in Turkish (a
// Nosy feature - see skill/data/lang/tr/read-decisions.json), the same Turkish phrase family. This is the
// single source; audit-prd.mjs's negation check (finding 7) imports it from here instead of keeping its
// own copy (migrate the consumers).
const TR_NEGATION = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/read-decisions.json", import.meta.url), "utf8")).negationPatterns;
const NEGATION_CORE = ["\\bnot doing\\b", "\\bwon'?t\\s+(?:do|use|add|send|support|ship)\\b", "\\bwill\\s+not\\s+(?:do|use|add|send|support|ship)\\b",
  "\\bnot\\s+(?:supported|allowed|used)\\b", "\\bdon'?t\\s+(?:use|support|add|send)\\b", "\\bwe'?re\\s+not\\s+doing\\b", "\\bout of scope\\b",
  ...TR_NEGATION];
export const NEGATION_RE = new RegExp(NEGATION_CORE.join("|"), "i");
// What a decision STATES: its heading and its first paragraph (and a "Decision:" / "Verdict:" line wherever it is). A negation phrase in a later sentence ("Excel format is
// out of scope", "we won't use streaming") is about something else the decision mentions, and read over the whole block it made "CSV export ships first" a decision not to do
// CSV export (field-test hunt: canwe said "there's a decision: not doing this" and the roadmap moved a work item to "Outside / not doing").
export function statementOf(text) {
  const lines = String(text).split("\n"), out = [];
  let i = 0; while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && /^#{1,6}\s|^\*\*|^[-*]\s/.test(lines[i])) out.push(lines[i++]);
  while (i < lines.length && !lines[i].trim()) i++;
  while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i])) out.push(lines[i++]);
  for (const l of lines) if (/^\s*(?:[-*]\s*)?\**\s*(?:decision|verdict|karar)\s*:?\**\s*:/i.test(l) && !out.includes(l)) out.push(l);
  return out.join("\n");
}
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Product-sourced negation family: sources.json's `glossary.notDoing` - the
// product's OWN words/phrases for "we're not doing this", in whatever language the product's decisions doc
// is actually written in. Merged with (never replacing) the EN+TR core above. A phrase is escaped (matched
// literally, not as a sub-regex) since these are free-text entries an owner/agent typed by hand, not regex
// authors. Returns the plain NEGATION_RE when there's nothing to add (the common case - EN/TR docs, or a
// doc whose language hasn't been given a glossary yet), so behavior/perf for every existing caller is
// unchanged.
export function negationRegexFor(K) {
  const extra = Array.isArray(K?.glossary?.notDoing) ? K.glossary.notDoing.filter(p => typeof p === "string" && p.trim()) : [];
  if (!extra.length) return NEGATION_RE;
  return new RegExp([...NEGATION_CORE, ...extra.map(escRe)].join("|"), "i");
}

// The traditional ADR "Status: Accepted/Rejected/Superseded/Proposed" line (the same shape find-sources.mjs
// looks for too). Free text in Turkish is NOT read here - that's NEGATION_RE's job.
const STATUS_RE = /\bStatus:\s*(Accepted|Rejected|Superseded|Proposed|Deprecated)\b/i;
const STATUS_MAP = { accepted: "accept", rejected: "rejected", superseded: "superseded", proposed: "proposed", deprecated: "superseded" };

// --- measurement/success line --------------------------------------------------
// Typical shape in a Turkish decision log: almost every occurrence is a bold label immediately followed by "." or ":"
// (optionally with a short parenthetical aside first) and then the free-text paragraph - e.g. "**Ölçüm.** Sevkiyat servisi ...",
// "**Ölçüm:** bugün her kayıt ...", "**Ölçüm (2 Eyl, örnek veri).** `HEDEF.md` ...".
// That shape (label, optional aside, terminal "." or ":", then the paragraph) is what MEASURE_LABEL_RE
// matches; freer bolded sentences that merely start with the word ("**Ölçüm daraltmanın kimi
// etkilediğini kesinleştirdi**...") are deliberately not matched - too easy to confuse with an unrelated
// bolded sentence that happens to start with the same word.
const TR_MEASURE = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/measurement.json", import.meta.url), "utf8"));
const MEASURE_LABELS = ["Measurement", "Success", "Metric", ...TR_MEASURE.labels];
// Word-boundary lookaheads, not `\b`: `\b` is ASCII-only, and Turkish letters like the dotless "ı" in
// "Ölçüm"/"Başarı" aren't ASCII word characters, so a trailing `\b` silently fails to match right after
// them. `\p{L}`/`\p{N}` (needs the "u" flag) work for any script.
const AFTER = "(?![\\p{L}\\p{N}_])";
// Builds the three measurement regexes from a label list (sources.json's
// `glossary.measurement` extends MEASURE_LABELS with the product's own words, e.g. German "Erfolg"/
// "Kennzahl" or Japanese "測定"/"成功基準" - merged in, the EN+TR labels always stay). Cached once for the
// no-extra-labels case (the common path: English/Turkish docs, or a doc whose language has no glossary yet)
// so behavior/perf for every existing caller is unchanged.
function measureResFor(labels) {
  const labelAlt = labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Bold form: "**Label.**", "**Label:**", "**Label (aside).**" - the terminal "." or ":" must sit right
  // before the closing "**", which is what tells a real label from an unrelated bolded phrase.
  const labelRe = new RegExp(
    `\\*\\*\\s*(?:${labelAlt})${AFTER}(?:\\s*\\([^)\\n]*\\))?\\s*[:.]\\s*\\*\\*` +
    `|(?:${labelAlt})${AFTER}(?:\\s*\\([^)\\n]*\\))?\\s*:(?!\\*)`, // plain "Label:" (no bold), e.g. an ADR/PRD heading body
    "iu");
  // Heading form: "## Measurement" / "## Ölçüm" on its own line - the next paragraph is the measurement.
  const headingRe = new RegExp(`^#{1,6}\\s*(?:${labelAlt})\\s*$`, "imu");
  return { labelRe, headingRe };
}
const DEFAULT_MEASURE_RE = measureResFor(MEASURE_LABELS);
// "We'll know it worked when ..." - a sentence-shaped phrase, not a label, for decisions that never name
// the word "measurement"/"ölçüm" at all. TR_MEASURE.phrases carries the Turkish family (data, not code -
// this is a language feature of the product Nosy reads, like scan-metrics.mjs's own TR word list).
const MEASURE_PHRASE_RE = new RegExp(
  ["we(?:'ll| will) know (?:it|this) worked when\\b", ...TR_MEASURE.phrases].join("|"), "i");

const collapse = s => String(s || "").replace(/\s+/g, " ").trim();
// The first sentence of a paragraph, capped at ~220 chars (a display line, not the whole paragraph).
function firstSentenceOf(paragraph) {
  const c = collapse(paragraph);
  if (!c) return null;
  const m = c.match(/^.{1,300}?[.!?](?=\s|$)/);
  const sentence = m ? m[0] : c;
  return sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}…` : sentence;
}
// From a match's end index, the rest of the paragraph: up to a blank line, a heading, a horizontal rule,
// or a markdown table row - whichever comes first (a table/heading is the next structural block, not part
// of the measurement's own sentence).
function paragraphAfter(text, fromIdx) {
  const rest = text.slice(fromIdx);
  const m = rest.match(/\n\s*\n|\n\s*#|\n\s*---|\n\s*\|/);
  return m ? rest.slice(0, m.index) : rest;
}
// The sentence a phrase match sits inside: back to the previous sentence boundary, forward to the next one.
function sentenceAround(text, start, end) {
  let from = 0;
  for (const ch of [".", "!", "?", "\n"]) { const i = text.lastIndexOf(ch, start); if (i > from - 1) from = Math.max(from, i + 1); }
  const rest = text.slice(end);
  const m = rest.match(/^[^.!?\n]*[.!?]/);
  const to = end + (m ? m[0].length : Math.min(rest.length, 200));
  return text.slice(from, to);
}

// The measurement/success line a decision's free text carries, or null. `text`: one decision's block
// (read-decisions.mjs's own `b.text`, or any free-standing decision/PRD text). `K` (internal request 104,
// optional): a sources.json object - if `K.glossary.measurement` is set, its words are unioned into the
// recognized label list before matching (product-sourced, on top of the EN+TR default; the default alone is
// used, and cached, when there's nothing to add).
export function measurementOf(text, K) {
  const t = String(text || "");
  const extra = Array.isArray(K?.glossary?.measurement) ? K.glossary.measurement.filter(p => typeof p === "string" && p.trim()) : [];
  const { labelRe, headingRe } = extra.length ? measureResFor([...MEASURE_LABELS, ...extra]) : DEFAULT_MEASURE_RE;
  const label = labelRe.exec(t);
  if (label) { const line = firstSentenceOf(paragraphAfter(t, label.index + label[0].length)); if (line) return line; }
  const heading = headingRe.exec(t);
  if (heading) { const line = firstSentenceOf(paragraphAfter(t, heading.index + heading[0].length)); if (line) return line; }
  const phrase = MEASURE_PHRASE_RE.exec(t);
  if (phrase) { const line = firstSentenceOf(sentenceAround(t, phrase.index, phrase.index + phrase[0].length)); if (line) return line; }
  return null;
}

// A deterministic, structural (never text-similarity) guess at an event/metric name a measurement line
// names, e.g. "`checkout_completed`" -> "checkout_completed". Only a backtick-quoted, identifier-shaped
// token with a "_" or "." in it counts (an event name like `signed_up`/`checkout.completed`) - a bare word
// (`card`) or a file path (`docs/x.md`) is not a candidate. Returns the first candidate, or null. Callers
// compare this literally (exact string equality) against skill/tools/scan-metrics.mjs's own known event
// names - never a similarity match.
const FILE_EXT_RE = /\.(md|mdx|txt|js|mjs|cjs|ts|tsx|jsx|go|py|rb|sql|json|ya?ml|toml|sh)$/i;
export function eventRefOf(text) {
  const candidates = [...String(text || "").matchAll(/`([A-Za-z][\w.-]{2,60})`/g)].map(m => m[1]);
  for (const c of candidates) {
    if (c.includes("/") || FILE_EXT_RE.test(c) || !/[_.]/.test(c)) continue;
    return c;
  }
  return null;
}

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const gitTry = (repo, ...a) => { try { return git(repo, ...a); } catch { return null; } };

// Simple glob -> regex ("**" any depth, "*" one segment, "?" one character). The "/" path separator is
// preserved so "docs/*.md" doesn't catch "docs/adr/x.md" (consistent with find-sources.mjs's own glob-skip rule).
function globRegex(glob) {
  const esc = s => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") { if (glob[i + 1] === "*") { re += ".*"; i++; } else re += "[^/]*"; }
    else if (c === "?") re += "[^/]";
    else re += esc(c);
  }
  return new RegExp(`^${re}$`);
}

// Lists the .md files under the path: a single file -> [path]; a directory -> the .md files inside it
// (recursive); a glob -> the matching files. Throws if nothing is found (verify-setup's caller prints a
// x mark; the others fall back gracefully to an empty list - see decisionsOfRead).
function filesOfFind(repo, ref, filePath) {
  if (/[*?]/.test(filePath)) {
    const all = git(repo, "ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean);
    const re = globRegex(filePath);
    const matching = all.filter(f => re.test(f));
    if (!matching.length) throw new Error(`no file matches the glob pattern: ${filePath}`);
    return matching.sort();
  }
  const type = gitTry(repo, "cat-file", "-t", `${ref}:${filePath}`);
  if (type === null) throw new Error(`${filePath} does not exist at ${ref}`);
  if (type.trim() === "tree") {
    const all = git(repo, "ls-tree", "-r", "--name-only", ref, "--", filePath).split("\n").filter(Boolean);
    const md = all.filter(f => /\.md$/i.test(f)).sort();
    if (!md.length) throw new Error(`no .md file inside ${filePath}`);
    return md;
  }
  return [filePath];
}

// Splits the content into blocks by the title pattern. If the pattern never matches in the content, the
// WHOLE FILE counts as one block (one file = one decision; for files like docs/adr/0007-x.md whose title
// doesn't fit the "## K<no>"/"ADR-<no>" shape).
function withBlock(content, titleSourceOf) {
  const re = new RegExp(titleSourceOf, "gm");
  const points = [...content.matchAll(re)].map(m => m.index);
  if (!points.length) return [{ text: content, line: 1 }];
  const lineNo = idx => content.slice(0, idx).split("\n").length;
  return points.map((idx, i) => ({ text: content.slice(idx, points[i + 1]), line: lineNo(idx) }));
}

function noExtract(text, file) {
  const k = text.match(/^##?\s+(K\d+)\b/m); if (k) return k[1];
  const adr = text.match(/\bADR[-\s]?(\d{3,5})\b/i); if (adr) return `ADR-${adr[1]}`;
  const name = path.basename(file).match(/^(\d{3,5})[-_]/); if (name) return `ADR-${name[1]}`;
  return path.basename(file).replace(/\.md$/i, "");
}
function titleExtract(text) {
  const firstLine = (text.split("\n", 1)[0] || "").trim();
  return firstLine.replace(/^#+\s*/, "").trim() || "(untitled)";
}
function statusExtract(text) {
  const m = text.match(STATUS_RE);
  return m ? (STATUS_MAP[m[1].toLowerCase()] || null) : null;
}
// Strikethrough heading ("## ~~K11: route optimization~~"): a structural, language-independent "not doing
// this anymore" signal - markdown syntax, not a word in any particular language.
const STRIKETHROUGH_TITLE_RE = /^#{1,6}[^\n]*~~[^~\n]+~~/;
const struckOut = text => STRIKETHROUGH_TITLE_RE.test(String(text || "").split("\n", 1)[0] || "");

// Main entry point. K: a sources.json object (at minimum repo, ref, preread.decisions; preread.decision_title
// is optional). Returns [] if the source isn't defined (doesn't throw); throws if the file/directory/glob
// truly isn't found.
export function decisionsOfRead(K) {
  const filePath = K?.preread?.decisions;
  if (!filePath || !K.repo || !K.ref) return [];
  const titleSourceOf = K.preread?.decision_title || DEFAULT_TITLE;
  const files = filesOfFind(K.repo, K.ref, filePath);
  const negRe = negationRegexFor(K);
  const blocks = [];
  for (const file of files) {
    const content = git(K.repo, "show", `${K.ref}:${file}`);
    for (const b of withBlock(content, titleSourceOf)) blocks.push({ ...b, file });
  }
  // Whole-doc coverage check ("never a silent wrong claim"): if the negation family
  // (EN+TR core plus the product's own glossary.notDoing, if given) matches NOWHERE in the whole doc, and no
  // block carries the language-independent "Status:" line either, and the doc clearly carries more than one
  // decision - this doc is very likely written in a language read-decisions.mjs doesn't recognize at all
  // (not just this one decision). Reporting notDoing:false for every block in that case would be a
  // confident, WRONG claim ("nothing here is rejected") rather than an honest "couldn't tell" - see
  // the language audit's German/Japanese canwe findings. A single-block file is too little signal either
  // way (could just be a short doc with no rejected decisions yet), so it's left readable.
  const wholeDocText = blocks.map(b => b.text).join("\n");
  const anyStatusLine = blocks.some(b => STATUS_RE.test(b.text));
  const statusReadable = blocks.length <= 1 || anyStatusLine || negRe.test(wholeDocText);
  const result = [];
  for (const b of blocks) {
    const status = statusExtract(b.text);
    const struck = struckOut(b.text);
    result.push({
      no: noExtract(b.text, b.file),
      title: titleExtract(b.text),
      text: b.text,
      file: b.file, line: b.line,
      status: statusReadable ? (struck && !status ? "rejected" : status) : (status || "unknown"),
      notDoing: statusReadable ? (negRe.test(statementOf(b.text)) || struck || status === "rejected") : false,
      statusReadable,
      measure: measurementOf(b.text, K),
    });
  }
  return result;
}

// Library, not a CLI: a misdirected `node read-decisions.mjs ...` would otherwise
// print nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "read-decisions.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy shipped\` or \`node skill/tools/preread.mjs\`?`);
  process.exit(1);
}
