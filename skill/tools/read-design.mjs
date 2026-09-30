// Design system reader: finds the product's design system (direction, patterns, content, governance, changelog,
// tokens, component registry, tests, agent context) and converts it into a single model. Product-agnostic: guesses
// from file names and common layouts; the `design` block in sources.json overrides the guess.
// Usage: node read-design.mjs <pm folder> [--folder <path>] [--json <file>]
// Reads: <pm>/sources.json → repo, ref, design: { root?: "apps/web", folder?: "<local folder>" }.
//   git mode (default): files are read via `git ls-tree`/`cat-file` at <ref>; no checkout.
//   folder mode (--folder or design.folder): reads a plain folder — e.g. a `project/` folder downloaded
//   from a design system Artifact (direction.md, tokens.json, components/*/README.md).
// dresscode.mjs, canwe.mjs and evidence collectors import `read()`. Counting lives in the script, judgment in the agent.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { readSources } from "./sources-file.mjs";

// Role → file path pattern (relative to the root folder).
const ROLES = {
  direction: /(^|\/)(direction|principles)\.md$/i,
  design: /(^|\/)(design(-system)?|tokens|foundations|ui[_-]?ux|style-?guide|ui-guidelines)\.md$|(^|\/)components\/README\.md$|(^|\/)docs\/[^/]*(design-system|ui-system)[^/]*\.md$/i,
  pattern: /(^|\/)(patterns)\.md$|(^|\/)guidelines\/[^/]+\.md$/i,
  content: /(^|\/)(content|voice|writing)\.md$/i,
  governance: /(^|\/)(governance)\.md$/i,
  change: /(^|\/)changelog\.md$/i,
  contribution: /(^|\/)contributing\.md$/i,
  agent: /(^|\/)(agents|claude|ai-context)\.md$|(^|\/)ai-readiness\/[^/]+\.md$/i,
  usage: /(^|\/)usage\.md$/i,
  token: /(^|\/)(design-)?tokens\.json$|\.tokens\.json$|(^|\/)tailwind\.config\.[cm]?[jt]s$|(^|\/)src\/(index|globals|tokens|theme)\.css$|(^|\/)app\/globals\.css$/i,
  record: /(^|\/)(ui|components)\/registry\.(ts|js|json)$|(^|\/)components\.json$/i,
  test: /(^|\/)tests?\/.*(contrast|visual|token|registry|design|a11y|axe|page-layer|colou?r)[^/]*\.(m?[jt]s|tsx?)$|(^|\/)scripts\/[^/]*(lint|check)[^/]*(colou?r|token|design)[^/]*\.m?[jt]s$/i,
};
// Where components live: the shadcn/shared ui folder, or the Artifact layout (components/<Name>/README.md).
const COMPONENT_DIR = /(^|\/)(components\/ui|shared\/ui)\/([^/]+?)(\.[jt]sx?|\/)/;
const ARTIFACT_COMPONENT = /(^|\/)components\/([A-Z][\w-]*)\/README\.md$/;
const Text = /\.(md|json|[cm]?[jt]sx?)$/i;
const Noise = /(^|\/)(node_modules|dist|build|\.next|vendor|coverage|baselines)\//;

const arg = (a, f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };

