// psst-refute: a refuter inside psst, the evaluator half of evaluator-optimizer. In blind tests
// psst lost to plain Claude on items a grader could break (a decision ignored, a size overstated); the grader's move —
// try to refute each item against the code — now runs before the owner sees the list. Counting here, judgment in the
// refuter sub-agent (agents/nosy-refuter.md), which gets only the draft and its receipts, in a fresh context.
// Usage:
//   node psst-refute.mjs pack  <pm> [--draft pm/state/psst-draft.json]    → pm/state/refute-packet.md (for the refuter)
//   node psst-refute.mjs apply <pm> [--verdicts pm/state/refute.json]     → final list, pm/state/psst-final.json,
//                                                                           one line in pm/state/refute-log.jsonl
// Draft:    { items: [{ id, title, claim, size, evidence: ["file:line", …], receipt: <rank in receipts.json> | null }] }
// Verdicts: { items: [{ id, verdict: "stands" | "weakened" | "refuted", checked: ["what was checked, file:line", …],
//                       why: "…", fix: "corrected claim or size (weakened only)" }] }
// A verdict with nothing in `checked` is a rubber stamp and is rejected; "found nothing wrong" is fine when it says what
// was looked at (we don't force objections: a quota of them only pads the list).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const VERDICTS = new Set(["stands", "weakened", "refuted"]);

export function pack(pm, draftFile = path.join(pm, "state", "psst-draft.json")) {
  const D = readJson(draftFile), R = readJson(path.join(pm, "state", "receipts.json"));
  if (!D?.items?.length) throw new Error(`no draft items in ${draftFile}`);
  const byRank = new Map((R?.items || []).map(r => [r.rank, r]));
  let o = `# Refute this list\n\nYou are checking a product manager's draft answer to "which cheap, valuable work can we ship this week?". For each item, try to break it against the code at ${R?.ref || "the product's ref"}: is every claim true, is it already done, deliberately held (a decision, a code comment with a ref), overruled by a later decision, or bigger than its size says (other apps, missing fields, a migration)? "Nothing wrong" is a valid finding, but list what you checked, with file:line.\n`;
  for (const it of D.items) {
    const r = it.receipt != null ? byRank.get(it.receipt) : null;
    o += `\n---\n\n## Item ${it.id}: ${it.title}\n\n(Use \`"id": ${JSON.stringify(it.id)}\` for this item.)\n\n**Claim:** ${it.claim}\n\n**Size claimed:** ${it.size || "(none)"}\n\n**Cited:** ${(it.evidence || []).join(", ") || "(nothing)"}\n`;
    if (r) {
      if (r.gate) o += `\n**⛔ Receipt says held on purpose:** ${r.gate.because.map(b => `${b.at} (${[...b.refs, ...b.decisions].join(", ")})`).join("; ")}\n`;
      for (const c of r.code || []) if (c.text?.length) o += `\n**Code at ${c.at}:**\n${c.text.map(l => `> ${l}`).join("\n")}\n`;
      if (r.needs?.length) o += `\n**The screen's own need:** ${r.needs.join(" · ")}\n`;
      for (const s of r.request || []) o += `\n**Request §${s.no}** (${s.file}:${s.line}):\n${s.text.split("\n").slice(0, 12).map(l => `> ${l}`).join("\n")}\n`;
      if (r.decisions?.length) o += `\n**Decisions:** ${r.decisions.map(d => `${d.no} (${d.date}) ${d.at}`).join("; ")}\n`;
      for (const h of r.history || []) o += `\n${h.merged ? "✓" : "✗"} ${h.kind} \`${h.name}\` (${h.date}) ${h.merged ? "merged" : "not merged"}${h.olderThan?.length ? `, older than ${h.olderThan.join(", ")}` : ""}\n`;
      for (const x of r.reach || []) o += `\n\`${x.id}\` in ${x.in.map(a => a.app).join(", ")}${x.notIn.length ? `; not in ${x.notIn.slice(0, 6).join(", ")}` : ""}\n`;
    } else o += `\n_No receipt for this item: check every claim from scratch._\n`;
  }
  o += `\n---\n\nAnswer as JSON only: {"items": [{"id": <n>, "verdict": "stands" | "weakened" | "refuted", "checked": ["<what you checked, file:line>", …], "why": "<one or two sentences>", "fix": "<for weakened: the corrected claim or size>"}]}\n`;
  const out = path.join(pm, "state", "refute-packet.md");
  fs.writeFileSync(out, o);
  return { out, items: D.items.length };
}

