// A deterministic evidence skeleton for "can we do this?". The agent gives the final verdict - this
// script only gathers the evidence and writes a guess.
// Usage: node canwe.mjs <pm folder> "<question>" [extra words...]
// Steps: (a) expands the words with sources.json's `glossary` (TR<->EN); (b) finds endpoints whose path/file
// matches, with their on-screen status, from the inventory (state/inventory.json, or computes it by
// importing inventory.mjs if missing); (c) runs gather-evidence.mjs as a subprocess with the expanded words
// (gather-evidence.mjs ITSELF IS UNCHANGED). Writes a gracefully missing section, without crashing, if
// gather-evidence.mjs is missing or pm/sources.json is missing.
import { localDay } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { small, root, ascii, words as tokens, langOfLoad } from "./text.mjs"; import { NEGATION_RE, negationRegexFor, decisionsOfRead } from "./read-decisions.mjs";
import { demandLoad, demandForQuestion, demandLine, isCluster, interviewsLoad, interviewsForQuestion, interviewLine } from "./demand.mjs";
import { readSources } from "./sources-file.mjs";
import { redactLine } from "./redact.mjs"; // a line of committed code prints as file:line, a secret in it hidden

const [pm = "pm", question = "", ...extra] = process.argv.slice(2);
if (!question) { console.error('Usage: node canwe.mjs <pm folder> "<question>" [extra words]'); process.exit(1); }
const K = readSources(pm);
langOfLoad(K); // sources.json's `language`, read once so text.mjs's words()/root() below pick it up

// --- (a) word expansion: text.mjs's shared rough Turkish stem + a two-way glossary ---
const low = small;
const glossary = K.glossary || {};
const reverse = {}; for (const [tr, ens] of Object.entries(glossary)) for (const en of ens) (reverse[low(en)] ??= []).push(tr);
// An exact match isn't enough: roughly stemming a Turkish inflected form (e.g. "files" as "dosyalari") only
// trims trailing suffixes, so it can still miss the glossary's base key ("dosya"). A prefix match is added
// (roughly good enough for Turkish inflection suffixes; keys longer than 3 characters are searched to avoid
// false matches on short keys).
const glossarySearch = (w, s) => { if (s[w]) return s[w]; const k = Object.keys(s).find(k => k.length > 3 && (w.startsWith(k) || k.startsWith(w))); return k ? s[k] : null; };
// Blind test v2 (kill criterion 2): "ile", "miyiz?", "yapabilir" used to become concept groups of their own, so
// an endpoint could be a "strong match" on "ile" + one domain word. Question fillers go first: particles,
// pronouns, the "can we" modal ending (gönderebilir → gönder) and generic verbs (yap, göster, show, make).
// Punctuation is split off by text.mjs's tokenizer ("miyiz?" is no longer a word). Turkish lists live in
// data/lang/tr/canwe.json.
const TRQ = (() => { try { return JSON.parse(fs.readFileSync(new URL("../data/lang/tr/canwe.json", import.meta.url), "utf8")); } catch { return {}; } })();
const EN_FILLERS = "can could would will we our us you your the and for with from into onto this that these those there how what when which whether still any all some get let make show add build have has had does did are was were been being able way possible possibly".split(" ");
const FILLERS = new Set([...EN_FILLERS, ...(TRQ.fillers || [])].map(w => low(w)));
const GENERIC_VERBS = new Set((TRQ.genericVerbs || []).map(w => low(w)));
const modalRe = TRQ.modalEnding ? new RegExp(`^(.{2,}?)${TRQ.modalEnding}$`) : null;
function topicWords(text) {
  const out = [];
  for (let w of tokens(text, 1)) {
    if (FILLERS.has(w)) continue;
    const m = modalRe && w.match(modalRe);
    if (m) { w = m[1]; if (GENERIC_VERBS.has(w)) continue; }
    if (w.length > 2 || /^[a-z0-9]{2,}$/i.test(w) && w === w.toUpperCase()) out.push(w);
  }
  return [...new Set(out)];
}
const raw = topicWords([question, ...extra].join(" "));
// The question as the other scripts should read it: topic words only (gather-evidence and measure-size split
// their topic on spaces themselves, fillers included).
const topic = raw.join(" ") || question;
// Each input word starts its own "concept group" (itself + its stem + its translation, both ways). canwe's
// endpoint matching runs on these groups: a single shared word (e.g. "client" turns up in dozens of
// endpoints in most products) doesn't count as strong evidence on its own; see matchingEndpoints() below.
const groups = raw.map(w => {
  const k = root(w), set = new Set([w, k]);
  (glossarySearch(w, glossary) || glossarySearch(k, glossary) || []).forEach(e => set.add(low(e)));
  (glossarySearch(w, reverse) || glossarySearch(k, reverse) || []).forEach(t => set.add(low(t)));
  return [...set].filter(x => x.length > 2);
});
const words = [...new Set(groups.flat())];

