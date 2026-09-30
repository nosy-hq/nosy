// Wave builder: builds a three-wave roadmap suggestion from the evidence (Now / When code lands / Needs
// backend); a "why now" sentence is written from the evidence for every item.
// Usage: node build-waves.mjs <pm folder> [--capacity <days>] [--json <file>] [--md <pm/waves.md>]   (sources from pm/sources.json; all optional)
//   --md: writes the output between the <!-- nosy:build-waves --> ... <!-- /nosy:build-waves --> markers in
//   the hand-written waves doc (appends at the end if the markers are missing); doesn't touch the
//   hand-written part of the doc (position, risk, suggestion) - the auto-section.mjs pattern.
// Pattern: Nosy matrix row 11 (roadmap suggestion/prioritization). Airfocus/Productboard's value x effort +
// RICE framework (pm/rivals/airfocus.md "11", productboard-spark.md "11"), JPD's Insights(evidence)+Delivery
// (status) pair (jira-product-discovery-rovo.md "5/8/9"), Linear's cycle/Loops capacity (linear-agent.md "19").
// Work the owner has set aside ("haven't decided yet" etc., matrix decision:"notDoing") doesn't enter a
// wave; listed separately. No LLM/network call, deterministic.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs"; import { matrixRead } from "./read-matrix.mjs"; import { small, root, langOfLoad } from "./text.mjs"; import { thresholds } from "./thresholds.mjs"; import { decisionsOfRead, NEGATION_RE } from "./read-decisions.mjs";
import { readSources } from "./sources-file.mjs";

