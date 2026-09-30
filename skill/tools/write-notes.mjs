// Reads main commits in a git range, groups them into work units by K/§/#/PR reference; classifies into
// Fresh/Improved/WasFixed/InBackground, filters and masks by audience (customer/team/manager).
// Usage: node write-notes.mjs <pm folder> [<start-ref|YYYY-MM-DD>] [end-ref=K.ref] [--audience customer|team|manager] [--json <file>] [--pr]
// Prior art: pm-changelog-curator (product-on-purpose-pm-skills.md — don't count a release note as a separate work item from the decision record), stakeholder-update's
// template switch by audience (anthropic-knowledge-work-plugins-pm.md), "one number, one headline" manager summary (caddie-ai.md: "Give Your Team 30 Extra Days").
// Deterministic; no LLM/network calls (gh only with --pr, read-only). Falls back to simple TR/EN keyword classification when there's no conventional commit type (common in this repo).
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { patternsOfLoad, refRegex } from "./refs.mjs";
import { advice } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

// Turkish-language support (see skill/data/lang/tr/write-notes.json): a repo with no conventional commit type
// falls back to keyword classification, and its commits may be in Turkish. Kept as data, loaded at runtime.
const TrWords = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/write-notes.json", import.meta.url), "utf8"));

const argv = process.argv.slice(2);
const ji = argv.indexOf("--json"), jsonOut = ji >= 0 ? argv.splice(ji, 2)[1] : null;
const pri = argv.indexOf("--pr"), prFlag = pri >= 0 ? (argv.splice(pri, 1), true) : false;
const ai = argv.indexOf("--audience"), audience = ai >= 0 ? argv.splice(ai, 2)[1] : "team";
const [pm = "pm", argFrom, argTo] = argv;
const K = readSources(pm);

const git = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const withTime = d => /\d:\d/.test(d) ? d : `${d} 00:00`;
const dayBefore = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const to = argTo || K.ref || "HEAD";
const show = f => { try { return git("show", `${to}:${f}`); } catch { return ""; } };

let from = argFrom;
if (!from) {
  const statusDir = path.join(pm, "state");
  let candidates = [];
  try { candidates = fs.readdirSync(statusDir).map(f => f.match(/^(\d{4}-\d{2}-\d{2})-delivery\.md$/)).filter(Boolean).map(m => m[1]).sort(); } catch {}
  if (candidates.length) from = candidates.at(-1);
  else { try { const d = JSON.parse(fs.readFileSync(path.join(statusDir, "status.json"), "utf8")); if (d.lastMain) from = d.lastMain; } catch {} }
  if (!from) from = dayBefore(7);
}
const range = /^\d{4}-\d{2}-\d{2}/.test(from) ? ["--since", withTime(from), to] : [`${from}..${to}`, "-n", "300"];
const rangeLabel = `${from}..${to}`;

// --- commit log (separators: %x1f field, %x1e record — body can be multi-line) ---
const FS_ = "\x1f", RS_ = "\x1e";
let logRaw = "";
try { logRaw = git("log", ...range, "--no-merges", `--format=%H${FS_}%h${FS_}%ad${FS_}%an${FS_}%s${FS_}%b${RS_}`, "--date=format:%d.%m %H:%M"); }
catch (e) { console.error(`could not read git log: ${String(e.message).split("\n")[0]}\n${advice(`${e.stderr || ""}\n${e.message}`) || "Check `repo` and `ref` in pm/sources.json (`nosy check` tests them)."}`); process.exit(1); }
const recs = logRaw.split(RS_).map(s => s.trim()).filter(Boolean).map(rec => {
  const [H, h, name, an, s, ...bRest] = rec.split(FS_); return { H, h, name, an, s, b: (bRest.join(FS_) || "").trim() };
});

