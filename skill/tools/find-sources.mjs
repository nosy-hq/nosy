// move-in discovery: reads the repo ONLY and produces a sources.json SUGGESTION (internal request: move-in used to
// make the agent type this out by hand).
// Usage: node find-sources.mjs <repo> [--pm <pm folder>] [--write] [--onTop] [--json <file>]
//   --write: writes <pm>/sources.json if it doesn't exist; if it does, shows the per-key diff instead of writing.
//   --onTop: (with --write) if the file exists, takes a .backup first, then overwrites it.
// Ponytail's "one-command setup" pattern (pm/product.md, owner's rule); ccpm's deterministic/LLM-free script +
// evidence-trail pattern (pm/rivals/automazeio-ccpm.md); Productboard Spark's "one card, one approval" (show the
// diff before writing) from pm/rivals/productboard-spark.md. `inventory` paths come from inventory.mjs's own pathEstimated.
import fs from "node:fs"; import path from "node:path"; import { execFileSync, spawnSync } from "node:child_process"; import { fileURLToPath } from "node:url"; import { pathEstimated } from "./inventory.mjs"; import { findNextDocs } from "./team-next.mjs"; import { advice, nosyCommand, oldLayoutNote } from "./hints.mjs"; import { readSources } from "./sources-file.mjs";

// Turkish package-detection keywords (a repo written in Turkish still needs a legaltech/fintech match): kept as
// data and loaded at runtime, since this is a language feature of the product being analyzed, not Nosy's own.
const TrPackageWords = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/find-sources.json", import.meta.url), "utf8")).packageKeywords;

// ---- argv ----
const argv = process.argv.slice(2);
const take = name => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = name => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const pmGiven = take("--pm"), jsonOut = take("--json"), pmDir = pmGiven || "pm", write = flag("--write"), onTop = flag("--onTop");
const repo = argv.find(a => !a.startsWith("--")) || ".";