// --- any-language section-name recognition -------------------------------------------
// goals/principles/scope were extracted with EN-only heading regexes (/\bgoals?\b/i, etc.) - a fully-documented
// design system in another language (German, Japanese, ...) read as completely undocumented (goals:[],
// principles:[], scope all 0), the single worst false-negative surface the language audit found. Same shape
// as read-decisions.mjs's NEGATION_RE/glossary.notDoing: an EN core, a TR data file
// (skill/data/lang/tr/read-design.json), and the product's OWN section-name words from sources.json's
// `glossary.design`, merged in - never replacing the EN+TR core.
//
// `glossary.design` stays a FLAT array of strings, like `glossary.notDoing`/`glossary.measurement` - K.glossary
// is a shared object read generically (as a plain {word: [translations]} map) by half a dozen other tools
// (gather-evidence/canwe/build-waves/collect-signals/ledger/measure-size, and validated that way by
// verify-setup.mjs); a nested object here would make every one of those throw on `for (const en of ens)`. Each
// entry is either "<field>:<word>" (field one of goals/nonGoals/principles/scope/included/excluded/deferred -
// see designGlossaryMap) or a bare word that only counts toward the document-wide recognition gate below.
//
// Also feeds that gate (headingsUnrecognized below): if NONE of these words - EN, TR, or glossary.design -
// match anywhere in the design docs' own headings, despite the docs clearly having section structure, the
// model says so (headings_unrecognized/all_headings) instead of silently reporting the system as undocumented;
// dresscode.mjs marks the affected checks "?" (unknown), never a false "missing"/✗.
const TR_HEADINGS = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/read-design.json", import.meta.url), "utf8"));
const escLit = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FIELD_FAMILY = { // EN core per field (word-shaped regex fragments, not yet anchored/grouped)
  goals: ["goals?"], nonGoals: ["non-goals?", "not now"], principles: ["principles?"], scope: ["scope"],
  included: ["included"], excluded: ["excluded", "out of scope"], deferred: ["deferred"],
};
// Broader area-name vocabulary: the heading nouns dresscode.mjs's own ~20 design-system
// areas name - used ONLY for the document-wide recognition gate below, not for a specific field's extraction.
const AREA_WORDS = ["architecture", "ownership", "foundations", "colou?rs?", "typography", "tokens", "components",
  "design.{0,3}code alignment", "catalogue|catalog|storybook", "documentation", "patterns", "content|voice|wording",
  "version", "release", "change ?log", "contact", "communication", "enablement", "contribution", "governance",
  "metrics", "feedback", "maintenance", "deprecation", "prioriti[sz]ation", "accessibility"];
// Parses sources.json's flat `glossary.design` array into { goals: [...], principles: [...], ..., _general: [...] }.
function designGlossaryMap(list) {
  const map = {};
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const m = raw.match(/^(\w+):(.+)$/);
    const field = m && Object.prototype.hasOwnProperty.call(FIELD_FAMILY, m[1]) ? m[1] : "_general";
    (map[field] ??= []).push((m ? m[2] : raw).trim());
  }
  return map;
}
function familyOf(key, glossaryDesign) {
  const extra = Array.isArray(glossaryDesign?.[key]) ? glossaryDesign[key].map(escLit) : [];
  return [...(FIELD_FAMILY[key] || []), ...(TR_HEADINGS[key] || []), ...extra];
}
// Unicode-aware boundaries (not \b, which is ASCII-word-only - a Japanese/CJK glossary.design word like "目標"
// has no \w characters at all, so \b would never find a boundary around it and every such word would silently
// never match; see text.mjs's matchRe for the same fix applied to word-overlap matching).
function fieldRe(key, glossaryDesign) { return new RegExp(`(?<![\\p{L}\\p{N}])(?:${familyOf(key, glossaryDesign).join("|")})(?![\\p{L}\\p{N}])`, "iu"); }

// --- source: git ref or local folder, same two functions either way: list() and read(files) ---
function gitSource(repo, ref) {
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] });
  return {
    type: "git", repo, ref,
    list: () => { try { return git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean); } catch { return []; } },
    read: files => { // batch read in a single git process (cat-file --batch)
      const map = new Map(); if (!files.length) return map;
      let buf; try { buf = execFileSync("git", ["-C", repo, "cat-file", "--batch"], { input: files.map(f => `${ref}:${f}\n`).join(""), maxBuffer: 256 << 20 }); } catch { return map; }
      let off = 0;
      for (const f of files) {
        const nl = buf.indexOf(10, off); if (nl < 0) break;
        const mm = buf.toString("utf8", off, nl).match(/ blob (\d+)$/); off = nl + 1;
        if (!mm) continue;
        const size = +mm[1]; map.set(f, buf.toString("utf8", off, off + size)); off += size + 1;
      }
      return map;
    },
  };
}
function folderSource(dir) {
  return {
    type: "folder", folder: dir,
    list: () => { try { return fs.readdirSync(dir, { recursive: true }).map(String).filter(f => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } }); } catch { return []; } },
    read: files => new Map(files.map(f => { try { return [f, fs.readFileSync(path.join(dir, f), "utf8")]; } catch { return [f, ""]; } })),
  };
}

