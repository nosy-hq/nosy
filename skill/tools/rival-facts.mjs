// rival-facts: the lines of each rival file that a battlecard needs and the matrix doesn't carry. Today that is the
// price line ("- **Price:** …", which the rival template asks for). Published with the dashboard files as
// pm/state/rival-facts.json, keyed by the rival file's name without .md (the same key as `file` in matrix.json).
// Public facts about rivals only; the privacy scan still runs over the file like the rest. A rival without the line
// is left out, never sent empty.
import fs from "node:fs"; import path from "node:path";

const MAX_PRICE = 700;
const cut = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const i = s.lastIndexOf(" ", n - 1); return s.slice(0, i > n * 0.6 ? i : n - 1) + "…"; };

// The price bullet: the text after "Price:" on its line, plus any indented sub-bullets under it (some files list plans
// as a nested list). Markdown bold and bullet markers are dropped from the continuation lines.
export function priceOf(md) {
  const lines = md.split("\n");
  const i = lines.findIndex(l => /^- \*\*Price:\*\*/.test(l));
  if (i < 0) return "";
  const parts = [lines[i].replace(/^- \*\*Price:\*\*/, "")];
  for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]); j++) parts.push(lines[j].replace(/^\s*[-*]\s*/, "").replace(/\*\*/g, ""));
  return parts.map(x => x.trim()).filter(Boolean).join(" · ");
}

export function rivalFacts(pm) {
  const dir = path.join(pm, "rivals");
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".md") && !f.startsWith("_")).sort()) {
    const price = priceOf(fs.readFileSync(path.join(dir, f), "utf8"));
    if (price) out[f.replace(/\.md$/, "")] = { price: cut(price, MAX_PRICE) };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const facts = rivalFacts(process.argv[2] || "pm");
  console.log(JSON.stringify(facts, null, 1));
}
