// Verifies every path and pattern in sources.json against the repo (preread had picked up
// the wrong DECISIONS path).
// Usage: node verify-setup.mjs <pm folder> [--fix]
//   --fix: if a document can't be found and the repo has exactly one candidate, writes it into sources.json. If
//   there's more than one candidate, it only lists them.
// Exit code: 0 if everything checks out, 1 if something's missing.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { matrixRead } from "./read-matrix.mjs"; import { ownColumnProblem } from "./matrix-preflight.mjs";
import { patternsOfLoad } from "./refs.mjs";
import { Default as THRESHOLD_DEFAULT } from "./thresholds.mjs";
import { decisionsOfRead } from "./read-decisions.mjs";
import { frontendAppsFind } from "./inventory.mjs";
import { sourcesProblem } from "./hints.mjs";
import { readSources, rivalsPathAbs, rivalFiles } from "./sources-file.mjs";
import { appStoreOf } from "./rival-sweep.mjs";
import { tierOf } from "./rival-tiers.mjs";
const argv = process.argv.slice(2), fix = argv.includes("--fix"), pm = argv.find(a => !a.startsWith("--")) || "pm";
const kf = path.join(pm, "sources.json"), rows = [];
const ok = (what, result, note = "") => rows.push({ what, result, note });
let K; try { K = readSources(pm); } catch (e) { console.log(`✗ ${sourcesProblem(pm) || `could not read ${kf}: ${e.message}`}`); process.exit(1); }
const git = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
const exists_ = f => { try { git("cat-file", "-e", `${K.ref}:${f}`); return true; } catch { return false; } };
// the old version only printed a ✗ for a BROKEN pattern, and produced nothing at all for a
// working one (a working pattern was silently considered "verified" unless the caller also printed its own ok()
// row). autoOk is now on by default: every working pattern gets a ✓ row. Callers that print their OWN row (with
// a match count) — like request title/state — pass autoOk=false so the row isn't printed twice.
const rx = (what, d, autoOk = true) => { try { const re = new RegExp(d, "gm"); if (autoOk) ok(what, "✓", d.length > 60 ? d.slice(0, 60) + "…" : d); return re; } catch (e) { ok(what, "✗", `bad regex: ${e.message}`); return null; } };
let files = null; const candidates = re => (files ??= git("ls-tree", "-r", "--name-only", K.ref).split("\n")).filter(f => re.test(f));
let changed = false;
const document = (what, filePath, search, write) => {
  if (!filePath) return ok(what, "–", "not set");
  if (exists_(filePath)) return ok(what, "✓", filePath), true;
  const a = candidates(search);
  if (fix && a.length === 1) { write(a[0]); changed = true; return ok(what, "wasFixed", `${filePath} → ${a[0]}`), true; }
  ok(what, "✗", `${filePath} not in ${K.ref}${a.length ? `; candidates: ${a.slice(0, 5).join(", ")}` : "; no candidate in the repo"}`); return false;
};

// Repo and ref
try { git("rev-parse", "--git-dir"); ok("repo", "✓", K.repo); } catch { ok("repo", "✗", `${K.repo} is not a git repo`); }
try { ok("ref", "✓", `${K.ref} = ${git("rev-parse", "--short", K.ref).trim()}`); } catch { ok("ref", "✗", `${K.ref} doesn't resolve (git fetch?)`); }
if (rows.some(r => r.result === "✗")) { print(); process.exit(2); } // exit contract: 2 = a ✗ row, 1 = couldn't read sources.json

// Reference patterns (refs.mjs): every pattern must compile; how many times it matches in the last 200 commit
// titles is useful for tuning.
if (K.refs !== undefined && !Array.isArray(K.refs)) ok("refs", "✗", "not an array");
else {
  if (K.refs === undefined) ok("refs", "–", "not set; using the default patterns (refs.mjs)");
  const patterns = patternsOfLoad(K);
  let titles = null; try { titles = git("log", "--no-merges", "-n", "200", "--format=%s", K.ref).split("\n").filter(Boolean); } catch {}
  patterns.forEach((d, i) => {
    let re; try { re = new RegExp(d); } catch (e) { return ok(`refs[${i}]`, "✗", `broken: ${e.message}`); }
    const n = titles ? titles.filter(s => re.test(s)).length : null;
    ok(`refs[${i}]`, "✓", `${d.length > 46 ? d.slice(0, 46) + "…" : d} · ${titles ? `${n} matches in the last 200 titles` : "commits couldn't be read"}`);
  });
}

