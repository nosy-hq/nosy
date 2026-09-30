// canwe's answer ledger: every "can we do this?" answer is written to a dated file and an index; asking the
// same topic again shows the previous verdict and what's changed since. Nosy's edge over a substitute is
// persistence: the counting lives in a script, the verdict lives with the agent, the memory lives in pm/
// (rivals/asking-the-coding-agent-directly.md, bmad-method.md's .memlog pattern).
// Usage:
//   node ledger.mjs <pm> find "<question>"      previous answers and what's changed since
//   node ledger.mjs <pm> write "<question>" --verdict "<verdict>" --basis <code|document|intent> [--size S|M|L] [--reason "<why now>"] [--evidence <file>] [--note "<note>"]
//   node ledger.mjs <pm> list                   every answer
// Files: <pm>/canwe/<date>-<topic>.md and <pm>/canwe/ledger.json. The agent gives the verdict; the ledger only records and compares.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { smallAscii } from "./text.mjs";
import { readSources } from "./sources-file.mjs";
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const verdictA = opt("--verdict"), basisA = opt("--basis"), sizeA = opt("--size"), reason = opt("--reason"), evidenceF = opt("--evidence"), note = opt("--note");
const [pm = "pm", action = "list", ...questionP] = argv, question = questionP.join(" ").trim();
const K = (() => { try { return readSources(pm); } catch { return {}; } })();
const dir = path.join(pm, "canwe"), idx = path.join(dir, "ledger.json");
const ledger = (() => { try { return JSON.parse(fs.readFileSync(idx, "utf8")); } catch { return []; } })();
// Tell an error apart from an empty result: null = git failed (e.g. no such ref), "" = the result is empty.
const gitN = (...a) => { if (!K.repo) return null; try { return execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const git = (...a) => gitN(...a) ?? "";
const ref = K.ref || "HEAD", now = git("rev-parse", "--short=10", ref) || null;

const Verdict = { "we can": "We can", "yes": "We can", "weCanDo": "We can", "partial": "Partial",
  "not now": "Not now", "no": "Not now",
  "decided: not doing": "Decided: not doing", "decided": "Decided: not doing", "notDoing": "Decided: not doing",
  "already exists": "Already exists" };
const Basis = { code: "code-based (with file:line or a commit)", document: "document-based (a decision, request doc, issue)", intent: "intent-based (evidence is weak, a guess)" };
const low = t => String(t).toLowerCase();
const root = w => w.length > 5 ? w.slice(0, -2) : w.length === 5 ? w.slice(0, -1) : w;
const Filler = new Set(["one", "with", "for", "and", "the", "can", "canDo", "exists", "our"]);
const words = s => low(s).split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 2 && !Filler.has(x));
// Stems match by prefix ("file" ~ "files"), at least 4 letters.
const match = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
// Each glossary group is one concept (a Turkish word and its English translation, e.g. "stage"): the
// translation matches, a shared word ("file") doesn't inflate similarity.
const groups = Object.entries(K.glossary || {}).map(([tr, en]) => [...new Set([tr, ...en].flatMap(x => low(x).split(/\s+/)).filter(p => p.length > 2).map(root))]);
const groupNo = k => groups.findIndex(G => G.some(y => match(k, y)));
const concepts = s => [...new Set(words(s).map(root).map(k => { const g = groupNo(k); return g >= 0 ? `#${g}` : k; }))];
// Keys (for searching commits and endpoints): stems + every translation of their group.
const keys = s => { const kk = words(s).map(root), set = new Set(kk); for (const k of kk) { const g = groupNo(k); if (g >= 0) groups[g].forEach(x => set.add(x)); } return [...set]; };
// Overlap coefficient over concepts: short and long questions can still match; a single shared concept needs a higher threshold.
const similar = (a, b) => { const common = a.filter(x => b.some(y => x.startsWith("#") || y.startsWith("#") ? x === y : match(x, y)));
  if (!common.some(x => x.startsWith("#") || x.length >= 4)) return 0; const s = common.length / Math.min(a.length || 1, b.length || 1);
  return (s >= 0.6 || (common.length >= 2 && s >= 0.5)) ? s : 0; };
const findMatching = s => { const a = concepts(s); return ledger.map(e => ({ e, score: similar(a, concepts(e.question)) })).filter(x => x.score > 0).sort((x, y) => y.score - x.score || y.e.date.localeCompare(x.e.date)); };
const dateWrite = iso => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Traceable pieces from the evidence text: file paths, commits, refs, endpoints.
const refPattern = (K.refs?.length ? K.refs : ["\\bK\\d{2,3}\\b", "§\\d+[a-z]?", "#\\d+", "\\b[A-Z][A-Z0-9]{1,9}-\\d+\\b"]).map(r => { try { return new RegExp(r, "g"); } catch { return null; } }).filter(Boolean);
const evidenceExtract = t => {
  const files = [...new Set([...t.matchAll(/([\w.@\-]+(?:\/[\w.@\-{}\[\]]+)+\.(?:go|ts|tsx|js|jsx|mjs|cjs|py|rb|sql|md|ya?ml|json|proto|java|kt|swift|rs|php|cs))(?::\d+)?/g)].map(m => m[1]))].slice(0, 40);
  const commits = [...new Set([...t.matchAll(/\b[0-9a-f]{7,12}\b/g)].map(m => m[0]))].filter(h => /[a-f]/.test(h) && /\d/.test(h) && git("cat-file", "-t", h) === "commit").slice(0, 20);
  const refs = [...new Set(refPattern.flatMap(r => [...t.matchAll(r)].map(m => m[0].replace(/\s+/g, " "))))].slice(0, 30);
  const endpoints = [...new Set([...t.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w\-\/{}:.]+)/g)].map(m => `${m[1]} ${m[2]}`))].slice(0, 30);
  return { files, commits, refs, endpoints };
};
// Inventory snapshot (inventory.mjs --json): whether the endpoints in the evidence (or matching the topic) are "on screen".
const inventoryRead = () => { try { const j = JSON.parse(fs.readFileSync(path.join(pm, "state", "inventory.json"), "utf8")); const array = Array.isArray(j) ? j : Object.values(j).find(v => Array.isArray(v) && v[0] && ("path" in v[0] || "path" in v[0])); return (array || []).map(u => ({ method: (u.method || "").toUpperCase(), path: u.path || u.path, used: !!(u.used ?? u.used), usage: u.usage || null })); } catch { return null; } };
const pathNorm = y => String(y).replace(/\{[^}]+\}|:[\w]+|\$\{[^}]+\}/g, "*").replace(/\/+$/, "");
const inventoryMatch = (env, evidence, survey) => { if (!env) return [];
  const fromEvidence = env.filter(u => evidence.endpoints.some(x => { const [m, y] = x.split(" "); return (!u.method || u.method === m) && pathNorm(u.path) === pathNorm(y); }));
  const selection = fromEvidence.length ? fromEvidence : env.filter(u => survey.filter(k => k.length >= 5).some(k => low(u.path).includes(k))).slice(0, 10);
  return selection.map(({ method, path: filePath, used }) => ({ method, path: filePath, used })); };

