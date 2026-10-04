// rival-tiers: which rivals get a full research pass, which are only watched, which get a thin read, and what that costs.
// The first run on a real product researched 11 rivals with one sub-agent each: 1,079,151 tokens, about 98,000 per rival, and the answer for
// several was "nothing new". A rival's tier is the owner's call, kept in sources.json `rivals.<slug>.tier`:
//   A  deep      a sub-agent researches it (nosy-neighbor). The default for a rival with no tier.
//   B  watch     the page diff only (watch-rivals.mjs, no model). A change is reported, never researched on its own.
//   C  reference a concept, a law firm, a rival that isn't really a product: a thin read of 3-5 pages, quarterly.
// `plan` says, per tier, who needs work now (A: the watch says changed, or the file is older than 30 days or missing · B: nobody, changes are only
// reported · C: file older than 90 days or missing), what A and C would cost, and two rules that only ever suggest:
//   - more than 10 A-tier rivals: a line saying so, and that Nosy Cloud's scheduled watch is the better home for the surplus. Nothing is blocked.
//   - a B-tier rival the watch saw changed in 3 or more of the last 4 snapshots: "promote to tier A?". Never promoted silently.
// Inputs (read only): pm/rivals/*.md (a file's age is its modification time), sources.json `rivals` (+ `tour.tokensPerRival`), pm/state/watch.json.
// The watch keeps only its latest snapshot per page (pm/history/watch/<slug>.json), so "changed in 3 of the last 4" needs a log of its own:
// pm/history/watch-states.jsonl, one line per watch run { at, states: { slug: "changed|same|first|error" } }. `record` appends the current
// pm/state/watch.json to it (`nosy watch` does that after each run); a run is never added twice, so `record` is safe to repeat.
// `plan` only reads: it never writes (the `tiers` command may save its JSON where it is told, that is the caller's file, not this plan's).
// `--no-record` is still accepted and does nothing (older callers passed it).
// Cost: sources.json `tour.tokensPerRival` when the owner set it, else 98,000, a figure from one earlier run and said as such. A C-tier thin read is
// counted at a quarter of that (THIN_SHARE: it reads three to five pages, not the whole web).
// Usage: node rival-tiers.mjs plan <pm> [--json [file]] [--now YYYY-MM-DD]      (--json alone prints the JSON instead of the text)
//        node rival-tiers.mjs record <pm>
// Exit: 0 planned · 1 no rival files and no registry.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { readSourcesSafe } from "./sources-file.mjs";

const DAY = 864e5;
// The first run on a real product: 11 rivals, 1,079,151 tokens. One run, said as such; sources.json tour.tokensPerRival replaces it.
export const TOKENS_PER_RIVAL = 98000, THIN_SHARE = 0.25, A_MAX = 10, A_STALE_DAYS = 30, C_STALE_DAYS = 90, PROMOTE_AFTER = 3, PROMOTE_OF = 4;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const mdFiles = d => { try { return fs.readdirSync(d).filter(f => f.endsWith(".md") && !f.startsWith("_")).sort(); } catch { return []; } };
const fmt = n => Math.round(n).toLocaleString("en-US");
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

// watch-rivals.mjs says changed / same / baseline / unreachable / "no pages"; the tools that talk about it say same / changed / first / error.
export const watchState = s => /^changed$/i.test(s) ? "changed" : /^(first|baseline)$/i.test(s) ? "first" : /^(error|unreachable|no pages)$/i.test(s) ? "error" : /^same$/i.test(s) ? "same" : null;
export const tierOf = t => (/^[abc]$/i.test(String(t ?? "").trim()) ? String(t).trim().toUpperCase() : null);

