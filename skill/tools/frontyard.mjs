// Frontyard (owner's ask): shipped features ↔ landing page. "You built this, let's add it to the page."
// Usage: node frontyard.mjs <pm folder> [--page <file>] [--day 60] [--json <file>]   (reads pm/sources.json)
// Reads: sources.json → repo, ref, frontyard: {
//   path: "README.md" | ["apps/web/app/page.tsx", …]   page lives in the repo (text and last-change date come from git)
//   url: "https://…"                                   page isn't in the repo; the script never hits the network — an agent fetches it and passes --page
//   price: "apps/web/app/pricing/page.tsx"             if present, and pm/state/plan-gates.json exists, compared against code gates
//   surface: [{ glob: "commands/*.md" }, { file: "src/cli.mjs", pattern: "^  mycli ([a-z-]+)" }]   names that should appear on the page
//   day: 60 }
// Produces three lists: (1) shipped, not on the page; (2) on the page, no trace in code (needs a look); (3) page is stale (shipped
// since the page's last change). Never edits the page; only suggests. Reads public text or our own code ("Never your data").
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { words, root, smallAscii, matchRe, idfSetup, langOfLoad, langOf } from "./text.mjs";
import { areaFind } from "./plan-gates.mjs";
import { matrixRead } from "./read-matrix.mjs";
import { frontendAppsFind } from "./inventory.mjs";
import { readSources } from "./sources-file.mjs";

// Path to the Turkish-language data this script needs: commit titles can be Turkish
// while the page is English (like Nosy's own repo). This is a language feature of the product Nosy analyzes,
// not Nosy's own language, so it's kept as data and loaded at runtime instead of hardcoded in the code below.
const GLOSSARY_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "lang", "tr", "frontyard.json");
const LangData = JSON.parse(fs.readFileSync(GLOSSARY_PATH, "utf8"));

// Commits that don't count as features: maintenance, docs, tests, merges, chores (English commit-type words,
// plus Turkish ones from LangData.maintenanceWords since a commit title may be written in either language).
export const Maintenance = new RegExp(`^(chore|docs?|test|tests|ci|build|refactor|style|fix|perf|revert|merge|wip|lint|deps|release|${LangData.maintenanceWords.join("|")})\\b|\\b(bump|typo|lint)\\b|^Merge `, "i");
// Stopwords filtered out of commit titles before keyword extraction — English connectors here, Turkish ones
// from LangData.stopwords, since a commit title may be written in either language.
const Filler = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "when", "only", "also", "more", "over", "than", "then", "their", "your", "our", "each", "every", "same", "add", "adds", "added", "new", "now", "support", "supports", "make", "makes", "use", "uses", "first", "one", "two", "all", "not", "its", "it's", "can", "via", "writing", "building", "reading", "checking", "making",
  ...LangData.stopwords]);