// --- (b) inventory: read from file, or compute by importing inventory.mjs (this must
// never silently fall through to "no trace" just because move-in's tour never ran `nosy inventory` — either
// the on-the-fly compute below succeeds (said plainly, so the agent knows the number wasn't cached), or it
// fails and the output says so by name instead of reading like a plain absence of evidence) ---
let EN, inventoryStatus = "cached";
const envPath = path.join(pm, "state", "inventory.json");
if (fs.existsSync(envPath)) { try { EN = JSON.parse(fs.readFileSync(envPath, "utf8")); } catch { EN = null; inventoryStatus = "unreadable"; } }
else inventoryStatus = "missing";
if (!EN) {
  try { const { compute } = await import(new URL("./inventory.mjs", import.meta.url)); EN = compute(pm); if (inventoryStatus === "missing") inventoryStatus = "computed"; }
  catch { EN = null; inventoryStatus = "failed"; }
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const groupRe = groups.filter(g => g.length).map(g => new RegExp(g.map(escRe).join("|"), "i"));
// An endpoint whose path or filename matches at least two concept groups is a "strong match" (if there's
// only one group, one match is enough). This keeps a very common single word (e.g. "client") from randomly
// flagging an unrelated endpoint (e.g. /clients) as relevant; gather-evidence also brings in real text
// evidence (decisions/request doc).
// If there's no strong match, fall back to a single-concept match, but only if that concept is rare
// (in at most 5% of endpoints, minimum 8): "export" appearing in 13 of 489 endpoints is meaningful;
// "client" appearing everywhere is not brought in.
//
// rarity alone isn't enough context — a rare-but-generic term (e.g. "client") can
// still land on an endpoint for a different audience/surface than the question asks about (a customer-
// facing "client portal" question matching an admin-only "client-infos" endpoint that just happens to
// share the word "client"). Two changes:
//  - every match now records WHICH concept group(s) it hit (`matchedOn`), so the agent sees why an
//    endpoint showed up instead of having to re-derive it;
//  - an endpoint's audience is guessed from its path/file/area (admin/internal/backoffice/staff/ops
//    segment vs. everything else); if the question itself names an audience and it disagrees with the
//    endpoint's, the match is demoted out of "strong" into "weak" regardless of concept-group count.
// A single-concept-group match, or an audience-mismatched match, is never mixed into the strong section:
// it's reported separately as "weak — verify" so the agent doesn't read it as confirmed evidence.
// "internal" is deliberately left out here even though it's an admin-ish word: in a Go backend it's also
// the standard package-layout directory (internal/<feature>/http/routes.go everywhere), so matching it
// against the FILE path would tag almost every endpoint as "admin" (confirmed against the first product's real
// inventory: 488 of 489 files sit under some internal/ directory). It's still checked in the PATH, where
// an actual "/internal/..." URL prefix is a real audience signal, not a source-layout artifact.
const ADMIN_PATH_RE = /(^|[/_-])(admin|internal|backoffice|staff|ops)([/_-]|$)/i;
const ADMIN_FILE_RE = /(^|[/_-])(admin|backoffice|staff|ops)([/_-]|$)/i;
const audienceOf = e => (ADMIN_PATH_RE.test(e.path || "") || ADMIN_FILE_RE.test(e.file || "") || ADMIN_FILE_RE.test(e.area || "")) ? "admin" : "customer";
const ADMIN_TERMS = ["admin", "internal", "backoffice", "staff", "ops", "employee", "operator", "dahili", "yonetici", "calisan"];
const CUSTOMER_TERMS = ["customer", "client", "portal", "musteri", "muvekkil", "selfservice", "member"];
const termHit = (w, list) => list.some(t => w === t || (w.length > 3 && t.length > 3 && (w.startsWith(t) || t.startsWith(w))));
// ASCII-fold before comparing: the words array keeps Turkish letters as typed ("müvekkil"), the term lists
// are plain ASCII ("muvekkil") — without folding, a Turkish word would never match its own audience term.
const wordsAscii = words.map(w => ascii(w));
const hasAdminTerm = wordsAscii.some(w => termHit(w, ADMIN_TERMS));
const hasCustomerTerm = wordsAscii.some(w => termHit(w, CUSTOMER_TERMS));
const questionAudience = hasAdminTerm && !hasCustomerTerm ? "admin" : hasCustomerTerm && !hasAdminTerm ? "customer" : null;

function matchingEndpoints() {
  if (!EN || EN.backend_missing || !groupRe.length) return { strong: [], weak: [] };
  const endpoints = EN.endpoints || [], required = Math.min(2, groupRe.length);
  const text = e => `${e.path} ${e.file}`.toLowerCase();
  const candidate = endpoints.map(e => ({ e, hit: groupRe.map(re => re.test(text(e))) }));
  const matchedOn = c => groups.filter((g, i) => c.hit[i]).map(g => g[0]).join(", ");
  const mismatchOf = c => questionAudience !== null && audienceOf(c.e) !== questionAudience;
  const decorate = c => ({ ...c.e, matchedOn: matchedOn(c), audienceMismatch: mismatchOf(c) });

  let strongC = candidate.filter(x => x.hit.filter(Boolean).length >= required);
  strongC.sort((a, b) => b.hit.filter(Boolean).length - a.hit.filter(Boolean).length || a.e.path.length - b.e.path.length);
  let weakList = [];
  if (strongC.length || required < 2) {
    // audience mismatch demotes an otherwise-strong match to "weak" — a shared word isn't enough when
    // the endpoint clearly belongs to a different surface than the one the question is asking about.
    const kept = strongC.filter(c => !mismatchOf(c));
    weakList = strongC.filter(c => mismatchOf(c)).map(decorate);
    strongC = kept;
  } else {
    const df = groupRe.map((_, i) => candidate.filter(x => x.hit[i]).length), limit = Math.max(8, Math.round(endpoints.length * 0.05));
    const rare = df.map(n => n > 0 && n <= limit);
    const weak = candidate.filter(x => x.hit.some((h, i) => h && rare[i]));
    weak.sort((a, b) => Number(a.e.used) - Number(b.e.used) || a.e.path.length - b.e.path.length);
    weakList = weak.map(decorate);
  }
  return { strong: strongC.slice(0, 8).map(decorate), weak: weakList.slice(0, 8) };
}
// the owner's rejection decisions (learn.mjs ret --type canwe) drop endpoints
// already ruled out on the same topic before matching (a light touch; the real/deep filter is in
// measure-size.mjs). Silently skipped if learned.json is missing or has no rule of kind "ret" for "canwe".
let rejectRulesOf = [];
try {
  const O = JSON.parse(fs.readFileSync(path.join(pm, "learned.json"), "utf8"));
  const b = localDay();
  rejectRulesOf = (O.rules || []).filter(k => k.tip === "reject" && (k.type === "canwe" || k.type === "all") && (!k.end || k.end >= b));
} catch {}
function contextIsMatching(context) {
  const bw = low(context || "").split(/[\s,]+/).filter(w => w.length > 2).map(root); if (!bw.length) return false;
  const sw = new Set(words.map(root));
  return bw.filter(w => sw.has(w)).length / bw.length >= 0.5;
}
const appliedReject = rejectRulesOf.filter(k => contextIsMatching(k.context));
const withRetryMi = e => appliedReject.some(k => `${e.path} ${e.file}`.toLowerCase().includes(low(k.key || "")));

const rawMatches = matchingEndpoints();
const strongMatches = rawMatches.strong.filter(e => !withRetryMi(e));
const weakMatches = rawMatches.weak.filter(e => !withRetryMi(e));
// Only strong (audience-consistent, multi-concept or single-concept-query) matches drive "on screen" and
// the suggested verdict below — a weak match (single rare concept, or an audience mismatch) is shown to
// the agent but never treated as confirmed evidence on its own.
const noScreenMatch = strongMatches.filter(e => !e.used && !e.infrastructure);
const usedMatch = strongMatches.filter(e => e.used);

// --- surface check: a question can name one surface ("calendar") while
// the only evidence sits on a different one (e.g. a records/table view) that just happens to share a word.
// inventory.mjs already buckets every endpoint into an `area` (first URL path segment); that's the same
// vocabulary a question's own words are compared against here — no new concept, just cross-checking one
// field that was already being read.
const inventoryAreas = EN && !EN.backend_missing ? [...new Set((EN.endpoints || []).map(e => low(e.area || "")).filter(Boolean))] : [];
const areaWordMatch = (w, a) => { const wa = ascii(w), aa = ascii(a); return wa.length > 2 && aa.length > 2 && (wa.startsWith(aa) || aa.startsWith(wa)); };
const askedAreas = inventoryAreas.filter(a => words.some(w => areaWordMatch(w, a)));
const evidenceAreas = [...new Set((strongMatches.length ? strongMatches : weakMatches).map(e => low(e.area || "")).filter(Boolean))];
const surfaceMismatch = askedAreas.length > 0 && evidenceAreas.length > 0 && !evidenceAreas.some(a => askedAreas.includes(a));

// --- anchor terms in the code (blind test v2): plain Claude beat Nosy by reading the code; Nosy's answers leaned on
// documents and word-matched endpoints. Each concept group is counted across the repo's files at the
// integration ref (`git grep -l`). Words found in many files are the product's own vocabulary ("tebligat" in a
// tebligat product) and can't anchor anything; the rarest groups are the question's anchors ("KEP", "redline"),
// and their actual lines in the code are listed as leads. An anchor with no trace anywhere is evidence too.
const repo = K.repo || ".", ref = K.integrationBranch || K.ref || "HEAD";
const git = (args, opts = {}) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"], ...opts });
let fileCount = 0;
try { fileCount = git(["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean).length; } catch {}
// .po/.pot (gettext translation catalogs) and locale directories are excluded the same way docs are: a
// translated UI string repeats every question word in every shipped language (Twenty: "csv" in 580+ .po
// files), which drowns out the one file that actually implements the feature. Not product-specific — any
// i18n'd product ships these.
const isDoc = f => /\.(md|mdx|txt|rst|adoc|po|pot)$/i.test(f) || /(^|\/)([\w.]+[-_])?docs?\//i.test(f) || /(^|\/)locales?\//i.test(f);
// Vendored/bundled/generated files: a committed minified bundle (.yarn/releases/*.cjs,
// vendor/, node_modules/ when it isn't gitignored, a lockfile) is thousands of lines of someone else's code
// that happens to contain most English words somewhere — with the rarest-word fallback above, one of these
// can out-rank the product's own files and even trip the "Deliberately off?" structural check on a line that
// has nothing to do with the question. These never carry product-relevant signal, so they're dropped from
// the anchor search entirely (not just deprioritized) — generic hygiene, not specific to any one product.
const isVendor = f => /(^|\/)(vendor|vendored|dist|build|node_modules|\.yarn|\.pnp|bower_components|third[-_]?party|generated)\//i.test(f)
  || /\.(lock|snap|min\.js|min\.css)$/i.test(f) || /-lock\.(json|yaml)$/i.test(f);
// Search forms for a group: the words as typed and their glossary translations (not the rough stem, which
// is shorter than any real identifier), each also ASCII-folded. Short all-letter terms (KEP, ZIP) match as
// whole words; longer ones as a prefix, so "redline" finds "redlines" and "tebligat" finds "tebligatlar".
const formsOf = g => [...new Set(g.flatMap(x => [x, ascii(x)]))].filter(x => x.length > 2);
// Whole word for short terms (KEP, ZIP), word-start prefix for longer ones. PCRE (-P) when this git has it;
// otherwise -w / a plain substring, which is close enough to count files. `git grep` exits 1 on no match.
const reEsc = f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A word of the question inside a text: at the start of a word, and, for a short term (KEP, ZIP), at its end. Unicode-aware: `\b` is ASCII-only, so it never matched a Japanese or Chinese term at all.
const termIn = (f, text) => new RegExp(`(?<![\\p{L}\\p{N}])${reEsc(ascii(f.toLowerCase()))}${f.length <= 4 && /^[\\x00-\\x7f]+$/.test(f) ? "(?![\\p{L}\\p{N}])" : ""}`, "u").test(text); // the whole-word rule is for short Latin terms; a short Japanese term (ルート) is a prefix of the next word by nature
function grepArgs(forms, mode) {
  if (mode === "pcre") return ["-P", ...forms.flatMap(f => ["-e", f.length <= 4 ? `\\b${reEsc(f)}\\b` : `\\b${reEsc(f)}`])];
  return ["-F", ...forms.flatMap(f => ["-e", f])];
}
let grepMode = "pcre";
function gitGrep(extra, forms, paths = []) {
  for (const mode of grepMode === "pcre" ? ["pcre", "plain"] : ["plain"]) {
    try { return git(["grep", ...extra, "-i", "-I", ...grepArgs(forms, mode), ref, "--", ...paths]); }
    catch (e) { if (e.status === 1) return ""; if (mode === "pcre") { grepMode = "plain"; continue; } return ""; }
  }
  return "";
}
function grepGroup(g) {
  const forms = formsOf(g); if (!forms.length || !fileCount) return null;
  const files = gitGrep(["-l"], forms).split("\n").filter(Boolean).map(l => l.replace(`${ref}:`, "")).filter(f => !isVendor(f));
  return { group: g, term: g[0], forms, files };
}
const counted = groups.map(grepGroup).filter(Boolean);
const commonLimit = Math.max(25, Math.round(fileCount * 0.01));
// A word that's only in docs (a Turkish question word in translated docs) is rarer than any code name, but it
// can't show where the feature lives: words the code has take the three anchor slots first (Twenty: "tekrarlayan"
// in 7 docs pushed out "CronTrigger" in 162 code files, and the verdict said the names weren't in the code).
const hasCode = c => c.files.some(f => !isDoc(f));
let anchors = counted.filter(c => c.files.length <= commonLimit).sort((a, b) => (hasCode(b) - hasCode(a)) || (a.files.length - b.files.length)).slice(0, 3);
let commonWords = counted.filter(c => c.files.length > commonLimit);
// every topic word can be "too common" in a big repo (Twenty: "export" in 25k+ files) —
// the old code dropped every anchor and answered "no rare term to anchor on", which reads the same as "this
// wasn't found" even though the words simply weren't rare enough. When NOTHING clears commonLimit but there
// ARE counted words, fall back to the rarest N anyway (the threshold is a quality signal, not a hard gate);
// the output says plainly that this is a fallback, so the agent reads these anchors with that in mind.
const anchorsAreFallback = !anchors.length && counted.length > 0;
if (anchorsAreFallback) {
  anchors = [...counted].sort((a, b) => a.files.length - b.files.length).slice(0, 3);
  commonWords = counted.filter(c => !anchors.includes(c));
}
// A file that matches MORE THAN ONE of the chosen anchors is much stronger evidence than a file that only
// happens to share one common word — most useful exactly when anchors are common words picked by the
// fallback above, but harmless (a no-op tie-break) when anchors are already rare: with a single anchor, or
// disjoint anchor file sets, every file's overlap count is the same constant and the stable sort changes nothing.
const anchorFileSets = anchors.map(a => new Set(a.files));
const overlapCount = f => anchorFileSets.reduce((n, s) => n + (s.has(f) ? 1 : 0), 0);
// Application code first, then tests, then migrations/generated files, at most two lines per file: the line
// that says what the product does with the term (a rejected type, a disabled flag) is rarely in a migration.
const fileRank = f => /(^|\/)(migrations?|generated|vendor|dist|build)\//i.test(f) || /\.(sql|lock|snap)$/i.test(f) ? 2 : /(^|\/)(tests?|__tests__|spec|e2e|fixtures?)\/|[._-](test|spec)\.[a-z]+$|_test\.go$/i.test(f) ? 1 : 0;
function anchorLines(c, limit = 10) {
  const code = c.files.filter(f => !isDoc(f)).sort((a, b) => (overlapCount(b) - overlapCount(a)) || (fileRank(a) - fileRank(b))).slice(0, 40); if (!code.length) return [];
  const perFile = {}, rows = gitGrep(["-n", "--max-count", "2"], c.forms, code).split("\n").filter(Boolean).map(l => l.replace(`${ref}:`, ""))
    .map(l => { const m = l.match(/^([^:]+):(\d+):(.*)$/); return m ? { f: m[1], text: `${m[1]}:${m[2]}  ${redactLine(m[1], m[3].trim()).slice(0, 140)}` } : null; }).filter(Boolean)
    .filter(r => (perFile[r.f] = (perFile[r.f] || 0) + 1) <= 2);
  rows.sort((a, b) => (overlapCount(b.f) - overlapCount(a.f)) || (fileRank(a.f) - fileRank(b.f)));
  return rows.slice(0, limit).map(r => r.text);
}
const anchorInfo = anchors.map(c => ({ ...c, code: c.files.filter(f => !isDoc(f)), docs: c.files.filter(isDoc), lines: anchorLines(c) }));
const anchorsAbsent = anchorInfo.filter(a => !a.code.length);

// --- deliberately off (blind test re-run Q7): the anchor search found KEP's code, but the
// answer read it as "not built yet" when the code says the opposite ("KEP is not a provider here", a test that
// wants ?provider=kep → 404). Around each anchor hit (±3 lines, code and tests: a test that pins a refusal is
// enforcement), keep the lines that refuse: "not a …", "rejected", "disabled", "out of scope", "404", and the
// Turkish forms in data/lang/tr/canwe.json. These are leads to cite, not a verdict on their own.
//
// the language audit #8: the word list stays EN+TR, plus sources.json's
// `glossary.refusal` — the product's OWN refusal words/phrases, same flat-array shape as `glossary.notDoing`
// (a comment explaining the refusal in German/Japanese/etc needs its own words to read). REFUSAL_RE alone
// is prose-shaped, though — "prefer code shape over words": STRUCTURAL_REFUSAL_RE below matches a refusal's
// CODE SHAPE (an HTTP 401/403/404/410 guard, a validator returning false/nil, a disabled/enabled flag, a
// thrown/panicked guard) regardless of what language the surrounding comment is in, so a refusal is still
// found near the anchor even when no word in any list matches.
const glossaryRefusal = Array.isArray(K.glossary?.refusal) ? K.glossary.refusal.filter(s => typeof s === "string" && s.trim()) : [];
const REFUSAL_RE = new RegExp(`\\b(?:not (?:a|an|supported|allowed|valid|available|ported|implemented|built|offered|registered)\\b|isn'?t (?:a|an|supported|allowed)\\b|won'?t\\b|disabled\\b|refus|reject|out of scope|(?:deliberately|intentionally|on purpose)\\W+(?:\\w+\\W+){0,2}?(?:out|off|not|excluded|left|dropped|skipped|disabled|removed)\\b|unsupported|forbidden|want 404|answered 404|status(?:code)?\\W*404|returns? false)|${[...(TRQ.refusal || []), ...glossaryRefusal].map(escRe).join("|") || "(?!)"}`, "i");
const STRUCTURAL_REFUSAL_RE = /\b(?:40[134]|410)\b|\breturns?\s+(?:false|nil)\b|\b(?:disabled|enabled)\s*[:=]\s*(?:true|false)\b|\bthrow(?:s|n)?\b|\bpanic\(/i;
// Second product (Twenty, 30 Sep): `it('should throw an exception for unsupported schedule type')` next to "cron"
// made the guess "deliberately not done" for a feature that ships. A test's title, and input validation
// ("invalid pattern", "unsupported type/value/format"), reject bad INPUT, not the feature: never a refusal.
const TEST_TITLE_RE = /^\s*(?:it|test|describe|context|specify)(?:\.\w+)?\s*\(/;
const VALIDATION_RE = /\b(?:invalid|unsupported|unknown|malformed|missing)\s+(?:\w+\s+){0,2}?(?:type|value|format|pattern|input|argument|param(?:eter)?|id|field|key|payload|schema|expression)s?\b|\bshould throw\b/i;
// Twenty (30 Sep): `Refused recurring charge "${chargeKey}" … ${reason}` is a log of one runtime event (a
// charge turned down for a reason), not the product declining a feature. A past-tense refusal inside an
// interpolated message (${…}, %s, {name}) reports what happened to one input: never a decision.
const RUNTIME_EVENT_RE = /\b(?:refused|rejected|denied|declined|blocked)\b[^\n]*(?:\$\{|%[sdvo]\b|\{\w*\})|(?:\$\{|%[sdvo]\b)[^\n]*\b(?:refused|rejected|denied|declined|blocked)\b/i;
// An import list naming a type (`type RejectedRecurringCharge,`) refuses nothing.
const IMPORT_LINE_RE = /^\s*(?:import\b|(?:type\s+)?[A-Za-z_$][\w$]*,?\s*$|\}\s*from\b)/;
// "must not be rejected", "never refuse": the refusal word itself negated.
const NEGATED_RE = /\b(?:not|never|n't|no longer)\s+(?:be\s+|get\s+)?(?:rejected|refused|disabled|reject|refuse)\b/i;
// The plainest wording ranks first, so the verdict cites a line that says it outright; a structural-only hit
// (no word matched, only the code shape) ranks lowest — real signal, but read it yourself before citing it.
const STRONG_RE = /\b(?:is not a|not a registered|not a provider|listed but disabled|disabled\b|want 404|answered 404|out of scope|not supported|unsupported)|kapsam dışı|bilerek/i;
function deliberateLines(c, limit = 6) {
  const code = c.files.filter(f => !isDoc(f)).sort((a, b) => fileRank(a) - fileRank(b)).slice(0, 40); if (!code.length) return [];
  const out = [], seen = new Set();
  for (const hunk of gitGrep(["-n", "-C", "1"], c.forms, code).split(/^--$/m)) {
    // git grep marks matching lines "path:N:" and context lines "path-N-"; a refusal counts only on the anchor's
    // own line or right next to it, and same-line refusals rank first.
    const rows = hunk.split("\n").filter(Boolean).map(l => l.replace(`${ref}:`, "")).map(l => l.match(/^(.*?)([:-])(\d+)\2(.*)$/)).filter(Boolean).map(m => ({ f: m[1], hit: m[2] === ":", n: +m[3], text: m[4].trim() }));
    for (const r of rows) {
      const key = `${r.f}:${r.n}`;
      const wordHit = REFUSAL_RE.test(r.text), structuralHit = STRUCTURAL_REFUSAL_RE.test(r.text);
      if (seen.has(key) || !(wordHit || structuralHit) || NEGATED_RE.test(r.text) || TEST_TITLE_RE.test(r.text) || VALIDATION_RE.test(r.text) || RUNTIME_EVENT_RE.test(r.text) || IMPORT_LINE_RE.test(r.text)) continue;
      const near = rows.some(x => x.hit && x.f === r.f && Math.abs(x.n - r.n) <= 1);
      if (!near) continue;
      // Owner's 20-question eval (29 Sep): a same-line refusal about something else ("scan rejected" in a
      // security-scan message that happens to mention the term) made the guess "deliberately not done". The
      // refusal now drives the verdict only when it sits within ~50 characters of the term itself ("KEP is not
      // a provider", "provider=kep … want 404"); farther ones are still listed for the agent to read.
      const low = r.text.toLowerCase(), termAt = c.forms.map(f => low.indexOf(f.toLowerCase())).filter(i => i >= 0);
      const m = (REFUSAL_RE.exec(r.text) || STRUCTURAL_REFUSAL_RE.exec(r.text)), refAt = m ? m.index : -1;
      const close = refAt >= 0 && termAt.some(i => Math.abs(i - refAt) <= 50);
      // BlogFactory field test (3 Oct): "Can we enforce draft-only delivery across multiple sites?" anchored on three generic words (enforce,
      // across, multiple) because the real subject ("draft", "delivery", "sites") was too common, and an unrelated comment ("Failures are
      // deliberately not enforced") sat next to "enforce", so the answer said the product had decided against the feature, which is its central
      // shipped boundary. In a question of four or more words, a refusal drives the verdict only when the line (and the one above and below)
      // mentions at least two different words of the question: sharing one word with it proves nothing. It is still listed, marked as a lead.
      const nearby = ascii(rows.filter(x => x.f === r.f && Math.abs(x.n - r.n) <= 1).map(x => x.text).join(" ").toLowerCase());
      const mentioned = counted.filter(g => g.forms.some(f => termIn(f, nearby))).length;
      const corroborated = counted.length < 4 || mentioned >= 2;
      seen.add(key); out.push({ ...r, close, corroborated, structuralOnly: !wordHit, rank: (STRONG_RE.test(r.text) ? 0 : wordHit ? 4 : 6) + (r.hit ? 0 : 2) + fileRank(r.f) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, limit).map(r => ({ hit: r.hit, close: r.close, corroborated: r.corroborated, structuralOnly: r.structuralOnly, line: `${r.f}:${r.n}  ${redactLine(r.f, r.text).slice(0, 140)}` }));
}
// a fallback anchor is a COMMON word chosen only because nothing rarer exists — a
// refusal-shaped line sitting near it (an unrelated 404 guard, an unrelated disabled flag) is far more likely
// to be coincidence than it is for a genuinely rare anchor, where proximity to the term itself is the signal.
// Skipping "Deliberately off?" for fallback anchors keeps the fallback's real job (surfacing the product's own
// files instead of saying "no trace") without also inventing a false "there's a decision not to do this".
for (const a of anchorInfo) a.deliberate = (a.code.length && !anchorsAreFallback) ? deliberateLines(a) : [];
// Listed: refusals on or next to the anchor line. Driving the verdict: only a refusal on the anchor's own line
// (a neighbouring line can refuse something else: "bulk billing … left out" next to an invoice line). A
// structural-only hit (a 404 guard etc, no recognized word) still drives the verdict — that's the point of
// "prefer code shape over words" — but is flagged so the description below says it's unread prose, not a claim.
const deliberateCode = anchorInfo.map(a => ({ ...a, own: a.deliberate.filter(d => d.hit && d.close && d.corroborated).map(d => d.line), ownStructuralOnly: a.deliberate.filter(d => d.hit && d.close && d.corroborated).every(d => d.structuralOnly) })).find(a => a.own.length);

// --- access layer (Q3): a portal or outside-access question is decided by the authorization
// model (company-wide roles vs per-record grants), not by the feature's own files. When the question is about who
// can get in, the authorization files are listed with their first comment line, so the answer reads them.
//
// ACCESS_WORDS merges sources.json's `glossary.access` (the product's OWN access/portal
// words, flat array, same shape as glossary.refusal above) on top of EN+TR. Even when no word matches at all —
// a German/Japanese question phrased in words this list doesn't have — the authorization-file scan itself is
// structural (a folder/file NAMING convention, English by real-world convention regardless of the product's
// own language, the same "actually fine" case plan-gates.mjs's identifiers are) and is still run whenever the
// matched endpoints themselves look access-related (an admin-audience match, or an anchor whose own code sits
// under an authz-shaped path), so the section isn't silently empty just because the question's wording wasn't
// recognized.
const ACCESS_WORDS = ["portal", "external", "guest", "share", "sharing", "permission", "access", "role", "login", "invite", "public", "outside", ...(TRQ.accessWords || []), ...(Array.isArray(K.glossary?.access) ? K.glossary.access : [])].map(w => ascii(low(w)));
const accessQuestion = raw.some(w => ACCESS_WORDS.some(t => { const a = ascii(w); return a === t || (t.length > 3 && a.startsWith(t)); }));
const AUTHZ_PATH_RE = /(^|\/)(authz|authorization|access|acl|permissions?|rbac|polic(?:y|ies)|roles?)(\/|\.|_|$)/i;
// Structural fallback: the question's words didn't trip ACCESS_WORDS, but the evidence
// already gathered points at access/authorization anyway (a matched endpoint sits on the admin/internal
// surface, or an anchor's own code lives under an authz-shaped path) — show the section, marked as structural,
// instead of going silent because this language's access words aren't in any list yet.
const accessStructural = !accessQuestion && (
  [...strongMatches, ...weakMatches].some(e => audienceOf(e) === "admin") ||
  anchorInfo.some(a => a.code.some(f => AUTHZ_PATH_RE.test(f))));
let accessFiles = [];
if ((accessQuestion || accessStructural) && fileCount) {
  try {
    accessFiles = git(["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean)
      .filter(f => AUTHZ_PATH_RE.test(f) && !isDoc(f) && fileRank(f) === 0 && /\.(go|ts|tsx|js|mjs|py|rb|java|kt|cs|php|rs)$/.test(f))
      .sort((a, b) => a.split("/").length - b.split("/").length).slice(0, 6)
      .map(f => { let first = ""; try { first = (git(["show", `${ref}:${f}`]).split("\n").find(l => /^\s*(\/\/|#|\*|\/\*)\s*\S/.test(l) && !/^\s*\/\/\s*(go:build|\+build|eslint|@ts-)/.test(l)) || "").replace(/^\s*(\/\/+|#+|\/?\*+)\s*/, "").slice(0, 120); first = redactLine(f, first); } catch {} return `${f}${first ? `  ${first}` : ""}`; });
  } catch {}
}

// --- the product's never rules (sources.json preread.never): a question that asks for a thing the owner put on
// the never list is answered by that rule first. Matched on the question itself, and on the rule's name.
const neverHits = (K.preread?.never || []).filter(n => {
  try { if (n.pattern && new RegExp(n.pattern, "i").test(question)) return true; } catch {}
  const nameWords = topicWords(n.name || "").map(root), qWords = new Set(raw.map(root));
  return nameWords.length > 0 && nameWords.every(w => qWords.has(w));
});

// --- (c) run gather-evidence.mjs as a subprocess (unchanged; only consumed) ---
const evidencePath = new URL("./gather-evidence.mjs", import.meta.url);
let evidenceText = "", evidenceError = null;
try { evidenceText = execFileSync("node", [evidencePath.pathname, pm, topic, ...words], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }); }
catch (e) { evidenceError = String(e.message || e).slice(0, 200); }

// blind test Q7: splitting on EVERY "## " line used to cut a Decisions block open on
// its own content — gather-evidence.mjs's decision blocks are read straight from read-decisions.mjs, whose
// DEFAULT title pattern is "## K180"/"## ADR-7", the same heading level as gather-evidence's own top-level
// "## Decisions" section title. A product using Nosy's default decision-heading convention (the common case)
// ended up with an always-empty B["Decisions"] here, silently breaking `negative`/the deliberate-not-built
// check below for any decision whose own heading happens to start with "## ". gather-evidence.mjs's own
// output is unchanged (per this file's header comment) — only known, fixed top-level section names are
// split on now, so a same-level heading INSIDE a section's own content no longer looks like a new section.
const SECTION_NAMES = ["Decisions", "Request doc", "Rivals", "Matrix", "Commits from the last 30 days"];
function withSection(txt) {
  const re = new RegExp(`^## (${SECTION_NAMES.join("|")})\\n`, "gm");
  const points = [...txt.matchAll(re)], m = {};
  for (let i = 0; i < points.length; i++) {
    const start = points[i].index + points[i][0].length;
    const end = i + 1 < points.length ? points[i + 1].index : txt.length;
    m[points[i][1]] = txt.slice(start, end).trim();
  }
  return m;
}
const B = evidenceText ? withSection(evidenceText) : {};
const summary = (txt, n = 2) => {
  if (!txt || txt === "—") return "—";
  const blocks = txt.split(/\n\n---\n\n/);
  if (blocks.length > 1) return blocks.slice(0, n).join("\n\n---\n\n").trim();
  return txt.split("\n").filter(Boolean).slice(0, 6).join("\n");
};

// --- request-doc status (from gather-evidence's strongest-matched section) ---
const requestText = B["Request doc"] || "";
const stateRe = (() => { try { return new RegExp(K.request?.state || "\\*\\*Status:\\*\\*\\s*`?(exists|partial|missing)"); } catch { return /\*\*Status:\*\*\s*`?(exists|partial|missing)/; } })();
const stateM = requestText.match(stateRe);
const state = stateM ? stateM[1].toLowerCase() : null;
const noUiRe = new RegExp(K.request?.screen_missing || "not built yet|UI:\\s*not|no screen", "i");
const uiLinesOf = requestText.split("\n").filter(l => /\*\*UI\b/.test(l));
const lastUi = uiLinesOf[uiLinesOf.length - 1] || "";
const screenMissingRequest = noUiRe.test(requestText) && !/\b(built|done|wired|drawn)\b/i.test(lastUi);

// --- "not doing" in the decisions ---
const decisionText = B["Decisions"] || "";
// negationRegexFor(K): the EN+TR core plus, if sources.json has one, the product's
// OWN not-doing words/phrases (`glossary.notDoing`) - so a German/Japanese/etc. "not doing this" decision is
// recognized here too, not just in English/Turkish. Falls back to plain NEGATION_RE when there's nothing to add.
// A negation counts only in a sentence that is about the question: one of its words in a short question, two in a long one (the same rule as "Deliberately off?"). The whole block
// used to be tested, so "Excel format is out of scope" in a decision that says CSV export ships first made "can we add CSV export?" a decision not to do it (field-test hunt).
const negativeRe = negationRegexFor(K);
const topicHits = sn => counted.filter(g => g.forms.some(f => termIn(f, ascii(sn.toLowerCase())))).length;
const negative = decisionText.split(/(?<=[.!?])\s+|(?<=[。！？])|\n+/).some(sn => negativeRe.test(sn) && topicHits(sn) >= (counted.length >= 4 ? 2 : 1));

// --- decision found, but its status couldn't be read in this language ---
// read-decisions.mjs's decisionsOfRead() flags statusReadable:false when NOTHING in the whole decisions doc
// matches the negation family (see its own comment) - i.e. the doc is very likely written in a language
// read-decisions.mjs doesn't recognize, not that nothing here is a rejected decision. `negative` above would
// then also be false, but that must NOT read as "no decision at all" (the "Not now: no trace in the code"
// verdict, further down) - a matching decision (by ref, e.g. "K11") is right there in the evidence; Nosy
// just can't confirm its status. This block is the one minimal addition to the verdict chain below; every
// other branch is unchanged.
const refOf = txt => { const m = String(txt || "").match(/\bK\d{2,3}\b|\bADR-\d+\b|§\d+[a-z]?/); return m ? m[0] : null; };
let unreadableDecisionRef = null;
if (!negative) {
  const ref = refOf(decisionText);
  if (ref && K.repo && K.ref && K.preread?.decisions) {
    try { const d = decisionsOfRead(K).find(x => x.no === ref); if (d && d.statusReadable === false) unreadableDecisionRef = ref; } catch {}
  }
}

// --- deliberately-not-built: "no code" must not be reported the same
// way as a genuinely untouched, greenfield ask when the absence is a known, deliberate omission. Three
// sources, each already Nosy's own vocabulary for "deliberately skipped" elsewhere:
//  - the Decisions evidence carrying a NEGATION_RE hit (`negative`, above) — its ref (K180/ADR-7/§50) is
//    pulled straight out of the matched decision block's own title/text.
//  - sources.json's `K.dropped.knowingly` pattern (the same regex lowhanging.mjs uses to drop "// dropped:
//    <reason>" comments from its own opportunity list because they're a known, deliberate omission).
//  - learn.mjs's `knowingly` rules (learned.json, tip "knowingly") — the owner's own past "yes, I know, leave
//    it" verdict for a matching key.
const deliberateDecisionRef = negative ? refOf(decisionText) : null;
let deliberateDroppedHit = false;
try { deliberateDroppedHit = Boolean(K.dropped?.knowingly) && new RegExp(K.dropped.knowingly, "i").test(`${decisionText}\n${requestText}`); } catch {}
let deliberateKnowingly = null;
try {
  const O = JSON.parse(fs.readFileSync(path.join(pm, "learned.json"), "utf8"));
  const sw = new Set(words.map(root));
  deliberateKnowingly = (O.rules || []).find(k => k.tip === "knowingly" && low(k.key || "").split(/[\s,]+/).filter(w => w.length > 2).map(root).some(w => sw.has(w)));
} catch {}
const deliberate = Boolean(deliberateDecisionRef || deliberateDroppedHit || deliberateKnowingly);
const deliberateRef = deliberateDecisionRef || (deliberateDroppedHit ? (K.dropped?.path || "dropped pattern") : null) || deliberateKnowingly?.key || "—";

// --- (d) suggested verdict: a deterministic heuristic, tried in order ---
// kill criterion 1: title/word similarity was only 9% correct as a "shipped" signal: 
// `state` comes from gather-evidence.mjs's TOP-SCORED request-doc section — the same word-overlap ranking
// as the killed T3 tier, not an explicit ref. Its "missing" reading is still safe to state plainly (it
// asserts absence, not existence). But "exists"/"partial" from that same fuzzy pick must NOT be reported as
// a settled "Already exists"/"backend ready" — only strongMatches (inventory endpoint usage: a real route
// <-> screen structural link) or an explicit ref/negation earn that plain wording.
let verdict, description;
// A text-matched request-doc section that never mentions the question's rarest term is about something else.
const anchorRe = anchorInfo.length ? new RegExp(anchorInfo[0].forms.map(escRe).join("|"), "i") : null;
const requestOffTopic = Boolean(anchorRe && requestText && !anchorRe.test(requestText));
if (neverHits.length) {
  verdict = "There's a decision: not doing this";
  description = `The product's never list has "${neverHits.map(n => n.name).join("\", \"")}" (sources.json preread.never).${deliberateCode ? ` The code enforces it: ${deliberateCode.own[0]}.` : ""} Cite the enforcing code line; don't call it "not built yet".`;
} else if (deliberateCode && !strongMatches.length) {
  verdict = "There's a decision: not doing this";
  description = `The code around "${deliberateCode.term}" refuses it: ${deliberateCode.own[0]}. Read the lines under "Deliberately off?" and cite one; this is a deliberate omission, not an unbuilt feature.${deliberateCode.ownStructuralOnly ? " (No refusal word matched in this language — this rests on the code's structural shape (a status/false/disabled guard) alone; confirm by reading the line before citing it.)" : ""}`;
} else if (negative) {
  verdict = "There's a decision: not doing this";
  description = "The Decisions section mentions this topic alongside \"not doing / won't\".";
} else if (unreadableDecisionRef) {
  // never "no trace" when a matching decision genuinely exists - the doc's language
  // just isn't one read-decisions.mjs can confirm a status in yet (no glossary.notDoing for it).
  verdict = "There's a decision — status couldn't be read in this language";
  description = `A matching decision exists (${unreadableDecisionRef}); its status couldn't be read in this language — read it before answering. Add sources.json → glossary.notDoing in the product's own language to fix this for good.`;
} else if (anchorInfo.length && anchorsAbsent.length === anchorInfo.length && !strongMatches.length && !weakMatches.length && commonWords.length) {
  // The question's own words were missing only because the code names given were everywhere: that's "too
  // vague to tell", never "no trace" (Twenty: "workflow", "cron", "trigger" are in thousands of files).
  verdict = "Can't tell from these names — name something more specific";
  description = `${commonWords.map(c => `"${c.term}"`).join(", ")} appear in too many files to anchor on, and the other words aren't in the code. Run again with the feature's own code names (a type, a class, an enum value, e.g. the thing a grep for the setting's label turns up).`;
} else if (anchorInfo.length && anchorsAbsent.length === anchorInfo.length && !strongMatches.length && !weakMatches.length) {
  verdict = "Not now: no trace in the code";
  description = `No code file at ${ref} mentions ${anchorsAbsent.map(a => `"${a.term}"`).join(" or ")}. Size it by the nearest existing thing of the same kind, not by word-matched history.`;
} else if (state && requestOffTopic) {
  verdict = strongMatches.length ? (noScreenMatch.length ? "We can: backend ready, no screen" : "Already exists") : "Not now: no trace in the backend";
  description = `The request doc's best text match never mentions "${anchorInfo[0].term}", so it's likely about something else; this guess rests on the inventory and the code lines below instead.`;
} else if (state === "missing") {
  verdict = "Not now: no trace in the backend"; description = "The request doc's best-matching section has status \"missing\".";
} else if (state) {
  if (!screenMissingRequest) { verdict = "Candidate — confirm: request doc says it's built"; description = `The request doc's best TEXT-MATCHED section (status "${state}", word overlap — not an explicit reference) says its UI is built/wired; confirm it's really about this topic before treating it as shipped.`; }
  else { verdict = "Candidate — confirm: request doc says backend ready"; description = `The request doc's best TEXT-MATCHED section (status "${state}", word overlap — not an explicit reference) has no screen; confirm it's really about this topic before treating it as backend-ready.`; }
} else if (strongMatches.length) {
  if (noScreenMatch.length) { verdict = "We can: backend ready, no screen"; description = `Of the ${strongMatches.length} matching endpoints in the inventory, ${noScreenMatch.length} have no screen.`; }
  else { verdict = "Already exists"; description = `All ${strongMatches.length} matching endpoints in the inventory are used on screen.`; }
} else if (weakMatches.length) {
  // a weak match (single rare concept, or the right term on the wrong audience/
  // surface) is real signal worth surfacing, but not strong enough on its own to claim the feature exists
  // or is backend-ready — the verdict stays cautious and points at the weak section for manual review.
  verdict = "Not now: no trace in the backend";
  description = `${weakMatches.length} endpoint(s) only share a single generic term with the question${weakMatches.some(e => e.audienceMismatch) ? " (some look like a different audience/surface, e.g. admin vs. customer-facing)" : ""} — see "Weak matches" below and verify by hand before trusting it.`;
} else if (anchorsAreFallback && anchorInfo.some(a => a.code.length)) {
  // Every name was too common and the fallback anchors are in the code: the names just can't single it out.
  verdict = "Can't tell from these names — name something more specific";
  description = `Every word given is in hundreds of files (${anchorInfo.map(a => `"${a.term}" ${a.files.length}`).join(", ")}), so neither "exists" nor "no trace" can be read off them. Run again with the feature's own code names (a type, a class, an enum value).`;
} else if (!anchorsAreFallback && anchorInfo.some(a => a.code.length)) {
  // The code has it, just not as an inventory endpoint (a GraphQL/metadata feature, a job, a trigger type):
  // "no trace in the backend" would contradict the anchor lines printed below (Twenty's CRON trigger).
  const a = anchorInfo.find(x => x.code.length);
  verdict = "Candidate — confirm: the code has it, not as an endpoint";
  description = `"${a.term}" is in ${a.code.length} code file${a.code.length === 1 ? "" : "s"} (see "Where it lives" below) but matches no endpoint in the inventory. Read those files: it may already exist as a job, trigger, setting or GraphQL/metadata feature.`;
} else {
  verdict = "Not now: no trace in the backend";
  description = "No matching endpoint in the inventory, and no relevant section in the request doc.";
}
// The guess must never contradict the evidence printed above it. "Not now: no trace in the backend" is false as soon as
// the code section lists lines for the question's own words (real run on a public repo: the guess said "no trace" over
// a retry loop that was printed two screens up). Every "no trace in the backend" verdict is checked here, once, against
// those lines: with code hits it becomes "partly there" and names where the code has it and where it does not.
const codeAnchored = anchorInfo.filter(a => a.code.length);
if (/^Not now: no trace in the backend/.test(verdict) && codeAnchored.length) {
  const fileOf = l => (String(l).match(/^([^:\s]+):\d+/) || [])[1];
  const files = [...new Set(codeAnchored.flatMap(a => a.lines.map(fileOf)).filter(Boolean))].slice(0, 3);
  const shown = files.length ? files : [...new Set(codeAnchored.flatMap(a => a.code))].slice(0, 3);
  const absent = anchorInfo.filter(a => !a.code.length);
  const missing = [absent.length ? `${absent.map(a => `"${a.term}"`).join(", ")} ${absent.length === 1 ? "is" : "are"} in no code file` : null, strongMatches.length ? null : "no endpoint in the inventory matches strongly", usedMatch.length ? null : "nothing matching is used on screen"].filter(Boolean).join("; ");
  verdict = `Partly there: exists in ${shown.join(", ")}; missing: ${missing || "read the rest"}`;
  description = `The code lines under "In the code" mention ${codeAnchored.map(a => `"${a.term}" (${a.code.length} code file${a.code.length === 1 ? "" : "s"})`).join(", ")}, so this is not "no trace". ${weakMatches.length ? `${weakMatches.length} endpoint(s) only share one generic term with the question (see "Weak matches"). ` : ""}${anchorsAreFallback ? "Every word in the question is common in this repo, so these lines may only share a word with it. " : ""}The judgement of what exists and what is missing is the agent's: open those files first.`;
}
// "no trace in the backend" is a claim that the backend was checked and came up empty —
// never true when the inventory itself couldn't be built (no pm/state/inventory.json, and the on-the-fly
// compute above also failed). Overridden here, once, so every branch above stays unchanged and this can't be
// missed by fixing only one of them.
if (inventoryStatus === "failed" && verdict === "Not now: no trace in the backend") {
  verdict = "Inventory missing — run `nosy inventory`";
  description = "The backend inventory couldn't be read or computed (pm/state/inventory.json is missing and inventory.mjs failed to run); this isn't a \"no trace\" finding — the backend was never actually scanned. Run `nosy inventory` and try again.";
}

// --- output ---
const line = e => `- ${e.method} \`${e.path}\` — ${e.file}:${e.line}${e.used ? ` (on screen: ${e.usage})` : ` (${EN?.frontend_dynamic ? EN.frontend_dynamic.note : "no screen"})`}${e.matchedOn ? ` — matched: ${e.matchedOn}` : ""}${e.audienceMismatch ? " — admin/internal surface vs. a customer-facing question" : ""}`;
// blind test Q6: the very first line restates the question as asked, so the answer
// can't silently drift onto a different one; a second line flags it if the question names one surface
// (calendar, records table, ...) but the only matching evidence sits on a different one.
let o = `Question: ${question}\n`;
if (surfaceMismatch) o += `Asked about ${askedAreas.join(", ")}; the evidence is on ${evidenceAreas.join(", ")} — confirm\n`;
if (neverHits.length) o += `Never rule: ${neverHits.map(n => n.name).join(", ")} (sources.json preread.never)\n`;
o += `\n# canwe: ${question}\n\n`;
o += `## Question\n\n"${question}"${extra.length ? ` (extra words: ${extra.join(", ")})` : ""} — topic words: ${raw.join(", ") || "—"} · expanded: ${words.join(", ") || "—"}\n\n`;
o += `## In the code (read this first)\n\n`;
if (!fileCount) o += `Couldn't read the repo at ${ref}; search the code yourself before answering.\n\n`;
else {
  if (anchorsAreFallback) o += `All words are common in this repo; searched the rarest: ${anchors.map(a => `"${a.term}" (${a.files.length} files)`).join(", ")}.\n\n`;
  o += anchorInfo.length ? anchorInfo.map(a => `### "${a.term}" · ${a.code.length} code file(s), ${a.docs.length} doc(s) at ${ref}\n\n`
      + (a.code.length ? a.lines.map(l => `- ${l}`).join("\n") + (a.code.length > a.lines.length ? `\n- … ${a.code.length} files in all: ${[...new Set(a.code.map(f => f.split("/").slice(0, 3).join("/")))].slice(0, 6).join(", ")}` : "")
        : `No code file mentions it${a.docs.length ? ` (only docs: ${a.docs.slice(0, 3).join(", ")})` : ""}.`)).join("\n\n") + "\n\n"
    : "Every topic word is common in this repo; no rare term to anchor on. Search the code for the feature's own names yourself.\n\n";
  if (anchorInfo.some(a => a.deliberate.length)) o += `### Deliberately off? (code that refuses it)\n\n${anchorInfo.filter(a => a.deliberate.length).map(a => a.deliberate.map(d => `- ${d.line}${d.structuralOnly ? " (structural: a status/false/disabled guard — no refusal word matched in this language, read it yourself)" : ""}${d.corroborated ? "" : " (a lead only: it shares just one word with the question; check it is about the same thing before citing it)"}`).join("\n")).join("\n")}\n\n_If these lines say the thing itself is refused, disabled or out of scope, the verdict is "deliberately not done", with one of these lines cited. Not "not built yet". A line marked "a lead only" may be about something else that shares a word: if it conflicts with what the product's docs or code say it does, the answer is "conflict, needs review", not a decision._\n\n`;
  if (accessQuestion || accessStructural) o += `### Access layer\n\n${accessStructural ? `_The question's words didn't match an access/portal pattern in this language (sources.json has no \`glossary.access\` for it); showing structural candidates found near the matched code anyway._\n\n` : ""}${accessFiles.length ? accessFiles.map(f => `- ${f}`).join("\n") + "\n\n_Who can get in is decided here. Read these and say what the model allows: company-wide roles, team, or per-record grants, and whether an outside user can exist at all._" : "_No authorization files found by name; find where roles and access are checked before answering._"}\n\n`;
  if (commonWords.length) o += `_Too common here to anchor on: ${commonWords.map(c => `"${c.term}" (${c.files.length} files)`).join(", ")}._\n\n`;
  // The question's language vs the code's: a Turkish question over English identifiers only anchors on comments.
  // The agent knows the code's own names (read receipt → seen/read_at, bulk → bulk/batch); it passes them as
  // extra words and runs this again.
  const untranslated = raw.filter((w, i) => /[^\x00-\x7f]/.test(w) && groups[i] && groups[i].every(x => /[^\x00-\x7f]/.test(x) || x === ascii(w) || x === root(w) || x === ascii(root(w))));
  if (untranslated.length && !extra.length) o += `_The question's words (${untranslated.slice(0, 4).join(", ")}) may not be the code's own names. Run again with them as extra words: \`canwe.mjs pm "<question>" <english names…>\` (e.g. the identifiers a developer would use)._\n\n`;
  o += `_Open these files before reading any document below. Every claim in the answer (exists, missing, not on main, deliberately off) must hold in the code at ${ref}._\n\n`;
}
// The answer ledger: has this topic been asked before, what changed since then (ledger.mjs). Persistence is
// Nosy's edge over a substitute.
let ledgerText = "";
try { ledgerText = execFileSync("node", [new URL("./ledger.mjs", import.meta.url).pathname, pm, "find", question], { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch {}
const ledgerBody = ledgerText.split(/^## /m).slice(1).map(b => "### " + b.trim()).join("\n\n");
o += `## In the ledger\n\n${ledgerBody || "This topic isn't in the ledger; it's being asked for the first time."}\n\n`;
o += `## Ready in the backend\n\n`;
if (inventoryStatus === "computed") o += "_pm/state/inventory.json was missing; computed on the fly for this run only — run `nosy inventory` to cache it (move-in's first tour now does this on its own)._\n\n";
o += inventoryStatus === "failed" ? "Inventory missing — run `nosy inventory` (or `node <skill>/tools/inventory.mjs pm --json pm/state/inventory.json`), then run `canwe` again. This is NOT \"no trace\": the backend was never scanned, so there's nothing to conclude either way yet.\n\n"
  : EN.backend_missing ? "There's no inventory for this product (no backend found).\n\n"
  : (strongMatches.length || weakMatches.length)
    ? (strongMatches.length ? `### Strong matches\n\n${strongMatches.map(line).join("\n")}\n\n` : "")
      + (weakMatches.length ? `### Weak matches — verify\n\n_Matched on a single (rare) concept, or on an endpoint whose admin/internal-vs-customer surface doesn't fit the question: confirm relevance yourself before treating this as evidence._\n\n${weakMatches.map(line).join("\n")}\n\n` : "")
  : "No endpoint in the inventory whose path or file matches these words.\n\n";
o += `## On screen\n\n`;
o += usedMatch.length ? usedMatch.map(line).join("\n") + "\n\n" : "None of the matching endpoints are used on screen (or there's no matching endpoint).\n\n";
o += `## Decisions and request doc\n\n`;
o += `_Documents are leads, not facts: a status, "not on main" or "missing" line was true when it was written. Check it in the code at ${ref} before repeating it.${requestOffTopic ? ` The request-doc section below never mentions "${anchorInfo[0].term}": probably not about this question.` : ""}_\n\n`;
o += evidenceError ? `(gather-evidence.mjs failed: ${evidenceError})\n\n` : `**Decisions**\n\n${summary(decisionText)}\n\n**Request doc**\n\n${summary(requestText) || "—"}\n\n`;
// Design system (dresscode): ready-made components and pattern/content sections matching the topic. Shows
// how much of the screen is a new design decision versus an off-the-shelf part; this changes the sizing and
// the question that goes to the designer.
let TS = null;
try { const tj = path.join(pm, "state", "design.json"); TS = fs.existsSync(tj) ? JSON.parse(fs.readFileSync(tj, "utf8")) : null; } catch {}
try { const { read, match } = await import(new URL("./read-design.mjs", import.meta.url)); if (!TS) { const m = read(pm); TS = m.notFound ? null : m; }
  if (TS) { const e = match(TS, words);
    o += `## In the design system\n\n` + (e.component.length || e.section.length
      ? (e.component.length ? `**Ready-made component:** ${e.component.map(b => `${b.name} (${b.status})`).join(", ")}\n\n` : "")
        + (e.section.length ? `**Pattern/rule:**\n${e.section.map(b => `- ${b}`).join("\n")}\n\n` : "")
        + "_A screen built with an off-the-shelf part isn't a design decision for the designer, it's implementation work; a part that isn't on record needs a design decision._\n\n"
      : `No component or pattern matches these words (in a system of ${TS.components?.total ?? 0} components): the screen may need a new design decision.\n\n`); } } catch {}
o += `## Rivals (matrix)\n\n`;
o += evidenceError ? "—\n\n" : `${summary(B["Rivals"], 1)}\n\n${(B["Matrix"] ? summary(B["Matrix"], 1) : "")}\n\n`;
o += `## Recent commits\n\n`;
o += evidenceError ? "—\n\n" : `${summary(B["Commits from the last 30 days"], 1)}\n\n`;
// Size is measured, not guessed: measure-size.mjs derives S/M/L from the active-day distribution of similar
// past work.
let size = null;
// blind test Q7: a deliberate, on-record omission isn't sized as greenfield work — it
// skips the measure-size.mjs run entirely (there's no "similar past work" question to ask) and says so plainly.
if (!deliberate) {
  try { const bj = path.join(pm, "state", "size-last.json"); fs.mkdirSync(path.dirname(bj), { recursive: true });
    execFileSync("node", [new URL("./measure-size.mjs", import.meta.url).pathname, pm, topic, "--json", bj], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
    size = JSON.parse(fs.readFileSync(bj, "utf8")); } catch {}
}
const t = size?.estimate ? { ...size.estimate } : null;
// Similar work that only touched documents measures spec-writing time, not build time; confidence drops if that's most of them.
const documentMi = b => (b.directorys || []).length > 0 && b.directorys.every(d => d === "." || /^docs?(\/|$)/.test(d) || /(^|\/)docs?(\/|$)/.test(d));
const documentSay = (size?.similar || []).filter(documentMi).length, similarSay = (size?.similar || []).length;
if (t?.size && similarSay && documentSay * 2 >= similarSay) { t.confidence = "low"; t.justification += ` · ${documentSay}/${similarSay} of the similar items only changed documents: this may be measuring spec-writing time, not build time.`; }
o += `## Size (from history)\n\n` + (deliberate
  ? `Deliberately not built (decision ${deliberateRef}) — this isn't an unsized "no code" gap, it's a known, on-record omission. Not sized as greenfield work; only re-size if the decision changes.\n\n`
  : !size ? "measure-size didn't run (script missing or repo unreadable); the agent should estimate size, marking the basis as \"intent-based\".\n\n"
  : !t?.size ? "No similar past work found; the agent should estimate size (basis: intent-based).\n\n"
  : `**${t.size}** · active-day median ${t.active_day_median} (p25-p75: ${t.range.join("-")}) · confidence: ${t.confidence}${t.coverage != null ? ` · keyword coverage ${Math.round(t.coverage * 100)}%` : ""}\n\n${t.justification}\n\n`
    + (size.similar || []).slice(0, 3).map(b => `- ${b.ref}: ${String(b.title).slice(0, 90)} · ${b.active_day} active days, ${b.commit} commits · ${b.who.join(", ")}`).join("\n")
    + (size.owner?.[0] ? `\n\nSuggested owner of this area (a suggestion, not an assignment): ${size.owner.slice(0, 2).map(s => `${s.who} ${s.pay}%`).join(", ")}` : "")
    + `\n\n_Verify the similar items' relevance yourself; if confidence is "low", treat the size as a guess, not a measurement._\n\n`);
// Demand: how often customers asked for this, next to the size. Read from
// pm/state/signals.json (collect-signals, quotes already masked); nothing printed if there is no demand data.
const Dm = demandLoad(pm), demandHits = demandForQuestion(Dm, question, words);
o += `## Demand\n\n` + (!Dm ? "No demand data (pm/state/signals.json). Drop support/interview/survey exports in pm/signal/ and run `collect-signals`; `nosy psst` does it when that folder has files.\n\n"
  : !demandHits.length ? "No customer request in the demand data matches this question.\n\n"
  : demandHits.map(g => `- **${String(g.title).slice(0, 90)}**${g.ref ? ` (${g.ref})` : ""}: ${demandLine(g, Dm)}${g.ready ? " · backend ready" : ""}`).join("\n") + "\n\n");
// Interview themes: the same question against pm/state/interviews.json.
const Iv = interviewsLoad(pm), ivHits = interviewsForQuestion(Iv, question, words);
if (Iv) o += `### In interviews\n\n` + (ivHits.length ? ivHits.map(t => `- **${t.target ? t.target.title : t.key}**: ${interviewLine(t, Iv.interviews.length)}`).join("\n") : `No theme from ${Iv.interviews.length} interview(s) matches this question.`) + "\n\n";
if (demandHits[0]) description += ` ${isCluster(demandHits[0]) ? "Related requests" : "Customers asked for it"}: ${demandLine(demandHits[0], Dm)}.`;
if (ivHits[0]) description += ` In interviews: ${ivHits[0].interviews} of ${Iv.interviews.length}.`;
o += `## Suggested verdict (script's guess)\n\n**${verdict}** — ${description}\n\nThe agent gives the final verdict; this is only an evidence skeleton.\n`;
process.stdout.write(o);
// The final evidence skeleton lives at a fixed spot; once the agent decides, it's saved with
// `ledger.mjs write ... --evidence pm/state/canwe-last.md`.
try { fs.mkdirSync(path.join(pm, "state"), { recursive: true }); fs.writeFileSync(path.join(pm, "state", "canwe-last.md"), o); } catch {}
