// tour: the first look at a product, in one go, for a repo that is new to Nosy or already has a pm/.
// On the first run on a real product the owner typed "continue with X" eight times and was asked about ten things, one per step, with no
// word up front on what Nosy reads, writes or never sends. This plans the whole walk from what is already in pm/, says the three
// things first (reads / writes / sends), runs nothing itself, and gathers every question into one list so the agent asks once.
//   node tour.mjs <pm> [--json <file>]        the welcome, the steps with their state, the one list of questions
//   node tour.mjs <pm> approve <id>...        record what the owner said yes to (pm/state/tour.json), so a tour that stops resumes
//   node tour.mjs <pm> done <id> [note]       record a finished step
// Steps that only read, or write inside pm/ (Nosy's own files, backed up where one is rewritten), never ask. A step asks only when it
// costs the owner something: model tokens (neighbors), a send outside the machine (publish), or an answer only they have (map).
// The tour runs commands; this file only decides and remembers. Order is inside → fence → ahead → share (SKILL.md).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { readSourcesSafe } from "./sources-file.mjs";
import { pagePath } from "./page-path.mjs";
import { examine } from "./doctor.mjs";
import { nosyCommand } from "./hints.mjs";
import { plan as tierPlan, TOKENS_PER_RIVAL } from "./rival-tiers.mjs";
import { rivalsDir, rivalFiles } from "./sources-file.mjs";

const DAY = 864e5;
// What the tour remembers lives in pm/state/tour.json: { started, updated, approved: [question ids], tokens: { id: figure the yes covered },
// skipped: [question ids], done: [step ids], notes }. A tour that is left for more than TOUR_DAYS days is a new tour: a yes to "spend about N
// tokens" belongs to that day's list of rivals, not to next week's, so approvals, skips and done marks all start over.
export const TOUR_DAYS = 2;
// The ids `approve` / `skip` (a question's id) and `done` (a step's id) accept: a typo is said, never recorded as if it meant something.
export const QUESTION_IDS = ["map", "neighbors", "publish", "roadmap", "rival-signals"];
export const STEP_IDS = ["doctor", "map", "facts", "inventory", "shipped", "psst", "rivals-import", "neighbors", "rival-signals", "scoop", "roadmap", "frontyard", "tea", "publish"];
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
const asOf = f => { const j = readJson(f), g = j?.generated && Date.parse(j.generated); return g || mtime(f); };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const mdFiles = d => { try { return fs.readdirSync(d).filter(f => f.endsWith(".md") && !f.startsWith("_")); } catch { return []; } };

// The first run on a real product: 11 rivals cost 1,079,151 tokens, about 98,000 each (rival-tiers.mjs holds the figure). A figure from one run,
// said as such; the owner's own number (sources.json → tour.tokensPerRival) replaces it.
export { TOKENS_PER_RIVAL };
const list = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
// The saved state, or an empty one when there is none, it is unreadable, or it is older than TOUR_DAYS.
function savedState(pm, now) {
  const j = readJson(path.join(pm, "state", "tour.json")), t = j && Date.parse(j.updated || j.started || "");
  if (!j || typeof j !== "object" || !Number.isFinite(t)) return { saved: {}, expired: !!j };
  if (now - t > TOUR_DAYS * DAY) return { saved: {}, expired: true };
  return { saved: j, expired: false };
}

