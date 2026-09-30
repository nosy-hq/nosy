// PRD auditor: audits the product-decision quality of the PRD spill produces — not a code review; it checks
// evidence, scope, measurement, and decision consistency (internal request: spill writes a PRD in two minutes
// but nothing checks decision quality; agents will implement this PRD).
// Usage: node audit-prd.mjs <prd.md|folder>... [--pm <pm>] [--package <legaltech|fintech|mobile|b2b-saas>] [--json <file>] [--strict]
// Patterns: chatprd.md ("CPO-level coaching" → every finding is justified/named, not generic praise), digidai-product-manager-skills.md
// ("solution smuggling" anti-pattern → check 3), product-on-purpose-pm-skills.md (pm-critic sub-agent → separate from spill, a
// standalone audit script that runs afterward), github-spec-kit.md (confidence + mandatory "Evidence Against the Idea" → check 8,
// Shape Up "appetite" → check 8), kiro.md (Requirements Analysis: scan for contradictions/gaps before coding/writing → checks 7 and 9).
// Deterministic; no LLM or network calls (only local `git show`, when --pm is given).
// Exit code: 1 if there's a "blocker" finding with --strict.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url"; import { patternsOfLoad, refRegex } from "./refs.mjs"; import { small, langOfLoad } from "./text.mjs"; import { decisionsOfRead, NEGATION_RE } from "./read-decisions.mjs";
import { readSources } from "./sources-file.mjs";
const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- argv ---
const argv = process.argv.slice(2);
const al = name => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const jsonOut = al("--json"), pmDir = al("--pm"), pkg = al("--package");
const strictI = argv.indexOf("--strict"); const strict = strictI >= 0; if (strict) argv.splice(strictI, 1);
const goals = argv;
if (!goals.length) { console.error("Usage: node audit-prd.mjs <prd.md|folder>... [--pm <pm>] [--package <legaltech|fintech|mobile|b2b-saas>] [--json <file>] [--strict]"); process.exit(2); }

