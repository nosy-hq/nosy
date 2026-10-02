#!/usr/bin/env node
// Rival language (owner's ask): "we score our own column ourselves, and we picked the
// steps ourselves against our own cycle - for an outside eye, the steps should also be derived from rivals'
// own language." Reads pm/rivals/*.md's "## Featured on the landing page" bullets (the rival's own homepage
// claims, matrix step number in brackets - written by nosy-neighbor, also read by frontyard.mjs) and
// pm/matrix.json's step names, and reports: (1) per step, the words rivals actually use to describe it and how
// many distinct rivals feature it; (2) rival-featured claims that don't map to any step (`[?]`, or a number
// outside the matrix) grouped by shared stemmed words - a candidate step, "owner decides", never added on its
// own; (3) steps no rival features at all - Nosy's own framing, unchecked against anyone else's language.
// No model: counting and deterministic word-stem grouping only (skill/tools/text.mjs, the same helper
// gather-evidence/frontyard use), same as the rest of Nosy's model-free tools. Still biased both ways - Nosy
// picked the 21 steps, and a rival's homepage sells rather than audits - which is why this is a lead for the
// owner, not a rewrite of the matrix.
// Usage: node rival-language.mjs <pm folder> [--json <file>]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { words, root, langOfLoad } from "./text.mjs";
import { matrixRead } from "./read-matrix.mjs";
import { readSources } from "./sources-file.mjs";

// Generic English stopwords (pm/rivals/*.md is written in English - skill/data/lang/tr/ holds Turkish PRODUCT
// content the tools analyze, not Nosy's own copy, so it doesn't apply to this file's own claim text).
const Filler = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "when", "only", "also",
  "more", "over", "than", "then", "their", "your", "our", "each", "every", "same", "a", "an", "to", "of", "in",
  "on", "is", "are", "we", "you", "it", "its", "us", "at", "by", "as", "be", "can", "will", "all", "now", "new",
  "get", "who", "how", "what", "no", "not", "or", "so", "up", "out", "do", "does", "one"]);
const FeatureLine = /^\s*[-*]\s*\[(\d{1,2}|\?)\]\s*(.+)$/gm;

