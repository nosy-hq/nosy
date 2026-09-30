// Measures size (S/M/L) and area ownership from git history: evidence, not a guess, for "how many days, whose area?"
// Usage: node measure-size.mjs <pm> "<topic>" [extra words...] [--path <dir>]... [--day 180] [--json <file>]
//        node measure-size.mjs <pm> --bulk <lowhanging.json> [--path <dir>]... [--json <file>]
// Provides the evidence canwe.md wants for every gap's size (matrix step 11 prioritization, step 12 suggest-not-assign).
// Patterns: Swarmia/Jellyfish's cycle time + PR-to-initiative mapping (grouping commits into a unit of work by
// ref, active days = a cycle-time signal, the most-touched directory = the "initiative" area) and Linear's
// estimate language ("DATE +/- N days", a confidence level) -> here, "S/M/L, a p25-p75 range, confidence".
// Deterministic; the agent does the interpreting (the ccpm pattern).
import fs from "node:fs"; import path from "node:path"; import { execFileSync, spawn } from "node:child_process"; import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs"; import { smallAscii, conceptGroupsOf as conceptGroupsOfCommon, idfSetup, langOfLoad } from "./text.mjs"; import { thresholds } from "./thresholds.mjs"; import { partialCloneNoticeOf } from "./integration-branch.mjs";
import { readSources } from "./sources-file.mjs";
const argv = process.argv.slice(2);
const opt = (name, many) => { const out = []; let i; while ((i = argv.indexOf(name)) >= 0) { out.push(argv.splice(i, 2)[1]); if (!many) break; } return many ? out : out[0]; };
const jsonOut = opt("--json"), dayN = +(opt("--day") || 180), bulkFile = opt("--bulk");
const paths = (opt("--path", true) || []).map(p => p.replace(/\/+$/, ""));
const [pm = "pm", topicRaw = "", ...extra] = argv;
const K = readSources(pm);
langOfLoad(K); // sources.json's `language`, read once so conceptGroupsOfCommon's words()/root() below pick it up
const ES = thresholds(K); // sources.json's optional `threshold` object, or the default
const git = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 256 << 20 });
const t0 = Date.now();

// on a large repo the git log --numstat pass below is the slow, silent part (Twenty:
// 4900+ commits in 180 days, 4+ minutes, nothing printed). Progress goes to stderr (CLI-CONTRACT.md); stdout
// stays the report. Throttled to at most one line every 2s, so a fast run (the common case, and every test)
// prints nothing at all.
const note = s => process.stderr.write(`measure-size: ${s}\n`);
// said once, before the slow part, on a partial/shallow clone (integration-branch.mjs's
// shared detector) - otherwise the "N/total commits…" progress above can itself sit silent for minutes on the
// very first blob fetch, looking hung rather than slow.
{ const p = partialCloneNoticeOf(K.repo); if (p) note(p); }
const LOG_FORMAT = "%x01%h%x1f%P%x1f%ad%x1f%an%x1f%s%x1f%b%x02";
// One shared parser for every `git log --numstat` pass (the main window and, when needed, the ownership
// window below) - a single place that turns the raw text into commit records.
function parseLog(raw) {
  return raw.split("\x01").slice(1).map(ch => {
    const [head, tail = ""] = ch.split("\x02");
    const [h, P, nameValue, an, s, ...bR] = head.split("\x1f");
    const files = []; let add = 0, remove = 0;
    for (const line of tail.split("\n")) { const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/); if (!m) continue; if (m[1] !== "-") add += +m[1]; if (m[2] !== "-") remove += +m[2]; files.push(m[3]); }
    return { h, day: nameValue.slice(0, 10), t: Date.parse(nameValue), an, s, b: bR.join("\x1f"), merge: P.trim().split(/\s+/).filter(Boolean).length > 1, add, remove, files };
  });
}
// Streams `git log --numstat` instead of blocking on execFileSync, so the slow part (Twenty-sized history)
// can report "N/total commits…" to stderr while it runs, instead of sitting silent until it's killed.
// `total` comes from a separate `git rev-list --count`, itself near-instant (no diff computation).
function gitLogNumstat(days) {
  let total = 0;
  try { total = +execFileSync("git", ["-C", K.repo, "rev-list", "--count", `--since=${days}.days`, K.ref], { encoding: "utf8" }).trim() || 0; } catch {}
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", K.repo, "log", `--since=${days}.days`, "--date=format:%Y-%m-%dT%H:%M:%S", "--format=" + LOG_FORMAT, "--numstat", K.ref]);
    const chunks = []; let seen = 0, lastPrint = Date.now(), errText = "";
    child.stdout.on("data", d => {
      chunks.push(d);
      let idx = 0; while ((idx = d.indexOf(1, idx)) !== -1) { seen++; idx++; } // byte 0x01 = one commit record start
      const now = Date.now();
      if (now - lastPrint >= 2000) { lastPrint = now; note(total ? `${seen}/${total} commits…` : `${seen} commits…`); }
    });
    child.stderr.on("data", d => { errText += d; });
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(errText || `git log exited ${code}`))));
  });
}