export function tour(pm, { now = Date.now(), staleDays = 7 } = {}) {
  const K = readSourcesSafe(pm);
  const state = f => path.join(pm, "state", f);
  const { saved, expired } = savedState(pm, now);
  const approved = new Set(list(saved.approved)), done = new Set(list(saved.done)), skipped = new Set(list(saved.skipped));
  const R = { type: "tour", generated: new Date(now).toISOString(), setUp: !!K, welcome: welcome(K), steps: [], questions: [], resumed: !!saved.started, ...(expired ? { expired: true } : {}) };
  if (!K) {
    // A file that is there but won't parse is not "no sources.json": move-in would start over on top of it.
    if (fs.existsSync(path.join(pm, "sources.json"))) { R.broken = true; R.note = `${path.join(pm, "sources.json")} is there but can't be read (it isn't valid JSON, or isn't an object). Fix that spot by hand: \`${nosyCommand("doctor --check")}\` says where. Nothing is run until it reads.`; return R; }
    R.note = `No ${pm}/sources.json: Nosy doesn't know this repo yet. \`/nosy:move-in\` sets it up and runs this same tour at the end.`; return R;
  }

  const step = (id, command, why, st, { writes = "pm", ask = null, skip = null } = {}) => R.steps.push({ id, command, why, state: skip ? "skip" : st, ...(skip ? { skip } : {}), writes, ...(ask ? { ask } : {}) });
  const age = f => { const t = asOf(state(f)); return t ? Math.floor((now - t) / DAY) : null; };

  // 1. An older pm/: renamed first, with a list, a backup and an undo line (doctor.mjs).
  let shape = []; try { shape = examine(pm).findings.filter(f => ["old-name", "old-key", "old-path", "both-names", "old-state"].includes(f.id)); } catch {} // a missing product.md or sources.json is move-in's, not doctor's
  step("doctor", "doctor", shape.length ? `${plural(shape.length, "thing")} from an older Nosy to bring up to date` : "nothing to bring up to date", shape.length ? "todo" : "fresh",
    { writes: "pm", skip: null });
  if (shape.length) R.steps[R.steps.length - 1].note = `Show the list first (\`${nosyCommand("doctor --fix --dry-run")}\`); the fix backs up to pm/.backup/ and \`${nosyCommand("doctor --undo")}\` puts it back.`;

  // 2. The map: the owner's own answers, so it's a question, but it is the one the answers depend on.
  const hasMap = fs.existsSync(path.join(pm, "map.md"));
  step("map", "map", hasMap ? "pm/map.md is there" : "no product map: what's live, beta or retired, what's off on purpose", hasMap ? "fresh" : "todo", { writes: "pm",
    ask: hasMap ? null : { id: "map", kind: "answers", question: "A few questions (at most 4) about what's live, beta or retired, and anything off on purpose: answer now, or skip and I'll draft the map from the code and mark it unconfirmed?" } });

  // 3. What Nosy knows from git and the issues, no model.
  const factsAge = age("facts.md");
  step("facts", "facts", factsAge == null ? "the product's hard facts aren't built yet (commits by person, kind and area; unmerged branches)" : `facts are ${plural(factsAge, "day")} old`, factsAge == null || factsAge >= 1 ? "todo" : "fresh", { writes: "pm" });
  // The file being there is not the step having worked: an inventory that found no backend wrote the file too (field-test hunt: the tour said "✓ the backend's endpoints are listed").
  const inv = readJson(state("inventory.json"));
  step("inventory", "inventory", !inv && !fs.existsSync(state("inventory.json")) ? "the backend's endpoints aren't listed yet" : inv?.backend_missing ? "ran, and found no backend in this repo (if it lives elsewhere, `inventory.backend` in sources.json says where)" : "the backend's endpoints are listed",
    fs.existsSync(state("inventory.json")) ? "fresh" : "todo", { writes: "pm" });
  const shippedAge = Math.min(...["shipped.json", "status.json"].map(f => age(f) ?? 1e9));
  step("shipped", "shipped", shippedAge >= 1e9 ? "no record of what shipped yet" : `the record is ${plural(shippedAge, "day")} old`, shippedAge >= staleDays ? "todo" : "fresh", { writes: "pm" });

  // 4. Cheap wins, checked by the refuter before the owner sees them.
  const psstAge = age("lowhanging.json"), finalAt = asOf(state("psst-final.json")), psstAt = asOf(state("lowhanging.json"));
  const checked = finalAt && psstAt && finalAt >= psstAt - 1000;
  step("psst", "psst", psstAge == null ? "no list of cheap wins yet" : !checked ? "the list isn't checked by the refuter yet" : `the checked list is ${plural(psstAge, "day")} old`, psstAge == null || psstAge >= staleDays || !checked ? "todo" : "fresh",
    { writes: "pm" });
  R.steps[R.steps.length - 1].note = "Includes the refuter and the local-work check (work already on your own branches is not listed as new).";

  // 5. Rivals: the one step that spends model tokens, so the one that asks, with the number in the question.
  // Rival research the team already keeps elsewhere (sources.json rivalsPath): copied in first, so nothing starts from zero.
  const outside = rivalsDir(pm, K), inPm = path.join(pm, "rivals");
  if (path.resolve(outside) !== path.resolve(inPm)) {
    const there = rivalFiles(outside, { nested: true }).length, have = mdFiles(inPm).length;
    step("rivals-import", "rivals-import", there ? `${plural(there, "rival file")} already in ${path.relative(path.dirname(pm), outside) || outside}, ${have ? `${have} in pm/rivals` : "none in pm/rivals yet"}` : "no rival files in the folder you named", there && !have ? "todo" : "fresh", { writes: "pm" });
    if (there && !have) R.steps[R.steps.length - 1].note = `Copies, never moves: \`${nosyCommand("rivals-import --dry-run")}\` lists first.`;
  }
  const files = mdFiles(inPm), watch = readJson(state("watch.json"))?.rivals || [];
  const per = +K.tour?.tokensPerRival || TOKENS_PER_RIVAL, fromOwner = !!K.tour?.tokensPerRival;
  const where = (tokens, count) => `about ${tokens.toLocaleString("en")} tokens${fromOwner ? "" : ", from one earlier run of about " + per.toLocaleString("en") + " each"}`;
  const free = `the free scan (\`${nosyCommand("watch")}\`) finds which of ${plural(watch.length || files.length, "rival")} changed, no model`;
  if (!files.length) step("neighbors", "neighbors", "no rival files yet: nothing says what rivals shipped", "todo", { writes: "pm",
    ask: { id: "neighbors", kind: "tokens", question: `Research the top 3 rivals I find (${where(3 * per, 3)})? ${free.charAt(0).toUpperCase() + free.slice(1)}. Rivals I propose are marked "proposed, not confirmed" until you say so.`, tokens: 3 * per } });
  else {
    // Tiers (rival-tiers.mjs): only tier A rivals that changed or went stale get a deep pass, tier C a thin read, tier B is only watched.
    const T = tierPlan(pm), A = T.tiers.A.needsWork.length, C = T.tiers.C.needsWork.length, b = T.tiers.B.changed?.length || 0, unread = watch.filter(r => /^(error|unreachable|no pages)$/i.test(r.state || "")).length;
    if (!A && !C) step("neighbors", "neighbors", `${plural(files.length, "rival")} read, none changed or stale${b ? `; ${plural(b, "watch-only rival")} changed (reported, not researched)` : ""}`, "fresh", { writes: "pm" });
    else step("neighbors", "neighbors", `${plural(A, "rival")} to research (changed or older than 30 days)${C ? `, ${plural(C, "reference")} for a thin read` : ""}${b ? `, ${plural(b, "watch-only rival")} changed` : ""}${unread ? `, ${unread} not readable` : ""}`, "todo", { writes: "pm",
      ask: { id: "neighbors", kind: "tokens", question: `Research ${plural(A, "rival")}${C ? ` and take a thin look at ${plural(C, "reference")}` : ""} (${where(T.tokens, A + C)}); the rest are unchanged and are not read?`, tokens: T.tokens } });
    if (T.suggestions.length) R.steps[R.steps.length - 1].note = T.suggestions.map(x => x.text).join(" ");
  }

  // Growth signals (rival-signals.mjs): public numbers (GitHub, npm, App Store, job boards) for the rivals that have a `signals` block. It reaches the
  // network (one GET per address), so it asks; with nothing configured it says how to start.
  const withSignals = Object.values(K.rivals && typeof K.rivals === "object" ? K.rivals : {}).filter(r => r && typeof r === "object" && r.signals && typeof r.signals === "object").length;
  const sigAge = age("rival-signals.json");
  step("rival-signals", "rival-signals", !withSignals ? "no rival has a `signals` block yet" : sigAge == null ? `${plural(withSignals, "rival")} to read, never read` : `read ${plural(sigAge, "day")} ago`, withSignals && (sigAge == null || sigAge >= staleDays) ? "todo" : "fresh",
    { writes: "pm", skip: withSignals ? null : `optional: \`${nosyCommand("rival-signals init")}\` proposes what to watch (GitHub, npm, App Store, job boards)`,
      ask: withSignals ? { id: "rival-signals", kind: "network", question: `Read public growth signals for ${plural(withSignals, "rival")} (GitHub stars and releases, npm downloads, App Store ratings, open roles)? One plain request per address, no model, nothing of yours leaves; \`${nosyCommand("rival-signals run")}\`.` } : null });

  // 6. Roadmap, page, and the landing page when there is one.
  const wavesAt = asOf(state("waves.json"));
  step("scoop", "scoop", !wavesAt ? "no roadmap waves yet" : psstAt && psstAt > wavesAt + 1000 ? "the list changed since the waves were built" : "waves are current", !wavesAt || (psstAt && psstAt > wavesAt + 1000) ? "todo" : "fresh", { writes: "pm" });
  // The roadmap in the repo (roadmap.mjs): opt-in (a `roadmap` key), and it ends in a pull request, so it asks.
  const roadmapAt = asOf(state("roadmap.md")), roadmapOn = !!K.roadmap;
  step("roadmap", "roadmap", !roadmapOn ? "not set up" : !roadmapAt ? "no roadmap block built yet" : wavesAt && wavesAt > roadmapAt + 1000 ? "the waves changed since the block was built" : "the block is current", roadmapOn && (!roadmapAt || (wavesAt && wavesAt > roadmapAt + 1000)) ? "todo" : "fresh",
    { writes: "outside", skip: roadmapOn ? null : "optional: a `roadmap` key in sources.json (Now / Next / Later as a pull request on ROADMAP.md)",
      ask: roadmapOn ? { id: "roadmap", kind: "send", question: `Open a pull request that updates the roadmap block in ${K.roadmap.path || "ROADMAP.md"}? It pushes a branch and opens a PR in your repo; merging is the approval, and only the block changes (\`${nosyCommand("roadmap")}\` shows it first).` } : null });
  const V = K.frontyard;
  const fy = readJson(state("frontyard.json")), fyMissing = !!(fy && fy.page_missing);
  step("frontyard", "frontyard", fyMissing ? "couldn't read the landing page (`frontyard.path` isn't in the repo, or `frontyard.url` hasn't been fetched and saved to pm/state/frontyard-page.html)" : "shipped features against the landing page", asOf(state("frontyard.json")) && !fyMissing ? "fresh" : "todo", { writes: "pm", skip: V && (V.path || V.url) ? null : "no landing page set in sources.json" });
  const pageAt = mtime(pagePath(pm, K).path), dataAt = Math.max(0, ...["shipped.json", "lowhanging.json", "waves.json"].map(f => asOf(state(f)) || 0));
  step("tea", "tea", !pageAt ? "no page yet" : dataAt > pageAt + 1000 ? "the page is older than what Nosy knows" : "the page is current", !pageAt || dataAt > pageAt + 1000 ? "todo" : "fresh", { writes: "pm" });

  // 7. Share: leaves the machine, so it asks, and says what goes.
  const target = process.env.NOSY_CLOUD_URL || K.cloud?.url;
  step("publish", "publish", target ? "counts and structure to your Nosy Cloud dashboard" : "no Cloud target", "todo", { writes: "outside",
    skip: target ? null : "no Cloud target (optional: `cloud.url` in sources.json)",
    ask: target ? { id: "publish", kind: "send", question: `Send the dashboard files to ${target}? Counts and structure only: no commit subjects, author names, issue titles or customer quotes; \`${nosyCommand("publish --dry-run")}\` shows exactly what.` } : null });

  // Questions, once. An answer already recorded (tour.json) isn't asked again: a yes, a "skip these", or a step already done in this tour.
  // The one exception is a yes that no longer covers the question: it was given for a token figure and the figure has grown since (more rivals
  // changed), so that is a different question and is asked again, with the new number.
  const grown = q => q.tokens != null && saved.tokens && Number.isFinite(saved.tokens[q.id]) && q.tokens > saved.tokens[q.id];
  for (const s of R.steps) if (done.has(s.id) && s.state === "todo") s.state = "fresh", s.note = `${s.note ? s.note + " " : ""}(done in this tour)`;
  for (const s of R.steps) if (s.ask && s.state === "todo" && skipped.has(s.ask.id)) { s.state = "skip"; s.skip = "you chose to skip it"; R.skipped = [...(R.skipped || []), s.id]; }
  for (const s of R.steps) if (s.ask && s.state === "todo" && (!approved.has(s.ask.id) || grown(s.ask))) R.questions.push({ step: s.id, ...s.ask, ...(approved.has(s.ask.id) ? { again: "the earlier yes was for fewer tokens" } : {}) });
  const todo = R.steps.filter(s => s.state === "todo");
  R.summary = todo.length ? `${plural(todo.length, "step")} to run, ${R.questions.length ? plural(R.questions.length, "question") + " for you, all at once" : "no questions"}.` : "Nothing to do: every step is current. `stakeout` is the weekly run.";
  return R;
}