// --- reference pattern: shared helper refs.mjs (sources.json `refs`, otherwise DEFAULT) ---
const refRe = refRegex(patternsOfLoad(K));
const norm = r => r.replace(/\s+/g, " ").trim().replace(/^SAHIBE/, "ToOwner");
const order = r => (r[0] === "K" ? 0 : r[0] === "§" ? 1 : r[0] === "#" ? 3 : 2) * 1e4 + parseInt(r.replace(/\D/g, ""), 10);
const kind = s => s.match(/^(\w+)(?:\(([^)]*)\))?!?:/) || [];

// --- request document (§item heading + status) ---
const requestSecs = (() => {
  if (!K.request) return [];
  const doc = show(K.request.path), hRe = new RegExp(K.request.title, "gm");
  const pos = []; let m;
  while ((m = hRe.exec(doc))) pos.push({ no: m[1], name: m[2], at: m.index });
  pos.forEach((s, i) => { s.body = doc.slice(s.at, pos[i + 1]?.at ?? doc.length); const sm = s.body.match(new RegExp(K.request.state)); s.state = sm ? sm[1] : "?"; });
  return pos;
})();

// --- DECISIONS headings: also catches multi-reference headings like "## K180 + K181 — ..." ---
const decisionTitle = (() => {
  const out = {}; if (!K.preread?.decisions) return out;
  const doc = show(K.preread.decisions), re = /^##\s+(.+)$/gm; let m;
  while ((m = re.exec(doc))) {
    const line = m[1], ks = line.match(/K\d{2,3}/g) || []; if (!ks.length) continue;
    const title = line.replace(/^K\d{2,3}(?:\s*\+\s*K\d{2,3})*\s*/, "").replace(/^[—\-:]\s*/, "").replace(/[*`]/g, "")
      .replace(/\(\d{1,2}\s+\p{L}{3,}[^)]*\)\s*$/u, "").trim().slice(0, 140);
    for (const k of ks) if (!(k in out)) out[k] = title || line.trim().slice(0, 140);
  }
  return out;
})();

// --- merged PRs (--pr): ref → PR mapping, single gh call ---
const prByRef = new Map(), prByNum = new Map(); let prMsg = null;
if (prFlag) {
  if (!K.issue?.repo) prMsg = "PR mapping skipped: sources.json.issue.repo not defined.";
  else try {
    const sd = /^\d{4}-\d{2}-\d{2}/.test(from) ? from : git("show", "-s", "--format=%cI", from).slice(0, 10);
    const js = JSON.parse(execFileSync("gh", ["pr", "list", "-R", K.issue.repo, "--state", "merged", "--search", `merged:>=${sd}`, "--json", "number,title,body,mergedAt,author"], { encoding: "utf8", maxBuffer: 64 << 20 }));
    for (const p of js) {
      const rec = { n: p.number, t: p.title, a: p.author?.login, m: p.mergedAt };
      prByNum.set(String(p.number), rec);
      for (const r of new Set(((p.title + " " + (p.body || "")).match(refRe) || []).map(norm))) prByRef.set(r, rec);
    }
  } catch (e) { prMsg = `PR mapping skipped: gh failed (${String(e.message).slice(0, 90)})`; }
}
const prOf = ref => {
  if (!ref) return null;
  const mm = ref.match(/^#(\d+)$/); if (mm) return prByNum.get(mm[1]) || null;
  if (prByRef.has(ref)) return prByRef.get(ref);
  const kb = ref.match(/^K\d{2,3}/); return (kb && prByRef.get(kb[0])) || null;
};

// --- drop non-shippable types, group by reference (§ref docs-exception: counted as shipped if status is exists/done) ---
const deps = [], skipped = [], groups = new Map(), singles = [];
for (const c of recs) {
  if (/^chore\(deps\)/.test(c.s)) { deps.push(c); continue; }
  const t = kind(c.s)[1];
  const refs = [...new Set(((c.s + " " + c.b).match(refRe) || []).map(norm))];
  if (t === "docs") {
    const valid = refs.some(r => /^§/.test(r) && requestSecs.some(s => `§${s.no}` === r && /^(exists|done)$/i.test(s.state)));
    if (!valid) { skipped.push(c); continue; }
  } else if (/^(test|style|ci|refactor)$/.test(t)) { skipped.push(c); continue; }
  if (!refs.length) { singles.push(c); continue; }
  for (const r of refs) { if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
}

// --- "did it already exist" (Fresh vs Improved): did the ref also appear before the range started ---
const ebCache = new Map();
const existedBefore = ref => {
  if (!ref) return false; if (ebCache.has(ref)) return ebCache.get(ref);
  let v = false;
  try {
    const out = /^\d{4}-\d{2}-\d{2}/.test(from) ? git("log", "--no-merges", `--before=${withTime(from)}`, "--format=%s", to) : git("log", "--no-merges", from, "--format=%s");
    v = out.split("\n").some(l => l.includes(ref));
  } catch {}
  ebCache.set(ref, v); return v;
};
const classFind = (ref, cs) => {
  const types = cs.map(c => kind(c.s)[1]).filter(Boolean);
  if (types.includes("fix")) return "WasFixed";
  if (types.includes("perf")) return "Improved";
  if (types.includes("feat")) return existedBefore(ref) ? "Improved" : "Fresh";
  const text = cs.map(c => c.s).join(" "); // no conventional type (common in this repo): simple keyword match
  // Plain \b doesn't work: in JS, \w doesn't count Turkish letters, so the start of an unrelated Turkish word
  // could be wrongly treated as a loanword's boundary (caught by Nosy's own test on its repo) — use a
  // \p{L}-based boundary instead; short loanwords "fix"/"bug" are also closed on the right (so they don't
  // match inside words like "fixture"), while the Turkish stems (TrWords) are left open on purpose (so they
  // also catch their own inflected forms).
  if (new RegExp(`(?<![\\p{L}\\p{N}])(fix(?![\\p{L}\\p{N}])|bug(?![\\p{L}\\p{N}])|${TrWords.fixedClosed.join("|")})`, "iu").test(text)) return "WasFixed";
  if (new RegExp(`(?<![\\p{L}\\p{N}])(perf|optimi[sz]e|${TrWords.improvedOpen.join("|")})`, "iu").test(text)) return "Improved";
  return "Fresh";
};
const backOverride = ref => {
  if (!ref || !/^§\d+[a-z]?$/.test(ref) || !K.request?.screen_missing) return false;
  const s = requestSecs.find(s => s.no === ref.slice(1));
  return !!s && /^(exists|done)$/i.test(s.state) && new RegExp(K.request.screen_missing, "i").test(s.body);
};

// --- human-readable name: request item > DECISIONS heading > PR title > oldest commit's summary ---
const titleSourceOf = (ref, cs) => {
  if (ref) {
    if (/^§\d+[a-z]?$/.test(ref)) { const s = requestSecs.find(s => s.no === ref.slice(1)); if (s?.name) return { t: s.name, k: "request" }; }
    const kb = ref.match(/^K\d{2,3}/);
    // m.N sub-item info isn't embedded in the title (it would leak into the customer mask) — it's already printed
    // separately in the `ref` field for the team view.
    if (kb && decisionTitle[kb[0]]) return { t: decisionTitle[kb[0]], k: "decisions" };
    const pr = prOf(ref); if (pr) return { t: pr.t, k: "pr" };
  }
  return { t: cs[cs.length - 1].s, k: "commit" }; // oldest commit (cs[0] is newest, same direction as collect-status)
};

const items = [];
for (const [ref, cs] of [...groups].sort((a, b) => order(a[0]) - order(b[0]))) {
  const bk = titleSourceOf(ref, cs), kindValue = backOverride(ref) ? "InBackground" : classFind(ref, cs), pr = prOf(ref);
  items.push({ class: kindValue, title: bk.t, ref, prs: pr ? [pr] : [], commits: cs.map(c => c.h), who: [...new Set(cs.map(c => c.an))], toCustomer: kindValue !== "InBackground", text_required: bk.k === "commit" });
}
for (const c of singles) items.push({ class: classFind(null, [c]), title: c.s, ref: null, prs: [], commits: [c.h], who: [c.an], toCustomer: true, text_required: true });

// --- new "dropped:" lines (K.dropped): lines ADDED within the range, via diff rather than find-lowhanging.mjs's HEAD scan ---
if (K.dropped) {
  let diffOut = ""; try { diffOut = git("log", ...range, "--no-merges", "-p", "--", K.dropped.path); } catch {}
  const opportunityRe = new RegExp(K.dropped.opportunity, "i"), knowinglyRe = K.dropped.knowingly ? new RegExp(K.dropped.knowingly, "i") : null, patternRe = new RegExp(K.dropped.pattern);
  const group = new Map(); let curFile = null;
  for (const line of diffOut.split("\n")) {
    const fm = line.match(/^\+\+\+ b\/(.+)$/); if (fm) { curFile = fm[1]; continue; }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const text = line.slice(1);
    if (!patternRe.test(text) || !opportunityRe.test(text) || knowinglyRe?.test(text)) continue;
    const refm = (text.match(refRe) || [])[0], ref = refm ? norm(refm) : null, key = ref || curFile || "?";
    if (!group.has(key)) group.set(key, { ref, file: curFile, lines: [] });
    group.get(key).lines.push(text.replace(/^\s*\/\/\s*dropped:\s*/, "").trim().slice(0, 160));
  }
  for (const [, g] of group) items.push({ class: "InBackground", title: `${g.file ? path.basename(g.file) : "?"} · ${g.lines.length} new field${g.lines.length === 1 ? "" : "s"}`, ref: g.ref, prs: [], commits: [], who: [], toCustomer: false, text_required: false, detail: g.lines.slice(0, 3) });
}

// --- customer mask: strips internal references, commit hashes, local paths, emails, author names (simple; full scan lives in the separate collect-signals.mjs branch) ---
const authorsAll = new Set(recs.map(c => c.an).filter(Boolean));
// date/person prefix from decision lines: forms like "(10 Sep, Alex): ", "(Sep 10, Alex): "
// and "**28 Sep 2026 (Alex):**" — this can stay for the team audience since the ref is already printed separately
// there, but it counts as internal info for the customer audience.
const DATE_PERSON_PREFIX_RE = /^\**\(?(?:\d{1,2}\s+\p{L}+|\p{L}+\s+\d{1,2})(?:\s+\d{4})?(?:,\s*[\p{L}][\p{L}\s]*)?\)?(?:\s*\([\p{L}][\p{L}\s]*\))?\s*:\**\s*/u;
const maskCustomer = s => {
  let t = String(s).replace(DATE_PERSON_PREFIX_RE, "");
  t = t.replace(/\(\s*(?:K\d{2,3}(?:\s*m\.\s*\d+(?:[-–,]\s*(?:m\.)?\d+)*)?|§\d+[a-z]?|#\d+)\s*\)/g, "");
  t = t.replace(/\/Users\/\S+/g, "(local path)").replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "(email)");
  t = t.replace(/\b[0-9a-f]{7,40}\b/gi, m => /[a-f]/i.test(m) ? "" : m); // strip hash-like hex, keep plain numbers (e.g. years)
  t = t.replace(refRe, "");
  for (const a of authorsAll) if (a) t = t.split(a).join("(person)");
  return t.replace(/\s{2,}/g, " ").replace(/\s+([.,:;])/g, "$1").trim();
};
const customerLine = i => i.text_required ? `(text required: ${i.ref || "no ref"})` : `${maskCustomer(i.title)}.`;
// Sub-items (m.N) under the same K item can land in the same sentence since they share a DECISIONS heading; there's
// no value in re-reading that in a customer note (the team/manager view still prints each ref separately) — dedupe by
// sentence text. numbers.to_customer_visible always uses this deduped count (regardless of audience), so it answers
// "how many things does the customer actually see".
const customerItems = (() => {
  const seen = new Set(), out = [];
  for (const i of items.filter(i => i.toCustomer)) {
    const key = `${i.class}|${customerLine(i)}`; if (seen.has(key)) continue;
    seen.add(key); out.push(i);
  }
  return out;
})();

const numbers = {
  commit: recs.length, unit: items.length,
  fresh: items.filter(i => i.class === "Fresh").length, improved: items.filter(i => i.class === "Improved").length,
  wasFixed: items.filter(i => i.class === "WasFixed").length, inBackground: items.filter(i => i.class === "InBackground").length,
  to_customer_visible: customerItems.length, dependency: deps.length, skipped: skipped.length,
};

// --- output ---
let o = `# Release note draft · ${rangeLabel} · ${audience}\n\n*Draft — awaiting owner approval. Read and fix before publishing.*\n\n`;
if (prMsg) o += `> ${prMsg}\n\n`;
if (audience === "manager") {
  o += `## This week\n\n**${numbers.unit} units shipped, ${numbers.to_customer_visible} visible to customers.**\n\n`;
  let waves = null; try { waves = JSON.parse(fs.readFileSync(path.join(pm, "state", "waves.json"), "utf8")); } catch {}
  if (waves) { const arr = Array.isArray(waves) ? waves : waves.waves || [];
    if (arr.length) o += `## Wave progress\n\n${arr.map(d => `- ${d.name || d.name || "?"}: ${d.done ?? d.done ?? "?"}/${d.total ?? "?"}`).join("\n")}\n\n`; }
}
const Kinds = audience === "customer" ? ["Fresh", "Improved", "WasFixed"] : ["Fresh", "Improved", "WasFixed", "InBackground"];
for (const kindValue of Kinds) {
  const group = audience === "customer" ? customerItems.filter(i => i.class === kindValue) : items.filter(i => i.class === kindValue);
  if (!group.length) continue;
  o += `## ${kindValue}\n\n`;
  for (const i of group) {
    const psst = kindValue === "InBackground" ? " — psst: opportunity here" : "";
    if (audience === "customer") o += `- ${customerLine(i)}\n`;
    else if (audience === "team") o += `- **${i.title}**${i.ref ? ` · ${i.ref}` : ""} — ${i.commits.length} commit${i.prs.length ? `, PR ${i.prs.map(p => `#${p.n}`).join(", ")}` : ""} · ${i.who.join(", ") || "—"}${i.commits.length ? ` · \`${i.commits[0]}\`` : ""}${psst}\n`;
    else o += `- ${i.title}${i.ref ? ` (${i.ref})` : ""}${psst}\n`;
  }
  o += "\n";
}
if (audience !== "customer") o += `\n## Numbers\n\n${Object.entries(numbers).map(([k, v]) => `${k} ${v}`).join(" · ")}\n`;
process.stdout.write(o);

if (jsonOut) {
  const sourceItems = audience === "customer" ? customerItems : items;
  const itemsValue = sourceItems.map(({ class: kindValue, title: titleValue, ref, prs, commits, who, toCustomer, text_required }) => audience === "customer"
    ? { class: kindValue, title: text_required ? null : maskCustomer(titleValue), ref: null, prs: [], commits: [], who: [], toCustomer, text_required }
    : { class: kindValue, title: titleValue, ref, prs: prs.map(p => ({ n: p.n, t: p.t })), commits, who, toCustomer, text_required });
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify({ type: "notes", generated: new Date().toISOString(), range: rangeLabel, audience, items: itemsValue, numbers }, null, 1));
}