// "Haven't decided yet" family: English plus, for decisions written in Turkish (see
// skill/data/lang/tr/build-waves.json), the same Turkish phrase.
const TR_WAITING = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/build-waves.json", import.meta.url), "utf8")).waitingPatterns;

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const jsonOut = opt("--json"), mdOut = opt("--md"); const capacityStr = opt("--capacity"); const capacityDay = capacityStr != null ? +capacityStr : null;
const pm = argv[0] || "pm";
let K = {}; try { K = readSources(pm); } catch {}
langOfLoad(K); // sources.json's `language`
const ES = thresholds(K); // sources.json's optional `threshold` object, or the default
const git = (...a) => execFileSync("git", ["-C", K.repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// Reference pattern: the shared refs.mjs helper; group key "K180 m.5" -> "K180" (so psst/collect-signals/measure-size match the same key).
const refRe = refRegex(patternsOfLoad(K));
const refsOfFind = s => [...new Set((String(s || "").match(refRe) || []).map(groupKeyOf))];
const firstRef = (...ss) => { for (const s of ss) { const r = refsOfFind(s)[0]; if (r) return r; } return null; };

// Glossary (TR<->EN) + rough stem + a high-threshold title similarity (the gather-evidence.mjs pattern; the
// threshold was raised to lower the risk of a false match).
const phrase = K.glossary || {}; const reversePhrase = {}; for (const [tr, ens] of Object.entries(phrase)) for (const en of ens) (reversePhrase[en] ??= []).push(tr);
const words = s => [...new Set(small(s || "").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3).flatMap(w => [w, ...(phrase[w] || []), ...(reversePhrase[w] || [])].map(root)))];
const similarity = (a, b) => { const A = new Set(words(a)), B = new Set(words(b)); if (!A.size || !B.size) return 0; let o = 0; for (const w of A) if (B.has(w)) o++; return o / Math.min(A.size, B.size); };
const Threshold = ES.waveSimilarity; // without a ref, only a strong word overlap matches (tunable via sources.json's threshold.waveSimilarity)

// text similarity never marks something shipped/present: the caller needs to know
// WHICH way a match was found, not just what it found. Returns { item, matchedBy: "ref" | "text" } (or null);
// "ref" is an explicit §/K/#-number match (unchanged behavior); "text" is only a title-similarity guess and
// must never be reported by a caller as a settled "backend ready"/"present in N rivals" fact.
function bestFind(ref, title, list, refField, titleField) {
  if (ref) { const r = list.find(x => x[refField] === ref); if (r) return { item: r, matchedBy: "ref" }; }
  if (!title) return null;
  let best = null, score = 0;
  for (const x of list) { const s = similarity(title, x[titleField]); if (s > score) { score = s; best = x; } }
  return score >= Threshold ? { item: best, matchedBy: "text" } : null;
}

// ---- Inputs (all optional) ----
// The owner-filtered psst list (learn.mjs apply), if present: work that was told to be quiet shouldn't
// return to the roadmap.
const low = readJson(path.join(pm, "state", "lowhanging.filtered.json")) || readJson(path.join(pm, "state", "lowhanging.json"));
const statusJson = readJson(path.join(pm, "state", "status.json"));
const signalsJson = readJson(path.join(pm, "state", "signals.json"));
const sizeV = readJson(path.join(pm, "state", "size.json"));
const lowM = low?.items || [], statusGroups = statusJson?.groups || [], statusPrs = statusJson?.prs || [], signalGoals = signalsJson?.goals || [], sizeM = sizeV?.items || [];

// ---- The "outside" list (matrix decision + signal + decisions, collected in one place; if the same title comes from multiple sources it merges) ----
const outside = new Map();
const outsideAdd = (title, reason, source) => { const k = small((title || "?").trim()); if (outside.has(k)) outside.get(k).sources.add(source); else outside.set(k, { title, reason, sources: new Set([source]) }); };

// ---- Matrix (read-matrix.mjs: both the line and step shapes; an acquired/closed rival doesn't count toward commonality) ----
const matrixPath = K.matrix || path.join(pm, "matrix.json");
let matrixRecognized = false, matrixLine = [];
if (fs.existsSync(matrixPath)) {
  const M = matrixRead(matrixPath); // both shapes: a real product's lines, Nosy's steps
  if (M) {
    matrixRecognized = true; const biz = M.biz;
    for (const r of M.lines) {
      if (r.decision === "notDoing") { outsideAdd(r.feature, `matrix: decided not doing — ${r.not || ""}`.trim(), "matrix.json"); continue; }
      const code = r.codes?.[biz];
      const rivals = Object.entries(r.codes || {}).filter(([u, v]) => u !== biz && v === "y" && !M.oh.has(u)).map(([u]) => u);
      matrixLine.push({ feature: r.feature, not: r.not, code, rivals, ref: firstRef(r.not, r.feature) });
    }
  }
}

// ---- Decisions: K.preread.decisions (git show) + <pm>/decisions.md; split into "not doing" / "haven't decided yet" blocks ----
const withBlock = (src, re) => { const out = []; let m, last = null; re.lastIndex = 0; while ((m = re.exec(src))) { if (last) out.push(src.slice(last.i, m.index)); last = { i: m.index }; } if (last) out.push(src.slice(last.i)); return out; };
let decisionBlock = [], decisionSourceOf = [];
// read-decisions.mjs: K.preread.decisions can be a single file/directory/glob; only the source
// changed, the matching/notDoing/waiting logic below is the same.
if (K.repo && K.ref && K.preread?.decisions) { try { decisionBlock.push(...decisionsOfRead(K).map(k => k.text)); decisionSourceOf.push(K.preread.decisions); } catch {} }
const decisionsMd = path.join(pm, "decisions.md");
if (fs.existsSync(decisionsMd)) { decisionBlock.push(...withBlock(fs.readFileSync(decisionsMd, "utf8"), /^-\s*\*\*/gm)); decisionSourceOf.push("decisions.md"); }
const NotDoing = NEGATION_RE, Waiting = new RegExp(["haven't decided yet", "I'?ll decide", "we'?ll look at it later", ...TR_WAITING].join("|"), "i");
function bestTextFind(ref, title, blocks) {
  if (ref) { const b = blocks.find(b => refsOfFind(b).includes(ref)); if (b) return b; }
  if (!title) return null;
  let best = null, score = 0; for (const b of blocks) { const s = similarity(title, b); if (s > score) { score = s; best = b; } } return score >= Threshold ? best : null;
}
function decisionStatusOf(ref, title) {
  const blk = bestTextFind(ref, title, decisionBlock); if (!blk) return null;
  const summary = blk.trim().replace(/\s+/g, " ").slice(0, 220);
  if (NotDoing.test(blk)) return { tip: "outside", summary };
  if (Waiting.test(blk)) return { tip: "waiting", summary };
  return null;
}

// signal.goals' own "not doing" flag: even if no matching work is found, the record shouldn't be dropped.
for (const h of signalGoals) if (h.notDoing) outsideAdd(h.title || h.ref, `signal: not doing${h.ref ? ` (${h.ref})` : ""}`, "signals.json");

// ---- Build tasks: psst items first, then unmatched matrix lines (code 'b' or widespread n/p) ----
const EFFORT_N = { S: 1, M: 2, L: 3 }, DAY_DEFAULT = ES.sizeDays, COMMON_THRESHOLD = ES.common, IN_PR_RE = /\s*·\s*in PR$/;
const tasks = [], ownerDecisionOf = [], processedRef = new Set(), processedTitle = new Set();

function isSetup(source) {
  const ref = source.ref || firstRef(source.title, source.evidence);
  if (ref) processedRef.add(ref); processedTitle.add(small(source.title.trim()));

  const mLineM = bestFind(ref, source.title, matrixLine, "ref", "feature");
  const mLine = mLineM?.item ?? null;
  const mLineByText = mLineM?.matchedBy === "text";
  const sGoal = bestFind(ref, source.title, signalGoals, "ref", "title")?.item ?? null;
  const bItem = bestFind(ref, source.title, sizeM, "ref", "title")?.item ?? null;
  const dGroup = ref ? statusGroups.find(g => g.ref === ref) : null;

  // Work the owner has set aside: leave without entering a wave (signals area first, then the decisions text).
  if (sGoal?.notDoing) { outsideAdd(source.title, `signal: not doing${ref ? ` (${ref})` : ""}`, "signals.json"); return; }
  const kd = decisionStatusOf(ref, source.title);
  if (kd?.tip === "outside") { outsideAdd(source.title, `decision: ${kd.summary}`, decisionSourceOf.join(", ") || "decisions"); return; }
  if (kd?.tip === "waiting") { ownerDecisionOf.push({ title: source.title, ref, reason: kd.summary, source: decisionSourceOf.join(", ") || "decisions.md" }); return; }

  const typeBase = (source.type || "").replace(IN_PR_RE, "");
  const inPr = IN_PR_RE.test(source.type || "") || !!(dGroup && dGroup.where?.length && !dGroup.where.includes("main"));
  // psst's 6th signal (inventory.mjs: endpoint exists, no screen) also counts as "backend ready"; inventory's
  // false positives get filtered out with learn.
  // only a REF match on the matrix row earns the plain "backend ready" wording; a
  // title-similarity-only match ("candidate", matchedBy "text") is surfaced but never stated as fact.
  const matrixBackendReady = mLine?.code === "b" && !mLineByText;
  const matrixCandidateOnly = mLine?.code === "b" && mLineByText;
  const backendReadyFull = typeBase === "Backend ready, not on screen" || typeBase === "Endpoint exists, no screen" || typeBase === "Matrix: backend ready" || matrixBackendReady;
  const backendPartial = typeBase === "Served, no screen";

  // Evidence types (Confidence, 1-4) and "why now" sentence fragments.
  const evidence = new Set(), part = [];
  if (backendReadyFull) { evidence.add("backend"); part.push(`backend ready (${source.evidence || mLine?.not || "no source"})`); }
  else if (matrixCandidateOnly) { evidence.add("candidate"); part.push(`candidate — confirm: matrix row "${mLine.feature}" matched by title similarity only, not an explicit ref (${mLine.not || "no source"})`); }
  else if (backendPartial) { evidence.add("backend"); part.push(`served, no screen (${source.evidence || "no source"})`); }
  else if (sGoal?.ready) { evidence.add("backend"); part.push("signal: flagged ready"); }

  let demand = 0;
  if (sGoal) {
    demand = sGoal.customer || Math.log2(1 + (sGoal.count || 0)); evidence.add("demand");
    const t = sGoal.trend; const trend = !t ? "" : t.previous30 === 0 ? (t.last30 > 0 ? ", new" : "") : t.last30 > t.previous30 * 1.1 ? ", rising" : t.last30 < t.previous30 * 0.9 ? ", falling" : ", flat";
    part.push(`${sGoal.count ?? "?"} request(s)${sGoal.customer ? ` (${sGoal.customer} customers${trend})` : trend}`);
  } else if (typeBase === "Issue opened against us") { demand = 1; evidence.add("demand"); part.push(`open issue (${source.evidence || ""})`); }

  let rivalCount = mLine?.rivals?.length ?? 0;
  if (!mLine && typeBase === "Common among rivals, partial for us") { const m = (source.detail || []).join(" ").match(/(\d+) rival/); rivalCount = m ? +m[1] : 0; }
  // a rival-presence claim off the SAME title-similarity-only matrix row is a candidate
  // too, not a settled "present in N rivals" fact.
  if (rivalCount > 0) { evidence.add("rival"); part.push(`${mLineByText ? "candidate — confirm: possibly " : ""}present in ${rivalCount} rivals${mLine?.rivals?.length ? ` (${mLine.rivals.join(", ")})` : ""}`); }

  if (typeBase === "On the team's next list") { evidence.add("request"); part.push(`on the team's own list (${source.evidence || ""})`); }
  if (dGroup || typeBase === "Status may be stale") { evidence.add("git"); part.push(typeBase === "Status may be stale" ? `status may be stale: ${source.evidence || ""}` : `git: ${dGroup.topic} (${dGroup.last})`); }

  const value = +((source.scorePsst || 0) + demand + rivalCount + (backendReadyFull ? 2 : backendPartial ? 1 : 0)).toFixed(2);
  const confidence = Math.max(1, Math.min(4, evidence.size));
  const effortLetter = bItem?.estimate?.size || source.effortPsst || "M";
  const effortSource = bItem?.estimate?.size ? `size.json (${bItem.estimate.confidence} confidence)` : source.effortPsst ? "psst effort" : "default (no input)";
  const score = +((value * confidence) / (EFFORT_N[effortLetter] || 2)).toFixed(2);
  const day = bItem?.estimate?.active_day_median ?? (DAY_DEFAULT[effortLetter] ?? 3);
  const linked = [...new Set([...(source.title.match(/\(in #(\d+)\)/g) || []).map(x => +x.match(/\d+/)[0]), ...(dGroup?.where || []).filter(y => /^#\d+$/.test(y)).map(y => +y.slice(1))])];
  const who_suggestion = bItem?.owner?.length ? `suggested: ${[...bItem.owner].sort((a, b) => b.pay - a.pay)[0].who}` : null;

  let wave;
  if (inPr) wave = "When code lands";
  else if (backendReadyFull || backendPartial) wave = "Now";
  else if (typeBase === "Common among rivals, partial for us" || (mLine && (mLine.code === "n" || mLine.code === "p") && rivalCount >= COMMON_THRESHOLD)) wave = "Needs backend";
  // Stale status isn't roadmap work, it's a documentation fix; an issue opened against us gets a wave of its
  // own (so the two don't both fall into "After" and disappear).
  else if (typeBase === "Status may be stale") wave = "Documentation fix";
  else if (typeBase === "Issue opened against us" || typeBase === "On the team's next list") wave = "Open requests";
  else wave = "After";

  tasks.push({ title: source.title, ref, type: source.type, score, value, effort: effortLetter, effortSource, confidence, size: bItem?.estimate || null, evidenceList: part, reason_now: part.join(" · ") || "(no evidence)", who_suggestion, linked, wave, day });
}

// lowhanging.json now carries item.ref (null if missing) - isSetup uses it first, but
// falls back to a regex over title/evidence (backward compatible with older lowhanging.json files).
// the roadmap comes from the checked list, not the raw one. psst's receipts mark an item held on
// purpose (a ref in the comment at its evidence, or a decision naming the file): it goes to "waiting on the owner", never
// "Now" (on the first product, Nosy's own "Now" list was deliberately dropped mapper fields). What psst checked and kept
// (psst-final.json) leads "Now" as its own task, with the refuter's corrected size; what the refuter broke goes to
// "outside". A drafted item isn't merged onto the raw item whose receipt it used: "strike the stale §28 lines" and
// "build §28's comparison" share a receipt but aren't the same work. Without those files nothing changes.
const receiptsJ = readJson(path.join(pm, "state", "receipts.json")), finalJ = readJson(path.join(pm, "state", "psst-final.json"));
const heldBy = new Map((receiptsJ?.items || []).filter(r => r.gate?.held).map(r => [small(r.title.trim()), r.gate]));
const receipted = new Set((receiptsJ?.items || []).map(r => small(r.title.trim())));
const CODE_EVIDENCE = new Set(["Backend ready, not on screen", "Endpoint exists, no screen", "Served, no screen"]);
for (const m of lowM) {
  const k = small(m.title.trim()), g = heldBy.get(k);
  if (g) { processedTitle.add(k); ownerDecisionOf.push({ title: m.title, ref: m.ref || null, reason: `held on purpose, per the code at ${g.because.map(b => `${b.at} (${[...b.refs, ...b.decisions].join(", ")})`).join("; ")}; the owner decides whether it's still parked`, source: "psst receipts" }); continue; }
  const before = tasks.length;
  isSetup({ title: m.title, type: m.type, evidence: m.evidence, detail: m.detail, scorePsst: m.score, effortPsst: m.effort, ref: m.ref || null });
  // Receipts ran but never reached this item: say so rather than let it read as settled.
  if (receiptsJ && tasks.length > before && CODE_EVIDENCE.has(String(m.type).replace(IN_PR_RE, "")) && !receipted.has(k)) tasks[tasks.length - 1].reason_now = `unchecked (no receipt yet) · ${tasks[tasks.length - 1].reason_now}`;
}
const sizeLetter = sz => (String(sz || "").match(/\b(XS|S|M|L|XL)\b/) || [, "M"])[1].replace(/^XS$/, "S").replace(/^XL$/, "L");
for (const it of finalJ?.items || []) {
  const letter = sizeLetter(it.verdict === "weakened" ? it.fix : it.size);
  tasks.push({ title: it.title, ref: null, type: "Checked by psst", checked: it.verdict, score: 13, value: 3, effort: letter, effortSource: "psst draft / refuter", confidence: 4, size: null,
    evidenceList: it.evidence || [], reason_now: `checked by psst${it.verdict === "weakened" ? ` (corrected: ${it.fix})` : ""} · ${(it.evidence || []).slice(0, 2).join(", ")}`,
    who_suggestion: null, linked: [], wave: letter === "L" ? "After" : "Now", day: DAY_DEFAULT[letter] ?? 3 });
}
for (const d of finalJ?.dropped || []) outsideAdd(d.title, `refuted after checking: ${d.why}`, "psst refuter");
for (const r of matrixLine) {
  const common = (r.code === "n" || r.code === "p") && r.rivals.length >= COMMON_THRESHOLD, readyFull = r.code === "b";
  if (!common && !readyFull) continue;
  if (r.ref && processedRef.has(r.ref)) continue;
  if (!r.ref && processedTitle.has(small(r.feature.trim()))) continue;
  isSetup({ title: r.feature, ref: r.ref, type: readyFull ? "Matrix: backend ready" : "Common among rivals, partial for us", evidence: r.not, detail: [] });
}

// An owner suggestion means nothing on a one-author repo ("suggested: <the only author>" on every task): drop it there.
{ const authors = new Set(tasks.map(t => t.who_suggestion).filter(Boolean)); if (authors.size <= 1) for (const t of tasks) t.who_suggestion = null; }
// The owner's "knowingly" calls (learn.mjs) also keep a matrix row out of the waves (the matrix loop above re-added them).
{ const known = new Set((low?.items_knowingly || []).map(i => small(String(i.title || "").trim())));
  for (let i = tasks.length - 1; i >= 0; i--) if (known.has(small(tasks[i].title.trim()))) { outsideAdd(tasks[i].title, "knowingly: the owner's standing call (learn.mjs)", "learned.json"); tasks.splice(i, 1); } }

// ---- Group into waves, apply capacity (if given) or suggest it (if not) ----
const Order = ["Now", "When code lands", "Needs backend", "Open requests", "Documentation fix", "After"];
const waves = Object.fromEntries(Order.map(name => [name, []]));
for (const i of tasks) waves[i.wave].push(i);
for (const name in waves) waves[name].sort((a, b) => b.score - a.score);

// the suggested capacity used to be "every author.json/status.json name x 5 days" -
// on Twenty that's all 53 authors active in the window, bots and one-off drive-by contributors included
// (a CI bot and a person who fixed one typo don't add a day of team capacity). Excluded by structure, not
// a name list: a bot ("[bot]" in the name or email, a noreply bot address, or a dependabot/renovate/
// github-actions identity) never counts; a human under `threshold.capacityMinCommits` commits in the
// window (default 3), or active on only one day, counts as a drive-by, not a team member. Needs actual
// per-author commit counts/active days, which status.json doesn't carry (just which refs an author
// touched) - one extra `git log` pass over `threshold.capacityWindowDay` days (default 30), not per author.
const BOT_RE = /\[bot\]|dependabot|renovate|github-actions/i;
function capacityFromGit() {
  if (!K.repo || !K.ref) return null;
  let raw;
  try { raw = git("log", `--since=${ES.capacityWindowDay}.days`, "--no-merges", "--format=%an%x1f%ae%x1f%ad", "--date=short", K.ref); } catch { return null; }
  const byAuthor = new Map();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [an, ae, ad] = line.split("\x1f");
    if (!an) continue;
    if (!byAuthor.has(an)) byAuthor.set(an, { email: ae, commit: 0, days: new Set() });
    const e = byAuthor.get(an); e.commit++; e.days.add(ad);
  }
  let bots = 0, driveBy = 0, regular = 0;
  for (const [an, e] of byAuthor) {
    if (BOT_RE.test(an) || BOT_RE.test(e.email || "")) { bots++; continue; }
    if (e.commit < ES.capacityMinCommits || e.days.size <= 1) { driveBy++; continue; }
    regular++;
  }
  const excluded = bots + driveBy;
  return { suggested_day: regular * 5, applied: false, regular, bots, driveBy, windowDay: ES.capacityWindowDay,
    source: `capacity: ${regular} regular author${regular === 1 ? "" : "s"} (${excluded} excluded: ${bots} bot${bots === 1 ? "" : "s"}, ${driveBy} drive-by)` };
}

let capacityInfo = null;
if (capacityDay != null && Number.isFinite(capacityDay)) {
  let remaining = capacityDay, exceeding = [], keep = [];
  for (const i of waves["Now"]) { if (i.day <= remaining) { keep.push(i); remaining -= i.day; } else exceeding.push(i); }
  waves["Now"] = keep; waves["After"].push(...exceeding); waves["After"].sort((a, b) => b.score - a.score);
  capacityInfo = { day: capacityDay, applied: true, used: +(capacityDay - remaining).toFixed(1), exceeding: exceeding.map(t => t.title) };
} else if (statusGroups.length || statusPrs.length) {
  capacityInfo = capacityFromGit();
  if (!capacityInfo) { // repo unreadable: fall back to the old, unfiltered count rather than showing nothing
    const authors = new Set([...statusGroups.flatMap(g => g.who || []), ...statusPrs.map(p => p.a)]);
    capacityInfo = { suggested_day: authors.size * 5, applied: false, source: `status.json: ${authors.size} authors x 5 days (repo unreadable, bots/drive-by not excluded)` };
  }
}

// ---- Output ----
const inputs = { lowHanging: !!low, status: !!statusJson, signal: !!signalsJson, size: !!sizeV, matrix: matrixRecognized, decisions: decisionBlock.length > 0 };
const formula = "Score = Value x Confidence / Effort. Value = psst score + demand (customer count, or log2(1+request count) if none) + rival count + backend bonus (+2 full/+1 partial). Confidence = number of evidence types (backend/request, demand, rival, git), 1-4. Effort = size.json's estimate, otherwise psst effort (S=1,M=2,L=3), otherwise the default M.";
const Description = { "Now": "screen-only work / the existing backend is enough", "When code lands": "the backend or a linked task is in an open PR", "Needs backend": "widespread among rivals, no backend evidence", "Open requests": "asked for: an issue opened against us, or an open item on the team's own list; which wave it enters is the owner's call", "Documentation fix": "the request doc's status is stale versus the code; update the doc (not roadmap work)", "After": "didn't fit a wave rule, or exceeded capacity" };
const outsideList = [...outside.values()];

let o = `# Waves · ${new Date().toISOString().slice(0, 10)} · ${pm}\n\n${formula}\n\n`;
const missing = Object.entries(inputs).filter(([, v]) => !v).map(([k]) => k);
o += missing.length ? `Missing input: ${missing.join(", ")} (that component counted as neutral).\n\n` : "All inputs present.\n\n";
for (const name of Order) {
  const list = waves[name]; o += `## ${name} (${list.length}) — ${Description[name]}\n\n`;
  if (!list.length) { o += "—\n\n"; continue; }
  o += `| # | Score | Effort | Confidence | Work | Why now |\n|---|---|---|---|---|---|\n`;
  list.slice(0, 5).forEach((i, n) => { const r = (i.checked ? "✓ " : "") + i.reason_now.replace(/\|/g, "/"); const why = r.length > 160 ? `${r.slice(0, 159)}…` : r; o += `| ${n + 1} | ${i.score} | ${i.effort} | ${i.confidence} | ${i.title.replace(/\|/g, "/")}${i.who_suggestion ? ` (${i.who_suggestion})` : ""} | ${why} |\n`; });
  o += "\n";
}
o += `## Waiting on the owner's decision (${ownerDecisionOf.length})\n\n${ownerDecisionOf.map(s => `- ${s.title}${s.ref ? ` (${s.ref})` : ""}: ${s.reason} — ${s.source}`).join("\n") || "—"}\n\n`;
o += `## Outside / not doing (${outsideList.length})\n\n${outsideList.map(d => `- ${d.title}: ${d.reason} (${[...d.sources].join(", ")})`).join("\n") || "—"}\n\n`;
o += capacityInfo ? (capacityInfo.applied ? `Capacity: ${capacityInfo.day} days given, ${capacityInfo.used} days used in Now${capacityInfo.exceeding.length ? `, overflow -> After: ${capacityInfo.exceeding.join(", ")}` : ""}.\n` : `No capacity given; suggested ${capacityInfo.suggested_day} days (${capacityInfo.source}), not applied.\n`) : "Capacity: no status.json, couldn't compute a suggestion.\n";
process.stdout.write(o);

// --md: the scripted section of a hand-written waves doc. Headings drop one level so they don't collide with the doc's own "## Wave" headings.
if (mdOut) {
  const Marker = "<!-- nosy:build-waves -->", Last = "<!-- /nosy:build-waves -->";
  const body = o.replace(/^# .*\n+/, "").replace(/^## /gm, "### ");
  const block = `${Marker}\n## From the script · ${new Date().toISOString().slice(0, 10)} (\`build-waves.mjs\`, not hand-edited)\n\n${body.trim()}\n${Last}`;
  let md = ""; try { md = fs.readFileSync(mdOut, "utf8"); } catch {}
  const i = md.indexOf(Marker), j = md.indexOf(Last);
  md = i >= 0 && j > i ? md.slice(0, i) + block + md.slice(j + Last.length) : (md ? md.replace(/\s*$/, "\n\n") : "") + block + "\n";
  fs.writeFileSync((fs.mkdirSync(path.dirname(mdOut), { recursive: true }), mdOut), md);
}

if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({
  type: "waves", generated: new Date().toISOString(), formula, inputs, capacity: capacityInfo,
  waves: Order.map(name => ({ name, description: Description[name], tasks: waves[name] })),
  owner_decision_of: ownerDecisionOf, outside: outsideList.map(d => ({ title: d.title, reason: d.reason, source: [...d.sources].join(", ") }))
}, null, 1));