// A "## Featured on the landing page" bullet: `- [<step no>] <claim> (<url>, <date read>)`. `no` is a string
// ("1".."21") or "?" (a rival-neighbor may mark a claim it couldn't cleanly map).
export function claimsOf(md) {
  const section = (md.match(/^## Featured on the landing page[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1] || "";
  return [...section.matchAll(FeatureLine)].map(m => ({ no: m[1], claim: m[2].trim().slice(0, 220) }));
}
// Stemmed, stopword-filtered keywords from a claim (the "(url, date)" tail dropped first so a URL never counts as a word).
export function keywordsOf(claim) {
  return [...new Set(words(claim.replace(/\([^)]*\)\s*$/, ""), 3).filter(w => !Filler.has(w) && !/^\d+$/.test(w)).map(root))];
}

function works(pmDir) {
  const empty = { type: "rival-language", generated: new Date().toISOString() };
  let K = {}; try { K = readSources(pmDir); } catch {}
  langOfLoad(K); // sources.json's `language`
  const MO = K.matrix ? matrixRead(K.matrix, { codes: K.matrixCodes }) : null;
  if (!MO) return { ...empty, matrix_missing: true };
  const rivalDir = path.join(pmDir, "rivals");
  if (!fs.existsSync(rivalDir)) return { ...empty, rivals_missing: true };

  const rivals = fs.readdirSync(rivalDir).filter(f => f.endsWith(".md") && !f.startsWith("_"))
    .map(f => { const md = fs.readFileSync(path.join(rivalDir, f), "utf8");
      return { slug: f.replace(/\.md$/, ""), name: (md.match(/^# (.+)$/m) || [, f])[1].trim(), claims: claimsOf(md) }; })
    .filter(r => r.claims.length);

  const stepNos = new Set(MO.lines.map((line, i) => String(line.no ?? i + 1)));
  const perStep = new Map(); // step no -> [{rival, claim, words}]
  const unmapped = []; // {rival, claim, words, no}
  for (const r of rivals) for (const c of r.claims) {
    const ws = keywordsOf(c.claim);
    if (c.no !== "?" && stepNos.has(c.no)) { if (!perStep.has(c.no)) perStep.set(c.no, []); perStep.get(c.no).push({ rival: r.name, claim: c.claim, words: ws }); }
    else unmapped.push({ rival: r.name, claim: c.claim, words: ws, no: c.no });
  }

  // --- per step: which words rivals themselves use, and how many distinct rivals feature it ---
  const steps = MO.lines.map((line, i) => {
    const no = String(line.no ?? i + 1), entries = perStep.get(no) || [];
    const byRival = new Map(); // word -> Set(rival name)
    for (const e of entries) for (const w of e.words) { if (!byRival.has(w)) byRival.set(w, new Set()); byRival.get(w).add(e.rival); }
    const top = [...byRival.entries()].map(([word, set]) => ({ word, rivals: set.size, example: (entries.find(e => e.words.includes(word)) || {}).claim || "" }))
      .sort((a, b) => b.rivals - a.rivals || a.word.localeCompare(b.word)).slice(0, 6);
    return { no, feature: line.feature, rivals: new Set(entries.map(e => e.rival)).size, top, examples: entries.slice(0, 5).map(e => ({ rival: e.rival, claim: e.claim })) };
  });
  const featured = steps.filter(s => s.rivals > 0), unfeatured = steps.filter(s => s.rivals === 0);

  // --- unmapped claims: cluster by shared stemmed word (deterministic union-merge over text.mjs's root()
  // stems - the same "merge groups that share an element" idea skill/tools/text.mjs's conceptGroupsOf applies
  // to a single text's own words, applied here across separate claims instead). A word too common across the
  // unmapped set (appears in more than ~40% of them) is too generic to signal that two claims are alike, so it
  // can't trigger a merge on its own - the same "rare word carries the real signal" idea as idf, as a simple cap
  // instead of a weight, since only a yes/no merge decision is needed here.
  const df = new Map(); for (const e of unmapped) for (const w of new Set(e.words)) df.set(w, (df.get(w) || 0) + 1);
  const cap = Math.max(2, Math.ceil(unmapped.length * 0.4));
  const sharedOk = w => (df.get(w) || 0) <= cap;
  let groups = unmapped.map(e => ({ members: [e], ws: new Set(e.words) }));
  for (let changed = true; changed;) { changed = false;
    for (let i = 0; i < groups.length && !changed; i++) for (let j = i + 1; j < groups.length && !changed; j++)
      if ([...groups[j].ws].some(w => groups[i].ws.has(w) && sharedOk(w))) { groups[j].ws.forEach(w => groups[i].ws.add(w)); groups[i].members.push(...groups[j].members); groups.splice(j, 1); changed = true; } }
  const candidates = groups.map(g => {
    const count = new Map(); for (const m of g.members) for (const w of m.words) count.set(w, (count.get(w) || 0) + 1);
    const label = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([w]) => w).join(" / ");
    return { label: label || "(no shared word)", rivals: new Set(g.members.map(m => m.rival)).size,
      members: g.members.map(m => ({ rival: m.rival, claim: m.claim, marked: m.no })) };
  }).sort((a, b) => b.rivals - a.rivals || b.members.length - a.members.length);

  return { ...empty, matrix_missing: false, rivals_missing: false, rivals_read: rivals.length, steps, featured, unfeatured, candidates,
    summary: { rivals: rivals.length, steps: steps.length, featured: featured.length, unfeatured: unfeatured.length, unmapped: unmapped.length, candidate_groups: candidates.length } };
}

function formatMd(R) {
  if (R.matrix_missing) return `# Rival language\n\nNo matrix (\`sources.json\` \`matrix\`): run \`move-in\`/\`neighbors\` first.\n`;
  if (R.rivals_missing) return `# Rival language\n\nNo \`pm/rivals/\` yet: run \`neighbors\` first.\n`;
  const O = R.summary;
  let o = `# Rival language · ${R.generated.slice(0, 10)} · ${O.rivals} rival file(s) with landing-page claims, ${O.featured}/${O.steps} step(s) featured by at least one rival, ${O.candidate_groups} candidate (unmapped) group(s)\n\n`;
  o += `Rivals' own homepage claims (\`pm/rivals/*.md\`'s "## Featured on the landing page", written by \`nosy-neighbor\`), read against Nosy's own ${O.steps}-step loop matrix. Biased both ways: Nosy picked the steps, and a rival's homepage sells, it doesn't audit. A candidate below is a lead, not a decision - the owner decides whether it's really a new step.\n\n`;
  if (R.featured.length) {
    o += `## Per step: how rivals describe it\n\n| # | Step | Rivals | Top words rivals use (rival count) |\n|---|---|---|---|\n`;
    for (const s of R.featured) o += `| ${s.no} | ${s.feature.replace(/\|/g, "/").slice(0, 64)} | ${s.rivals} | ${s.top.map(t => `${t.word} (${t.rivals})`).join(", ") || "—"} |\n`;
    o += "\n";
  }
  if (R.candidates.length) {
    o += `## Candidate steps — owner decides (rival-featured, no matching step)\n\nGrouped by shared stemmed words across claims marked \`[?]\` or a step number outside the matrix. The label is built from the group's own most common words - a lead, never a matrix row added on its own.\n\n`;
    for (const g of R.candidates) {
      o += `### ${g.label} (${g.rivals} rival(s), ${g.members.length} claim(s))\n`;
      for (const m of g.members) o += `- ${m.rival}${m.marked === "?" ? "" : ` (was marked [${m.marked}], not a matrix step)`}: ${m.claim}\n`;
      o += "\n";
    }
  }
  if (R.unfeatured.length) o += `## Steps no rival features (our own framing)\n\n${R.unfeatured.map(s => `- ${s.no}. ${s.feature}`).join("\n")}\n\n`;
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), takeArg = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = takeArg("--json"), [pmDir = "pm"] = argv;
  const R = works(pmDir);
  process.stdout.write(formatMd(R));
  if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
}

export { works as compute };
