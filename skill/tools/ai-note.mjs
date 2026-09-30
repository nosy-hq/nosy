// Grades an AI-readiness trial output automatically instead of by hand: given an
// agent's output (markdown/code it produced when asked to build a screen) and the product's design-system
// record (read-design.mjs's component/token names), lists every component/token-looking name the output
// uses and marks it: on record ✓, not on record ✗ (invented), close to a record name (edit distance ≤2 or
// same stem) "did you mean X?". Deterministic - no model call, no judgment about whether the PROSE is right,
// only whether the NAMES it used exist. dresscode.md's AI-readiness step runs this on every trial answer.
// Usage: node ai-note.mjs <pm folder> <output-file> [--folder <design-folder>] [--json <file>]
// Exit 1 if any name is invented (✗); 0 otherwise (✓ and "did you mean" both pass - a near-miss is a nudge,
// not a failure, since the trial instructs the agent to flag missing context rather than invent).
import fs from "node:fs"; import path from "node:path"; import { read } from "./read-design.mjs";

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const jsonOut = opt("--json"), folder = opt("--folder");
const [pm = "pm", outputFile] = argv;
if (!outputFile) { console.error("Usage: node ai-note.mjs <pm folder> <output-file> [--folder <design-folder>] [--json <file>]"); process.exit(1); }
let text;
try { text = fs.readFileSync(outputFile, "utf8"); } catch (e) { console.error(`could not read ${outputFile}: ${e.message}`); process.exit(1); }

// --- 1. the record: every name a trial answer is allowed to use, from read-design.mjs's model -------------
const model = read(pm, { folder });
if (model.notFound) { console.error(`no design system found for ${pm} (${model.reason || "no role file"})`); process.exit(1); }
const record = [
  ...(model.components?.list || []).map(c => ({ name: c.name, kind: "component", source: c.source })),
  ...(model.tokens?.pixel || []).map(t => ({ name: t.name, kind: "token", source: null })),
  ...Object.keys(model.tokens?.groups || {}).map(g => ({ name: g, kind: "token", source: null })),
];

// --- 2. candidate names: what the output actually names as a component/token ------------------------------
// Two deliberate signals, both something an agent choosing to CITE a name would naturally produce:
//   - backtick code spans (`table`, `color.primary`) - how the trial's own instructions ask it to name things
//   - JSX-style opening tags (<Table) - how a code answer would use a component
// A file path, a file:line citation, or a bare extension isn't a component/token name; both are filtered out
// so citing evidence ("registry.ts:12") never itself counts as a candidate.
const EXT = /\.(md|json|ts|tsx|js|jsx|mjs|cjs|css|ya?ml|html?)$/i;
const looksLikePathOrRef = s => /[\/\\]/.test(s) || /:\d/.test(s) || EXT.test(s) || /\s/.test(s);
function candidatesOf(t) {
  const found = new Map(); // name -> first raw form seen
  for (const m of t.matchAll(/`([^`\n]+)`/g)) { const s = m[1].trim(); if (s && !looksLikePathOrRef(s) && /^[A-Za-z][\w.-]*$/.test(s)) found.set(s, found.get(s) || s); }
  for (const m of t.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) found.set(m[1], found.get(m[1]) || m[1]);
  return [...found.keys()];
}
const candidates = candidatesOf(text);

// --- 3. matching: exact (normalized) -> ✓, edit distance <=2 or same stem -> "did you mean", else -> ✗ -----
const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const stem = s => normalize(s).replace(/s$/, ""); // a rough singular/plural squash, good enough for names
function levenshtein(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i]; for (let j = 1; j <= n; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[n];
}
const recordNorm = record.map(r => ({ ...r, norm: normalize(r.name), stem: stem(r.name) }));

function classify(name) {
  const n = normalize(name), s = stem(name);
  const exact = recordNorm.find(r => r.norm === n);
  if (exact) return { status: "on-record", match: exact.name, kind: exact.kind };
  let best = null;
  for (const r of recordNorm) {
    const d = levenshtein(n, r.norm);
    const close = d <= 2 || r.stem === s;
    if (close && (!best || d < best.d)) best = { d, name: r.name, kind: r.kind };
  }
  if (best) return { status: "close", match: best.name, kind: best.kind, distance: best.d };
  return { status: "invented" };
}

const graded = candidates.map(name => ({ name, ...classify(name) }));
const on_record = graded.filter(g => g.status === "on-record");
const close = graded.filter(g => g.status === "close");
const invented = graded.filter(g => g.status === "invented");

// --- 4. report -----------------------------------------------------------------------------------------
const symbol = g => g.status === "on-record" ? "✓" : g.status === "invented" ? "✗" : `did you mean \`${g.match}\`?`;
let o = `# ai-note · ${path.basename(outputFile)}\n\n`;
o += `Design system: ${model.source.type === "git" ? `${model.source.repo}@${model.source.ref}` : model.source.folder} · root "${model.source.root}" · ${record.length} names on record (${(model.components?.list || []).length} components, ${record.length - (model.components?.list || []).length} tokens)\n\n`;
if (!graded.length) o += "No component/token-looking name (backtick or JSX tag) found in the output.\n\n";
else {
  o += `| Name | Status | Kind |\n|---|---|---|\n`;
  for (const g of graded) o += `| \`${g.name}\` | ${symbol(g)} | ${g.kind || "?"} |\n`;
  o += "\n";
}
o += `**${on_record.length} on record · ${close.length} close${close.length ? " (possible typo/rename)" : ""} · ${invented.length} invented.**\n`;
if (invented.length) o += `\nInvented (not on record, no close match): ${invented.map(g => `\`${g.name}\``).join(", ")}.\n`;
process.stdout.write(o);
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify({ type: "ai-note", generated: new Date().toISOString(), output_file: outputFile, source: model.source, record_count: record.length, graded, summary: { on_record: on_record.length, close: close.length, invented: invented.length } }, null, 1)); }
process.exit(invented.length ? 2 : 0); // exit contract: 2 = an invented name, 1 = couldn't run