export const logFile = pm => path.join(pm, "history", "watch-states.jsonl");
const readLog = pm => { try { return fs.readFileSync(logFile(pm), "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && x.at && x.states); } catch { return []; } };

// Appends pm/state/watch.json's states to the log once per watch run (idempotent: the run's own timestamp is the key). Returns true when it
// added a line. A log whose last line was cut off (no final newline, a crash mid-write) gets its newline first, so the new line isn't glued to it.
export function record(pm) {
  const W = readJson(path.join(pm, "state", "watch.json")); if (!W || !Array.isArray(W.rivals) || !W.generated) return false;
  if (readLog(pm).some(x => x.at === W.generated)) return false;
  const states = {}; for (const r of W.rivals) { const s = watchState(r.state); if (r && r.slug && s) states[r.slug] = s; }
  const f = logFile(pm); fs.mkdirSync(path.dirname(f), { recursive: true });
  let lead = ""; try { const t = fs.readFileSync(f, "utf8"); if (t && !t.endsWith("\n")) lead = "\n"; } catch {}
  fs.appendFileSync(f, lead + JSON.stringify({ at: W.generated, states }) + "\n");
  return true;
}

// A rival file the first watch (or a bare `neighbors` run) created has the template's shape and nothing in it: no coded matrix row, no source. Its
// modification time is minutes old, so by age alone it looked fresh and "needs no deep pass" (BlogFactory field test). What is in the file decides, not when
// it was touched: a coded row (y p n u d, or a blank one is not) and at least one source address, else it is a stub.
export function stubOf(md) {
  const coded = (md.match(/^\|\s*\d{1,2}\s*\|[^|\n]*\|\s*[ypnud]\b/gim) || []).length;
  const sources = /https?:\/\/[^\s)>\]]+/i.test(md.replace(/<[^>\n]*>/g, ""));
  return { stub: coded === 0 || !sources, coded, sources };
}

// The plan: everything the text prints, as data. `now` is a number (ms) so a test can pin it.
export function plan(pm, { now = Date.now() } = {}) {
  const K = readSourcesSafe(pm) || {}, registry = K.rivals && typeof K.rivals === "object" && !Array.isArray(K.rivals) ? K.rivals : {};
  const files = new Map(mdFiles(path.join(pm, "rivals")).map(f => [f.replace(/\.md$/, ""), path.join(pm, "rivals", f)]));
  const slugs = [...new Set([...Object.keys(registry), ...files.keys()])].sort();
  const W = readJson(path.join(pm, "state", "watch.json")), watch = new Map(((W && W.rivals) || []).map(r => [r.slug, watchState(r.state)]));
  const own = +(K.tour && K.tour.tokensPerRival) > 0;
  const per = own ? +K.tour.tokensPerRival : TOKENS_PER_RIVAL;
  const log = readLog(pm).slice(-PROMOTE_OF);
  const rivals = slugs.map(slug => {
    const R = registry[slug] && typeof registry[slug] === "object" ? registry[slug] : {}, file = files.get(slug);
    let md = "", age = null; // an unreadable file (a dangling link, no permission) counts as "no file", not a crash
    if (file) try { md = fs.readFileSync(file, "utf8"); age = Math.floor((now - fs.statSync(file).mtimeMs) / DAY); } catch { md = ""; }
    const tier = tierOf(R.tier);
    const state = watch.get(slug) ?? null, why = [];
    const t = tier || "A";
    let needsWork = false;
    const empty = file && md ? stubOf(md).stub : false;
    if (t === "A") {
      if (state === "changed") { needsWork = true; why.push("its pages changed since the last watch"); }
      if (age === null) { needsWork = true; why.push("no rival file yet"); } else if (age > A_STALE_DAYS) { needsWork = true; why.push(`file ${plural(age, "day")} old`); }
      if (empty) { needsWork = true; why.push("the file is a new stub: no coded matrix row or no source in it yet"); }
    } else if (t === "C") {
      if (age === null) { needsWork = true; why.push("no rival file yet"); } else if (age > C_STALE_DAYS) { needsWork = true; why.push(`file ${plural(age, "day")} old`); }
      if (empty) { needsWork = true; why.push("the file is a new stub: no coded matrix row or no source in it yet"); }
    }
    // One reason, named: a stub is not "fresh" however recently it was written.
    const status = !file ? "no file" : empty ? "new stub" : state === "changed" && t !== "B" ? "changed upstream" : needsWork ? "stale" : "complete and current";
    const changedIn = log.filter(x => x.states[slug] === "changed").length;
    return { slug, name: (typeof R.name === "string" && R.name) || (md.match(/^# (.+)$/m) || [])[1]?.trim() || slug, tier: t, tierSet: !!tier, ...(R.tier !== undefined && !tier ? { tierInvalid: String(R.tier) } : {}),
      watch: state, ageDays: age, status, needsWork, why, changedIn, snapshots: log.length };
  });
  const tiers = {};
  for (const t of ["A", "B", "C"]) {
    const rs = rivals.filter(r => r.tier === t), work = rs.filter(r => r.needsWork);
    const tokens = t === "A" ? work.length * per : t === "C" ? Math.round(work.length * per * THIN_SHARE) : 0;
    tiers[t] = { rivals: rs, needsWork: work.map(r => r.slug), tokens, ...(t === "B" ? { changed: rs.filter(r => r.watch === "changed").map(r => r.slug) } : {}) };
  }
  const suggestions = [], aCount = tiers.A.rivals.length;
  if (aCount > A_MAX) suggestions.push({ kind: "surplus", count: aCount, surplus: aCount - A_MAX,
    text: `${aCount} rivals are tier A (more than ${A_MAX}): a deep pass on each is ${fmt(aCount * per)} tokens. Nosy Cloud's scheduled watch is the better home for the surplus of ${aCount - A_MAX}: it keeps watching them without a model. A suggestion only; nothing is held back.` });
  for (const r of tiers.B.rivals) if (r.changedIn >= PROMOTE_AFTER) suggestions.push({ kind: "promote", slug: r.slug, name: r.name, changedIn: r.changedIn, snapshots: r.snapshots,
    text: `${r.name}: changed ${r.changedIn} times in ${r.snapshots} snapshots: promote to tier A? (sources.json rivals.${r.slug}.tier)` });
  const untiered = rivals.filter(r => !r.tierSet);
  return { type: "tiers", generated: new Date(now).toISOString(), perRival: { tokens: per, source: own ? "sources.json tour.tokensPerRival" : "one earlier run (the first run on a real product: 11 rivals, 1,079,151 tokens)" },
    watchGenerated: (W && W.generated) || null, snapshots: log.length, total: rivals.length, untiered: untiered.map(r => r.slug), tiers, tokens: tiers.A.tokens + tiers.C.tokens, suggestions };
}

const few = (xs, n = 8) => xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more (all in the JSON)` : xs.join(", ");
const ago = r => r.ageDays === null ? "no file" : `file ${plural(r.ageDays, "day")} old`;
export function render(P) {
  const c = t => P.tiers[t].rivals.length;
  const L = [`# Rival tiers · ${P.total} rivals: ${c("A")} deep (A), ${c("B")} watch only (B), ${c("C")} reference (C)`, "",
    `Cost: about ${fmt(P.perRival.tokens)} tokens per deep rival, from ${P.perRival.source}${/earlier run/.test(P.perRival.source) ? "; set sources.json `tour.tokensPerRival` to your own figure" : ""}.${P.watchGenerated ? ` Watch state from ${P.watchGenerated.slice(0, 10)}.` : " No watch snapshot yet (`nosy watch`): tier A is judged by file age alone."}`, ""];
  const A = P.tiers.A, B = P.tiers.B, C = P.tiers.C, by = (T, f) => T.rivals.filter(f);
  L.push(`## Tier A · deep research, one sub-agent per rival (${c("A")})`);
  if (A.rivals.length) {
    L.push(A.needsWork.length ? `Needs work now (${A.needsWork.length}): ${by(A, r => r.needsWork).map(r => `${r.name} (${r.why.join(", ")})`).join("; ")}.` : "Nobody needs a deep pass now.");
    const rest = by(A, r => !r.needsWork); if (rest.length) L.push(`Up to date: ${few(rest.map(r => `${r.name} (${ago(r)}${r.watch === "error" ? "; the watch couldn't read it" : ""})`))}.`);
    L.push(`Estimate: ${A.needsWork.length} × ${fmt(P.perRival.tokens)} = about ${fmt(A.tokens)} tokens.`);
  } else L.push("No rival is tier A.");
  L.push("", `## Tier B · watch only, page diff and no model (${c("B")})`);
  if (B.rivals.length) {
    L.push(B.changed.length ? `Changed since the last watch (reported, not researched): ${by(B, r => r.watch === "changed").map(r => r.name).join(", ")}.` : "Nothing changed since the last watch.");
    L.push(`Watched: ${B.rivals.map(r => r.name).join(", ")}. Cost: no model.`);
  } else L.push("No rival is tier B.");
  L.push("", `## Tier C · reference, a thin read of 3-5 pages, quarterly (${c("C")})`);
  if (C.rivals.length) {
    L.push(C.needsWork.length ? `Due (${C.needsWork.length}): ${by(C, r => r.needsWork).map(r => `${r.name} (${r.why.join(", ")})`).join("; ")}.` : "None is due.");
    if (C.needsWork.length) L.push(`Estimate: ${C.needsWork.length} × ${fmt(Math.round(P.perRival.tokens * THIN_SHARE))} = about ${fmt(C.tokens)} tokens (a thin read counted at a quarter of a deep pass).`);
  } else L.push("No rival is tier C.");
  L.push("", `**This round: about ${fmt(P.tokens)} tokens** (${plural(A.needsWork.length, "deep pass", "deep passes")}${C.needsWork.length ? ` + ${plural(C.needsWork.length, "thin read")}` : ""}).`);
  if (P.untiered.length) L.push("", `${plural(P.untiered.length, "rival")} ${P.untiered.length === 1 ? "has" : "have"} no tier yet and count${P.untiered.length === 1 ? "s" : ""} as A: ${few(P.untiered.map(s => P.tiers.A.rivals.find(r => r.slug === s).name))}. Confirm each with the owner and write it to sources.json \`rivals.<slug>.tier\`.`);
  const bad = Object.values(P.tiers).flatMap(T => T.rivals).filter(r => r.tierInvalid); if (bad.length) L.push("", `Not a tier (use A, B or C), counted as A: ${bad.map(r => `${r.name} ("${r.tierInvalid}")`).join(", ")}.`);
  if (P.suggestions.length) L.push("", "## Suggestions (never done on their own)", ...P.suggestions.map(s => `- ${s.text}`));
  return L.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; }, take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  // --json <file> writes the file (like the other tools) and still prints the text; --json alone prints the JSON.
  const ji = argv.indexOf("--json"); let jsonFile = null, jsonStdout = false;
  if (ji >= 0) { const next = argv[ji + 1]; if (ji >= 2 && next && !next.startsWith("--")) { jsonFile = next; argv.splice(ji, 2); } else { jsonStdout = true; argv.splice(ji, 1); } } // after `plan <pm>` a following word is the file
  flag("--no-record"); const nowArg = take("--now"); // --no-record: kept so older callers still work; `plan` never writes the log
  const [cmd, pm = "pm"] = argv, fail = m => { console.error(`Psst… ${m}`); process.exit(1); };
  if (cmd === "record") { console.log(record(pm) ? "Recorded this watch run." : "Nothing new to record (no pm/state/watch.json, or this run is already in the log)."); }
  else if (cmd === "plan") {
    if (!mdFiles(path.join(pm, "rivals")).length && !Object.keys((readSourcesSafe(pm) || {}).rivals || {}).length) fail(`No rivals yet: no ${path.join(pm, "rivals")}/*.md and no \`rivals\` in sources.json. Run /nosy:neighbors first.`);
    const P = plan(pm, nowArg ? { now: Date.parse(nowArg + "T12:00:00Z") } : {});
    if (jsonFile) { fs.mkdirSync(path.dirname(jsonFile), { recursive: true }); fs.writeFileSync(jsonFile, JSON.stringify(P, null, 1)); }
    console.log(jsonStdout ? JSON.stringify(P, null, 1) : render(P));
  } else fail("usage: rival-tiers plan <pm> [--json [file]] · rival-tiers record <pm>");
}