export function apply(pm, verdictFile = path.join(pm, "state", "refute.json"), { draftFile = path.join(pm, "state", "psst-draft.json"), now = Date.now() } = {}) {
  const D = readJson(draftFile), V = readJson(verdictFile);
  if (!D?.items?.length) throw new Error(`no draft items in ${draftFile}`);
  if (!V?.items) throw new Error(`no verdicts in ${verdictFile}`);
  // Match by id; a refuter that numbered the items 1..n instead of copying the draft's ids gets them by position
  // (v7 on Twenty: the draft said "dead-unique-indexes-flag", the refuter said 3).
  const ids = new Set(D.items.map(it => String(it.id))), byId = new Map(), problems = [];
  for (const v of V.items) {
    const k = String(v.id), n = Number(k);
    byId.set(ids.has(k) ? k : Number.isInteger(n) && n >= 1 && n <= D.items.length ? String(D.items[n - 1].id) : k, v);
  }
  for (const it of D.items) {
    const v = byId.get(String(it.id));
    if (!v) problems.push(`item ${it.id}: no verdict`);
    else if (!VERDICTS.has(v.verdict)) problems.push(`item ${it.id}: verdict "${v.verdict}" isn't stands/weakened/refuted`);
    else if (!Array.isArray(v.checked) || !v.checked.length) problems.push(`item ${it.id}: nothing listed under "checked" (a verdict has to say what it looked at)`);
    else if (v.verdict === "weakened" && !v.fix) problems.push(`item ${it.id}: weakened without a fix`);
  }
  if (problems.length) return { ok: false, problems };
  const final = [], dropped = [];
  for (const it of D.items) {
    const v = byId.get(String(it.id));
    if (v.verdict === "refuted") dropped.push({ ...it, why: v.why, checked: v.checked });
    // A fix that opens with a size ("L, not M: …", "M: …") corrects the item's size too (the next
    // decision said M under a fix that said L).
    else { const sz = v.verdict === "weakened" ? (String(v.fix).match(/^\s*(S|M|L)\b/) || [])[1] : null;
      final.push({ ...it, ...(sz ? { size: sz, size_before: it.size } : {}), verdict: v.verdict, ...(v.verdict === "weakened" ? { fix: v.fix, why: v.why } : {}), checked: v.checked }); }
  }
  const stats = { drafted: D.items.length, stands: final.filter(x => x.verdict === "stands").length, weakened: final.filter(x => x.verdict === "weakened").length, refuted: dropped.length };
  stats.precision = +(stats.stands / stats.drafted).toFixed(2); // share of drafted items that survived untouched
  // say which items rest on Nosy's list and which on reading the code (on Twenty the list gave nothing).
  stats.fromList = final.filter(x => x.receipt != null).length; stats.fromReading = final.length - stats.fromList;
  const R = { type: "psstFinal", generated: new Date(now).toISOString(), stats, items: final, dropped };
  fs.writeFileSync(path.join(pm, "state", "psst-final.json"), JSON.stringify(R, null, 1));
  fs.appendFileSync(path.join(pm, "state", "refute-log.jsonl"), JSON.stringify({ at: R.generated, ...stats, dropped: dropped.map(d => d.title) }) + "\n");
  return { ok: true, ...R };
}

export function formatMd(R) {
  if (!R.ok) return `Verdicts not usable, fix and re-run apply:\n${R.problems.map(p => `- ${p}`).join("\n")}\n`;
  let o = `# psst after the refuter · ${R.stats.stands} stand, ${R.stats.weakened} corrected, ${R.stats.refuted} dropped (precision ${R.stats.precision})\n\n`;
  if (R.items.length && !R.stats.fromList) o += `Nothing on the list survived checking: all ${R.items.length} item(s) below come from reading the code, not from Nosy's signals.\n\n`;
  else if (R.stats.fromReading) o += `${R.stats.fromReading} of ${R.items.length} item(s) come from reading the code, not from Nosy's signals.\n\n`;
  for (const it of R.items) o += `- **${it.title}** (${it.verdict === "weakened" ? `corrected: ${it.fix}` : it.size || "no size"})\n`;
  if (R.dropped.length) o += `\nDropped after checking:\n${R.dropped.map(d => `- ${d.title}: ${d.why}`).join("\n")}\n`;
  return o;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, pm = "pm", ...rest] = process.argv.slice(2), take = k => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  try {
    if (cmd === "pack") { const r = pack(pm, take("--draft") || undefined); console.log(`Refute packet: ${r.out} (${r.items} items). Give it to the nosy-refuter sub-agent; save its JSON to ${path.join(pm, "state", "refute.json")}.`); }
    else if (cmd === "apply") { const R = apply(pm, take("--verdicts") || undefined, { draftFile: take("--draft") || undefined }); process.stdout.write(formatMd(R)); if (!R.ok) process.exit(2); }
    else { console.error("usage: psst-refute.mjs pack|apply <pm> [--draft f] [--verdicts f]"); process.exit(1); }
  } catch (e) { console.error(String(e.message)); process.exit(1); }
}