// --- line-based section parsing: every check works over the same `lines` array + 1-based line numbers ---
const norm = s => s.replace(/\s+/g, " ").trim();
const headings = lines => { const hs = []; lines.forEach((l, i) => { const m = l.match(/^(#{1,6})\s+(.*)$/); if (m) hs.push({ level: m[1].length, title: norm(m[2]), line: i + 1, idx: i }); });
  return hs.map((h, i) => ({ ...h, endIdx: hs[i + 1]?.idx ?? lines.length })); };
const section = (lines, wanted, level = 2) => { const h = headings(lines).find(x => x.level === level && x.title === norm(wanted)); if (!h) return null;
  return { line: h.line, bodyStart: h.line + 1, idx: h.idx, endIdx: h.endIdx, body: lines.slice(h.idx + 1, h.endIdx) }; };
const stripPh = s => s.replace(/<[^<>]*>/g, "");
// A body counts as "empty" if it only has structural marks (heading/list/table marks, numbers, placeholders).
const emptyMu = bodyArr => !stripPh(bodyArr.join("\n")).replace(/^\s*#{1,6}.*$/gm, "").replace(/[-*|:.\d>]/g, "").replace(/\s+/g, "").length;
const refsIn = (lines, re) => { const out = []; lines.forEach((l, i) => { for (const m of l.matchAll(re)) out.push({ ref: m[0].replace(/\s+/g, " "), line: i + 1 }); }); return out; };
const blocks = (src, reStr) => { const out = [], r = new RegExp(reStr, "gm"); let m, last = null; while ((m = r.exec(src))) { if (last) out.push(src.slice(last.i, m.index)); last = { i: m.index }; } if (last) out.push(src.slice(last.i)); return out; };

// --- claim / solution / vagueness patterns (the word lists from the task spec) ---
// these were English-only - zero Turkish coverage, let alone any other language (every
// other check-list in the codebase has at least an EN+TR core, see the language audit). Same shape as
// read-decisions.mjs's NEGATION_RE/glossary.notDoing and read-design.mjs's
// FIELD_FAMILY/glossary.design: an EN core (below), a TR data file
// (skill/data/lang/tr/audit-prd.json), and the product's OWN words from sources.json's `glossary.prd` (keyed
// strong/vague/solution/size/against), merged in - never replacing the EN+TR core. `reOf()` builds each
// regex once K is known (see below, after --pm is parsed).
const TR_PRD = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/audit-prd.json", import.meta.url), "utf8"));
const escLit = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EN_SOURCE = {
  strong: String.raw`\d|\bcustomers?\b|\brivals?\b|\bcompetitors?\b|\beveryone\b|\ba lot\b|\bvery\b`,
  vague: String.raw`\bfast\b|\beasy\b|\bintuitive\b|\bseamless\b|\buser-friendly\b|\bgood\b`,
  solution: String.raw`\badd\p{L}*\b|\bbuttons?\b|\bpages?\b|\bscreens?\b|\bendpoints?\b|\btables?\b|\bmodals?\b|\bbuild\p{L}*\b`,
  size: String.raw`\bappetite\b|\bsize\p{L}*\s*[:=]?\s*(S|M|L|small|medium|large)\b`,
  against: String.raw`counter-evidence|evidence against|why we shouldn't|\brisk\p{L}*\b`,
};
// `glossary.prd` stays a FLAT array of strings, like `glossary.notDoing`/`glossary.design` (internal request
// 104/105) - K.glossary is read generically (as a plain {word: [translations]} map) by half a dozen other
// tools and validated that way by verify-setup.mjs; a nested object here would make every one of those throw.
// Each entry is "<check>:<word>" (check one of strong/vague/solution/size/against); an entry with no known
// prefix is ignored (there's no "general" bucket here - unlike glossary.design, there's no document-wide gate
// these words could still usefully feed).
function prdGlossaryMap(list) {
  const map = {};
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string") continue;
    const m = raw.match(/^(\w+):(.+)$/);
    if (m && Object.prototype.hasOwnProperty.call(EN_SOURCE, m[1]) && m[2].trim()) (map[m[1]] ??= []).push(m[2].trim());
  }
  return map;
}
function reOf(key, glossaryPrd) {
  const extra = [...(TR_PRD[key] || []), ...(Array.isArray(glossaryPrd?.[key]) ? glossaryPrd[key].map(escLit) : [])];
  return new RegExp([EN_SOURCE[key], ...extra].join("|"), "iu");
}
const SOURCE_RE = /\b[0-9a-f]{7,40}\b|#\d+|§\d+[a-z]?|\bK\d+\b|[\w.\-/]+\.\w{1,6}:\d+|https?:\/\/\S+|pm\/rivals\/\S+|\(unverified\)/i;
// The "not doing" family + other real negative-decision phrasings seen in an actual DECISIONS.md (e.g. "no ID
// number is used", K163). NEGATION_RE is now defined in ONE place, read-decisions.mjs;
// here it's only imported.
// Reference pattern: shared helper refs.mjs (sources.json's `refs`, or DEFAULT if missing).
const refPatternOf = K => refRegex(patternsOfLoad(K));
// the product's language, for the "not available in <lang>" notes below - sources.json's
// `language` (when --pm is given) first, otherwise a cheap script guess (never a real language identifier,
// same limitation text.mjs's own langOfText documents) so an ungiven --pm still gets SOME signal for an
// obviously non-Latin PRD. Latin script with no `language` set is left alone (assumed EN/TR-compatible,
// consistent with every existing English-only test) - flagging every English PRD as "unavailable" would be
// noise, not a fix.
const NON_LATIN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Devanagari}]/u;
function productLanguageOf(text, K) {
  const fromK = K ? langOfLoad(K) : null;
  if (fromK && fromK !== "en" && fromK !== "tr") return fromK;
  if (!fromK && NON_LATIN_RE.test(text)) return "an unrecognized script";
  return null;
}
const STOP = new Set(["and", "for", "the", "this", "that", "from", "with", "have", "has",
  "not", "one", "per", "same", "more", "most", "very", "then", "than", "there", "these", "those",
  "into", "about", "being", "doing", "missing", "exists", "decision"]);
const tok = s => (small(s).match(/\p{L}{3,}/gu) || []).filter(w => !STOP.has(w));
// Two-way expansion with K.glossary (TR→EN[]): decisions may be written in Turkish while the request doc is
// English, or the other way around.
const expand = (arr, glossary) => { const set = new Set(arr); if (!glossary) return set; const rev = {};
  for (const [tr, ens] of Object.entries(glossary)) for (const en of ens) (rev[small(String(en))] ??= []).push(tr);
  for (const w of [...set]) { (glossary[w] || []).forEach(e => set.add(small(String(e)))); (rev[w] || []).forEach(t => set.add(t)); }
  return set; };

// --- template (read at run time; no hardcoded list) and package (if given) ---
const templateLines = fs.readFileSync(path.join(SKILL, "templates", "prd.md"), "utf8").split("\n");
// The "Design system" section only applies to work with a screen (dresscode); its absence in a backend-only
// PRD isn't a blocker.
const OPTIONAL_LINKED = /^Design system/i;
const templateSectionsOf = headings(templateLines).filter(h => h.level === 2 && !OPTIONAL_LINKED.test(h.title)).map(h => h.title);
let packageMandatory = [], packagePatterns = [];
if (pkg) { const pf = path.join(SKILL, "packs", `${pkg}.md`);
  if (!fs.existsSync(pf)) console.error(`! pack not found: ${pkg} (${pf})`);
  else { const raw = fs.readFileSync(pf, "utf8");
    packageMandatory = [...((raw.split(/^## 5\./m)[1] || "").split(/^## \d+\./m)[0]).matchAll(/^- \*\*(.+?):\*\*/gm)].map(m => m[1].trim());
    const sec6 = (raw.split(/^## 6\./m)[1] || "").split(/^## \d+\./m)[0];
    packagePatterns = [...(sec6.split(/^### Patterns/m)[1] || "").matchAll(/^- (.+?) :: (.+)$/gm)].map(m => ({ name: m[1], re: new RegExp(m[2].trim(), "i") })); } }

// --- --pm: decisions (read-decisions.mjs: single file/directory/glob) and the request doc, only local `git show` (no network calls) ---
let K = null, decisions = [], requestText = "", decisionRead = "";
if (pmDir) { try { K = readSources(pmDir); } catch (e) { console.error(`! could not read sources.json: ${e.message}`); } }
if (K) { const git = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
  decisionRead = K.preread?.decisions || "DECISIONS.md";
  try { decisions = decisionsOfRead({ ...K, preread: { ...K.preread, decisions: decisionRead } }); } catch { decisions = []; }
  if (K.request?.path) { try { requestText = git("show", `${K.ref}:${K.request.path}`); } catch { requestText = ""; } } }
// built once K is known, so a product-language PRD gets the SAME checks English gets -
// sources.json's `glossary.prd` (strong/vague/solution/size/against) merged with the EN+TR core above.
const glossaryPrd = prdGlossaryMap(K?.glossary?.prd);
const STRONG_RE = reOf("strong", glossaryPrd), VAGUE_RE = reOf("vague", glossaryPrd), SOLUTION_RE = reOf("solution", glossaryPrd),
  SIZE_RE = reOf("size", glossaryPrd), AGAINST_RE = reOf("against", glossaryPrd);
const decisionsExistsMi = decisions.length > 0;
// The old broad K-number scan is kept (not just headings — every "K180" mention in the body also counts as
// a known reference); ADR numbers (read-decisions.mjs's `no` field) now also count as known references.
const knownK = new Set((decisions.map(k => k.text).join("").match(/K\d{2,3}/g)) || []);
const knownRefs = new Set(decisions.map(k => k.no));
// no → decision: to catch a PRD directly referencing a rejected ("notDoing: true",
// read-decisions.mjs) decision.
const decisionByNo = new Map(decisions.map(k => [k.no, k]));
// A rarity filter to avoid a common-word false positive (same idea as gather-evidence.mjs's idf pattern,
// internal request 16): a word that appears in more than 12% of all decision blocks ("same", "system",
// "according to") doesn't count as contradiction evidence — only a rare/distinctive word does.
const allDecisionBlocksOf = decisions.map(k => k.text);
const blockTokenSetsOf = allDecisionBlocksOf.map(b => expand(tok(b), K?.glossary)); // keep the common/rarity math in the same (glossary-expanded) space
const dfRate = t => blockTokenSetsOf.length ? blockTokenSetsOf.filter(s => s.has(t)).length / blockTokenSetsOf.length : 0;
// Pulls only the section NUMBER from lines like "### 75. Title" in the request doc (with K.request.title) —
// the same method lowhanging.mjs uses for its own §${s.no} pattern: the literal "§75" isn't searched for in
// the document (documents usually write "### 75.", "§" is only used in outside references).
const requestTitles = (K?.request?.path && K.request.title && requestText) ? new Set([...requestText.matchAll(new RegExp(K.request.title, "gm"))].map(m => m[1])) : null;
// read-decisions.mjs's `notDoing` field (NEGATION_RE OR "Status: Rejected"); K-item/ADR distinction doesn't matter.
const doesNotDoBlocksOf = decisions.filter(k => k.notDoing);

const Weight = { blocker: 15, "warning": 5, not: 1 };
const RANK = { blocker: 0, "warning": 1, not: 2 };
const Formula = `Starts at 100; each **blocker** −15, each **warning** −5, each **note** −1 (never below 0).`;

function audit(file, text) {
  const lines = text.split("\n"), findings = [];
  const add = (lineValue, name, levelValue, justification, suggestion) => findings.push({ line: lineValue, name, level: levelValue, justification, suggestion });

  // 1) Template sections (+ the package's "Mandatory PRD sections" list, if --package is given)
  for (const title of templateSectionsOf) { const s = section(lines, title);
    if (!s) add(1, `Missing section: ## ${title}`, "blocker", `The "## ${title}" heading exists in the template (templates/prd.md) but not in this PRD.`, `Add the "## ${title}" section.`);
    else if (emptyMu(s.body)) add(s.line, `Empty section: ## ${title}`, "warning", `The heading exists but the body is empty or just a "<…>" placeholder.`, `Write real content, or fill it with evidence.`); }
  const textSmall = small(text);
  for (const label of packageMandatory) { const e = small(label);
    const existsMi = headings(lines).some(h => small(h.title).includes(e)) || textSmall.includes(`**${e}`);
    if (!existsMi) add(1, `Missing package section: ${label} (${pkg})`, "warning", `packs/${pkg}.md's "Mandatory PRD sections" list, but it's missing from the PRD as a heading or bullet.`, `Add a heading or a "**${label}:**" bullet.`); }

  // never silent - a word-list check (unsourced-claim/vague/solution/counter-evidence/
  // size) that never matches anywhere in the WHOLE document, in a product language it can't recognize (no
  // glossary.prd entry for that check, and the EN+TR core found nothing at all), says so instead of quietly
  // reporting a PRD clean of that signal - the same "no built-in or glossary word matched anywhere" shape
  // read-design.mjs's headings_unrecognized gate uses.
  const productLang = productLanguageOf(text, K);
  // Heading/template scaffolding lines (e.g. "## Backend ↔ screen") stay English by design (category (a),
  // the language audit) and would otherwise make e.g. SOLUTION_RE's "screen" match the PRD's OWN "Backend
  // ↔ screen" heading - a false "this check found something" that has nothing to do with the product's prose.
  const bodyOnly = lines.filter(l => !/^\s*#{1,6}\s/.test(l)).join("\n");
  const noteIfUnavailable = (key, re, label) => {
    if (!productLang) return;
    if (Array.isArray(glossaryPrd?.[key]) && glossaryPrd[key].some(s => typeof s === "string" && s.trim())) return; // a glossary was given - the check runs for real
    if (re.test(bodyOnly)) return; // the built-in EN/TR core matched something in the product's own prose - don't second-guess it
    add(1, `${label} not available in ${productLang}`, "not",
      `No built-in (English/Turkish) or \`glossary.prd.${key}\` word for this check matched anywhere in the document; the product's language is ${productLang} and sources.json has no \`glossary.prd.${key}\`.`,
      `Add sources.json → glossary.prd.${key} with this product's own words (see move-in.md step 5), or read this PRD by hand for this signal.`);
  };
  noteIfUnavailable("strong", STRONG_RE, "Unsourced-claim check");
  noteIfUnavailable("vague", VAGUE_RE, "Vague-word check");
  noteIfUnavailable("solution", SOLUTION_RE, "Solution-smuggling check");
  noteIfUnavailable("against", AGAINST_RE, "Counter-evidence check");
  noteIfUnavailable("size", SIZE_RE, "Size/appetite check");

  // 2) Evidence: do the strong claim sentences have a source (excluding meta lines before the first heading and table rows)
  const ilkTitle = headings(lines).find(h => h.level === 2)?.idx ?? 0;
  // Measurement targets ("90% within the first 7 days") and open questions aren't claims; the counter-evidence
  // line is also deliberately a guess. Flagging a number there as an "unsourced claim" was punishing a good
  // PRD (2 false warnings in good.md).
  const CLAIM_EXCLUDED = /measure|metric|open question|counter-evidence|evidence against|risk/i;
  const sectionStartOf = headings(lines).filter(h => h.level === 2);
  const claimExcluded = i => { const b = [...sectionStartOf].reverse().find(h => h.idx <= i); return !!b && CLAIM_EXCLUDED.test(b.title); };
  let strong = 0, sourced = 0;
  lines.forEach((l, i) => { if (i < ilkTitle || /^\s*#{1,6}\s/.test(l) || /^\s*\|/.test(l) || claimExcluded(i) || /^\s*[-*]?\s*\**counter-evidence/i.test(l)) return;
    const li = norm(l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")); // strip list marker/number so a numbered item's leading digit doesn't trigger a false claim
    for (const c of li.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)) { if (!c.trim() || /\?\s*$/.test(c) || !STRONG_RE.test(c)) continue; strong++; // a question isn't a claim
      if (SOURCE_RE.test(c)) { sourced++; continue; }
      add(i + 1, "Unsourced claim", "warning", `Strong wording with no source: "${c.trim().slice(0, 140)}"`, `Add a commit hash, #N, §N, K\\d+, file:line, URL, or "(unverified)".`); } });
  const evidenceRate = strong ? Math.round(100 * sourced / strong) : null;

  // 3) Solution smuggling (digidai-product-manager-skills.md)
  const problem = section(lines, "Problem");
  if (problem) problem.body.forEach((l, i) => { if (/^\s*#{1,6}\s/.test(l) || !l.trim()) return; const m = l.match(SOLUTION_RE);
    if (m) add(problem.bodyStart + i, "Solution smuggling", "warning", `Solution language in the "Problem" section: "${m[0]}" — "${l.trim().slice(0, 140)}"`, `Describe the problem without a solution; move the proposed solution to "Scope".`); });

  // 4) An unmeasurable acceptance/measurement
  const metrics = section(lines, "Measurement");
  if (metrics && !/\d/.test(metrics.body.join(" "))) add(metrics.line, "No number/threshold/duration in the measurement", "warning", `The "Measurement" section has no number at all; "success" can't be counted.`, `Add a threshold, percentage, duration, or count (e.g. "90% within 7 days").`);
  const acceptSectionsOf = [metrics, ...headings(lines).filter(h => h.level >= 2 && /acceptance/i.test(h.title)).map(h => ({ bodyStart: h.line + 1, body: lines.slice(h.idx + 1, h.endIdx) }))].filter(Boolean);
  for (const b of acceptSectionsOf) b.body.forEach((l, i) => { const m = l.match(VAGUE_RE); if (m) add(b.bodyStart + i, `Vague measurement word: "${m[0]}"`, "warning", `An unmeasurable adjective is used: "${l.trim().slice(0, 140)}"`, `Replace the adjective with a number (e.g. "fast" → "under 300ms").`); });

  // 5) Out of scope
  const scope = section(lines, "Scope");
  let existsBlock = null;
  if (scope) { const yi = scope.body.findIndex(l => /^\s*-\s*Out\s*:/i.test(l));
    if (yi < 0) add(scope.line, "No Out: line in scope", "warning", `No "- Out:" line found in the "Scope" section.`, `Add an "- Out: …" line; state what's deliberately not being done.`);
    else { const value = scope.body[yi].replace(/^\s*-\s*Out\s*:/i, "").trim();
      if (!value || /^<[^<>]*>$/.test(value)) add(scope.bodyStart + yi, "Out: line is empty", "warning", `The "- Out:" line exists but its value is empty or a placeholder.`, `Write at least one item that's out of scope.`); }
    const vi = scope.body.findIndex(l => /^\s*-\s*In\s*:/i.test(l));
    if (vi >= 0) { const vj = scope.body.findIndex((l, k) => k > vi && /^\s*-\s*Out\s*:/i.test(l));
      existsBlock = { text: scope.body.slice(vi, vj < 0 ? undefined : vj).join("\n"), line: scope.bodyStart + vi }; } }

  // 6) Backend ↔ screen table
  const be = section(lines, "Backend ↔ screen");
  if (be) { const pipeLines = be.body.map((l, i) => ({ l, i })).filter(x => /^\s*\|/.test(x.l) && !/^\s*\|[\s:|-]+\|\s*$/.test(x.l));
    const veri = pipeLines.slice(1); // the first remaining "|" row is the column header
    if (!veri.length) add(be.line, "No rows in the Backend ↔ screen table", "warning", `The table has no data rows besides the header.`, `Add a row for every piece (endpoint/table/field).`);
    else for (const { l, i } of veri) { const cells = l.split("|"); if (norm(cells[0] ?? "x") === "") cells.shift(); if (cells.length && norm(cells[cells.length - 1]) === "") cells.pop();
      const h = cells.map(c => c.trim()), status = h[2] || "", part = h[0] || "?";
      if (!status) add(be.bodyStart + i, `Empty Status column: ${part}`, "warning", `The "Status" column is empty on the "${part}" row.`, `Fill in the status: ready / to do / partial, etc.`); } }

  // 7) Consistency with decisions — K-number/ADR-number/§N/"not doing" only with --pm; the package's never list runs
  // independently with --package (in code: the two are separate preconditions)
  if (K) { if (!decisionsExistsMi) add(1, "Could not read the DECISIONS doc", "warning", `Could not read ${K.repo}@${K.ref}:${decisionRead}; the K-number check was skipped.`, `Check sources.json → preread.decisions (verify-setup.mjs).`);
    if (K.request?.path && !requestText) add(1, "Could not read the request doc", "warning", `Could not read ${K.repo}@${K.ref}:${K.request.path}; the §N check was skipped.`, `Check sources.json → request.path.`);
    // never silent, same gap the STRONG_RE/VAGUE_RE/etc. checks above have: read-
    // decisions.mjs's statusReadable is false for the WHOLE decisions doc - the
    // "Refers to a rejected decision" check below can't tell notDoing from not-notDoing in this language, so
    // it would otherwise silently never fire, reading as "nothing here contradicts a settled decision" when
    // really the doc just couldn't be read.
    if (decisionsExistsMi && decisions[0]?.statusReadable === false)
      add(1, "Decision status not verifiable in this language", "not", `"${decisionRead}" doesn't match any built-in (English/Turkish) or sources.json \`glossary.notDoing\` phrase anywhere in the doc - read-decisions.mjs can't tell which decisions are "not doing" in this language, so the "Refers to a rejected decision" check below couldn't run for real.`, `Add sources.json → glossary.notDoing with this product's own "not doing this" words (see move-in.md step 5), then rerun.`);
    for (const { ref, line } of refsIn(lines, refPatternOf(K))) {
      if (/^K\d+/.test(ref)) { const knum = ref.match(/^K\d+/)[0];
        if (decisionsExistsMi && !knownK.has(knum)) add(line, `K-number not in DECISIONS: ${knum}`, "blocker", `The PRD refers to ${knum}, but "${decisionRead}" has no such heading.`, `Fix the number, or link it to a real decision.`);
        // the decision exists BUT is "not doing" (rejected) — the PRD still refers to it.
        else if (decisionByNo.get(knum)?.notDoing) add(line, `Refers to a rejected decision: ${knum}`, "warning", `The PRD refers to ${knum}, but that decision is "not doing" (rejected/negative).`, `Confirm with the owner: is ${knum} still valid, or should the PRD be updated?`); }
      // References like ADR-<no> (not K, not §): verified against read-decisions.mjs's `no` field (docs/adr/ etc.).
      else if (/^ADR-\d+$/i.test(ref)) { const adr = ref.toUpperCase();
        if (decisionsExistsMi && !knownRefs.has(adr)) add(line, `Reference not in the decisions: ${adr}`, "blocker", `The PRD refers to ${adr}, but "${decisionRead}" has no such decision.`, `Fix the number, or link it to a real decision.`);
        else if (decisionByNo.get(adr)?.notDoing) add(line, `Refers to a rejected decision: ${adr}`, "warning", `The PRD refers to ${adr}, but that decision is "not doing" (rejected/negative).`, `Confirm with the owner: is ${adr} still valid, or should the PRD be updated?`); }
      else if (ref.startsWith("§") && requestTitles && !requestTitles.has(ref.slice(1))) add(line, `Reference not in the request doc: ${ref}`, "warning", `"${ref}" isn't among the section numbers in ${K.request.path}.`, `Verify the item number.`); }
    if (existsBlock) { const existsTok = expand(tok(existsBlock.text), K.glossary), matches = [];
      for (const k of doesNotDoBlocksOf) { const knum = k.no, b = k.text;
        // A single shared word can be misleading (e.g. "system"); 2+ shared rare words is reliable, a single word
        // needs to be much rarer (≤4%).
        const candidates = [...expand(tok(b), K.glossary)].filter(t => t.length >= 4 && existsTok.has(t) && dfRate(t) <= 0.12);
        const common = candidates.length >= 2 ? candidates : candidates.filter(t => dfRate(t) <= 0.04);
        if (common.length) matches.push({ knum, common, score: common.reduce((s, t) => s - Math.log(Math.max(dfRate(t), 0.001)), 0) }); }
      // In a large DECISIONS doc, two shared words flagged five different decisions at once (5 candidates in one
      // trial run, 1 correct). The strongest 2 candidates are shown; it's a "blocker" only for the strongest, with
      // 3+ shared rare words — the rest are "warning", and how many were left out becomes a "note".
      matches.sort((a, b) => b.score - a.score).slice(0, 2).forEach((e, n) => add(existsBlock.line, `May conflict with a "not doing" decision: ${e.knum}`, n === 0 && e.common.length >= 3 ? "blocker" : "warning", `Scope/In shares (rare) words with decision ${e.knum}: ${e.common.slice(0, 4).join(", ")}.`, `Confirm with the owner: is ${e.knum} still valid, or should it come out of Scope?`));
      if (matches.length > 2) add(existsBlock.line, `${matches.length - 2} weaker "not doing" matches not shown`, "not", `${matches.slice(2).map(e => e.knum).join(", ")} also share a word, but more weakly.`, `Check these decisions too if needed.`); } }
  if (pkg && existsBlock) for (const d of packagePatterns) if (d.re.test(existsBlock.text)) add(existsBlock.line, `Conflicts with the never list: ${d.name} (${pkg})`, "blocker", `Scope/In matches packs/${pkg}.md's "Never list" pattern: "${d.name}".`, `Remove it from Scope/In, or confirm with the owner.`);

  // 8) Counter-evidence and size — github-spec-kit.md: confidence/"Evidence Against the Idea", Shape Up "appetite"
  if (!AGAINST_RE.test(text)) add(1, "No counter-evidence / risk section", "not", `Neither "counter-evidence", nor "why we shouldn't", nor "risk" appears.`, `Add a short "Counter-evidence" or "Risk" item (like spec-kit's mandatory "Evidence Against the Idea").`);
  if (!SIZE_RE.test(text)) add(1, "No size/appetite", "not", `No S/M/L size or Shape Up "appetite" (day/week/month budget) is mentioned.`, `Add a line like "Size: S/M/L" or "Appetite: small (days)".`);

  // 9) Open questions — kiro.md: scan for gaps before writing
  const open = section(lines, "Open questions");
  if (open && emptyMu(open.body)) add(open.line, "No open question", "not", `The section exists but has no items.`, `Write at least one open question; having none usually means either this is a very well-understood piece of work, or there are unasked questions.`);

  findings.sort((a, b) => RANK[a.level] - RANK[b.level] || a.line - b.line);
  const numbers = { blocker: findings.filter(b => b.level === "blocker").length, warning: findings.filter(b => b.level === "warning").length, not: findings.filter(b => b.level === "not").length };
  const score = Math.max(0, 100 - findings.reduce((s, b) => s + Weight[b.level], 0));
  return { file, score, evidenceRate, numbers, findings };
}

function sectionWrite(r) {
  let o = `## ${r.file} · score ${r.score}/100\n\n`;
  o += `Score: ${Formula} Evidence rate (sourced/strong claims): ${r.evidenceRate === null ? "—" : r.evidenceRate + "%"} · blocker ${r.numbers.blocker} · warning ${r.numbers.warning} · note ${r.numbers.not}\n\n`;
  if (!r.findings.length) return o + "No findings.\n\n";
  o += `**Fix these ${Math.min(3, r.findings.length)} first:**\n\n`;
  r.findings.slice(0, 3).forEach((b, i) => o += `${i + 1}. line ${b.line} · **${b.name}** (${b.level}) — ${b.justification}\n`);
  o += `\n### Findings\n\n| Line | Level | Name | Justification | Suggestion |\n|---|---|---|---|---|\n`;
  r.findings.forEach(b => o += `| ${b.line} | ${b.level} | ${b.name.replace(/\|/g, "/")} | ${b.justification.replace(/\|/g, "/")} | ${b.suggestion.replace(/\|/g, "/")} |\n`);
  return o + "\n";
}

function expandPaths(ps) { const out = [];
  for (const p of ps) { if (!fs.existsSync(p)) { console.error(`! path not found: ${p}`); continue; }
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p, { recursive: true })) { const fp = path.join(p, String(f)); if (fp.endsWith(".md") && fs.statSync(fp).isFile()) out.push(fp); }
    else out.push(p); }
  return out; }

const files = expandPaths(goals);
const results = files.map(f => audit(f, fs.readFileSync(f, "utf8")));
let out = `# PRD audit · ${new Date().toISOString().slice(0, 10)}\n\n`;
if (results.length > 1) out += `| File | Score | Blocker | Warning | Note |\n|---|---|---|---|---|\n${results.map(r => `| ${r.file} | ${r.score} | ${r.numbers.blocker} | ${r.numbers.warning} | ${r.numbers.not} |`).join("\n")}\n\n`;
for (const r of results) out += sectionWrite(r);
process.stdout.write(out);
if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({ type: "prd-audit", generated: new Date().toISOString(), files: results.map(r => ({ file: r.file, score: r.score, evidenceRate: r.evidenceRate, numbers: r.numbers, findings: r.findings })) }, null, 1));
if (strict && results.some(r => r.findings.some(b => b.level === "blocker"))) process.exit(2); // exit contract: 2 = a blocker