// Reference pattern: the shared refs.mjs helper (sources.json's `refs`, otherwise DEFAULT); group key "K180 m.5" -> "K180".
const refRe = refRegex(patternsOfLoad(K));
const normRef = groupKeyOf;
const refsOf = s => [...new Set((String(s).match(refRe) || []).map(normRef))];

// Word prep: text.mjs's shared helper - rough Turkish stem + word filter + K.glossary
// TR<->EN expansion if present + concept groups (merged groups, "toplu"/"bulk" is one
// concept: coverage is counted per concept so synonyms don't unfairly inflate the denominator and drop confidence).
const conceptGroupsOf = text => conceptGroupsOfCommon(text, K.glossary || {});
const keys = text => [...new Set(conceptGroupsOf(text).flat())];

// --- the owner's/agent's "ret" decisions (learn.mjs ret --type size) --------------------
// If a candidate (a ref like "#71", or part of a title) has been rejected IN A SPECIFIC CONTEXT ("client portal"),
// it drops out of the similar list on the next measure-size call whose context resembles that one; since word
// similarity doesn't understand meaning ("client portal" also appears in the billing tab), this is a lasting fix.
function rejectRulesOfRead() {
  try {
    const O = JSON.parse(fs.readFileSync(path.join(pm, "learned.json"), "utf8"));
    const b = new Date().toISOString().slice(0, 10);
    return (O.rules || []).filter(k => k.tip === "reject" && (k.type === "size" || k.type === "all") && (!k.end || k.end >= b));
  } catch { return []; }
}
const REJECT_RULES_OF = rejectRulesOfRead();
// Context match: a rule applies to this topic if its `context` overlaps this measure-size call's topic
// (concept-group overlap) by more than half (the same rough measure as build-waves's "widespread"/similarity thresholds).
function contextIsMatching(topicText, context) {
  const bg = conceptGroupsOf(context || "").flat(); if (!bg.length) return false;
  const kg = new Set(conceptGroupsOf(topicText).flat());
  return bg.filter(w => kg.has(w)).length / bg.length >= 0.5;
}
function rejectFilter(topicText, similar) {
  if (!REJECT_RULES_OF.length || !similar.length) return { similar, extracted: 0 };
  const applied = REJECT_RULES_OF.filter(k => contextIsMatching(topicText, k.context));
  if (!applied.length) return { similar, extracted: 0 };
  const matches = (b, k) => { const a = smallAscii(k.key || ""); if (!a) return false;
    return (b.ref && smallAscii(b.ref) === a) || smallAscii(b.title || "").includes(a); };
  const remaining = similar.filter(b => !applied.some(k => matches(b, k)));
  remaining.documentEliminated = similar.documentEliminated; // similarFind's document-only counter; must carry over past the filter too
  return { similar: remaining, extracted: similar.length - remaining.length };
}

// One git log --numstat call (target <10s on the first product; streamed with progress on a large repo like Twenty):
// commit title, body, parent count (merge detection), +/- lines, files.
const raw = await gitLogNumstat(dayN);
const commits = parseLog(raw);