// ---- git/gh helpers (verify-setup.mjs's own pattern) ----
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).trim();
const gitTry = (...a) => { try { return git(...a); } catch { return null; } };
const ghTry = (...a) => { try { return execFileSync("gh", a, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };

// git itself missing is a different problem from "not a repo": say to install it (hints.mjs), don't tell them to `git init`.
if (spawnSync("git", ["--version"], { stdio: "ignore" }).error?.code === "ENOENT") { console.error(`✗ ${advice("spawnSync git ENOENT")}`); process.exit(1); }
// An older Nosy's pm/ (old file names, kaynaklar.json) is upgraded with `doctor --fix`; writing here would leave a second, empty sources.json beside it.
if (write && !fs.existsSync(path.join(pmDir, "sources.json"))) { const old = oldLayoutNote(pmDir); if (old) { console.error(`✗ ${old}`); process.exit(1); } }
if (gitTry("rev-parse", "--git-dir") === null) { console.log(`✗ ${repo} is not a git repo. Run this inside the product's git folder (or pass its path: ${nosyCommand("setup <path>")}); if it isn't under git yet, \`git init\` and make a first commit first.`); process.exit(1); }

// ---- ref: the branch the team's day-to-day work lands on ----
// 1. the remote's default branch (`git symbolic-ref refs/remotes/origin/HEAD`), else origin/main, origin/master, main, master;
// 2. but when a develop/dev/development/staging branch exists AND is ahead of that default AND is at least as recent, the default
//    is only the release branch (git-flow style: default `master`, work on `dev`) and the working branch wins. Reading the
//    release branch under-reads the product: the code, the inventory and the size history all lag behind what the team ships.
// The choice and how to change it are printed with the ref.
const INTEGRATION_NAMES = ["develop", "dev", "development", "staging"];
function refFind() {
  const sym = gitTry("symbolic-ref", "refs/remotes/origin/HEAD");
  const exists = r => gitTry("rev-parse", "--verify", "--quiet", r) !== null;
  const defaultRef = sym ? sym.replace(/^refs\/remotes\//, "") : ["origin/main", "origin/master", "main", "master"].find(exists) || null;
  if (!defaultRef) return null;
  const base = defaultRef.replace(/^origin\//, "");
  const found = { ref: defaultRef, defaultRef, reason: sym ? "the remote's default branch (git symbolic-ref refs/remotes/origin/HEAD)" : "no symbolic ref; candidates tried in order (origin/main, origin/master, main, master)", alternatives: [] };
  if (INTEGRATION_NAMES.includes(base)) return { ...found, reason: `${found.reason}; it is itself the integration branch` };
  const tipTime = r => +(gitTry("log", "-1", "--format=%ct", r) || 0);
  for (const name of INTEGRATION_NAMES) for (const cand of [`origin/${name}`, name]) {
    if (!exists(cand)) continue;
    const ahead = +(gitTry("rev-list", "--count", `${defaultRef}..${cand}`) || 0);
    found.alternatives.push(`${cand} (${ahead} commits ahead of ${defaultRef})`);
    if (ahead > 0 && tipTime(cand) >= tipTime(defaultRef)) return { ...found, ref: cand, reason: `${cand} is ${ahead} commit(s) ahead of the default branch ${defaultRef} and at least as recent: ${defaultRef} looks like the release branch and ${cand} the branch the work lands on` };
    break; // origin/<name> exists: don't fall through to a stale local copy of the same name
  }
  return found;
}
const refInfo = refFind();
const ref = refInfo?.ref || null;
if (!ref) { console.log(`✗ No default branch found (none of origin/main, origin/master, main, master exist). The repo probably has no commits yet: make one (\`git commit --allow-empty -m start\`). If its branch has another name, \`git branch -m main\` (or \`git fetch\` for a remote one). Then run \`${nosyCommand("setup .")}\` again.`); process.exit(1); }

const show = f => gitTry("show", `${ref}:${f}`);
let _files = null;
const files = () => _files ??= (git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean));
const grepSay = (pattern, filePath) => { // -F literal string; file count + total match count
  const out = gitTry("grep", "-c", "-i", "-F", pattern, ref, "--", filePath);
  if (!out) return { file: 0, total: 0 };
  const lines = out.split("\n").filter(Boolean);
  return { file: lines.length, total: lines.reduce((s, l) => s + (+l.split(":").pop() || 0), 0) };
};
const escapes = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- report collection: each key → {value, confidence, evidence} ----
const records = [], confidences = {};
const add = (key, value, confidence, evidence) => { records.push({ key, confidence, value, evidence }); confidences[key] = confidence; return value; };
const summarize = v => { if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "–"; if (Array.isArray(v)) return v.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" · ").slice(0, 160); if (typeof v === "object") return JSON.stringify(v).slice(0, 160); return String(v).slice(0, 160); };

// ---- repo absolute or relative: if the --pm folder is INSIDE the scanned repo, the scripts
// assume they'll run from that repo's own root, so `repo` is written as "." (consistent with Nosy's own
// pm/sources.json) and `matris` is written relative to the repo root; if --pm is outside the repo (e.g. a separate
// pm repo), it stays absolute.
const repoAbs = path.resolve(repo);
const pmAbs = path.resolve(pmDir);
const relPmToRepo = path.relative(repoAbs, pmAbs);
const pmInsideRepo = relPmToRepo === "" || (!relPmToRepo.startsWith("..") && !path.isAbsolute(relPmToRepo));
const repoValue = pmInsideRepo ? "." : repoAbs;

add("repo", repoValue, "high", `git rev-parse --git-dir${pmInsideRepo ? " (--pm is inside the repo, written relative)" : ""}`);
add("ref", ref, ref === refInfo.defaultRef ? "high" : "medium", `${refInfo.reason}${refInfo.alternatives.length && ref === refInfo.defaultRef ? `; also present but not chosen: ${refInfo.alternatives.join(", ")}` : ""}`);

// ============================================================
// inventory — paths come from inventory.mjs's own guess (single source: pathEstimated); only the OpenAPI file and
// the default exclusions are added here. The owner narrows it later (e.g. the first product only kept web-frontend).
// ============================================================
function inventorySuggest() {
  const t = pathEstimated(repo, ref);
  const openapi = files().find(f => /(^|\/)(openapi|swagger)\.(ya?ml|json)$/i.test(f)) || null;
  return { backend: t.backend, frontend: t.frontend, ...(openapi ? { openapi } : {}), excluded: ["**/*.test.*", "**/*_test.*", "**/tests/**", "**/node_modules/**"] };
}
const inventory = add("inventory", inventorySuggest(), "medium", "inventory.mjs's pathEstimated (apps/*api*, apps/backend, server, backend, and apps|packages/*-server|*-api|*-backend · apps/web, apps/*frontend*, web, src, and frontend-shaped apps) — if there's more than one frontend, keep the one that's the actual product screen");

// ============================================================
// issue.repo + issue.our
// ============================================================
let issue = null;
const originUrl = gitTry("remote", "get-url", "origin");
if (originUrl) {
  const m = originUrl.match(/[:/]([^/:]+\/[^/.]+?)(\.git)?$/);
  const repoNameOf = m ? m[1] : null;
  if (repoNameOf && ghTry("repo", "view", repoNameOf, "--json", "name")) {
    add("issue.repo", repoNameOf, "high", `git remote get-url origin → ${originUrl}; verified with gh repo view`);
    const titles = ghTry("issue", "list", "-R", repoNameOf, "--state", "all", "--limit", "60", "--json", "title");
    let our = "", ourConfidence = "low", ourEvidence = "gh issue list could not be read";
    if (titles) {
      const items = JSON.parse(titles);
      const counter = new Map();
      for (const it of items) { const mm = it.title.match(/^([\p{L}][\p{L}0-9_-]*)\s*:/u); const prefix = mm ? mm[1] : null; if (prefix) counter.set(prefix, (counter.get(prefix) || 0) + 1); }
      const orderedRaw = [...counter].sort((a, b) => b[1] - a[1]);
      // prefixes that match a directory name are preferred (mechanical "most frequent" alone can mislead — see report).
      const directoryNames = [...new Set([...inventory.backend, ...inventory.frontend].flatMap(p => p.split("/")))];
      const directoryMatching = orderedRaw.filter(([prefix]) => directoryNames.some(d => d && (d.toLowerCase() === prefix.toLowerCase() || d.toLowerCase().includes(prefix.toLowerCase()) || prefix.toLowerCase().includes(d.toLowerCase()))));
      if (directoryMatching.length) {
        const selected = [...new Set(directoryMatching.map(([prefix]) => prefix))].slice(0, 3);
        our = `^(${selected.map(escapes).join("|")})\\b`;
        const total = directoryMatching.reduce((s, [, n]) => s + n, 0);
        ourConfidence = "medium";
        ourEvidence = `prefixes matching a directory: ${directoryMatching.map(([prefix, n]) => `${prefix}×${n}`).join(", ")} (${total}/${items.length} total); if the raw most-frequent prefix "${orderedRaw[0]?.[0]}"×${orderedRaw[0]?.[1]} matches no directory, the mechanical count may be misleading — owner should confirm`;
      } else if (orderedRaw.length) {
        ourEvidence = `not confident, left blank. Most frequent prefixes (none match an apps/* directory): ${orderedRaw.slice(0, 5).map(([prefix, n]) => `${prefix}×${n}`).join(", ")} / ${items.length} titles`;
      }
    }
    add("issue.our", our, ourConfidence, ourEvidence);
    issue = { repo: repoNameOf, ...(our ? { our } : {}) };
  } else {
    add("issue.repo", "", "low", repoNameOf ? `${repoNameOf} could not be read with gh (permissions/private repo?)` : `could not extract owner/name from origin url: ${originUrl}`);
  }
} else {
  add("issue.repo", "", "–", "no origin remote (git remote get-url origin is empty) — issue key skipped");
}

// ============================================================
// preread.decisions — score by file name + a heading pattern like "## K12" / "# ADR-" / "Status: Accepted"
// ============================================================
const decisionTitleBank = [
  { name: "## K<no>", src: "^## K\\d+", re: /^## K\d+/gm },
  { name: "# ADR-<no>", src: "^#+\\s*ADR-\\d+", re: /^#+\s*ADR-\d+/gmi },
  { name: "Status: Accepted", src: "^Status:\\s*Accepted", re: /^Status:\s*Accepted/gmi },
  { name: "## <no>. heading", src: "^##+ \\d+[a-z]?\\.", re: /^##+ \d+[a-z]?\./gm },
];
const decisionFileCandidates = new Set(files().filter(f =>
  /(^|\/)(kararlar|decisions?)([-_.].*)?\.md$/i.test(f) || /(^|\/)adr[-_]?\d+.*\.md$/i.test(f) || /(^|\/)docs\/(adr|decisions)\//i.test(f)));
for (const f of (gitTry("grep", "-l", "-i", "-F", "Architecture Decision Record", ref) || "").split("\n").filter(Boolean)) decisionFileCandidates.add(f);
const decisionResults = [...decisionFileCandidates].map(f => {
  const content = show(f) || "";
  const scores = decisionTitleBank.map(b => ({ ...b, n: (content.match(b.re) || []).length })).sort((a, b) => b.n - a.n);
  return { file: f, best: scores[0] };
}).sort((a, b) => b.best.n - a.best.n || a.file.length - b.file.length);
let decisionsPath = "";
if (decisionResults.length) {
  const w = decisionResults[0];
  decisionsPath = w.file;
  const confidence = w.best.n >= 5 ? "high" : w.best.n > 0 ? "medium" : "low";
  const otherCandidates = decisionResults.slice(1, 4).map(k => `${k.file} (${k.best.n})`).join(", ");
  add("preread.decisions", decisionsPath, confidence, `${w.best.n} "${w.best.name}" headings${otherCandidates ? ` · other candidates: ${otherCandidates}` : ""}${w.best.n === 0 ? " — no familiar heading pattern in the content, file picked by name alone" : ""}`);
} else add("preread.decisions", "", "low", "no candidate found (no KARARLAR.md, DECISIONS.md, docs/adr/**, docs/decisions/**, ADR-*.md; content also has no 'Architecture Decision Record')");
add("preread.stale_day", 5, "high", "fixed default (owner adjusts it; every example in SKILL.md uses 5)");
add("preread.never", [], "–", "owner fills this in; a package flag (--legaltech etc.) adds to it at run time, left empty here");

// ============================================================
// request — numbered heading + status pattern; the file with the most matches wins
// ============================================================
const requestTitleBank = [
  { name: "### <no>. <name>", src: "^### (\\d+[a-z]?)\\. (.+)$", re: /^### (\d+[a-z]?)\. (.+)$/gm },
  { name: "## <no>. <name>", src: "^## (\\d+[a-z]?)\\. (.+)$", re: /^## (\d+[a-z]?)\. (.+)$/gm },
  { name: "#### <no>. <name>", src: "^#### (\\d+[a-z]?)\\. (.+)$", re: /^#### (\d+[a-z]?)\. (.+)$/gm },
  { name: "<no>. <name> (item)", src: "^(\\d+[a-z]?)\\. (.+)$", re: /^(\d+[a-z]?)\. (.+)$/gm },
];
// words: an alternation is only built from status words that ACTUALLY APPEAR IN THE DOCUMENT
// (each candidate word is checked against the document individually; one that doesn't appear isn't added to the
// alternation — "let the claim carry its own proof").
const requestStateBank = [
  { name: "**Status:** `x`", words: ["exists", "partial", "missing", "planned", "done", "in-progress"], setup: ks => `\\*\\*Status:\\*\\*\\s*\`?(${ks.join("|")})\`?` },
  { name: "Status: x", words: ["exists", "partial", "missing", "planned", "done"], setup: ks => `Status:\\s*(${ks.join("|")})` },
  { name: "[x]/[ ]", words: null, setup: () => "\\[( |x|X)\\]" },
  { name: "TODO/DONE", words: null, setup: () => "\\b(TODO|DONE)\\b" },
]; // per-document word narrowing below (done separately for each candidate file, since which words appear varies by file)
const stateForSetup = (b, content) => {
  const ks = b.words ? b.words.filter(k => new RegExp(`\\b${escapes(k)}\\b`, "i").test(content)) : null;
  const src = b.setup(ks && ks.length ? ks : (b.words || []));
  return { name: b.name, src, re: new RegExp(src, "gi") };
};
const requestFileCandidates = files().filter(f => /\.md$/i.test(f) && (/(^|\/)(backend-?needs|requests|needs|roadmap|todo)\.md$/i.test(f) || /(^|\/)plan[^/]*\.md$/i.test(f) || /needs/i.test(path.basename(f))));
const requestResults = requestFileCandidates.map(f => {
  const content = show(f) || "";
  const hBest = requestTitleBank.map(b => ({ ...b, n: (content.match(b.re) || []).length })).sort((a, b) => b.n - a.n)[0];
  const sBest = requestStateBank.map(b => stateForSetup(b, content)).map(b => ({ ...b, n: (content.match(b.re) || []).length })).sort((a, b) => b.n - a.n)[0];
  return { file: f, hBest, sBest, content };
}).filter(x => x.hBest.n >= 3).sort((a, b) => b.hBest.n - a.hBest.n || b.sBest.n - a.sBest.n);
let request = null;
if (requestResults.length) {
  const w = requestResults[0];
  const confidence = (w.hBest.n >= 10 && w.sBest.n >= 5) ? "high" : (w.sBest.n > 0 ? "medium" : "low");
  add("request.path", w.file, confidence, `most heading matches among ${requestResults.length} candidates${requestResults.length > 1 ? ` (others: ${requestResults.slice(1, 3).map(x => `${x.file} ${x.hBest.n}`).join(", ")})` : ""}`);
  add("request.title", w.hBest.src, confidence, `"${w.hBest.name}" pattern · ${w.hBest.n} sections`);
  add("request.state", w.sBest.src, w.sBest.n > 0 ? confidence : "low", `"${w.sBest.name}" pattern · ${w.sBest.n} status lines`);
  const screenMissingBank = ["not built", "not wired", "does not read", "no screen", "not drawn", "UI:\\s*not"];
  const screenMissingMatching = screenMissingBank.map(p => ({ p, n: (w.content.match(new RegExp(p, "gi")) || []).length })).filter(x => x.n > 0);
  const screenMissingSrc = screenMissingMatching.map(x => x.p).join("|");
  add("request.screen_missing", screenMissingSrc, screenMissingMatching.length ? "medium" : "low", screenMissingMatching.length ? screenMissingMatching.map(x => `"${x.p}"×${x.n}`).join(", ") : "no phrase like 'not built/not wired/does not read' found in the document; field left blank");
  add("request.last_day", 14, "low", "fixed default (lowhanging.mjs's own 14-day default) — should be tuned per product");
  request = { path: w.file, title: w.hBest.src, state: w.sBest.src, ...(screenMissingSrc ? { screen_missing: screenMissingSrc } : {}), last_day: 14 };
} else add("request.path", "", "low", `${requestFileCandidates.length} file-name candidates tried (BACKEND-NEEDS/REQUESTS/NEEDS/ROADMAP/PLAN*/TODO), none has ≥3 numbered headings`);

// ============================================================
// refs — reference-format count in the last 300 commit titles
// ============================================================
const referenceBank = [
  { name: "#issue", src: "#\\d+", re: /#\d+/g },
  { name: "JIRA/Linear (XX-123)", src: "\\b[A-Z]{2,10}-\\d+\\b", re: /\b[A-Z]{2,10}-\d+\b/g },
  { name: "K-decision", src: "\\bK\\d{2,3}(?:\\s*m\\.\\s*\\d+(?:[-–,]\\s*(?:m\\.)?\\d+)*)?", re: /\bK\d{2,3}(?:\s*m\.\s*\d+(?:[-–,]\s*(?:m\.)?\d+)*)?/g },
  { name: "§item", src: "§\\d+[a-z]?", re: /§\d+[a-z]?/g },
  { name: "ADR-<no>", src: "ADR-\\d+", re: /ADR-\d+/g },
  { name: "Owner/roadmap §<no>", src: "(?:OWNER|roadmap)\\s*§?\\s*[\\d.]+", re: /(?:OWNER|roadmap)\s*§?\s*[\d.]+/gi },
];
const subjects300 = (gitTry("log", ref, "-n", "300", "--no-merges", "--format=%s") || "");
const commitCount = subjects300 ? subjects300.split("\n").filter(Boolean).length : 0;
const referenceResult = referenceBank.map(b => ({ ...b, n: (subjects300.match(b.re) || []).length })).sort((a, b) => b.n - a.n);
const threshold = Math.max(3, Math.round(commitCount * 0.01));
const referenceWinner = referenceResult.filter(b => b.n >= threshold);
add("refs", referenceWinner.map(b => b.src), referenceWinner.length ? "high" : "low",
  `last ${commitCount} commit titles, threshold ≥${threshold}: ${referenceResult.map(b => `${b.name}×${b.n}`).join(", ")}`);

// ============================================================
// dropped — "dropped:"/"unused"/"not wired"/"TODO(ui)" convention in frontend directories
// ============================================================
const frontendCandidates = [...new Set([...inventory.frontend, ...files().filter(f => f.startsWith("apps/")).map(f => f.split("/").slice(0, 2).join("/")).filter(a => /frontend|web|client|ui/i.test(a))])];
const droppedPatternBank = ["dropped:", "unused", "not wired", "TODO(ui)", "TODO(backend)"];
let droppedBest = null;
for (const dir of frontendCandidates) for (const pattern of droppedPatternBank) {
  const { file, total } = grepSay(pattern, dir);
  if (total >= 2 && (!droppedBest || total > droppedBest.total)) droppedBest = { dir, pattern, file, total };
}
let dropped = null;
if (droppedBest) {
  let { dir, pattern, total, file } = droppedBest;
  // The parent directory usually also pulls in tests/docs/config (noise); if a real source subdirectory exists
  // and also matches on its own, prefer it — the winner is "closest to the real source", not "highest raw ratio"
  // (confirmed on the first product: apps/web-frontend had 57 files but 35 were in tests/; apps/web-frontend/src had 22).
  for (const altName of ["src", "source", "app"]) {
    const narrowed = grepSay(pattern, `${dir}/${altName}`);
    if (narrowed.total > 0) { dir = `${dir}/${altName}`; total = narrowed.total; file = narrowed.file; break; }
  }
  const lines = (gitTry("grep", "-n", "-i", "-F", pattern, ref, "--", dir) || "").split("\n").filter(Boolean).map(l => l.split(":").slice(2).join(":")).join("\n");
  const opportunityBank = ["not drawn", "not built", "not wired", "will read", "waits?", "\\buntil\\b", "\\bpending\\b", "\\byet\\b", "\\bTODO\\b", "backend needs?", "no screen", "not read"];
  const knowinglyBank = ["intentionally", "by design", "on purpose", "nothing (?:else )?references? it", "no screen reads?", "not needed", "won't", "not required", "deliberate"];
  const pickPhrase = bank => { const e = bank.map(p => ({ p, n: (lines.match(new RegExp(p, "gi")) || []).length })).filter(x => x.n > 0); return { src: e.map(x => x.p).join("|"), evidence: e.map(x => `"${x.p}"×${x.n}`).join(", ") }; };
  const opportunity = pickPhrase(opportunityBank), knowingly = pickPhrase(knowinglyBank);
  add("dropped.path", dir, "medium", `"${pattern}" in ${file} files, ${total} lines (frontend candidates: ${frontendCandidates.join(", ") || "missing"})`);
  add("dropped.pattern", pattern, "medium", `most matches among ${droppedPatternBank.map(d => `"${d}"`).join(", ")}`);
  add("dropped.opportunity", opportunity.src, opportunity.src ? "low" : "–", opportunity.evidence || "no match, field left blank");
  add("dropped.knowingly", knowingly.src, knowingly.src ? "low" : "–", knowingly.evidence || "no match, field left blank");
  dropped = { pattern, path: dir, ...(opportunity.src ? { opportunity: opportunity.src } : {}), ...(knowingly.src ? { knowingly: knowingly.src } : {}) };
} else add("dropped", null, "–", `no "dropped:"/"unused"/"not wired"/"TODO(ui)" convention seen in the frontend candidates (${frontendCandidates.join(", ") || "notFound"}) — key not set`);

// ============================================================
// glossary — mixed TR/EN field glossary: fixed candidate pairs, only the ones that ACTUALLY appear in the document.
// Kept in Turkish on purpose: this seed pairs real Turkish domain terms with their English equivalents so the
// script can spot a bilingual glossary in a TARGET repo's own docs — translating the Turkish terms away would
// break the feature (see the final migration report).
// ============================================================
// Glossary candidates (a product term -> English words), data not code: skill/data/lang/tr/glossary-seed.json, grouped in packs.
// A pack is a vertical (legal) or a language (Turkish) and is applied ONLY when the repo's own docs show its detect markers;
// a repo with no matching pack gets no glossary at all. (A real run on a public chat-support product got the legal pair
// "file" -> "matter" written into its sources.json because the seed was one flat list and the word "matter" is in every README.)
const GLOSSARY_PACKS = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/glossary-seed.json", import.meta.url), "utf8")).packs;
// each source is bounded SEPARATELY (the decisions document alone can be hundreds of KB — 400KB+ in the first product — a
// single shared bound would truncate the request document before it ever enters the pool; internal request: the
// idf/stem pattern from gather-evidence.mjs works here too).
const PART_BOUNDARY = 80000;
const textPool = [show("README.md"), decisionsPath ? show(decisionsPath) : "", request ? show(request.path) : ""].filter(Boolean).map(s => s.slice(0, PART_BOUNDARY)).join("\n");
const occurrenceCount = (text, word) => (text.match(new RegExp(`\\b${escapes(word)}\\b`, "gi")) || []).length;
const asciiFold = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
const foldedPool = asciiFold(textPool);
const packVerdicts = GLOSSARY_PACKS.map(pack => { const hit = pack.detect.markers.filter(m => occurrenceCount(foldedPool, asciiFold(m)) > 0); return { pack, hit, applies: hit.length >= (pack.detect.min ?? 2) }; });
const GLOSSARY_SEED = packVerdicts.filter(v => v.applies).flatMap(v => v.pack.seed);
const glossaryCandidates = GLOSSARY_SEED.map(([sourceTerm, targets]) => {
  // A pair that maps a word to itself ("user" → "user", an English-only product) says nothing: dropped.
  const sourceN = occurrenceCount(textPool, sourceTerm), targetHits = targets.filter(t => t.toLowerCase() !== sourceTerm.toLowerCase()).map(target => ({ target, n: occurrenceCount(textPool, target) })).filter(x => x.n > 0);
  return { sourceTerm, sourceN, targetHits, total: sourceN + targetHits.reduce((s, x) => s + x.n, 0) };
}).filter(x => x.sourceN > 0 && x.targetHits.length > 0).sort((a, b) => b.total - a.total).slice(0, 10);
const glossary = Object.fromEntries(glossaryCandidates.map(x => [x.sourceTerm, x.targetHits.map(h => h.target)]));
const packNote = packVerdicts.map(v => `${v.pack.name} pack ${v.applies ? "applied" : "not applied"} (${v.hit.length}/${v.pack.detect.min ?? 2} markers${v.hit.length ? `: ${v.hit.join(", ")}` : ""})`).join("; ");
add("glossary", glossary, glossaryCandidates.length ? "low" : "–", glossaryCandidates.length
  ? `${glossaryCandidates.length} pairs, kept because both sides appear in the docs (README/decisions/request, ${textPool.length} characters); ${packNote} — (unverified: owner should confirm)`
  : `nothing written: no vertical or language pack matched this repo's docs (${packNote})`);

// ============================================================
// matris — fixed rule: <pm>/matris.json (move-in step 4 sets this up)
// ============================================================
const matrixPath = path.resolve(pmDir, "matrix.json");
const matrixValue = pmInsideRepo ? path.relative(repoAbs, matrixPath) : matrixPath;
add("matrix", matrixValue, "high", `fixed rule: sits next to sources.json${fs.existsSync(matrixPath) ? " (found)" : " (not there yet — move-in step 4 sets it up)"}${pmInsideRepo ? " · --pm is inside the repo, written relative" : ""}`);

// ============================================================
// team — REPORT ONLY, doesn't go into sources.json (for the product.md suggestion)
// ============================================================
const teamRaw = gitTry("shortlog", "-sn", "--since=30.days", ref) || "";
const team = teamRaw.split("\n").filter(Boolean).map(l => { const m = l.trim().match(/^(\d+)\s+(.+)$/); return m ? { n: +m[1], name: m[2] } : null; }).filter(Boolean).filter(x => !/\[bot\]|-bot$|bot$/i.test(x.name)).slice(0, 5);

// ============================================================
// package guess — REPORT ONLY (no field in sources.json; added by hand via a command flag / to product.md)
// ============================================================
const PACKAGE_KEY = {
  legaltech: [...TrPackageWords.legaltech],
  fintech: ["payment", "\\bkyc\\b", "\\baml\\b", ...TrPackageWords.fintech],
  mobile: ["\\bios\\b", "android", "app store", "play store", "react-native", "flutter", "\\bswift\\b", "\\bkotlin\\b"],
  "b2b-saas": ["subscription", "subscription", "\\btenant\\b", "workspace", "\\bseat\\b", "\\bsso\\b", "\\bsaml\\b", "champion"],
};
const packageScore = Object.entries(PACKAGE_KEY).map(([name, words]) => {
  const e = words.map(k => ({ k, n: (textPool.match(new RegExp(k, "gi")) || []).length })).filter(x => x.n > 0);
  return { name, total: e.reduce((s, x) => s + x.n, 0), e };
}).sort((a, b) => b.total - a.total);
const packageWinner = packageScore[0]?.total >= 3 ? packageScore[0] : null;

// ---- landing page: where `frontyard` reads the page from ----
// A web page in the repo (Next/Astro/Nuxt/SvelteKit/plain index.html), shallowest first; for a tool or library with no
// page (package.json "bin", or no screen files at all), the README is the page. Otherwise leave it for the owner: a live
// site outside the repo goes in `frontyard.url`, and `frontyard` has an agent fetch it.
// Also a site package inside a monorepo (packages/<name>-website, apps/marketing…) and Next's [locale]/(group)
// segments: Twenty's home page is packages/twenty-website/src/app/[locale]/(site)/page.tsx.
const LANDING = /^((apps|packages)\/([\w.-]*-)?(web|www|site|website|landing|marketing|homepage|frontend)\/)?(src\/)?(app\/((\([\w-]+\)|\[[\w-]+\])\/)*page\.[jt]sx|pages\/index\.(astro|[jt]sx|vue|svelte|mdx?)|routes\/\+page\.svelte|(public\/)?index\.html)$/;
// A package named like a site beats a generic web app; then the shallowest.
const siteRank = f => /(^|\/|-)(website|www|site|landing|marketing|homepage)\//.test(f) ? 0 : 1;
const landingHits = files().filter(f => LANDING.test(f)).sort((a, b) => siteRank(a) - siteRank(b) || a.split("/").length - b.split("/").length);
let packageBin = false; try { packageBin = !!JSON.parse(git("show", `${ref}:package.json`)).bin; } catch {}
const hasScreens = files().some(f => /\.(jsx|tsx|vue|svelte|astro|html)$/i.test(f) && !/(^|\/)(test|tests|__tests__|docs?|examples?)\//.test(f));
const frontyard = landingHits.length
  ? add("frontyard", { path: landingHits[0] }, landingHits.length === 1 ? "medium" : "low", `${landingHits.length} landing candidate(s): ${landingHits.slice(0, 3).join(", ")} — the shallowest is taken; the owner confirms it's the public home page`)
  : files().includes("README.md") && (packageBin || !hasScreens)
    ? add("frontyard", { path: "README.md" }, "low", `no web page in the repo and ${packageBin ? "package.json has a \"bin\"" : "no screen files"}: a tool's README is its landing page`)
    : add("frontyard", null, "–", "no landing page in the repo: ask the owner for the live site and write it as frontyard.url");

// ---- the team's working notes: psst's signal 10 reads them ----
const pmRelNext = path.relative(path.resolve(repo), path.resolve(pmDir));
const nextDocs = findNextDocs(repo, ref, { own: [decisionsPath, request?.path, pmRelNext && !pmRelNext.startsWith("..") ? pmRelNext.replace(/\/?$/, "/") : null] });
const next = nextDocs.files.length
  ? add("next", { path: nextDocs.files.length === 1 ? nextDocs.files[0] : nextDocs.files }, nextDocs.candidates.length > 1 ? "low" : "medium", nextDocs.candidates.slice(0, 3).map(c => `${c.file}: ${c.commits} commits in 14 days, ${c.cites} paragraphs cite repo paths`).join("; "))
  : add("next", null, "–", "no working notes found (no markdown file edited in 5+ commits lately that cites the code); psst skips signal 10");

// ============================================================
// suggestion object (sources.json shape)
// ============================================================
const suggestion = {
  repo: repoValue, ref,
  ...(dropped ? { dropped } : {}),
  ...(request ? { request } : {}),
  matrix: matrixValue,
  ...(issue ? { issue } : {}),
  // No decisions doc: leave the key out (an empty string reads like a setting that points nowhere).
  preread: { ...(decisionsPath ? { decisions: decisionsPath } : {}), stale_day: 5, never: [] },
  refs: referenceWinner.map(b => b.src),
  glossary,
  inventory,
  ...(frontyard ? { frontyard: { ...frontyard, every: 7 } } : {}),
  ...(next ? { next } : {}),
  _source_find: { date: new Date().toISOString().slice(0, 10), confidence: confidences },
};

// ============================================================
// markdown report
// ============================================================
let md = `# sources.json suggestion · ${path.basename(path.resolve(repo))} · ${ref}\n\n`;
md += `This report only reads the repo. Nothing is written unless you run setup or pass --write, and then only under pm/. Every line comes with its evidence.\n\n`;
// if --pm isn't given, the pm folder defaults to the current directory's pm/; stated explicitly so running it from
// a different repo doesn't make a wrong matrix look "found".
if (!pmGiven) md += `**Note:** --pm not given; the pm folder defaults to \`${path.resolve(pmDir)}\` (matris and --write look at this folder).\n\n`;
md += `| Key | Confidence | Suggestion | Evidence |\n|---|---|---|---|\n`;
for (const k of records) md += `| ${k.key} | ${k.confidence} | ${summarize(k.value)} | ${String(k.evidence).replace(/\|/g, "/").slice(0, 200)} |\n`;
md += ref !== refInfo.defaultRef
  ? `\n**Branch:** read from \`${ref}\`, not the default branch \`${refInfo.defaultRef}\` (${refInfo.reason}). To read the default branch instead, set \`"ref": "${refInfo.defaultRef}"\` in sources.json.\n`
  : `\n**Branch:** read from \`${ref}\` (${refInfo.reason}). To read another branch, set \`"ref"\` in sources.json${refInfo.alternatives.length ? ` (also present: ${refInfo.alternatives.join(", ")})` : ""}.\n`;
if (packageWinner) md += `\n**Package guess:** \`--${packageWinner.name}\` (${packageWinner.e.map(x => `${x.k.replace(/\\b/g, "")}×${x.n}`).join(", ")}). Add \`- **Package:** ${packageWinner.name}\` to \`product.md\`, or pass \`--${packageWinner.name}\` to the commands.\n`;
if (team.length) md += `\n**Team (last 30 days, product.md suggestion — not part of sources.json):** ${team.map(e => `${e.name} ${e.n}`).join(", ")}\n`;

// ---- --write / --onTop: one card, one approval (Productboard Spark pattern) ----
const goal = path.join(pmDir, "sources.json");
md += `\n## Writing\n\n`;
if (fs.existsSync(goal)) {
  let old = {}; try { old = readSources(pmDir, { raw: true }); } catch (e) { md += `\n✗ could not read existing ${goal}: ${e.message}\n`; }
  const keys = [...new Set([...Object.keys(old), ...Object.keys(suggestion)])].filter(a => !a.startsWith("_"));
  md += `\`${goal}\` already exists. Per-key diff:\n\n| Key | Status |\n|---|---|\n`;
  for (const a of keys) {
    const e = JSON.stringify(old[a] ?? null), y = JSON.stringify(suggestion[a] ?? null);
    const status = !(a in old) ? "new suggestion (missing from the old one)" : !(a in suggestion) ? "missing from the suggestion (present in the old one)" : e === y ? "same" : "different";
    md += `| ${a} | ${status} |\n`;
  }
  if (write && onTop) {
    fs.copyFileSync(goal, goal + ".backup");
    fs.writeFileSync(goal, JSON.stringify(suggestion, null, 1) + "\n");
    md += `\n--onTop: took a \`${goal}.backup\`, replaced \`${goal}\` with the new suggestion.\n`;
  } else if (write) md += `\n--write given, but the file already exists; without --onTop it won't be overwritten. To overwrite: \`--write --onTop\`.\n`;
  else md += `\nTo write: \`--write --onTop\` (takes a .backup first).\n`;
} else if (write) {
  fs.mkdirSync(pmDir, { recursive: true });
  fs.writeFileSync(goal, JSON.stringify(suggestion, null, 1) + "\n");
  md += `\`${goal}\` written.\n`;
} else md += `\`${goal}\` doesn't exist. To write it: \`--write\`.\n`;

// Relative only when it's short (inside this folder); a skill installed elsewhere shows as an absolute path, not ../../../…
const skillAbs = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), skillRel = path.relative(process.cwd(), skillAbs);
const skillRoot = !skillRel ? "skill" : skillRel.startsWith("..") ? skillAbs : skillRel;
md += `\nNext: \`node ${skillRoot}/tools/verify-setup.mjs ${pmDir}\`\n`;

process.stdout.write(md);
if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({ type: "source_find", generated: new Date().toISOString(), repo: path.resolve(repo), ref, suggestion, confidence: confidences, team, packageEstimated: packageWinner ? packageWinner.name : null }, null, 1));