// Dropped fields: does the folder exist, does the pattern actually find something
if (K.dropped) {
  let n = 0; try { n = git("grep", "-c", K.dropped.pattern, K.ref, "--", K.dropped.path).split("\n").filter(Boolean).length; } catch {}
  ok("dropped.path", git("ls-tree", K.ref, K.dropped.path).trim() ? "✓" : "✗", `${K.dropped.path} · "${K.dropped.pattern}" in ${n} files`);
  for (const k of ["opportunity", "knowingly"]) if (K.dropped[k]) rx(`dropped.${k}`, K.dropped[k]);
}
// Request document: do the path, title and status patterns actually match
if (K.request && document("request.path", K.request.path, new RegExp(`(^|/)${path.basename(K.request.path)}$`, "i"), y => K.request.path = y)) {
  const doc = git("show", `${K.ref}:${K.request.path}`), h = rx("request.title", K.request.title, false), s = rx("request.state", K.request.state, false);
  if (h) { const n = (doc.match(h) || []).length; ok("request.title", n ? "✓" : "✗", `${n} sections`);
    // Repeated item number: two sessions filling the same day with different numbers makes
    // "58" refer to two separate pieces of work.
    const noSay = new Map(); for (const m of doc.matchAll(new RegExp(K.request.title, "gm"))) if (m[1]) noSay.set(m[1], (noSay.get(m[1]) || 0) + 1);
    const again = [...noSay].filter(([, c]) => c > 1).map(([no]) => no);
    // Numbers written another way ("90. …" at line start, "**Internal request 89:**") don't
    // match request.title but are still taken; `request.mention` (optional regex, group 1 = number) counts them
    // toward "next number" so a new item doesn't collide.
    let mentioned = []; if (K.request.mention) { try { mentioned = [...doc.matchAll(new RegExp(K.request.mention, "gm"))].map(m => parseInt(m.slice(1).find(Boolean), 10)).filter(Number.isFinite); } catch {} }
    const nextNo = Math.max(0, ...[...noSay.keys()].map(x => parseInt(x, 10)).filter(Number.isFinite), ...mentioned) + 1;
    ok("request numbers", again.length ? "~" : "✓", again.length ? `${again.length} number(s) used in more than one item: ${again.slice(0, 12).join(", ")}${again.length > 12 ? "…" : ""} — next number: ${nextNo}` : `${noSay.size} numbers, no repeats — next number: ${nextNo}`); }
  if (s) { const n = (doc.match(s) || []).length; ok("request.state", n ? "✓" : "✗", `${n} status lines`); }
}
// Decisions document (read by preread, gather-evidence, prd-review, build-waves) — read-decisions.mjs now
// recognizes a single file, a directory, or a glob; the "decision headings" check now
// reports how many decisions/which format instead of a fixed "## K\d+".
const kyol = K.preread?.decisions;
if (K.preread) {
  if (!kyol) ok("preread.decisions", "–", "not set");
  else {
    const withGlob = /[*?]/.test(kyol);
    let decisionMaking = null, error = null;
    try { decisionMaking = decisionsOfRead(K); } catch (e) { error = e.message; }
    if (!decisionMaking || !decisionMaking.length) {
      const a = withGlob ? [] : candidates(/(^|\/)(kararlar|decisions?)[^/]*\.md$/i);
      if (fix && !withGlob && a.length === 1) {
        K.preread.decisions = a[0]; changed = true;
        try { decisionMaking = decisionsOfRead(K); error = null; } catch (e) { decisionMaking = null; error = e.message; }
        if (decisionMaking && decisionMaking.length) ok("preread.decisions", "wasFixed", `${kyol} → ${a[0]}`);
      }
      if (!decisionMaking || !decisionMaking.length) ok("preread.decisions", "✗", `${kyol}: ${error || "no decisions found"}${a.length ? `; candidates: ${a.slice(0, 5).join(", ")}` : ""}`);
    } else ok("preread.decisions", "✓", kyol);
    if (decisionMaking && decisionMaking.length) {
      const formatSay = new Map();
      for (const k of decisionMaking) { const b = /^ADR-/i.test(k.no) ? "ADR" : /^K\d+/.test(k.no) ? "K-item" : "other"; formatSay.set(b, (formatSay.get(b) || 0) + 1); }
      // A log whose headings don't look like "## K12" or "ADR-7" parses as ONE big decision, and then nothing in it can be "not doing": the check said ✓. Count the headings the
      // file has at one level; many headings but one or two decisions is a mismatch, said with the way to fix it (field-test hunt).
      const headingsIn = (() => { try { const f = String(kyol).split(",")[0].trim(); const raw = exists_(f) ? git("show", `${K.ref}:${f}`) : ""; const by = {}; for (const m of raw.matchAll(/^(#{2,4})\s+\S/gm)) by[m[1].length] = (by[m[1].length] || 0) + 1; return Math.max(0, ...Object.values(by)); } catch { return 0; } })();
      const mismatch = !withGlob && headingsIn >= 4 && decisionMaking.length <= Math.max(1, Math.floor(headingsIn / 4));
      ok("decision headings", mismatch ? "~" : "✓", mismatch ? `${decisionMaking.length} decision${decisionMaking.length === 1 ? "" : "s"} parsed, but the file has ${headingsIn} headings at one level: they are probably the decisions, in a shape this doesn't recognise (it expects "## K12 …" or "ADR-7"). Set \`preread.decision_title\` in sources.json to a regex for your heading, or "not doing" can't be found` : `${decisionMaking.length} decisions (${[...formatSay].map(([b, n]) => `${n} ${b}`).join(", ")}) — gather-evidence/prd-review/build-waves split by these`);
      // Language coverage: does read-decisions.mjs's negation family (EN+TR core
      // plus sources.json's own glossary.notDoing, if any) actually recognize this doc's language? "~" (not
      // "✗" — an unset `language`/glossary isn't a broken setup, just an opportunity) when some decisions'
      // status couldn't be confirmed; see read-decisions.mjs's decisionsOfRead() `statusReadable` field.
      const readable = decisionMaking.filter(k => k.statusReadable !== false).length;
      ok("decisions language", readable === decisionMaking.length ? "✓" : "~",
        `${K.language ? `sources.json language: "${K.language}"` : "sources.json language: not set"} — status readable for ${readable}/${decisionMaking.length} decision(s)` +
        (readable < decisionMaking.length ? ` — add glossary.notDoing/glossary.measurement in the product's own language (move-in.md step 5)` : ""));
    } else ok("decision headings", "✗", "0 decisions found");
  }
}
for (const r of K.preread?.never || []) rx(`never: ${r.name}`, r.pattern);
// Product language: a general row even when preread.decisions isn't set (glossary.
// notDoing/measurement below also feed canwe.mjs's word matching, not only read-decisions.mjs).
if (K.language !== undefined && (typeof K.language !== "string" || !K.language.trim())) ok("language", "✗", `not text (it is ${Array.isArray(K.language) ? "a list" : K.language === "" || typeof K.language === "string" ? "empty" : typeof K.language}): write the language's name, e.g. "Turkish", or its code, "tr"`);
else ok("language", K.language ? "✓" : "–", K.language ? `"${K.language}" — read-decisions.mjs/text.mjs use it instead of guessing per text` : "not set; text.mjs detects per text (script), read-decisions.mjs assumes English/Turkish only");
// Glossary: the {"source term": ["target term", ...]} shape gather-evidence.mjs's
// two-way expansion needs. `notDoing`/`measurement`, `design`/`prd` (internal request
// 105/106, entries shaped "<field>:<word>", read by dresscode/read-design.mjs and audit-prd.mjs), and
// `signals`/`refusal`/`access`/`landing` (internal request 109/110, read by collect-signals/canwe/frontyard -
// `signals` is field-prefixed like `design`/`prd`, `refusal`/`access`/`landing` are flat lists like
// `notDoing`) are all the same array-of-strings shape - every one validates the same way, counted together.
if (K.glossary) {
  const input = Object.entries(K.glossary);
  const broken = input.filter(([, v]) => !Array.isArray(v) || v.some(x => typeof x !== "string"));
  const term = input.reduce((s, [, v]) => s + (Array.isArray(v) ? v.length : 0), 0);
  const own = ["notDoing", "measurement", "design", "prd", "signals", "refusal", "access", "landing"].filter(k => Array.isArray(K.glossary[k]) && K.glossary[k].length);
  ok("glossary", broken.length ? "✗" : "✓", broken.length ? `value isn't an array/string: ${broken.map(([k]) => k).join(", ")}` : `${input.length} keys, ${term} terms${own.length ? ` (incl. ${own.join(", ")})` : ""}`);
} else ok("glossary", "–", "not set (gather-evidence won't do two-way expansion; read-decisions.mjs/dresscode/audit-prd have no product words beyond English/Turkish)");
// Thresholds: warns if there's a field thresholds.mjs doesn't know about (could be a typo).
if (K.threshold) {
  const unknown = Object.keys(K.threshold).filter(k => !(k in THRESHOLD_DEFAULT));
  ok("threshold", unknown.length ? "✗" : "✓", unknown.length ? `unknown field(s): ${unknown.join(", ")} (not in thresholds.mjs's DEFAULT)` : `${Object.keys(K.threshold).length} field(s), merged with thresholds.mjs's defaults`);
} else ok("threshold", "–", "not set (using thresholds.mjs's defaults)");
// Research source tool: neighbors/nosy-neighbor read sources.json `research` to pick which
// tool researches rivals. `tool` outside the known set isn't a hard failure — a custom MCP tool name is allowed
// (the agent's own tools: allowlist decides whether it can actually call it) — so an unrecognized tool is a
// warning (~), not a ✗; it just doesn't block exit code 0, in case it's a typo the owner should notice.
if (K.research) {
  const Known = ["web", "firecrawl"], tool = K.research.tool;
  if (typeof tool !== "string" || !tool) ok("research.tool", "✗", 'not set or not a string ("web" | "firecrawl" | an MCP tool name)');
  else ok("research.tool", Known.includes(tool) ? "✓" : "~", Known.includes(tool) ? tool : `"${tool}" isn't "web"/"firecrawl" — treated as an MCP tool name; check the spelling and the agent's tools: allowlist`);
  if (K.research.fallback !== undefined && (typeof K.research.fallback !== "string" || !K.research.fallback)) ok("research.fallback", "✗", "not a non-empty string");
  else ok("research.fallback", "✓", K.research.fallback || 'not set; defaults to "web"');
  if (K.research.paidRequiresOwnerOk !== undefined && typeof K.research.paidRequiresOwnerOk !== "boolean") ok("research.paidRequiresOwnerOk", "✗", "not a boolean");
  else if (typeof tool === "string" && tool !== "web" && !K.research.paidRequiresOwnerOk) ok("research.paidRequiresOwnerOk", "~", `${tool} isn't "web" but paidRequiresOwnerOk isn't true — neighbors/nosy-neighbor will fall back to free web tools instead`);
} else ok("research", "–", "not set; neighbors/nosy-neighbor default to free web tools (WebSearch/WebFetch)");
// Inventory: do the given paths exist at ref; a */**/? pattern is matched against the tracked files.
// "**/" is zero or more folders, "*" stays inside one, "?" is one character.
const globToRe = g => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0000").replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?").replace(/\u0001/g, ".*") + "$");
if (K.inventory) {
  for (const [name, paths] of Object.entries(K.inventory)) for (const filePath of (Array.isArray(paths) ? paths : [paths])) {
    // A wildcard is checked too: how many tracked files it matches (git's own glob pathspec).
    if (/[*?]/.test(filePath)) { let n = 0; try { n = candidates(globToRe(filePath)).length; } catch {} ok(`inventory.${name}: ${filePath}`, n ? "✓" : "~", n ? `matches ${n} file${n === 1 ? "" : "s"}` : `matches nothing at ${K.ref} (harmless for an exclusion)`); continue; }
    let exists__ = false; try { exists__ = git("ls-tree", K.ref, filePath).trim() !== ""; } catch {}
    ok(`inventory.${name}: ${filePath}`, exists__ ? "✓" : "✗", exists__ ? "" : `not in ${K.ref}`);
  }
} else ok("inventory", "–", "not set");
// Frontend coverage: a name-only guess used to miss an app with no "frontend" in its own
// name (apps/admin-app was fine by name, but a real the first product check found 64 false "no screen" endpoints from
// exactly this gap once sources.json's inventory.frontend was hand-set and never revisited). Compares the
// SHAPE-detected apps (inventory.mjs's frontendAppsFind: a package.json with a frontend framework dependency, or
// a pages/app/routes-shaped subfolder, under apps/, packages/, clients/) against what's actually listed — "~", not
// "✗": a repo can legitimately choose not to inventory every app (an internal tool, a demo), so this is an
// opportunity to notice, not a broken setup, and never blocks exit code 0.
if (K.inventory) {
  let detected = [];
  try { detected = frontendAppsFind(K.repo, K.ref); } catch {}
  const listed = new Set((Array.isArray(K.inventory.frontend) ? K.inventory.frontend : []).map(p => String(p).replace(/\/$/, "")));
  const isListed = d => [...listed].some(l => l === d || d.startsWith(l + "/") || l.startsWith(d + "/"));
  const backends = new Set((Array.isArray(K.inventory.backend) ? K.inventory.backend : [K.inventory.backend]).filter(Boolean).map(p => String(p).replace(/\/$/, "")));
  const missing = detected.filter(d => !isListed(d) && !backends.has(d));
  if (detected.length) ok("inventory.frontend coverage", missing.length ? "~" : "✓",
    missing.length ? `${missing.length} frontend-shaped app(s) not listed in inventory.frontend: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}` : `${detected.length} frontend-shaped app(s) detected, all listed`);
}
// Matrix
if (K.matrix) { try { JSON.parse(fs.readFileSync(K.matrix, "utf8")); const MO = matrixRead(K.matrix, { codes: K.matrixCodes }); ok("matrix", MO ? "✓" : "✗", MO ? `${MO.lines.length} rows × ${MO.products.length} products (${MO.format} shape${MO.oh.size ? `, ${MO.oh.size} dead rival(s) excluded from the count` : ""})` : "unrecognized shape: has neither lines nor steps (lowhanging's 4th signal won't work)"); const own = (() => { try { return ownColumnProblem(JSON.parse(fs.readFileSync(K.matrix, "utf8"))); } catch { return null; } })(); if (own) ok("matrix: own column", "✗", `${own.rows} rows but ${own.why}: ${own.fix}`);
} catch (e) { ok("matrix", "✗", `${K.matrix}: ${e.message.slice(0, 60)}`); } }
// Issue repo
if (K.issue) { try { execFileSync("gh", ["repo", "view", K.issue.repo, "--json", "name"], { stdio: "ignore" }); ok("issue.repo", "✓", K.issue.repo); } catch { ok("issue.repo", "✗", `${K.issue.repo} couldn't be read with gh`); } if (K.issue.our) rx("issue.our", K.issue.our); else ok("issue.our", "–", "not set (optional: a title prefix for your own team's issues; find-sources leaves it blank when it isn't sure)"); }
// Keys added for the first runs on real products (207). One row each; a ✗ row says what to write instead.
// team: GitHub logins of the people who build the product. Their issues are work items, not demand (collect-signals.mjs, lowhanging.mjs).
if (K.team === undefined) ok("team", "–", "not set (optional: your own GitHub logins, so your own issues aren't counted as customers asking)");
else if (typeof K.team === "string") ok("team", K.team.trim() ? "~" : "✗", K.team.trim() ? `"${K.team}" works as one login; write a list, ["${K.team.trim().replace(/^@/, "")}", …]` : 'empty: write a list of GitHub logins, ["ali", "veli"]');
else if (!Array.isArray(K.team)) ok("team", "✗", `not a list (it is ${K.team === null ? "null" : typeof K.team}): write ["login", "login"]`);
else { const bad = K.team.filter(x => typeof x !== "string" || !/^@?[A-Za-z0-9][A-Za-z0-9-]*$/.test(x.trim()));
  ok("team", bad.length ? "✗" : "✓", bad.length ? `${bad.length} entr${bad.length === 1 ? "y isn't" : "ies aren't"} a GitHub login (${bad.slice(0, 3).map(x => JSON.stringify(x)).join(", ")}): letters, digits and dashes, no spaces or e-mail addresses` : `${K.team.length} login${K.team.length === 1 ? "" : "s"}: their issues count as work items, not demand`); }
// rivalsPath: a folder (relative to the folder that holds pm/, or absolute) that already holds the rival research.
if (K.rivalsPath === undefined || K.rivalsPath === "") ok("rivalsPath", "–", "not set (rival files are read from pm/rivals)");
else if (typeof K.rivalsPath !== "string") ok("rivalsPath", "✗", `not text (it is ${Array.isArray(K.rivalsPath) ? "a list" : typeof K.rivalsPath}): a folder path, e.g. "references/competitors"`);
else { const at = rivalsPathAbs(pm, K); let isDirectory = false; try { isDirectory = fs.statSync(at).isDirectory(); } catch {}
  if (!isDirectory) ok("rivalsPath", "✗", `${K.rivalsPath} isn't a folder (looked in ${at}): fix the path (it is read from the folder that holds pm/), or remove \`rivalsPath\``);
  else { const n = rivalFiles(at, { nested: true }).length; ok("rivalsPath", n ? "✓" : "~", n ? `${K.rivalsPath}: ${n} rival file${n === 1 ? "" : "s"} (\`nosy rivals-import\` copies them into pm/rivals)` : `${K.rivalsPath} exists but holds no rival-shaped markdown (a "Latest major announcement" field, a "Position relative to" heading, or a feature table)`); } }
// matrixCodes: the owner's own cell letters → y p n u d. Only those five are words Nosy has.
if (K.matrixCodes !== undefined) {
  const M = K.matrixCodes, own = ["y", "p", "n", "u", "d"];
  if (!M || typeof M !== "object" || Array.isArray(M)) ok("matrixCodes", "✗", `not an object (it is ${Array.isArray(M) ? "a list" : M === null ? "null" : typeof M}): map your letters to Nosy's, {"s": "d", "f": "p"}`);
  else { const bad = Object.entries(M).filter(([, v]) => !own.includes(v)), same = Object.keys(M).filter(k => own.includes(k));
    ok("matrixCodes", bad.length ? "✗" : same.length ? "~" : "✓", bad.length ? `${bad.map(([k, v]) => `${JSON.stringify(k)} → ${JSON.stringify(v)}`).slice(0, 4).join(", ")}: each must map to one of y (done) p (partial) n (missing) u (unknown) d (announced)` : same.length ? `${same.join(", ")} already ${same.length === 1 ? "is" : "are"} Nosy's own code${same.length === 1 ? "" : "s"} and is never remapped: remove ${same.length === 1 ? "it" : "them"}` : `${Object.keys(M).length} of your letters mapped to Nosy's`); }
}
// rivals.<slug>.tier (A deep, B watch only, C reference) and rivals.<slug>.stores.appStore (the app's number or its apps.apple.com link).
if (K.rivals !== undefined) {
  if (!K.rivals || typeof K.rivals !== "object" || Array.isArray(K.rivals)) ok("rivals", "✗", `not an object (it is ${Array.isArray(K.rivals) ? "a list" : K.rivals === null ? "null" : typeof K.rivals}): { "<slug>": { "name": …, "tier": "A" } }`);
  else { let tiers = 0, stores = 0;
    for (const [slug, R] of Object.entries(K.rivals)) {
      if (!R || typeof R !== "object" || Array.isArray(R)) { ok(`rivals.${slug}`, "✗", `not an object: { "name": …, "tier": "A" }`); continue; }
      if (R.tier !== undefined) { tiers++; if (!tierOf(R.tier)) ok(`rivals.${slug}.tier`, "✗", `${JSON.stringify(R.tier)} isn't A, B or C (it counts as A): A deep research, B watch only, C reference`); }
      if (R.stores !== undefined) {
        if (!R.stores || typeof R.stores !== "object" || Array.isArray(R.stores)) { ok(`rivals.${slug}.stores`, "✗", `not an object: { "appStore": "id123456789", "country": "tr" }`); continue; }
        if (R.stores.appStore !== undefined) { stores++; if (!appStoreOf(R.stores)) ok(`rivals.${slug}.stores.appStore`, "✗", `${JSON.stringify(R.stores.appStore)} has no App Store id: use the number from the app's address (id123456789) or its apps.apple.com link`); }
        if (R.stores.country !== undefined && !/^[A-Za-z]{2}$/.test(String(R.stores.country).trim())) ok(`rivals.${slug}.stores.country`, "✗", `${JSON.stringify(R.stores.country)} isn't a two-letter country code ("us" is used): "tr", "de", …`);
      }
    }
    ok("rivals", "✓", `${Object.keys(K.rivals).length} in the registry${tiers ? `, ${tiers} with a tier` : ""}${stores ? `, ${stores} with an App Store entry` : ""}`); }
}
// tour.tokensPerRival: your own figure for what one rival's research costs, in tokens (otherwise about 98,000, from one earlier run).
if (K.tour !== undefined) {
  if (!K.tour || typeof K.tour !== "object" || Array.isArray(K.tour)) ok("tour", "✗", `not an object (it is ${Array.isArray(K.tour) ? "a list" : K.tour === null ? "null" : typeof K.tour}): { "tokensPerRival": 80000 }`);
  else if (K.tour.tokensPerRival !== undefined) ok("tour.tokensPerRival", typeof K.tour.tokensPerRival === "number" && Number.isFinite(K.tour.tokensPerRival) && K.tour.tokensPerRival > 0 ? "✓" : "✗",
    typeof K.tour.tokensPerRival === "number" && Number.isFinite(K.tour.tokensPerRival) && K.tour.tokensPerRival > 0 ? `${K.tour.tokensPerRival.toLocaleString("en-US")} tokens per rival: used in the cost shown before research starts` : `${JSON.stringify(K.tour.tokensPerRival)} isn't a positive number: write the tokens one rival's research cost you, e.g. 80000`);
}
// Auto-section data
for (const f of ["status.json", "lowhanging.json"]) { const p = path.join(pm, "state", f); ok(`state/${f}`, fs.existsSync(p) ? "✓" : "–", fs.existsSync(p) ? `${fs.statSync(p).mtime.toLocaleString("en-US")}` : "not there yet (the auto-section on the page stays empty)"); }

if (changed) { if (K.repoAsWritten !== undefined) K.repo = K.repoAsWritten; if (K.matrixAsWritten !== undefined) K.matrix = K.matrixAsWritten; } // write back what the file said, not the resolved paths
if (changed) fs.writeFileSync(kf, JSON.stringify(K, null, 1) + "\n");
print(); process.exit(rows.some(r => r.result === "✗") ? 2 : 0);
function print() { console.log(`# sources.json verification · ${kf}\n\n| What | Result | Note |\n|---|---|---|\n${rows.map(r => `| ${r.what} | ${r.result} | ${String(r.note).replace(/\|/g, "/")} |`).join("\n")}${changed ? "\n\nsources.json updated." : ""}`); }