// Root of the design system: whichever "app root" the anchor files (DESIGN.md, design-tokens.json,
// docs/design-system/, ui registry) most often sit under. apps/web-frontend in the first product, "" in a single-app repo.
export function rootEstimated(files) {
  const count = new Map();
  for (const f of files) {
    if (Noise.test(f)) continue;
    if (!(ROLES.design.test(f) || ROLES.token.test(f) || /(^|\/)docs\/design-system\//i.test(f) || ROLES.record.test(f) || ROLES.direction.test(f))) continue;
    // If docs/ is at the top, the root is the repo root itself (""), otherwise the app folder in front of docs/src:
    // "docs/design-system/X" → "", "apps/web/docs/design-system/X" → "apps/web". Otherwise the root would be
    // mistaken for "docs/design-system" and the tokens and components under web/ would go unseen.
    const m = f.match(/^(?:(.*?)\/)??(docs|src|web\/src|project|design-system)\//); // ?? : try the empty prefix first
    const k = m ? (m[1] || "") : path.posix.dirname(f) === "." ? "" : path.posix.dirname(f);
    count.set(k, (count.get(k) || 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? null;
}

// Markdown: extract table rows and status words under a heading.
function section(md, titleRe) {
  const lines = md.split("\n"); let ic = false, level = 0; const out = [];
  for (const [i, s] of lines.entries()) {
    const h = s.match(/^(#{1,4})\s+(.*)$/);
    if (h) { if (ic && h[1].length <= level) break; if (!ic && titleRe.test(h[2])) { ic = true; level = h[1].length; continue; } }
    if (ic) out.push({ line: i + 1, text: s });
  }
  return out;
}
const tableLinesOf = part => part.filter(x => /^\s*\|/.test(x.text) && !/^\s*\|[\s:|-]+\|\s*$/.test(x.text))
  .map(x => ({ ...x, cells: x.text.split("|").slice(1, -1).map(c => c.trim()) }));

function tableItem(docs, titleRe) { // rows of the first table excluding the header row; id = first cell
  for (const [file, md] of docs) {
    const t = tableLinesOf(section(md, titleRe));
    if (t.length > 1) return t.slice(1).map(r => ({ id: r.cells[0].replace(/\*/g, ""), name: (r.cells[1] || "").replace(/\*\*/g, "").slice(0, 120), file, line: r.line }));
  }
  return [];
}

function tokenFlatten(j, filePath = [], out = []) {
  if (j && typeof j === "object" && !Array.isArray(j)) {
    if ("$value" in j || "value" in j) { out.push({ name: filePath.join("."), value: j.$value ?? j.value, tip: j.$type ?? j.type }); return out; }
    for (const [k, v] of Object.entries(j)) if (!k.startsWith("$")) tokenFlatten(v, [...filePath, k], out);
  } else if (typeof j === "string" || typeof j === "number") out.push({ name: filePath.join("."), value: j });
  return out;
}

function recordComponentsOf(src, file) {
  if (file.endsWith("components.json")) return []; // shadcn config, not a component list
  const out = [];
  for (const part of src.split(/\bmodule:\s*/).slice(1)) {
    const name = part.match(/^["'`]([^"'`]+)/)?.[1]; if (!name) continue;
    const status = part.match(/\bstatus:\s*["'`]([\w-]+)/)?.[1] || "?";
    const instead = part.match(/\binsteadOf:\s*["'`]([^"'`]+)/)?.[1];
    out.push({ name, status, ...(instead ? { instead } : {}), ...(/\bnotFor:/.test(part) ? { whenNot: true } : {}), ...(/\ba11y:/.test(part) ? { access: true } : {}), source: file });
  }
  return out;
}

export function read(pm, options = {}) {
  let K = {}; try { K = readSources(pm); } catch {}
  const T = K.design || {};
  const folder = options.folder || T.folder;
  const source = folder ? folderSource(path.resolve(folder)) : K.repo ? gitSource(K.repo, K.ref || "HEAD") : null;
  const empty = { date: new Date().toISOString().slice(0, 10), notFound: true, source: source ? { type: source.type } : null, roles: {} };
  if (!source) return { ...empty, reason: "no repo in sources.json and no folder given" };
  const all = source.list().filter(f => !Noise.test(f));
  const rootGiven = T.root != null && !folder;
  const root = folder ? "" : rootGiven ? T.root.replace(/\/$/, "") : rootEstimated(all);
  if (root == null) return { ...empty, source: { type: source.type, repo: source.repo, ref: source.ref }, reason: "no design system file found (DESIGN.md, tokens.json, docs/design-system/, ui registry)" };
  // If the root is a subfolder (e.g. web/), role files at the repo root and under docs/ are also part of the system:
  // AGENTS.md, UI_UX.md, CONTRIBUTING.md sit at the top in most repos. For the same role, the file under root comes first.
  const onTop = f => !f.includes("/") || /^docs\/[^/]+\.md$/i.test(f);
  const under = root ? all.filter(f => f.startsWith(root + "/") || onTop(f)) : all;
  const rel = f => root && f.startsWith(root + "/") ? f.slice(root.length + 1) : f;

  const roles = {};
  for (const f of under) for (const [role, re] of Object.entries(ROLES)) if (re.test(rel(f))) (roles[role] ??= []).push(f);
  // Artifact layout: the README.md next to tokens.json is the design doc.
  for (const j of (roles.token || []).filter(j => /(^|\/)tokens\.json$/i.test(j))) { const r = path.posix.join(path.posix.dirname(j), "README.md"); if (under.includes(r)) (roles.design ??= []).push(r); }
  // Multiple files for the same role: the one closer to the design system folder (docs/design-system, project/) goes first.
  const inRoot = f => !root || f.startsWith(root + "/");
  for (const r of Object.values(roles)) r.sort((a, b) => Number(!/design-system|project\//i.test(a)) - Number(!/design-system|project\//i.test(b)) || Number(!inRoot(a)) - Number(!inRoot(b)) || a.length - b.length);

  const mdRolesOf = ["direction", "design", "pattern", "content", "governance", "change", "contribution", "agent", "usage"];
  const toBeRead = [...new Set([...mdRolesOf.flatMap(r => roles[r] || []), ...(roles.token || []).slice(0, 3), ...(roles.record || []).slice(0, 2)])];
  const text = source.read(toBeRead);
  const docs = [...text].filter(([f]) => f.endsWith(".md"));

  // Components: registry file > Artifact layout > file names in the ui folder.
  let components = (roles.record || []).flatMap(f => recordComponentsOf(text.get(f) || "", f));
  const artifactB = under.map(f => f.match(ARTIFACT_COMPONENT)).filter(Boolean);
  if (!components.length && artifactB.length) {
    const readmes = source.read(artifactB.map(m => m.input));
    components = artifactB.map(m => { const t = readmes.get(m.input) || ""; const d = t.match(/·\s*(Stable|Beta|Experimental|Deprecated|Legacy|Internal)\b/i)?.[1]?.toLowerCase() || "?";
      return { name: m[2], status: d, ...(/^#+\s*when not/im.test(t) ? { whenNot: true } : {}), ...(/^#+\s*accessibility/im.test(t) ? { access: true } : {}), source: m.input }; });
  }
  if (!components.length) {
    const names = new Map(); for (const f of under) { const m = f.match(COMPONENT_DIR); if (m && !/index|registry|\.test\.|\.stories\./i.test(f)) names.set(m[3], f); }
    components = [...names].map(([name, f]) => ({ name, status: "?", source: f }));
  }
  const statusCount = {}; for (const b of components) statusCount[b.status] = (statusCount[b.status] || 0) + 1;

  // Tokens: groups and "pixel" values (the measurements that matter when talking to a designer).
  const tokens = [];
  for (const f of (roles.token || []).slice(0, 3)) {
    const t = text.get(f) || "";
    if (f.endsWith(".json")) { try { tokens.push(...tokenFlatten(JSON.parse(t)).map(x => ({ ...x, source: f }))); } catch {} }
    else if (f.endsWith(".css")) { const seen = new Set(); // CSS variables; dark theme redefines the same name, count once
      for (const m of t.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) if (!seen.has(m[1])) { seen.add(m[1]); tokens.push({ name: m[1].replace("-", "."), value: m[2].trim(), source: f }); } }
  }
  const groups = {}; for (const j of tokens) { const g = j.name.split(".")[0]; groups[g] = (groups[g] || 0) + 1; }
  const measureRe = /^-?\d+(\.\d+)?(px|rem|em|ms)$/;
  const important = /density|row|control|height|radius|space|spacing|gap|page|size|font|type|motion|duration/i;
  const pixel = tokens.filter(j => measureRe.test(String(j.value).trim())).sort((a, b) => Number(!important.test(a.name)) - Number(!important.test(b.name))).slice(0, 16).map(({ name, value }) => ({ name, value }));

  // sources.json's `glossary.design` - the product's OWN section-name words, merged
  // with the EN+TR core (see FIELD_FAMILY/TR_HEADINGS above).
  const glossaryDesign = designGlossaryMap(K.glossary?.design);
  const directionDocs = docs.filter(([f]) => (roles.direction || []).includes(f) || (roles.design || []).includes(f));
  const goals = tableItem(directionDocs, fieldRe("goals", glossaryDesign));
  const principles = tableItem(directionDocs, fieldRe("principles", glossaryDesign));
  const scopeLine = tableItem(directionDocs, fieldRe("scope", glossaryDesign));
  // toLowerCase (not tr-TR): under tr-TR, "Included" becomes "ıncluded" and English status words are missed.
  const scopeText = scopeLine.map(k => (directionDocs.find(([f]) => f === k.file)?.[1].split("\n")[k.line - 1] || "").toLowerCase());
  const scope = {
    included: scopeText.filter(t => fieldRe("included", glossaryDesign).test(t)).length,
    deferred: scopeText.filter(t => fieldRe("deferred", glossaryDesign).test(t)).length,
    excluded: scopeText.filter(t => fieldRe("excluded", glossaryDesign).test(t)).length,
    line: scopeLine.length,
  };

  // Document-wide recognition gate: every heading across the read design docs, and
  // whether ANY known word - EN core + TR + every glossary.design list (all fields) + the broader area
  // vocabulary + a free-form glossary.design.sections list - matches ANY of them. More than one heading is
  // required before this fires (a single-section doc is too little signal either way, same guard
  // read-decisions.mjs's statusReadable uses) so a tiny/empty doc doesn't get flagged.
  const allHeadings = docs.flatMap(([f, md]) => md.split("\n").map((s, i) => ({ file: f, line: i + 1, text: s }))
    .filter(x => /^#{1,4}\s+\S/.test(x.text)));
  const recognitionWords = [...new Set([
    ...Object.keys(FIELD_FAMILY).flatMap(k => familyOf(k, glossaryDesign)),
    ...AREA_WORDS,
    ...(glossaryDesign._general || []).map(escLit), // an unprefixed glossary.design entry - counts toward the gate only
  ])];
  const recognitionRe = recognitionWords.length ? new RegExp(recognitionWords.join("|"), "i") : null;
  const headingsUnrecognized = allHeadings.length > 1 && !!recognitionRe && !allHeadings.some(h => recognitionRe.test(h.text));

  // Scenarios the agent reads (ai-readiness): "### S3 · Scope — ..." form and a results table.
  const aiDoc = docs.find(([f]) => /ai-readiness/i.test(f));
  const scenario = aiDoc ? [...aiDoc[1].matchAll(/^###\s+(S\d+)\s*[·:-]\s*([^—\n-]+)/gm)].map(m => ({ no: m[1], area: m[2].trim() })) : [];
  const resultLineOf = aiDoc ? Math.max(0, tableLinesOf(section(aiDoc[1], /results/i)).length - 1) : 0;

  const changeDoc = docs.find(([f]) => (roles.change || []).includes(f));
  const changeDate = changeDoc ? [...changeDoc[1].matchAll(/^##\s+(\d{4}-\d{2}-\d{2})/gm)].map(m => m[1]).sort() : [];

  // Broken reference: files the docs mention as `NAME.md` / `name.json` that don't exist anywhere under the root.
  // When the agent tries to read that file it won't find it and falls back to guessing; this is the cheapest fix in a design system.
  const names = new Set(all.map(f => path.posix.basename(f).toLowerCase())); // repo-wide: PRODUCT.md can live at the root
  const broken = [];
  for (const [f, md] of docs) md.split("\n").forEach((s, i) => {
    for (const r of s.matchAll(/`([\w./-]+\.(?:md|json))`/g)) {
      const name = path.posix.basename(r[1]).toLowerCase();
      if (!names.has(name) && !/^(package|tsconfig|components)\.json$|^(readme|changelog)\.md$/.test(name) && !broken.some(k => k.name === r[1])) broken.push({ name: r[1], where: `${f}:${i + 1}` });
    }
  });

  const model = {
    date: new Date().toISOString().slice(0, 10),
    source: { type: source.type, ...(source.repo ? { repo: source.repo, ref: source.ref } : { folder: source.folder }), root, root_estimate: !rootGiven && !folder },
    roles,
    titles: Object.fromEntries(docs.map(([f, md]) => [f, md.split("\n").map((s, i) => [s, i + 1]).filter(([s]) => /^#{1,3}\s/.test(s)).map(([s, i]) => `${i} ${s.replace(/^#+\s*/, "")}`).slice(0, 60)])),
    goals, principles, scope,
    components: { total: components.length, status: statusCount, when_not: components.filter(b => b.whenNot).length, access: components.filter(b => b.access).length, list: components.slice(0, 200) },
    tokens: { total: tokens.length, groups, pixel },
    ai: { scenario, result_line_of: resultLineOf },
    change: { record: changeDate.length, last: changeDate.at(-1) || null },
    tests: roles.test || [],
    broken_ref: broken.slice(0, 20),
    // never a silent "undocumented" claim - see the recognition gate above.
    language: (typeof K.language === "string" && K.language.trim()) || null,
    headings_unrecognized: headingsUnrecognized,
    all_headings: allHeadings.slice(0, 60).map(h => `${h.file}:${h.line} ${h.text.replace(/^#+\s*/, "").trim()}`),
  };
  model.notFound = !Object.keys(roles).length && !components.length;
  Object.defineProperty(model, "_docs", { value: docs, enumerable: false }); // dresscode looks for evidence here; not serialized to JSON
  return model;
}

// Looks up a topic (canwe/spill keywords) in the design system: components whose name matches and pattern/content sections whose heading matches.
export function match(model, words) {
  const resource = words.filter(w => w.length > 2).map(w => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  if (!resource.length || model.notFound) return { component: [], section: [] };
  const component = (model.components?.list || []).filter(b => resource.some(r => r.test(b.name))).slice(0, 8);
  const section = Object.entries(model.titles || {}).flatMap(([f, hs]) => hs.filter(h => resource.some(r => r.test(h))).map(h => `${f}:${h.split(" ")[0]} ${h.slice(h.indexOf(" ") + 1)}`)).slice(0, 8);
  return { component, section };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), pm = a[0] && !a[0].startsWith("--") ? a[0] : "pm";
  const m = read(pm, { folder: arg(a, "--folder") });
  const out = arg(a, "--json");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(m, null, 1)); }
  if (m.notFound) { console.log(`Design system not found: ${m.reason || "no role file"}.`); process.exit(0); }
  console.log(`Design system: ${m.source.type === "git" ? `${m.source.repo}@${m.source.ref}` : m.source.folder} · root "${m.source.root}"${m.source.root_estimate ? " (estimated)" : ""}`);
  for (const [r, fs_] of Object.entries(m.roles)) console.log(`- ${r}: ${fs_.slice(0, 3).join(", ")}${fs_.length > 3 ? ` (+${fs_.length - 3})` : ""}`);
  console.log(`Goals ${m.goals.length} · principles ${m.principles.length} · scope lines ${m.scope.line} · components ${m.components.total} ${JSON.stringify(m.components.status)} · tokens ${m.tokens.total} · AI scenarios ${m.ai.scenario.length} · changelog entries ${m.change.record}`);
}