// What the owner is told before anything runs: three sentences about their data, then the walk.
export function welcome(K) {
  const lang = K?.language && !/^en/i.test(K.language) ? K.language : null;
  const L = [
    "Nosy reads: your git history and branches, your issues and PRs through your own `gh` (read-only), the docs and decision files you pointed it at, and public rival pages.",
    "Nosy writes: only inside `pm/`, Nosy's own folder. Before it rewrites one of its files it keeps a copy in `pm/.backup/`. It never touches your code, your repo or the text of your notes.",
    "Nosy sends nothing on its own. The only things that leave your machine are the ones you say yes to below: reading public rival pages, and (if you set a Cloud target) `publish`, which sends counts and structure, never quotes.",
  ];
  if (lang) L.push(`Say all of this to the owner in ${lang}, product words first.`);
  return L;
}

export function render(R, { prefix = "/nosy:" } = {}) {
  const out = ["Psst… the first look, in order.", "", ...R.welcome.map(l => `  ${l}`), ""];
  if (R.note) return [...out, R.note].join("\n");
  const sym = { fresh: "✓", todo: "→", skip: "–" };
  out.push("The walk:");
  for (const s of R.steps) out.push(`  ${sym[s.state]} ${prefix}${s.command.padEnd(9)} ${s.state === "skip" ? `skipped: ${s.skip}` : s.why}${s.writes === "outside" && s.state !== "skip" ? "  [leaves your machine]" : ""}${s.note ? `\n      ${s.note}` : ""}`);
  out.push("", R.summary);
  if (R.questions.length) {
    out.push("", "Ask the owner this once, as one message (not one question per step):");
    R.questions.forEach((q, i) => out.push(`  ${i + 1}. ${q.question}${q.again ? ` (${q.again})` : ""}`));
    out.push("", `Record the answers: \`${nosyCommand("tour approve " + R.questions.map(q => q.id).join(" "))}\` (the ones they said yes to) and \`${nosyCommand("tour skip <id>")}\` (the ones they said no to: it is not asked again, and is said at the end).`);
  }
  out.push("", "Run the todo steps in the order shown; a read-only or pm-only step never needs asking about. After each: " + `\`${nosyCommand("tour done <id>")}\`. Then the first report (move-in.md step 8, the six parts).`);
  return out.join("\n");
}