// Since then: has the repo moved on, are there commits touching the evidence files or the topic, has any endpoint's status changed.
function changedOnes(e) {
  const o = [];
  if (!K.repo || !e.ref) return ["No repo info; couldn't compare for changes."];
  if (!now) return ["Couldn't read the repo right now."];
  if (e.ref === now) return [`The repo hasn't changed since then (${ref} @ ${now}).`];
  if (gitN("cat-file", "-t", e.ref) !== "commit") return [`That day's commit (${e.ref}) isn't in the repo (history rewritten, or a different repo); couldn't compare, rebuild the answer.`];
  const say = git("rev-list", "--count", `${e.ref}..${ref}`);
  o.push(`${ref} has moved ${say || "?"} commits since then (${e.ref} -> ${now}).`);
  if (e.evidence?.files?.length) { const l = git("log", "--no-merges", "--format=%h %ad %s", "--date=format:%d.%m", `${e.ref}..${ref}`, "--", ...e.evidence.files).split("\n").filter(Boolean);
    o.push(l.length ? `${l.length} commits touching the evidence files: ${l.slice(0, 5).map(x => "`" + x.slice(0, 100) + "`").join(" · ")}` : "No commit touches the evidence files."); }
  // Topic commit: at least two of the question's concepts (one, if there's only one) should show up in the title, or a ref from the evidence; this cuts translation noise.
  const kv = concepts(e.question).map(c => (c.startsWith("#") ? groups[+c.slice(1)] : [c]).filter(k => k.length >= 4)).filter(g => g.length);
  const kre = kv.map(g => g.map(k => new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"))), need = Math.min(2, kre.length);
  const topic = git("log", "--no-merges", "--format=%h %ad %s", "--date=format:%d.%m", `${e.ref}..${ref}`).split("\n").filter(l => l && (kre.filter(g => g.some(r => r.test(low(l)))).length >= need && need > 0 || (e.evidence?.refs || []).some(r => new RegExp(`${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d])`).test(l))));
  if (topic.length) o.push(`${topic.length} commits touching the topic or its refs: ${topic.slice(0, 5).map(x => "`" + x.slice(0, 100) + "`").join(" · ")}`);
  const env = inventoryRead();
  if (env && e.inventory?.length) { for (const u of e.inventory) { const s = env.find(x => (!u.method || x.method === u.method) && pathNorm(x.path) === pathNorm(u.path));
    if (!s) o.push(`\`${u.method} ${u.path}\` is no longer in the inventory.`); else if (s.used !== u.used) o.push(`\`${u.method} ${u.path}\`: ${u.used ? "was on screen, now isn't" : "wasn't on screen, now is"}${s.usage ? ` (${s.usage})` : ""}.`); } }
  return o;
}
const suggestion = (e, d) => { if (d.some(x => /not found|couldn't read|No repo info/.test(x))) return "Couldn't compare; re-run `canwe` and record the new answer with `ledger write`.";
  const movement = d.some(x => /commits touching|no longer|now is/.test(x)); if (!movement) return "No sign of change; the previous answer still looks valid (the agent should still verify the evidence)."; return `The previous verdict was "${e.verdict}"; there's related movement since then -> worth a second look (re-run \`canwe\`, then \`ledger write\`).`; };
const shortBlock = (e, score) => `**${dateWrite(e.date)} · ${e.verdict}**${e.size ? ` · size ${e.size}` : ""} · ${Basis[e.basis]?.split(" (")[0] || e.basis} · similarity ${score.toFixed(2)}\n- Question: "${e.question}"\n${e.reason ? `- Why then: ${e.reason}\n` : ""}- File: \`${path.relative(pm, path.join(dir, e.file))}\``;

if (action === "find") {
  if (!question) { console.error('Usage: node ledger.mjs <pm> find "<question>"'); process.exit(1); }
  const es = findMatching(question);
  let o = `# Ledger: "${question}"\n\nKeys: ${keys(question).join(", ")}\n\n`;
  if (!es.length) o += `No answer for this topic in the ledger yet (${ledger.length} records scanned). A new question: run \`canwe\`, then \`ledger write\` once you have a verdict.\n`;
  else { const [first, ...other] = es, d = changedOnes(first.e);
    o += `## Previous answer\n\n${shortBlock(first.e, first.score)}\n\n## Since then\n\n${d.map(x => `- ${x}`).join("\n")}\n\n**Suggestion:** ${suggestion(first.e, d)}\n`;
    if (other.length) o += `\n## Other similar answers\n\n${other.slice(0, 3).map(x => shortBlock(x.e, x.score)).join("\n\n")}\n`; }
  process.stdout.write(o);
} else if (action === "write") {
  const verdict = Verdict[low(verdictA || "")] || Object.values(Verdict).find(h => low(h) === low(verdictA || ""));
  if (!question || !verdict || !Basis[basisA]) { console.error(`Usage: node ledger.mjs <pm> write "<question>" --verdict "<${[...new Set(Object.values(Verdict))].join(" | ")}>" --basis <code|document|intent> [--size S|M|L] [--reason "..."] [--evidence <file>] [--note "..."]`); process.exit(1); }
  if (sizeA && !/^[SML]$/.test(sizeA)) { console.error("--size must be S (1-2 days), M (~1 week) or L (bigger)"); process.exit(1); }
  if (basisA === "intent" && verdict === "We can") console.error("Warning: a 'We can' verdict is intent-based; backing it with evidence (code or a document) is recommended.");
  const evidenceText = evidenceF ? fs.readFileSync(evidenceF, "utf8") : "", evidence = evidenceExtract(evidenceText), survey = keys(question);
  // Don't write if the evidence is another question's skeleton (pm/state/canwe-last.md gets overwritten on every canwe run).
  const evidenceQuestion = (evidenceText.match(/^# canwe: (.+)$/m) || [])[1];
  if (evidenceQuestion && low(evidenceQuestion.trim()) !== low(question)) { console.error(`The evidence file belongs to a different question ("${evidenceQuestion.trim()}"). Run \`canwe.mjs pm "${question}"\` first, then write.`); process.exit(1); }
  const previous = findMatching(question)[0]?.e || null, date = new Date().toISOString();
  const slug = smallAscii(question).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "question";
  fs.mkdirSync(dir, { recursive: true });
  let file = `${date.slice(0, 10)}-${slug}.md`; for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${date.slice(0, 10)}-${slug}-${i}.md`;
  const e = { date, question, keys: survey, verdict, basis: basisA, size: sizeA || null, reason: reason || null, ref: now, repoRef: K.repo ? ref : null, file, evidence, inventory: inventoryMatch(inventoryRead(), evidence, survey), previous: previous ? { file: previous.file, verdict: previous.verdict, date: previous.date } : null, note: note || null };
  const md = `# canwe: ${question}\n\n- **Date:** ${dateWrite(date)}\n- **Verdict:** ${verdict}\n- **Basis:** ${Basis[basisA]}\n${e.size ? `- **Size:** ${e.size}\n` : ""}${reason ? `- **Why now:** ${reason}\n` : ""}${now ? `- **Repo state:** ${ref} @ ${now}\n` : ""}${previous ? `- **Previous answer:** ${dateWrite(previous.date)} · ${previous.verdict}${previous.verdict === verdict ? " (unchanged)" : ` -> ${verdict} (changed)`} · \`${previous.file}\`\n` : ""}` +
    `${e.inventory.length ? `\n## Endpoints (inventory at the time)\n\n${e.inventory.map(u => `- \`${u.method} ${u.path}\`: ${u.used ? "onScreen" : "noScreen"}`).join("\n")}\n` : ""}` +
    `\n## Evidence\n\n${evidenceText.trim() || "—"}\n${note ? `\n## Note\n\n${note}\n` : ""}`;
  fs.writeFileSync(path.join(dir, file), md); ledger.push(e); fs.writeFileSync(idx, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`written: ${path.join(dir, file)}${previous ? ` · previous answer: ${previous.verdict}${previous.verdict === verdict ? "" : ` -> ${verdict}`}` : ""} · tracked: ${evidence.files.length} files, ${evidence.commits.length} commits, ${evidence.refs.length} refs, ${e.inventory.length} endpoints`);
} else if (action === "list") {
  if (!ledger.length) { console.log(`The ledger is empty (${idx}).`); process.exit(0); }
  const count = ledger.reduce((s, e) => (s[e.verdict] = (s[e.verdict] || 0) + 1, s), {});
  let o = `# Answer ledger · ${ledger.length} answers\n\n${Object.entries(count).map(([h, n]) => `${h} ${n}`).join(" · ")}\n\n| Date | Question | Verdict | Basis | Size | Since then | File |\n|---|---|---|---|---|---|---|\n`;
  for (const e of [...ledger].sort((a, b) => b.date.localeCompare(a.date))) {
    const progress = e.ref && now ? (e.ref === now ? "unchanged" : `${git("rev-list", "--count", `${e.ref}..${ref}`) || "?"} commits`) : "—";
    o += `| ${dateWrite(e.date)} | ${e.question.replace(/\|/g, "/").slice(0, 70)} | ${e.verdict} | ${e.basis} | ${e.size || "—"} | ${progress} | \`${e.file}\` |\n`;
  }
  process.stdout.write(o);
} else { console.error("action: find | write | list"); process.exit(1); }