// "roadmap" can be a product's own subject matter (like Nosy itself); doesn't count as a promise phrase.
const Phrase = new RegExp(`\\b(coming soon|soon|waitlist|wait-list|early access|private beta|in beta|${LangData.promisePhrases.join("|")})\\b`, "i");
// the language audit #8: sources.json's `glossary.landing` — the product's OWN
// "coming soon"/maintenance/waitlist words, a flat array like `glossary.notDoing` — merged on top of the
// EN+TR core above (never replacing it). Kept as a function (not a module-level const) since it depends on a
// specific product's K, unlike Phrase/Maintenance/Filler above which stay fixed EN+TR exports other tools
// (next.mjs, nudge.mjs) import directly.
const escLit = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// CJK/Kana/Hangul/Thai runs carry no space before/after a phrase the way Latin/Turkish text does - `\b`
// (an ASCII \w/\W transition) never fires between two non-\w characters, so wrapping a Japanese
// glossary.landing phrase in `\b...\b` (like the EN+TR core) would silently never match it at all (the same
// boundary bug text.mjs's matchRe fixes for word-overlap matching). A glossary.landing entry containing one
// of those scripts is matched as a plain substring instead; a Latin/Cyrillic/other entry keeps the `\b`
// behavior, byte-identical to before for every existing EN/TR caller.
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
function phraseRegexFor(K) {
  const extra = Array.isArray(K?.glossary?.landing) ? K.glossary.landing.filter(s => typeof s === "string" && s.trim()) : [];
  if (!extra.length) return Phrase;
  const plain = extra.filter(w => !CJK_RE.test(w)).map(escLit), cjk = extra.filter(w => CJK_RE.test(w)).map(escLit);
  const core = `\\b(?:coming soon|soon|waitlist|wait-list|early access|private beta|in beta|${LangData.promisePhrases.join("|")}${plain.length ? `|${plain.join("|")}` : ""})\\b`;
  return new RegExp(cjk.length ? `${core}|(?:${cjk.join("|")})` : core, "i");
}
// Structural "not shipped yet" signals on the landing page itself: a disabled
// button/input, `aria-disabled="true"`, a waitlist/email-capture form, or a dead `href="#"` anchor read the
// SAME regardless of what language the page's own words are in - unlike Phrase above, which needs actual
// words. Read from the page's own untouched markup (before pageTextOf strips tags), not the stripped prose.
const DISABLED_CONTROL_RE = /<(?:button|input|a)\b[^>]*\bdisabled\b[^>]*>/i;
const ARIA_DISABLED_RE = /\baria-disabled\s*=\s*["']?true["']?/i;
const WAITLIST_FORM_RE = /<form\b[^>]{0,400}?>[\s\S]{0,600}?<input\b[^>]*\btype\s*=\s*["']?email["']?[^>]*>/i;
const DEAD_ANCHOR_RE = /<a\b[^>]*\bhref\s*=\s*["']#["']?[^>]*>/gi;
function structuralPromiseSignalsOf(markup) {
  const out = [];
  if (DISABLED_CONTROL_RE.test(markup)) out.push("a disabled button/input/link on the page");
  if (ARIA_DISABLED_RE.test(markup)) out.push('aria-disabled="true" on an element');
  if (WAITLIST_FORM_RE.test(markup)) out.push("a form that only collects an email (waitlist/early-access capture)");
  const deadAnchors = [...markup.matchAll(DEAD_ANCHOR_RE)].length;
  if (deadAnchors >= 2) out.push(`${deadAnchors} link(s) that go nowhere (href="#") — often a placeholder for something not built yet`);
  return out;
}
const Screen = /\.(jsx|tsx|vue|svelte|html|astro|swift|dart|kt)$/i;

// a monorepo (apps/packages/clients) commonly holds a server, a docker image, a shared
// lib, or a component-RENDERER package alongside the real screens — none of those are pages a customer sees,
// even though they may share file extensions (.tsx) or a `feat(scope):` commit prefix with the real frontend.
// "User-facing" is judged by PATH, not by extension/title: the frontend app dir(s) inventory.mjs already knows
// (sources.json `inventory.frontend`, else its own `frontendAppsFind` shape-detector as a fallback — same
// source of truth `inventory.mjs`/`canwe.mjs` use) plus anything under them (a feature folder, a route). A file
// under a DIFFERENT top-level app/package (monorepo container), a CI workflow, a Dockerfile, or a lockfile is
// "structural" — language-independent, no word list, so this holds regardless of the product's commit language.
const MONOREPO_CONTAINER_RE = /^(?:apps|packages|clients)\//;
const CI_PATH_RE = /(^|\/)\.github\/workflows\/|(^|\/)\.circleci\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)azure-pipelines\.ya?ml$|(^|\/)\.buildkite\//i;
const DOCKERFILE_RE = /(^|\/)Dockerfile(?:[.\-][\w.-]+)?$|(^|\/)docker-compose[\w.-]*\.ya?ml$/i;
const LOCKFILE_RE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|poetry\.lock)$/i;
// A generated-codegen file (e.g. a GraphQL client typed from the backend schema) commonly lives PHYSICALLY
// inside the frontend app dir even though a backend-only commit is what changed it — a path-shape convention
// (a "generated"/"__generated__" directory segment, or a ".generated.<ext>" filename), never a word match, so it
// holds regardless of the product's language. Without this, a backend commit that only touched its own package
// still counted as "on the frontend" purely because its schema bump regenerated that checked-in file.
const GENERATED_PATH_RE = /(^|\/)(__generated__|generated(?:-[\w-]+)?)\/|\.generated\.[\w.-]+$/i;
// Frontend app dirs this product's sources.json already knows, or (no explicit inventory.frontend) the same
// shape-detector inventory.mjs falls back to — read once per run; never touches the network.
function frontendDirsOf(K) {
  const explicit = Array.isArray(K.inventory?.frontend) ? K.inventory.frontend.filter(a => typeof a === "string" && a.trim()) : [];
  if (explicit.length) return explicit;
  try { return frontendAppsFind(K.repo, K.ref); } catch { return []; }
}

export function pageTextOf(raw, file = "") {
  let t = String(raw);
  // Astro/MDX frontmatter (--- … ---) and top-level imports are code, not page copy: "import Waitlist from …" isn't a promise.
  if (/\.(astro|mdx|vue|svelte)$/i.test(file)) t = t.replace(/^\s*---[\s\S]*?\n---/, " ").replace(/^\s*(import|export)\b.*$/gm, " ").replace(/\{[^{}]*\}/g, " ");
  if (/\.(html?|[jt]sx|vue|svelte|astro)$/i.test(file) || /<(html|body|div|section|p|li)\b/i.test(t)) {
    t = t.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|li|h\d|div|section|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
    if (/\.[jt]sx$/i.test(file)) t = t.replace(/\{[^{}]*\}/g, " ").replace(/^\s*(import|export|const|let|return|function)\b.*$/gm, " ");
  }
  return t.replace(/[ \t]+/g, " ");
}

// Field and feature text from a commit title: `feat(field): …` → field; `field: …` (short prefix, Nosy's own
// convention) → field.
export function commitArea(title, files = []) {
  let m = title.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  // A prefix carrying a digit is a version or cycle name ("plugin 0.9.0", "cycle 5"), not a feature name: fall back to files.
  if (m && m[2]) return { area: m[2].split(/[,/]/)[0].trim().toLowerCase(), text: m[3] };
  if (m && !/^(feat|feature)$/i.test(m[1])) return { area: m[1].toLowerCase(), text: m[3] };
  m = title.match(/^([\p{L}\p{N} ._-]{2,30}):\s*(.+)$/u);
  if (m && m[1].trim().split(/\s+/).length <= 3 && !/^(feat|feature)$/i.test(m[1].trim())) return /\d/.test(m[1]) ? { area: null, text: m[2] } : { area: m[1].trim().toLowerCase(), text: m[2] };
  // A name derived from a file is not a feature name if it's a folder at the repo root ("skill", "src").
  const a = areaFind(files);
  return { area: a && !files.some(d => d.split("/")[0].toLowerCase() === a) ? a : null, text: title.replace(/^(feat|feature)(\([^)]*\))?!?:\s*/i, "") };
}

