// next-decision: the one "next product decision" every surface says: move-in's first report,
// the after-commit nudge, `nosy` / next.mjs, the session-start whisper. Before this each picked its own (the nudge took
// the top of "Now" even when it was held on purpose; the first report let the agent choose), so the owner could hear
// three different answers in one day.
// Usage: node next-decision.mjs <pm folder> [--json]
// Order, first hit wins:
//   1. the top of the roadmap's "Now" wave that psst checked (waves.json task with `checked`, from psst-final.json)
//   2. psst's checked list itself (psst-final.json), when the roadmap hasn't been rebuilt since (its checked tasks are skipped)
//   3. the top of "Now" that isn't marked "unchecked", labelled as not checked
//   4. the top cheap win from the raw list that the receipts didn't hold, labelled as not checked
// Never an item the receipts hold on purpose or the refuter dropped. Reads pm/state only; no git, no network.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const small = s => String(s || "").trim().toLowerCase();

// A "why" for one line: the first " · " part, file paths dropped, cut at a word boundary.
export function shortWhy(s, max = 90) {
  let t = String(s || "").split(" · ")[0].replace(/\s*\([^()]*\/[^()]*\)/g, "").replace(/\S+\/\S+:\d+/g, "").replace(/\s+/g, " ").trim();
  if (t.length > max) t = t.slice(0, t.lastIndexOf(" ", max) > max / 2 ? t.lastIndexOf(" ", max) : max).replace(/[\s,;:(—-]+$/, "") + "…";
  return t;
}

export function nextDecision(pm) {
  const st = f => readJson(path.join(pm, "state", f));
  const W = st("waves.json"), F = st("psst-final.json"), R = st("receipts.json");
  const held = new Set((R?.items || []).filter(r => r.gate?.held).map(r => small(r.title)));
  const dropped = new Set((F?.dropped || []).map(d => small(d.title)));
  const blocked = t => held.has(small(t)) || dropped.has(small(t));
  // A checked list older than the psst list it checked is stale: its verdicts may not hold any more.
  // The owner-filtered list only when it's at least as new as the raw one (a stale filter would bring back old items).
  const raw = st("lowhanging.json"), filtered = st("lowhanging.filtered.json");
  const L0 = filtered && Date.parse(filtered.generated || 0) >= Date.parse(raw?.generated || 0) ? filtered : raw;
  const fresh = !!F && Date.parse(F.generated || 0) >= Date.parse(L0?.generated || 0);
  // A roadmap built before the checked list it would carry is stale too (Nosy's own page kept
  // naming a closed request as the next decision because waves.json predated a fresh psst-final.json).
  const wavesStale = !!F && !!W?.generated && Date.parse(W.generated) < Date.parse(F.generated || 0);
  const now = (W?.waves?.find(w => w.name === "Now")?.tasks || []).filter(t => !blocked(t.title) && (fresh || !t.checked) && !(wavesStale && t.checked));
  const reason = t => shortWhy(String(t.reason_now || "").replace(/^(checked by psst[^·]*·\s*|unchecked \(no receipt yet\)\s*·\s*)/, ""));
  const c = now.find(t => t.checked);
  if (c) return { title: c.title, why: c.checked === "weakened" ? shortWhy(String(c.reason_now).match(/corrected: ([^)]*)/)?.[1] || "") : reason(c), checked: true, size: c.effort || null, source: "pm/state/waves.json (Now, checked by psst)" };
  const f = fresh ? F?.items?.[0] : null;
  if (f) return { title: f.title, why: f.verdict === "weakened" ? shortWhy(f.fix) : shortWhy((f.evidence || []).join(", ")), checked: true, size: f.size || null, source: "pm/state/psst-final.json" };
  const u = now.find(t => !/^unchecked/.test(String(t.reason_now || "")));
  if (u) return { title: u.title, why: reason(u), checked: false, size: u.effort || null, source: "pm/state/waves.json (Now, not checked yet)" };
  const L = L0?.items?.find(i => !blocked(i.title));
  if (L) return { title: L.title, why: shortWhy([L.type, L.effort ? `size ${L.effort}` : "size not estimated"].filter(Boolean).join(", ")), checked: false, size: L.effort || null, source: "pm/state/lowhanging.json (not checked yet)" };
  return null;
}

export function render(D) {
  if (!D) return "No next product decision yet: run psst, then scoop.";
  return `Next product decision: ${D.title}${D.size ? ` (${D.size})` : ""}${D.why ? ` — ${D.why}` : ""}${D.checked ? "" : " · not checked yet: run psst before you commit to it"}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), D = nextDecision(argv.find(a => !a.startsWith("--")) || "pm");
  console.log(argv.includes("--json") ? JSON.stringify(D, null, 1) : render(D));
}