// Reads, changes and writes pm/state/tour.json, the only file this tool writes. An old or unreadable one starts a new tour (see TOUR_DAYS).
function save(pm, mutate, now = Date.now()) {
  const f = path.join(pm, "state", "tour.json"), { saved } = savedState(pm, now);
  const cur = { started: saved.started || new Date(now).toISOString(), approved: list(saved.approved), skipped: list(saved.skipped), done: list(saved.done),
    tokens: saved.tokens && typeof saved.tokens === "object" ? saved.tokens : {}, ...(saved.notes && typeof saved.notes === "object" ? { notes: saved.notes } : {}) };
  mutate(cur); cur.updated = new Date(now).toISOString();
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(cur, null, 1));
  return cur;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), prefix = take("--prefix") ?? "/nosy:";
  const [pm = "pm", cmd, ...rest] = argv, bad = m => { console.error(m); process.exit(1); };
  if (cmd === "approve" || cmd === "skip" || cmd === "done") {
    if (!rest.length) bad(`usage: tour.mjs <pm> ${cmd} <id>...`);
    if (!fs.existsSync(pm)) bad(`no folder at ${pm}`);
    const ids = cmd === "done" ? [rest[0]] : rest, ok = cmd === "done" ? STEP_IDS : QUESTION_IDS, unknown = ids.filter(id => !ok.includes(id));
    if (unknown.length) bad(`${unknown.join(", ")}: not ${cmd === "done" ? "a step" : "a question"} of the tour. ${cmd === "done" ? "Steps" : "Questions"}: ${ok.join(", ")}.`);
    // A yes is recorded with the token figure it was given for, so a bigger bill later is asked about again.
    const asked = cmd === "approve" ? Object.fromEntries(tour(pm).questions.filter(q => q.tokens != null).map(q => [q.id, q.tokens])) : {};
    const t = save(pm, c => {
      for (const id of ids) {
        if (cmd === "done") { if (!c.done.includes(id)) c.done.push(id); }
        else if (cmd === "approve") { if (!c.approved.includes(id)) c.approved.push(id); c.skipped = c.skipped.filter(x => x !== id); if (asked[id] != null) c.tokens[id] = asked[id]; }
        else { if (!c.skipped.includes(id)) c.skipped.push(id); c.approved = c.approved.filter(x => x !== id); delete c.tokens[id]; }
      }
      if (cmd === "done" && rest[1]) (c.notes ||= {})[rest[0]] = rest.slice(1).join(" ");
    });
    console.log(`Recorded ${cmd}: ${ids.join(", ")}. Approved: ${t.approved.join(", ") || "none"} · skipped: ${t.skipped.join(", ") || "none"} · done: ${t.done.join(", ") || "none"}.`);
  } else if (cmd !== undefined) bad(`usage: tour.mjs <pm> [approve <id>... | skip <id>... | done <id> [note]] [--json <file>]`);
  else {
    const R = tour(pm);
    if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1)); }
    console.log(render(R, { prefix }));
    // The tour has started: a second run says "resumed". A tour left for more than TOUR_DAYS days starts over (its old yeses don't carry).
    if (R.setUp && fs.existsSync(pm) && (!R.resumed || R.expired)) save(pm, c => { if (R.expired) { c.started = new Date().toISOString(); c.approved = []; c.skipped = []; c.done = []; c.tokens = {}; delete c.notes; } });
  }
}