// Units of work: grouped by ref. A merged PR title ("Merge pull request #N", squash "(#N)", "Merge #N") is
// already caught by the #\d+ pattern; but the merge commit ITSELF (2 parents) is excluded from counting - its
// diff is empty, the work isn't there, it's only scanned to mark which ref is "this unit of work". Excludes chore(deps).
const groups = new Map();
for (const c of commits) {
  if (/^chore\(deps\)/.test(c.s)) continue;
  for (const r of refsOf(c.s)) { if (!groups.has(r)) groups.set(r, { ref: r, commits: [] }); groups.get(r).commits.push(c); }
}
for (const [ref, g] of [...groups]) {
  const cs = g.commits.filter(c => !c.merge).sort((a, b) => a.t - b.t);
  if (!cs.length) { groups.delete(ref); continue; }
  g.commits = cs;
  g.first = cs[0].day; g.last = cs[cs.length - 1].day;
  g.calendar_day = Math.max(1, Math.round((Date.parse(g.last) - Date.parse(g.first)) / 86400000) + 1);
  g.active_day = new Set(cs.map(c => c.day)).size;
  g.files = [...new Set(cs.flatMap(c => c.files))];
  g.add = cs.reduce((s, c) => s + c.add, 0); g.remove = cs.reduce((s, c) => s + c.remove, 0);
  g.who = [...new Set(cs.map(c => c.an))];
  // A unit of work that only touches documents (md/txt, non-code under docs/) measures spec-writing time, not
  // build time (a finding from a parallel session on the first product: "client portal"'s similar items pulling in §55/§58
  // into BACKEND-NEEDS were two document commits).
  g.document = g.files.length > 0 && g.files.every(f => /\.(md|mdx|txt|rst|adoc)$/i.test(f) || (/(^|\/)docs?\//i.test(f) && !/\.(m?[jt]sx?|go|py|rb|java|kt|swift|cs|php|rs|sql|vue|svelte)$/i.test(f)));
  g.title = cs[0].s; // the first commit's title (consistent with collect-status.mjs's "Topic (first commit)" pattern)
  const dc = new Map(); for (const f of g.files) dc.set(path.dirname(f), (dc.get(path.dirname(f)) || 0) + 1);
  g.directorys = [...dc].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
  // A commit citing three or more refs (e.g. "add §55/§57/§58 - ... client portal") is a listing/index commit:
  // its text doesn't count for similarity, otherwise §57's group looked similar to "client portal" only
  // because of §58's text. If every commit in the group is like that, they all count anyway.
  const singleAbout = cs.filter(c => refsOf(c.s + " " + c.b).length < 3);
  g.text = (singleAbout.length ? singleAbout : cs).map(c => c.s + " " + c.b).join(" ") + " " + g.files.join(" ");
  // Large body text: text.mjs's smallAscii (lowercase + ASCII fold) - calling toLocaleLowerCase("tr-TR") every
  // time was very slow on a large repo (measured: 107s -> 6.7s); computed once here.
  // ASCII folding also lets a commit typed on an ASCII keyboard match a search typed with proper Turkish
  // accents, and vice versa.
  g.textLower = smallAscii(g.text);
}
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(2); };
const median = arr => pct(arr, 0.5);
const base = { is_count: groups.size, active_day_median: median([...groups.values()].map(g => g.active_day)) };

// Similarity: idf-weighted word match + a square-root penalty for long blocks (the gather-evidence.mjs pattern);
// if --path is given, work touching that directory gets extra weight.
// The topic's own ref (e.g. K167) doesn't count as similar: that group IS the effort spent on this work SO FAR,
// not the work remaining; it's reported separately.
// coverage = idf weight of matched words / idf weight of all words (0-1); this also drives confidence.
function similarFind(concepts, filePath, N = 8, excludedRefs = []) {
  const docs = [...groups.values()].filter(g => !excludedRefs.includes(g.ref)), words = [...new Set(concepts.flat())];
  if (!words.length || !docs.length) return [];
  const Nd = docs.length;
  const { idf, re: wre } = idfSetup(docs.map(g => g.textLower), words); // text.mjs: ASCII-folded word-start match + rarity (idf)
  // A concept's score = its strongest matching word (synonyms aren't double-counted). A concept never seen in
  // history stands in the denominator at its rarest weight: if "plugin" was never built, similar work won't
  // cover that concept, and confidence drops.
  const hit = l => concepts.reduce((s, g) => s + Math.max(0, ...g.map(w => wre[w].test(l) ? idf[w] : 0)), 0);
  const maxPossible = concepts.reduce((s, g) => s + (Math.max(0, ...g.map(w => idf[w])) || Math.log(Nd + 1)), 0) || 1;
  const avg = docs.reduce((s, g) => s + g.text.length, 0) / Nd;
  const ordered = docs.map(g => {
    let s = hit(g.textLower) / Math.sqrt(Math.max(1, g.text.length / avg));
    if (filePath.length && g.files.length) { const pay = g.files.filter(f => filePath.some(y => f === y || f.startsWith(y + "/"))).length / g.files.length; s *= (1 + pay); }
    return { ...g, score: +s.toFixed(2), coverage: +(hit(g.textLower) / maxPossible).toFixed(2) };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  const code = ordered.filter(x => !x.document).slice(0, N); code.documentEliminated = ordered.filter(x => x.document).length; return code;
}

// Estimate: the similar items' active-day median -> K(<=2) / O(3-7) / B(>7); a p25-p75 range; confidence >=5
// similar + a narrow range = high, >=3 = medium, <3 = low -> (unverified) and falls back to the product-wide
// baseline. With agents, work can finish in a day: if active days are low but commit/file count is high
// (median >=10 commits or >=20 files), it's bumped up one notch - calendar days alone don't show intensity.
function resize(similar) {
  if (!base.is_count) return { size: "?", active_day_median: 0, range: [0, 0], confidence: "low", justification: `(unverified) no referenced (K/§/#) unit of work found in the last ${dayN} days; no evidence to estimate from.` };
  if (similar.length < 3) return { size: base.active_day_median <= 2 ? "S" : base.active_day_median <= 7 ? "M" : "L", active_day_median: base.active_day_median, range: [base.active_day_median, base.active_day_median], confidence: "low",
    justification: `(unverified) only ${similar.length} similar item(s) found; fell back to the product-wide baseline (${base.is_count} units of work, median ${base.active_day_median} active days).` };
  const networkList = similar.map(b => b.active_day), coMed = median(similar.map(b => b.commits.length)), doMed = median(similar.map(b => b.files.length));
  const networkMed = median(networkList), networkP25 = pct(networkList, .25), networkP75 = pct(networkList, .75);
  let size = networkMed <= 2 ? "S" : networkMed <= 7 ? "M" : "L", bump = "";
  if (size !== "L" && (coMed >= 10 || doMed >= 20)) { size = size === "S" ? "M" : "L"; bump = ` · high commit/file density (commit median ${coMed}, file median ${doMed}) -> bumped up one notch`; }
  // "High" should be rare: word similarity doesn't understand meaning ("client portal" also shows up in the
  // e-notice portal tab), and on a fast team every task takes 1-2 days, so "5 similar + a narrow range" alone was
  // handing out "high" almost everywhere. Below 34% coverage is low; "high" also needs coverage >=80% and at
  // least 80% of the top 5 in the same area; otherwise it caps at medium - the agent verifies the similar items.
  const coverage = +(similar.slice(0, 5).reduce((s, b) => s + (b.coverage || 0), 0) / Math.min(5, similar.length)).toFixed(2);
  let confidence = (similar.length >= 5 && (networkP75 - networkP25) <= Math.max(2, networkMed)) ? "high" : "medium", weak = "";
  if (coverage < ES.sizeCoverageLow) { confidence = "low"; weak = ` · (unverified) similarity is weak: the top 5's topic coverage is ${Math.round(coverage * 100)}%`; }
  else if (coverage < ES.sizeCoverageHigh && confidence === "high") { confidence = "medium"; weak = ` · medium similarity: coverage ${Math.round(coverage * 100)}%`; }
  // Area consistency: genuinely similar work touches the same area. If the top 5's main directories (the first
  // two path segments) are scattered, it's word overlap ("client ... portal" also shows up in the e-notice tab):
  // confidence caps at medium.
  const area = b => (b.directorys[0] || "").split("/").slice(0, 2).join("/"), first5 = similar.slice(0, 5), areaSay = new Map();
  for (const b of first5) areaSay.set(area(b), (areaSay.get(area(b)) || 0) + 1);
  const consistency = first5.length ? Math.max(...areaSay.values()) / first5.length : 0;
  if (consistency < ES.sizeConsistency && confidence === "high") { confidence = "medium"; weak += ` · similar items are in different areas (the most common area is ${[...areaSay].sort((a, b) => b[1] - a[1])[0][0] || "?"} ${Math.round(consistency * 100)}%)`; }
  if (similar.documentEliminated) weak += ` · ${similar.documentEliminated} document-only unit(s) of work (spec writing) excluded from the similar list`;
  return { size, active_day_median: networkMed, range: [networkP25, networkP75], confidence, coverage, consistency: +consistency.toFixed(2), justification: `The active-day median of ${similar.length} similar item(s) is ${networkMed} (p25-p75: ${networkP25}-${networkP75} days), commit median ${coMed}, file median ${doMed}.${bump}${weak}` };
}

// Suggested ownership (not an assignment): the last-90-days git shortlog -sn share in the similar items'
// directories (or --path). Excludes bots.
//
// this used to run one `git shortlog -sn -- <dirs>` PER psst item (`--bulk` can have
// dozens) with no cache beyond one process's own lifetime - on a large repo like Twenty, each one is its own
// slow path-limited history walk. Replacing it with a plain in-memory "which commits touch these files"
// scan was tried and dropped: git's own pathspec history simplification can drop a commit that DID touch the
// path (a side branch whose net change got superseded before a later merge - see git-log(1) "History
// Simplification"), so a flat re-scan doesn't always agree with `git shortlog -- <dirs>` on a repo with real
// merge history (verified different on the first product's canwe-v3 fixture; identical on Nosy's own repo and the Kargo
// tests, which don't hit that case) - not safe when the contract is "output must be identical". What IS safe
// to cut is calling git again for a (ref sha, directory set) this tool has already asked about: the result
// is cached in-run (as before) AND persisted to `<pm>/state/.measure-size-ownership-cache.json`, keyed by
// the ref's resolved commit sha, so a second `measure-size --bulk` against the same commit (rerunning scoop
// after a `learn reject`, or canwe re-measuring a topic) costs zero extra git calls instead of one per item.
const ownCacheFile = path.join(pm, "state", ".measure-size-ownership-cache.json");
let ownCacheOnDisk = null; try { ownCacheOnDisk = JSON.parse(fs.readFileSync(ownCacheFile, "utf8")); } catch {}
let ownSha = null; try { ownSha = git("rev-parse", K.ref).trim(); } catch {}
const ownCacheRows = (ownSha && ownCacheOnDisk && ownCacheOnDisk.sha === ownSha) ? (ownCacheOnDisk.rows || {}) : {};
let ownCacheDirty = false;
const shortlogCache = new Map();
function ownershipFind(similar, filePath) {
  const directorys = (filePath.length ? filePath : [...new Set(similar.flatMap(b => b.directorys))].slice(0, 6)).sort();
  if (!directorys.length) return [];
  const key = directorys.join("|");
  if (!shortlogCache.has(key)) {
    if (Object.prototype.hasOwnProperty.call(ownCacheRows, key)) { shortlogCache.set(key, ownCacheRows[key]); }
    else {
      let raw = ""; try { raw = git("shortlog", "-sn", "--no-merges", "--since=90.days", K.ref, "--", ...directorys); } catch {}
      shortlogCache.set(key, raw);
      if (ownSha) { ownCacheRows[key] = raw; ownCacheDirty = true; }
    }
  }
  const bot = /dependabot|github-actions|renovate/i;
  const rows = shortlogCache.get(key).split("\n").filter(Boolean).map(l => { const m = l.match(/^\s*(\d+)\s+(.+)$/); return m ? { who: m[2], commit: +m[1] } : null; }).filter(r => r && !bot.test(r.who));
  const total = rows.reduce((s, r) => s + r.commit, 0) || 1;
  return rows.slice(0, 3).map(r => ({ who: r.who, pay: +(100 * r.commit / total).toFixed(0), commit: r.commit }));
}
function ownCachePersist() {
  if (!ownCacheDirty || !ownSha) return;
  try { fs.mkdirSync(path.dirname(ownCacheFile), { recursive: true }); fs.writeFileSync(ownCacheFile, JSON.stringify({ sha: ownSha, rows: ownCacheRows })); } catch {}
}

const ownHistoryOf = refs => { const g = refs.map(r => groups.get(r)).filter(Boolean).sort((a, b) => b.active_day - a.active_day)[0];
  return g ? { ref: g.ref, first: g.first, last: g.last, active_day: g.active_day, commit: g.commits.length, file: g.files.length, document: g.document } : null; };
const ownLine = k => k ? `This work's own history (${k.ref}): ${k.first} -> ${k.last}, ${k.active_day} active days, ${k.commit} commits, ${k.file} files${k.document ? " (document only: a spec was written, build hasn't started)" : ""} - effort spent so far, not work remaining; excluded from the similar list.` : "";
const duration = () => `_Duration: ${((Date.now() - t0) / 1000).toFixed(1)}s._\n`;
if (!bulkFile) {
  const concept = conceptGroupsOf([topicRaw, ...extra].join(" ").replace(refRe, " ")), words = concept.flat(), ownRef = refsOf([topicRaw, ...extra].join(" "));
  const similarRaw = similarFind(concept, paths, 8, ownRef);
  const { similar, extracted } = rejectFilter([topicRaw, ...extra].join(" "), similarRaw);
  const estimate = resize(similar), owner = ownershipFind(similar, paths), own = ownHistoryOf(ownRef);
  if (extracted) estimate.justification += ` · ${extracted} similar item(s) removed by the owner's/agent's rejection.`;
  let o = `# Size measurement · "${topicRaw}" · ${K.ref} · last ${dayN} days\n\nKeywords: ${words.join(", ") || "—"}\n\n`;
  o += `## Estimate\n**${estimate.size}** · active-day median ${estimate.active_day_median} (p25-p75: ${estimate.range[0]}-${estimate.range[1]}) · confidence: ${estimate.confidence}\n\n${estimate.justification}\n\n${own ? ownLine(own) + "\n\n" : ""}`;
  o += `## Similar work (${similar.length})\n\n| Ref | Title | First | Last | Cal. days | Active days | Commits | Files | +/- | Who | Directories |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const b of similar) o += `| ${b.ref} | ${b.title.replace(/\|/g, "/").slice(0, 70)} | ${b.first} | ${b.last} | ${b.calendar_day} | ${b.active_day} | ${b.commits.length} | ${b.files.length} | +${b.add}/-${b.remove} | ${b.who.join(", ")} | ${b.directorys.join(", ")} |\n`;
  o += `\n## Suggestion: ownership (not an assignment)\n${owner.length ? owner.map(s => `- suggestion: ${s.who} (${s.pay}% of this area's commits, ${s.commit} commits)`).join("\n") : "- (unverified) not enough directory/commit data"}\n\n`;
  o += `## Baseline\nIn the last ${dayN} days: ${base.is_count} units of work, active-day median ${base.active_day_median}.\n\n${duration()}`;
  process.stdout.write(o);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ type: "size", generated: new Date().toISOString(), topic: topicRaw, keys: words,
    similar: similar.map(b => ({ ref: b.ref, title: b.title, first: b.first, last: b.last, calendar_day: b.calendar_day, active_day: b.active_day, commit: b.commits.length, file: b.files.length, add: b.add, remove: b.remove, who: b.who, directorys: b.directorys, score: b.score })),
    estimate, owner, own, base }, null, 1));
} else {
  const lh = JSON.parse(fs.readFileSync(bulkFile, "utf8"));
  const bulkItems = lh.items || [];
  let lastItemPrint = Date.now();
  const items = bulkItems.map((m, i) => {
    const now = Date.now();
    if (now - lastItemPrint >= 2000) { lastItemPrint = now; note(`${i + 1}/${bulkItems.length} items…`); }
    // lowhanging.mjs now writes item.ref; used first if present, otherwise (an older
    // lowhanging.json) extracted with a regex from the title+evidence (backward compatible).
    const found = refsOf(`${m.title || ""} ${m.evidence || ""}`);
    const ref = m.ref || found[0] || null;
    const refs = ref ? [...new Set([ref, ...found])] : found;
    const clean = String(m.title || "").replace(/\s*\(in #\d+\)\s*$/, "");
    // A ref isn't searched as a word (it would find its own group); similar by topic words, own history by ref.
    const similarRaw = similarFind(conceptGroupsOf(clean.replace(refRe, " ")), paths, 8, refs);
    const { similar, extracted } = rejectFilter(clean, similarRaw);
    const estimate = resize(similar);
    if (extracted) estimate.justification += ` · ${extracted} similar item(s) removed by the owner's/agent's rejection.`;
    return { title: m.title, ref, estimate, owner: ownershipFind(similar, paths), own: ownHistoryOf(refs) };
  });
  let o = `# Size measurement · bulk (${items.length} items) · ${K.ref} · last ${dayN} days\n\n| Title | Ref | Size | p25-p75 | Confidence | Coverage | Spent (own ref) | Suggested owner |\n|---|---|---|---|---|---|---|---|\n`;
  for (const m of items) o += `| ${String(m.title).replace(/\|/g, "/").slice(0, 70)} | ${m.ref || "—"} | ${m.estimate.size} | ${m.estimate.range[0]}-${m.estimate.range[1]} | ${m.estimate.confidence} | ${m.estimate.coverage != null ? Math.round(m.estimate.coverage * 100) + "%" : "—"} | ${m.own ? `${m.own.active_day} days, ${m.own.commit} commits` : "—"} | ${m.owner[0] ? `${m.owner[0].who} ${m.owner[0].pay}%` : "—"} |\n`;
  o += `\n${duration()}`;
  process.stdout.write(o);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ type: "size-bulk", generated: new Date().toISOString(), items }, null, 1));
}
ownCachePersist();