// TR↔EN product glossary: commits may be Turkish, the page may be English (as in Nosy's
// own repo). Holds general product words; product-specific ones come from sources.json `glossary` and are
// layered on top. Loaded from LangData (GLOSSARY_PATH) at runtime instead of hardcoded, since it's
// Turkish-language data.
const DEFAULT_GLOSSARY = LangData.glossary;
// Translations of a keyword's root: the opposite side of any glossary entry whose TR or EN side reduces to
// this root (lowercase, ASCII-folded).
export function translations(kRaw, glossary = DEFAULT_GLOSSARY) {
  // Comparison is ASCII-folded (Turkish-language support: see skill/data/lang/tr/text.json's asciiFold) —
  // without folding, no word carrying a Turkish-specific letter would ever match.
  const k = smallAscii(kRaw), out = new Set();
  const equal = (a, b) => a === b || (b.length >= 4 && a.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  for (const [tr, ens] of Object.entries(glossary)) {
    const trk = root(smallAscii(tr).split(/\s+/)[0]), enl = (ens || []).map(e => smallAscii(e));
    if (equal(trk, k)) enl.forEach(e => out.add(e));
    else if (enl.some(e => equal(root(e.split(/\s+/)[0]), k))) out.add(smallAscii(tr));
  }
  out.delete(k); return [...out];
}
// English synonym groups: after the English migration, matrix steps and commit messages are English too, and
// the Turkish stemmer's root() trims English words oddly ("suggestion" → "suggesti", "delivery" → "delive"), so
// a step worded differently from the page ("Reading real delivery from Git" vs "What shipped, from git") read as
// only partly on the page. General product words only; product-specific ones go in sources.json `glossary`.
const EN_SYNONYMS = [
  ["delivery", "delivered", "shipped", "ship", "shipping", "released"], ["reading", "reads", "read", "looks at", "goes through"],
  ["prioritization", "prioritize", "priority", "ranked", "waves", "wave"], ["suggestion", "suggest", "suggests", "recommend", "proposes"],
  ["citing", "cite", "source", "sources", "receipt", "receipts", "evidence"], ["unverified", "verified", "verify", "receipt"],
  ["flag", "flags", "mark", "marker"], ["commits", "commit", "git history", "git log"], ["inference", "infer", "works out", "matching"],
  ["request", "requests", "asked for", "demand"], ["approval", "approve", "only after you say so", "asking first"],
  ["scheduled", "weekly", "every week"], ["assignment", "assign", "owner"], ["sharing", "shareable", "share", "publish"],
  ["competitor", "competitors", "rival", "rivals", "neighbours", "neighbors"], ["feasibility", "can we", "can we do"],
];
export function synonyms(kRaw) {
  const k = smallAscii(kRaw), out = new Set();
  const equal = (a, b) => a === b || (b.length >= 4 && a.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  for (const g of EN_SYNONYMS) if (g.some(w => !w.includes(" ") && equal(root(w), k))) g.forEach(w => out.add(w));
  out.delete(k); return [...out];
}
const globRe = g => new RegExp("^" + g.split("**").map(p => p.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*") + "$");
// A surface item that comes from a glob has a whole file as its source (any change to that file is a change to
// that surface item); one from a pattern has a single line.
const WHOLE_FILE = y => !/:\d+$/.test(y.source);
const nameExists = (name, pageA) => { const a = smallAscii(name); return [a, a.replace(/[-_]/g, " "), a.replace(/[-_ ]/g, "")].some(v => v.length >= 3 && matchRe(v).test(pageA)); };

function works(pm, { pageFileOf, dayArg } = {}) {
  const K = readSources(pm);
  langOfLoad(K); // sources.json's `language`
  const V = K.frontyard || {}, day = +(dayArg || V.day || 60);
  const tryGit = (...a) => { try { return execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const empty = { type: "frontyard", generated: new Date().toISOString(), ref: K.ref, day };

  // --- page ---
  let source, raw = "", rawMarkup = "";
  const paths = [].concat(V.path || []);
  if (pageFileOf) { rawMarkup = fs.readFileSync(pageFileOf, "utf8"); raw = pageTextOf(rawMarkup, pageFileOf); source = { type: "file", path: pageFileOf, url: V.url || null }; }
  else if (paths.length) {
    const shown = paths.map(y => tryGit("show", `${K.ref}:${y}`));
    rawMarkup = shown.join("\n");
    raw = shown.map((r, i) => pageTextOf(r, paths[i])).join("\n");
    const last = paths.map(y => tryGit("log", "-1", "--format=%cI", K.ref, "--", y).trim()).filter(Boolean).sort().at(-1) || null;
    // Full timestamp: keeps ordering correct even when the page and a feature change on the same day.
    source = { type: "repo", path: paths, last_change: last, day_before: last ? Math.round((Date.now() - Date.parse(last)) / 864e5) : null };
  }
  if (!raw.trim()) return { ...empty, page_missing: true, url: V.url || null };
  const pageA = smallAscii(raw);
  const Glossary = { ...DEFAULT_GLOSSARY, ...Object.fromEntries(Object.entries(K.glossary || {}).map(([a, b]) => [a, [...(DEFAULT_GLOSSARY[a] || []), ...[].concat(b)]])) };
  // Is the root or one of its translations on the page; returns the match as "root→translation" (so the
  // report shows why it matched).
  // A plural acronym ("PRDs", "APIs") is on the page as its singular: "prds" → a whole-word "prd" (
  // Nosy's README says "A PRD your agents can build from" and frontyard called "Writing PRDs / specs" missing).
  const pageRoot = k => { if (k.length >= 4 && matchRe(k).test(pageA)) return k; if (k.length === 4 && k.endsWith("s") && new RegExp(`(?<![\\p{L}\\p{N}])${k.slice(0, 3)}(?![\\p{L}\\p{N}])`, "u").test(pageA)) return `${k}→${k.slice(0, 3)}`; const c = [...translations(k, Glossary), ...synonyms(k)].find(t => t.length >= 3 && matchRe(t).test(pageA)); return c ? `${k}→${c}` : null; };
  // Field name: the full name is on the page, or at least half of its parts (itself or a translation) are ("decisions-read" → decision + reads).
  const areaPage = name => { if (nameExists(name, pageA)) return true; const p = smallAscii(name).split(/[-_ ]+/).filter(x => x.length >= 4).map(root); return p.length > 0 && p.filter(pageRoot).length >= Math.ceil(p.length / 2); };

  // --- surface: things whose name should appear on the page (commands, CLI subcommands, pages) ---
  const allFiles = tryGit("ls-tree", "-r", "--name-only", K.ref).split("\n").filter(Boolean);
  const surface = [];
  for (const Y of V.surface || []) {
    if (Y.glob) { const r = globRe(Y.glob); for (const f of allFiles.filter(f => r.test(f))) surface.push({ name: path.basename(f).replace(/\.[^.]+$/, ""), source: f }); }
    if (Y.file && Y.pattern) { const r = new RegExp(Y.pattern, "gm"), t = tryGit("show", `${K.ref}:${Y.file}`); for (const m of t.matchAll(r)) surface.push({ name: m[1], source: `${Y.file}:${t.slice(0, m.index).split("\n").length}` }); }
  }
  const surfaceFile = new Set(surface.map(y => y.source.replace(/:\d+$/, "")));
  // The same name can come from more than one file (commands/psst.md + skill/commands/psst.md): all of them are that surface item's files.
  const surfaceMap = new Map();
  for (const y of surface) { if (!surfaceMap.has(y.name)) surfaceMap.set(y.name, { name: y.name, source: y.source, files: new Set() }); if (WHOLE_FILE(y)) surfaceMap.get(y.name).files.add(y.source); }
  const surfaceSingular = [...surfaceMap.values()].map(y => ({ name: y.name, source: y.source, files: [...y.files], page: nameExists(y.name, pageA) }));

  // --- shipped features: non-maintenance commits from the last N days, grouped by field ---
  // frontend app dir(s) this run knows about (sources.json inventory.frontend, else
  // inventory.mjs's own frontendAppsFind fallback) — a file under a DIFFERENT monorepo container
  // (apps/packages/clients), a CI workflow, a Dockerfile, or a lockfile never counts as "the customer can see
  // this", however the commit is titled or whatever extension the file has.
  const frontendDirs = frontendDirsOf(K);
  const inFrontendDir = f => frontendDirs.some(d => f === d || f.startsWith(d.replace(/\/+$/, "") + "/"));
  const structuralNonFrontend = f => LOCKFILE_RE.test(f) || CI_PATH_RE.test(f) || DOCKERFILE_RE.test(f) || GENERATED_PATH_RE.test(f) || (MONOREPO_CONTAINER_RE.test(f) && !inFrontendDir(f));
  // A file is user-facing when it's an explicit surface file (already configured as "should be on the page",
  // whatever directory it lives in), or it isn't structurally backend/infra/tooling AND — when this run actually
  // knows the frontend app dir(s) — it's inside one of them or outside every monorepo container altogether (a
  // repo with no apps/packages/clients split, like Nosy's own, keeps its old behavior unchanged).
  const isUserFacingFile = (f, surfaceFile) => surfaceFile.has(f) || (!structuralNonFrontend(f) && (!frontendDirs.length || inFrontendDir(f) || !MONOREPO_CONTAINER_RE.test(f)));
  const log = tryGit("log", "--no-merges", `--since=${day}.days`, "--name-only", "--format=@@%h%x09%cI%x09%s", K.ref);
  const fields = new Map();
  for (const block of log.split("@@").filter(Boolean)) {
    const [head, ...fileLines] = block.split("\n"), [h, date, ...topic] = head.split("\t"), title = topic.join("\t");
    const files = fileLines.map(d => d.trim()).filter(Boolean);
    if (!title || Maintenance.test(title)) continue;
    // A docs/test-only commit is not a feature — but a surface file (e.g. a command's doc) counts as product even if it's a doc.
    if (files.length && !files.some(d => surfaceFile.has(d)) && files.every(d => /\.(md|txt)$/i.test(d) || /(^|\/)(tests?|__tests__)\//.test(d) || /\.(test|spec)\./.test(d))) continue; // docs/test only
    if (source.type === "repo" && files.length && files.every(d => paths.includes(d))) continue; // the page's own change
    const { area, text } = commitArea(title, files);
    for (const y of surfaceSingular) if (y.files.some(d => files.includes(d))) (y.changed ||= []).push({ h, date, text: text.slice(0, 140) });
    if (!area || area.length < 3) continue;
    // A change the user can see: touches a surface file (command, page) or a screen file, or is a feat: commit —
    // AND at least one of those files is actually user-facing (not a backend/infra/shared/
    // tooling package elsewhere in the monorepo). Work that only touches internal scripts, or a non-frontend
    // app/package, is counted separately (in Nosy itself, script names like "inventory" never reach the customer;
    // in a Twenty-style monorepo, neither does packages/twenty-server or packages/twenty-docker).
    const visible = (/^(feat|feature)\b/i.test(title) || files.some(d => Screen.test(d) || surfaceFile.has(d)))
      && (!files.length || files.some(d => isUserFacingFile(d, surfaceFile)));
    if (!fields.has(area)) fields.set(area, { area, commits: [], visible: false });
    const A = fields.get(area); A.commits.push({ h, date, text: text.slice(0, 140) }); if (visible) A.visible = true;
  }
  const surfaceRoot = new Set(surfaceSingular.flatMap(y => [root(smallAscii(y.name)), smallAscii(y.name)]));
  // Distinctive words: appear in a field's commit titles, rare across all titles (idf).
  const documents = [...fields.values()].map(A => smallAscii(A.commits.map(c => c.text).join(" ")));
  const candidateWords = [...new Set([...fields.values()].flatMap(A => words(A.commits.map(c => c.text).join(" "), 3).filter(w => !Filler.has(w) && !/^\d+$/.test(w)).map(root)))];
  const { idf, re } = idfSetup(documents, candidateWords);
  const result = [];
  for (const A of fields.values()) {
    const ks = [...new Set(words(A.commits.map(c => c.text).join(" "), 3).filter(w => !Filler.has(w) && !/^\d+$/.test(w)).map(root))]
      .sort((a, b) => (idf[b] || 0) - (idf[a] || 0)).slice(0, 6);
    // Surface names (commands) already appear on the page: a commit saying "canwe" doesn't mean that feature was explained.
    const matching = ks.filter(k => !surfaceRoot.has(k)).map(pageRoot).filter(Boolean);
    const nameOnPage = areaPage(A.area);
    const stakeholder = ks.filter(k => !surfaceRoot.has(k)).length, coverage = stakeholder ? matching.length / stakeholder : 0;
    const status = nameOnPage || coverage >= 0.5 ? "page" : coverage >= 0.25 ? "partial" : "missing";
    const last = A.commits.map(c => c.date).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
    result.push({ area: A.area, visible: A.visible, commit_count: A.commits.length, last, status, name_page: nameOnPage, words: ks, matching, example: A.commits.slice(0, 3),
      ...(source.last_change && Date.parse(last) > Date.parse(source.last_change) ? { page_after: true } : {}) });
  }
  // A visible field whose name is on the page but that changed again after the page's last change: is the description still current?
  // Surface level: did the command/page named on the page change in its own file after the page's last change?
  for (const y of surfaceSingular) { const after = (y.changed || []).filter(c => source.last_change && Date.parse(c.date) > Date.parse(source.last_change)); delete y.changed; if (y.page && after.length) y.page_after = after.slice(0, 3); }
  for (const a of result) if (a.status === "page" && a.visible && a.page_after) {
    a.current_mi = true; a.after = fields.get(a.area).commits.filter(c => Date.parse(c.date) > Date.parse(source.last_change)).slice(0, 3); }
  result.sort((a, b) => ({ missing: 0, partial: 1, page: 2 }[a.status] - { missing: 0, partial: 1, page: 2 }[b.status]) || b.commit_count - a.commit_count);

  // --- on the page, no trace in code: do the distinguishing words of bullet/table lines never appear in code (outside docs)? ---
  const lines = raw.split("\n").map(l => l.trim()).filter(l => /^([-*•]|\d+\.|\|)/.test(l) && !/^\|?\s*[-:| ]+\|?$/.test(l) && l.length > 12).slice(0, 80);
  const claimWord = lines.map(l => ({ line: l.replace(/\s+/g, " ").slice(0, 160), ks: [...new Set(words(l.replace(/`[^`]*`|https?:\/\/\S+/g, " "), 4).filter(w => !Filler.has(w) && /^[\p{L}-]+$/u.test(w)))].slice(0, 6) })).filter(x => x.ks.length >= 2);
  const allWords = [...new Set(claimWord.flatMap(x => x.ks))];
  const code = new Set();
  if (allWords.length) {
    const output = tryGit("grep", "-h", "-o", "-i", "-I", "-E", allWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), K.ref, "--", ".", ":(exclude)*.md", ":(exclude)*.txt", ...paths.map(y => `:(exclude)${y}`));
    for (const l of output.split("\n")) if (l) code.add(smallAscii(l.replace(/^[^:]*:/, "")));
  }
  const claims = claimWord.map(x => ({ line: x.line, words: x.ks, code: x.ks.filter(w => code.has(smallAscii(w))) }))
    .filter(x => !x.code.length).map(({ line, words }) => ({ line, words }));
  // word-based promise phrases (EN+TR+glossary.landing) first, then structural signals
  // (disabled controls, waitlist forms, dead anchors) from the page's own untouched markup - independent of
  // language. If NEITHER fires and the product's language is known and isn't English/Turkish/covered by a
  // glossary, say so instead of silently reporting a clean page (the language audit's German/Japanese
  // "coming soon" finding: a real promise on the page, never flagged, with nothing telling the agent to check).
  const PhraseRe = phraseRegexFor(K);
  const phrases = raw.split("\n").map(l => l.trim()).filter(l => PhraseRe.test(l) && l.length < 240).slice(0, 10);
  const structuralPromises = structuralPromiseSignalsOf(rawMarkup);
  const lang = langOf();
  const hasGlossaryLanding = Array.isArray(K.glossary?.landing) && K.glossary.landing.length > 0;
  const phrasesNote = (!phrases.length && !structuralPromises.length && lang && lang !== "en" && lang !== "tr" && !hasGlossaryLanding)
    ? `Promise phrases ("coming soon"/waitlist/beta) weren't checked in "${lang}": no built-in word and no sources.json glossary.landing for this language. Add glossary.landing (move-in.md step 5), or read the page by hand.`
    : null;

  // --- pricing page ↔ code gates (plan-gates.json) ---
  let price = null;
  const pkPath = path.join(pm, "state", "plan-gates.json");
  if (V.price && fs.existsSync(pkPath)) { try {
    const PK = JSON.parse(fs.readFileSync(pkPath, "utf8")), fA = smallAscii(pageTextOf(tryGit("show", `${K.ref}:${V.price}`), V.price));
    if (fA.trim()) price = { path: V.price,
      code_gated_page_missing: (PK.fields || []).filter(a => a.gated && !a.app && !nameExists(a.area, fA)).map(a => ({ area: a.area, evidence: a.evidence })),
      page_exists_code_gateless: (PK.fields || []).filter(a => !a.gated && !a.infrastructure && !a.app && nameExists(a.area, fA)).map(a => ({ area: a.area })) };
  } catch {} }

  // --- rival footing: from the matrix, steps we've shipped (y) ---
  //   distinguishing: present in at most 10% of active rivals → "your edge isn't on the page"
  //   table stakes:   present in at least 25% of active rivals → customers look for it when comparing
  // A rival file's "## Featured on their landing page" bullets ("- [20] …") show which rivals spotlight that step.
  let rival = null;
  const MO = K.matrix ? matrixRead(K.matrix) : null;
  if (MO) {
    const E = { distinguish: 0.1, desk: 0.25, ...(V.rival || {}) };
    const active = MO.products.filter(u => u !== MO.biz && !MO.oh.has(u));
    const oneThatOutputs = new Map();
    const rDir = path.join(pm, "rivals");
    if (fs.existsSync(rDir)) for (const f of fs.readdirSync(rDir).filter(f => f.endsWith(".md") && !f.startsWith("_"))) {
      const md = fs.readFileSync(path.join(rDir, f), "utf8"), name = (md.match(/^#\s+(.+)$/m) || [, f])[1].trim();
      const plentiful = md.match(/^## Featured on the landing page[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m); if (!plentiful) continue;
      for (const m of plentiful[1].matchAll(/^\s*[-*]\s*\[(\d{1,2})\]\s*(.+)$/gm)) { if (!oneThatOutputs.has(m[1])) oneThatOutputs.set(m[1], []); oneThatOutputs.get(m[1]).push({ rival: name, claim: m[2].trim().slice(0, 140) }); }
    }
    const stepK = MO.lines.map(r => [...new Set(words(r.feature, 3).filter(w => !Filler.has(w) && !/^\d+$/.test(w)).map(root))]);
    const list = [];
    MO.lines.forEach((r, i) => {
      if (r.codes[MO.biz] !== "y" || r.decision === "notDoing") return;
      const exists_ = active.filter(u => r.codes[u] === "y"), rate = active.length ? exists_.length / active.length : 0;
      const type = rate <= E.distinguish ? "distinguish" : rate >= E.desk ? "desk" : null; if (!type) return;
      const ks = stepK[i].filter(k => !surfaceRoot.has(k)), es = ks.map(pageRoot).filter(Boolean), scope = ks.length ? es.length / ks.length : 0;
      const no = String(r.no ?? i + 1);
      list.push({ no, feature: r.feature, type, inRival: exists_.length, active: active.length, status: scope >= 0.5 ? "page" : scope >= 0.25 ? "partial" : "missing", matching: es, withUs: r.not.slice(0, 120), one_extractor: oneThatOutputs.get(no) || [] });
    });
    // Rivals whose page spotlights it, and that aren't on our page, come first; then distinguishing steps, then the most common table stakes.
    list.sort((a, b) => (b.one_extractor.length - a.one_extractor.length) || (a.type === b.type ? (a.type === "distinguish" ? a.inRival - b.inRival : b.inRival - a.inRival) : a.type === "distinguish" ? -1 : 1));
    rival = { active: active.length, threshold: E, steps: list };
  }

  const missing = result.filter(a => a.status === "missing" && a.visible), visibleFields = result.filter(a => a.visible);
  return { ...empty, page_missing: false, source, fields: result, surface: surfaceSingular, claims, phrases, structuralPromises, phrasesNote, price, rival,
    summary: { area: visibleFields.length, ic: result.length - visibleFields.length, page: visibleFields.filter(a => a.status === "page").length, partial: visibleFields.filter(a => a.status === "partial").length, missing: missing.length,
      current_mi: result.filter(a => a.current_mi).length + surfaceSingular.filter(y => y.page_after).length,
      rival_distinguish_missing: rival ? rival.steps.filter(a => a.type === "distinguish" && a.status !== "page").length : 0,
      rival_desk_missing: rival ? rival.steps.filter(a => a.type === "desk" && a.status !== "page").length : 0,
      surface_missing: surfaceSingular.filter(y => !y.page).length, page_after_missing: missing.filter(a => a.page_after).length } };
}

function formatMd(R) {
  if (R.page_missing) return `# Frontyard\n\nCouldn't read the page. ${R.url ? `Not in the repo: have an agent fetch \`${R.url}\` and save it to \`pm/state/frontyard-page.html\`, then run \`frontyard.mjs pm --page pm/state/frontyard-page.html\`.` : "Set `frontyard.path` (a page in the repo) or `frontyard.url` in `sources.json`."}\n`;
  const K = R.source, O = R.summary;
  let o = `# Frontyard · ${K.type === "repo" ? K.path.join(", ") : K.path} · last ${R.day} days\n\n`;
  if (K.type === "repo" && K.last_change) o += `Page last changed ${K.last_change.slice(0, 16).replace("T", " ")} (${K.day_before} days ago).${O.page_after_missing ? ` **${O.page_after_missing} field(s) shipped since then and aren't on the page: the page is stale.**` : ""}\n\n`;
  o += `Of ${O.area} user-visible field(s), ${O.page} are on the page, ${O.partial} partly, **${O.missing} not at all.**${R.surface.length ? ` Surface has ${R.surface.length} name(s), ${O.surface_missing} not on the page.` : ""}\n\n`;
  const missingSurface = R.surface.filter(y => !y.page);
  if (missingSurface.length) o += `## Names missing from the page\n\n${missingSurface.map(y => `- \`${y.name}\` — ${y.source}`).join("\n")}\n\n`;
  const missing = R.fields.filter(a => a.visible && a.status !== "page");
  if (missing.length) { o += `## Shipped, not on the page — add these\n\n| Field | Shipped | Last | On page | Example |\n|---|---|---|---|---|\n`;
    for (const a of missing) o += `| ${a.area}${a.page_after ? " ⏱" : ""} | ${a.commit_count} | ${a.last.slice(0, 10)} | ${a.status === "partial" ? `partial (${a.matching.join(", ")})` : "missing"} | ${a.example[0].h} ${a.example[0].text.replace(/\|/g, "/").slice(0, 80)} |\n`;
    o += `\n⏱ = shipped after the page's last change.\n\n`; }
  if (R.rival) {
    const d = R.rival.steps.filter(a => a.status !== "page"), sat = a => `| ${a.no}. ${a.feature.replace(/\|/g, "/").slice(0, 70)} | ${a.inRival}/${a.active} | ${a.status === "partial" ? `partial (${a.matching.join(", ")})` : "missing"} | ${a.one_extractor.length ? a.one_extractor.slice(0, 3).map(x => x.rival).join(", ") : "—"} |`;
    const distinguishing = d.filter(a => a.type === "distinguish"), deskStakes = d.filter(a => a.type === "desk");
    if (distinguishing.length) o += `## Your edge isn't on the page — you have it, most rivals don't\n\n| Step | In rivals | On page | Rival page spotlights it |\n|---|---|---|---|\n${distinguishing.map(sat).join("\n")}\n\n`;
    if (deskStakes.length) o += `## Table stakes, not on the page — most rivals have it, so do you\n\nCustomers look for this when comparing; if it's not on the page, they assume you don't have it.\n\n| Step | In rivals | On page | Rival page spotlights it |\n|---|---|---|---|\n${deskStakes.map(sat).join("\n")}\n\n`;
    if (!d.length && R.rival.steps.length) o += `Rival footing: all ${R.rival.steps.length} distinguishing/table-stakes step(s) are on the page.\n\n`;
  }
  if (R.claims.length) o += `## On the page, no trace in code — needs a look\n\nNone of the line's distinguishing words appear in code (outside docs). The page may be ahead of the product, or the wording differs:\n\n${R.claims.slice(0, 12).map(x => `- ${x.line}`).join("\n")}\n\n`;
  if (R.phrases.length || (R.structuralPromises || []).length || R.phrasesNote) {
    o += `## Promises on the page (coming soon/beta/roadmap)\n\n`;
    if (R.phrases.length) o += R.phrases.map(s => `- ${s.slice(0, 160)}`).join("\n") + "\n";
    if ((R.structuralPromises || []).length) o += R.structuralPromises.map(s => `- (structural) ${s}`).join("\n") + "\n";
    if (R.phrasesNote) o += `${R.phrases.length || (R.structuralPromises || []).length ? "\n" : ""}${R.phrasesNote}\n`;
    o += "\n";
  }
  if (R.price) o += `## Pricing page ↔ code gates\n\n- Gated in code, missing from the pricing page: ${R.price.code_gated_page_missing.map(a => `${a.area} (${a.evidence})`).join(", ") || "—"}\n- On the pricing page, no gate in code: ${R.price.page_exists_code_gateless.map(a => a.area).join(", ") || "—"}\n\n`;
  const gm = [...R.fields.filter(a => a.current_mi).map(a => ({ name: a.area, c: a.after })), ...R.surface.filter(y => y.page_after && !R.fields.some(a => a.current_mi && a.area === y.name)).map(y => ({ name: `${y.name} (${y.source})`, c: y.page_after }))];
  if (gm.length) o += `## On the page, but changed again since — is the description still current?\n\n${gm.map(a => `- **${a.name}**: ${a.c.map(c => `${c.date.slice(0, 10)} ${c.text.slice(0, 90)}`).join(" · ")}`).join("\n")}\n\n`;
  const page = R.fields.filter(a => a.visible && a.status === "page"), internalFields = R.fields.filter(a => !a.visible);
  if (page.length) o += `On the page: ${page.map(a => a.area).join(", ")}.\n`;
  // no page needed and no names printed — an internal/backend/infra/tooling area's own
  // name (a package, a script) isn't customer-facing information either; a count is enough for the report.
  if (internalFields.length) o += `\n${internalFields.length} internal-only area(s) not counted.\n`;
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), takeArg = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = takeArg("--json"), pageFileOf = takeArg("--page"), dayArg = takeArg("--day");
  const R = works(argv[0] || "pm", { pageFileOf, dayArg });
  process.stdout.write(formatMd(R));
  if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify(R, null, 1));
}

export { works as compute };
