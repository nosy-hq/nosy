// tour.mjs. First run on a real product: eight "continue with X" prompts, about ten questions one at a time, and no word
// up front on what Nosy reads, writes or sends. The tour says it first, plans from what pm/ already holds, and asks once.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tour, render, TOKENS_PER_RIVAL } from "../tools/tour.mjs";
import { next } from "../tools/next.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const NOW = Date.parse("2026-10-02T12:00:00Z");
function pmWith(files = {}, K = { repo: ".", ref: "main" }) {
  const root = temporary("nosy-tour-"); dirs.push(root);
  const pm = path.join(root, "pm");
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(pm, f)), { recursive: true }); fs.writeFileSync(path.join(pm, f), typeof c === "string" ? c : JSON.stringify(c)); };
  if (K) put("sources.json", K);
  for (const [f, c] of Object.entries(files)) put(f, c);
  return pm;
}
const at = (pm, f, iso) => { const t = new Date(iso); fs.utimesSync(path.join(pm, f), t, t); };
const step = (R, id) => R.steps.find(s => s.id === id);

test("the welcome says what Nosy reads, writes and sends, before any step", () => {
  const R = tour(pmWith(), { now: NOW });
  assert.equal(R.welcome.length, 3);
  assert.match(R.welcome[0], /^Nosy reads: .*your own `gh` \(read-only\)/);
  assert.match(R.welcome[1], /^Nosy writes: only inside `pm\/`.*`pm\/\.backup\/`.*never touches your code/);
  assert.match(R.welcome[2], /^Nosy sends nothing on its own\./);
  assert.ok(render(R).indexOf("Nosy reads") < render(R).indexOf("The walk"));
});

test("no sources.json: the tour says move-in sets it up and ends with this tour, and plans nothing", () => {
  const R = tour(pmWith({}, null), { now: NOW });
  assert.equal(R.setUp, false);
  assert.deepEqual(R.steps, []);
  assert.match(R.note, /move-in`? sets it up and runs this same tour/);
});

test("a bare pm/: every step is to run, and the questions come as one list: the map, the rival cost, nothing sent", () => {
  const R = tour(pmWith(), { now: NOW });
  assert.deepEqual(R.steps.filter(s => s.state === "todo").map(s => s.id), ["map", "facts", "inventory", "shipped", "psst", "neighbors", "scoop", "tea"]);
  assert.equal(step(R, "publish").state, "skip");
  assert.equal(step(R, "frontyard").state, "skip");
  assert.deepEqual(R.questions.map(q => q.step), ["map", "neighbors"]);
  const n = R.questions.find(q => q.step === "neighbors");
  assert.equal(n.tokens, 3 * TOKENS_PER_RIVAL);
  assert.match(n.question, /top 3 rivals.*294,000 tokens.*proposed, not confirmed/s);
  assert.match(R.summary, /8 steps to run, 2 questions for you, all at once/);
});

test("steps that only read or write Nosy's own files never ask", () => {
  const R = tour(pmWith(), { now: NOW });
  for (const id of ["doctor", "facts", "inventory", "shipped", "psst", "scoop", "tea"]) assert.equal(step(R, id).ask, undefined, id);
  assert.ok(R.steps.filter(s => s.writes === "outside").every(s => ["publish", "roadmap"].includes(s.id)), "only the steps that leave pm/ ask: publish and the roadmap PR");
});

test("what pm/ already holds is not run again: fresh outputs are ✓, and the rival question counts only rivals that changed", () => {
  const pm = pmWith({
    "map.md": "# map", "state/facts.md": "x", "state/inventory.json": {}, "state/shipped.json": { generated: "2026-10-02T08:00:00Z" },
    "state/lowhanging.json": { generated: "2026-10-02T08:00:00Z" }, "state/psst-final.json": { generated: "2026-10-02T09:00:00Z" },
    "state/waves.json": { generated: "2026-10-02T10:00:00Z" }, "page.html": "<html>",
    "rivals/acme.md": "x", "rivals/beta.md": "x", "rivals/gamma.md": "x",
    "state/watch.json": { rivals: [{ slug: "acme", state: "changed" }, { slug: "beta", state: "same" }, { slug: "gamma", state: "error" }] },
  });
  for (const f of ["state/facts.md", "page.html", "rivals/acme.md", "rivals/beta.md", "rivals/gamma.md"]) at(pm, f, "2026-10-02T11:30:00Z");
  const R = tour(pm, { now: NOW });
  assert.deepEqual(R.steps.filter(s => s.state === "todo").map(s => s.id), ["neighbors"]);
  const q = R.questions.find(q => q.step === "neighbors");
  assert.equal(q.tokens, 1 * TOKENS_PER_RIVAL, "one rival changed; the one that couldn't be read isn't counted as research");
  assert.match(R.summary, /1 step to run, 1 question for you/);
});

test("the owner's own token figure replaces the one-run figure and drops the 'from one earlier run' wording", () => {
  const pm = pmWith({}, { repo: ".", ref: "main", tour: { tokensPerRival: 40000 } });
  const q = tour(pm, { now: NOW }).questions.find(q => q.step === "neighbors");
  assert.equal(q.tokens, 120000);
  assert.doesNotMatch(q.question, /earlier run/);
});

test("a Cloud target makes publish a question that says nothing but counts leaves; none, and it's skipped", () => {
  const R = tour(pmWith({}, { repo: ".", ref: "main", cloud: { url: "https://cloud.example.test" } }), { now: NOW });
  const p = step(R, "publish");
  assert.equal(p.writes, "outside");
  assert.match(R.questions.find(q => q.step === "publish").question, /https:\/\/cloud\.example\.test.*Counts and structure only.*publish --dry-run/s);
});

test("approve and done are remembered: an approved question isn't asked again, a done step is ✓, and a second run says resumed", () => {
  const pm = pmWith();
  assert.equal(run(path.join(Tool, "tour.mjs"), [pm, "approve", "neighbors", "map"]).code, 0);
  assert.equal(run(path.join(Tool, "tour.mjs"), [pm, "done", "facts", "all", "good"]).code, 0);
  const R = tour(pm, { now: NOW });
  assert.deepEqual(R.questions, []);
  assert.equal(step(R, "facts").state, "fresh");
  assert.match(step(R, "facts").note, /done in this tour/);
  assert.equal(R.resumed, true);
  const saved = JSON.parse(fs.readFileSync(path.join(pm, "state", "tour.json"), "utf8"));
  assert.deepEqual(saved.approved.sort(), ["map", "neighbors"]);
  assert.equal(saved.notes.facts, "all good");
});

test("an older pm/ shows up as the first step, with the dry-run and undo lines", () => {
  const root = temporary("nosy-tour-old-"); dirs.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(pm);
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main" }));
  fs.writeFileSync(path.join(pm, "urun.md"), "# x\n");
  const R = tour(pm, { now: NOW }), d = step(R, "doctor");
  assert.equal(d.state, "todo");
  assert.match(d.note, /doctor --fix --dry-run.*pm\/\.backup\/.*doctor --undo/s);
});

test("next.mjs sends a set-up repo that hasn't looked yet to the tour, and stops once the tour has started", () => {
  const pm = pmWith();
  assert.equal(next(pm, { now: NOW }).picks[0].command, "tour");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "tour.json"), JSON.stringify({ started: "2026-10-02T00:00:00Z", approved: [], done: [] }));
  assert.notEqual(next(pm, { now: NOW }).picks[0].command, "tour");
});

test("`nosy tour` runs end to end and writes nothing outside pm/state/tour.json", () => {
  const pm = pmWith();
  const r = run(path.join(Tool, "nosy.mjs"), ["tour", "--pm", pm]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Nosy reads:[\s\S]*The walk:[\s\S]*Ask the owner this once, as one message/);
  assert.deepEqual(fs.readdirSync(path.join(pm, "state")), ["tour.json"]);
});

// ---- review of 2 Oct: skip, expiry, grown bills, unknown ids, order against commands/tour.md, nothing created in a pm/ with no sources.json ----
import { STEP_IDS, QUESTION_IDS, TOUR_DAYS } from "../tools/tour.mjs";
const TOUR = path.join(Tool, "tour.mjs");
const aged = (pm, files, iso = "2026-08-01T00:00:00Z") => files.forEach(f => at(pm, f, iso)); // a rival file older than the 30 days after which a tier-A rival is researched again
const savedTour = pm => JSON.parse(fs.readFileSync(path.join(pm, "state", "tour.json"), "utf8"));

test("a question the owner skipped is never asked again: its step reads 'skipped', and a yes can be changed to a skip", () => {
  const pm = pmWith();
  assert.equal(run(TOUR, [pm, "skip", "neighbors"]).code, 0);
  const R = tour(pm, { now: Date.now() });
  assert.deepEqual(R.questions.map(q => q.step), ["map"], "only the map is still open");
  assert.equal(step(R, "neighbors").state, "skip");
  assert.match(step(R, "neighbors").skip, /you chose to skip it/);
  assert.deepEqual(R.skipped, ["neighbors"]);
  assert.match(render(R), /– \/nosy:neighbors +skipped: you chose to skip it/);
  run(TOUR, [pm, "approve", "neighbors"]);
  assert.deepEqual(savedTour(pm).skipped, [], "approve takes it off the skipped list");
  run(TOUR, [pm, "skip", "neighbors"]);
  assert.deepEqual(savedTour(pm).approved, [], "and skip takes it off the approved list");
});

test("a typo is said and recorded nowhere: approve and skip take question ids, done takes step ids", () => {
  const pm = pmWith();
  const a = run(TOUR, [pm, "approve", "neighbours"]);
  assert.equal(a.code, 1); assert.match(a.error, /neighbours: not a question of the tour\. Questions: map, neighbors, publish, roadmap, rival-signals\./);
  const d = run(TOUR, [pm, "done", "psstt"]);
  assert.equal(d.code, 1); assert.match(d.error, /psstt: not a step of the tour\. Steps: doctor, map, facts/);
  assert.equal(fs.existsSync(path.join(pm, "state", "tour.json")), false, "nothing was written");
  assert.equal(run(TOUR, [pm, "bogus"]).code, 1);
  assert.deepEqual(QUESTION_IDS.filter(id => !STEP_IDS.includes(id)), [], "every question belongs to a step");
});

test("a yes belongs to its day: a tour left for more than TOUR_DAYS days starts over, and approving later starts a fresh file", () => {
  const pm = pmWith({ "state/tour.json": { started: "2026-09-20T00:00:00Z", updated: "2026-09-20T00:00:00Z", approved: ["neighbors", "map"], done: ["facts"], skipped: ["publish"] } });
  const R = tour(pm, { now: NOW });
  assert.equal(R.expired, true); assert.equal(R.resumed, false);
  assert.deepEqual(R.questions.map(q => q.step), ["map", "neighbors"], "asked again, in full");
  assert.equal(step(R, "facts").state, "todo", "a done mark from last month doesn't count");
  const young = tour(pmWith({ "state/tour.json": { started: "2026-10-01T12:00:00Z", updated: "2026-10-01T12:00:00Z", approved: ["neighbors", "map"], done: [], skipped: [] } }), { now: NOW });
  assert.equal(young.expired, undefined); assert.deepEqual(young.questions, [], "one day old: still this tour");
  assert.ok(TOUR_DAYS >= 1);
  run(TOUR, [pm, "approve", "map"]);
  const t = savedTour(pm);
  assert.deepEqual(t.approved, ["map"], "the old yes to neighbors did not come back");
  assert.deepEqual(t.done, []);
});

test("a yes given for fewer tokens than the bill now is a different question and is asked again, with the new number", () => {
  const pm = pmWith({ "rivals/a.md": "x", "rivals/b.md": "x", "state/tour.json": { started: new Date().toISOString(), updated: new Date().toISOString(), approved: ["neighbors"], tokens: { neighbors: 50000 }, done: [], skipped: [] } });
  aged(pm, ["rivals/a.md", "rivals/b.md"]);
  const R = tour(pm, { now: Date.now() });
  const q = R.questions.find(x => x.step === "neighbors");
  assert.ok(q, "asked again"); assert.match(q.again, /earlier yes was for fewer tokens/);
  assert.match(render(R), /\(the earlier yes was for fewer tokens\)/);
  const pm3 = pmWith({ "rivals/a.md": "x", "rivals/b.md": "x", "state/tour.json": { started: new Date().toISOString(), updated: new Date().toISOString(), approved: ["neighbors"], tokens: { neighbors: 5e6 }, done: [], skipped: [] } });
  aged(pm3, ["rivals/a.md", "rivals/b.md"]);
  const same = tour(pm3, { now: Date.now() });
  assert.equal(same.questions.find(x => x.step === "neighbors"), undefined, "a yes that covers it stays a yes");
  // `approve` records the figure it was given for.
  const pm2 = pmWith();
  run(TOUR, [pm2, "approve", "neighbors"]);
  assert.equal(savedTour(pm2).tokens.neighbors, 3 * TOKENS_PER_RIVAL);
});

test("a step done in this tour is not asked about, even when its output still reads as old; a corrupt tour.json starts clean", () => {
  const pm = pmWith({ "rivals/a.md": "x" }); aged(pm, ["rivals/a.md"]);
  assert.ok(tour(pm, { now: Date.now() }).questions.some(q => q.step === "neighbors"), "a rival file older than 30 days is researched again: that is a question");
  run(TOUR, [pm, "done", "neighbors"]);
  assert.equal(tour(pm, { now: Date.now() }).questions.some(q => q.step === "neighbors"), false);
  fs.writeFileSync(path.join(pm, "state", "tour.json"), "{ half written");
  const R = tour(pm, { now: Date.now() });
  assert.equal(R.resumed, false);
  assert.equal(run(TOUR, [pm, "approve", "map"]).code, 0, "and approve overwrites it with a good one");
  assert.deepEqual(savedTour(pm).approved, ["map"]);
  fs.writeFileSync(path.join(pm, "state", "tour.json"), JSON.stringify({ started: new Date().toISOString(), approved: "map", done: 7 }));
  assert.doesNotThrow(() => tour(pm, { now: Date.now() }), "arrays that aren't arrays are ignored");
});

test("the steps run in the order commands/tour.md names them, and every step it names exists", () => {
  const md = fs.readFileSync(path.join(Tool, "..", "commands", "tour.md"), "utf8");
  // The steps step 3 lists as "never asked about"; `neighbors` and `publish` are the asked ones, which the doc treats on their own.
  const para = md.split("\n").find(l => /^3\./.test(l)), named = [...para.matchAll(/`([a-z-]+)`/g)].map(m => m[1]).filter(id => STEP_IDS.includes(id) && !["neighbors", "publish"].includes(id));
  assert.ok(named.length >= 7, `step 3 of tour.md names ${named.join(", ")}`);
  const RIVAL = "# Acme\n\n**Latest major announcement:** none\n";
  const R = tour(pmWith({ "../references/acme/competitive.md": RIVAL }, { repo: ".", ref: "main", rivalsPath: "references", frontyard: { path: "index.html" }, cloud: { url: "https://cloud.example.test" } }), { now: NOW });
  const order = R.steps.map(s => s.id).filter(id => named.includes(id));
  assert.deepEqual(order, named, "tour.mjs plans in the order tour.md tells the agent to run");
  for (const id of named) assert.ok(R.steps.some(s => s.id === id), id);
  assert.ok(R.steps.every(s => STEP_IDS.includes(s.id)), "STEP_IDS lists every step tour.mjs can plan");
});

test("the tour writes nothing but pm/state/tour.json: not on a plain run, not in a pm/ with no sources.json, not with --pm before the command", () => {
  const root = temporary("nosy-tour-bare-"); dirs.push(root);
  const bare = path.join(root, "pm"); fs.mkdirSync(bare); fs.writeFileSync(path.join(bare, "notes.md"), "x");
  const r = run(path.join(Tool, "nosy.mjs"), ["tour", "--pm", bare]);
  assert.equal(r.code, 0, r.error); assert.match(r.output, /move-in`? sets it up/);
  assert.deepEqual(fs.readdirSync(bare).sort(), ["notes.md"], "no state/ folder made, no tour.json");
  const pm = pmWith();
  const front = run(path.join(Tool, "nosy.mjs"), ["--pm", pm, "tour"]);
  assert.equal(front.code, 0, front.error); assert.match(front.output, /The walk:/);
  assert.deepEqual(fs.readdirSync(path.join(pm, "state")), ["tour.json"]);
  const approve = run(path.join(Tool, "nosy.mjs"), ["--pm", pm, "tour", "approve", "map"]);
  assert.match(approve.output, /Recorded approve: map/);
  assert.deepEqual(fs.readdirSync(path.join(pm, "state")), ["tour.json"]);
  assert.deepEqual(fs.readdirSync(path.dirname(pm)).sort(), ["pm"], "nothing beside pm/ either");
});

test("a sources.json that is there but won't parse is said to be unreadable (never 'missing'), in the tour and in next.mjs; nothing is written over it", () => {
  const pm = pmWith({}, null); fs.mkdirSync(pm, { recursive: true }); fs.writeFileSync(path.join(pm, "sources.json"), '{ "repo": ".", "ref": ');
  const R = tour(pm, { now: NOW });
  assert.equal(R.setUp, false); assert.equal(R.broken, true); assert.deepEqual(R.steps, []);
  assert.match(R.note, /sources\.json is there but can't be read.*doctor --check.*Nothing is run until it reads/);
  assert.doesNotMatch(R.note, /No .*sources\.json: Nosy doesn't know this repo yet|move-in/);
  const n = next(pm, { now: NOW });
  assert.equal(n.picks[0].command, "doctor"); assert.match(n.picks[0].reason, /is there but can't be read.*doctor --check` says where; Nosy won't write over it/);
  const empty = pmWith({}, null); fs.mkdirSync(empty, { recursive: true });
  assert.equal(next(empty, { now: NOW }).picks[0].command, "move-in", "no file at all is still move-in");
  assert.equal(fs.readFileSync(path.join(pm, "sources.json"), "utf8"), '{ "repo": ".", "ref": ');
  assert.equal(fs.existsSync(path.join(pm, "state")), false);
});

test("roadmap is an opt-in step: skipped without a roadmap key; with one it asks once (it ends in a PR) and is current once the block is newer than the waves", () => {
  assert.equal(tour(pmWith(), { now: NOW }).steps.find(s => s.id === "roadmap").state, "skip");
  const pm = pmWith({}, { repo: ".", ref: "main", roadmap: {} });
  const R = tour(pm, { now: NOW }), s = R.steps.find(x => x.id === "roadmap");
  assert.equal(s.state, "todo");
  assert.equal(s.writes, "outside");
  assert.match(R.questions.find(q => q.step === "roadmap").question, /pull request.*ROADMAP\.md.*merging is the approval/s);
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "waves.json"), JSON.stringify({ generated: "2026-10-02T08:00:00Z", waves: [] }));
  fs.writeFileSync(path.join(pm, "state", "roadmap.md"), "block");
  fs.utimesSync(path.join(pm, "state", "roadmap.md"), new Date("2026-10-02T09:00:00Z"), new Date("2026-10-02T09:00:00Z"));
  assert.equal(tour(pm, { now: NOW }).steps.find(x => x.id === "roadmap").state, "fresh");
});

test("rival-signals is an asked step that only appears with a `signals` block, and goes stale after a week", () => {
  assert.equal(tour(pmWith(), { now: NOW }).steps.find(s => s.id === "rival-signals").state, "skip");
  const pm = pmWith({}, { repo: ".", ref: "main", rivals: { acme: { name: "Acme", signals: { github: "acme/widgets" } }, beta: { name: "Beta" } } });
  const R = tour(pm, { now: NOW }), s = R.steps.find(x => x.id === "rival-signals");
  assert.equal(s.state, "todo");
  assert.match(R.questions.find(q => q.step === "rival-signals").question, /1 rival.*one plain request per address/is);
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "rival-signals.json"), JSON.stringify({ generated: "2026-10-01T12:00:00Z", rivals: [] }));
  assert.equal(tour(pm, { now: NOW }).steps.find(x => x.id === "rival-signals").state, "fresh");
  fs.writeFileSync(path.join(pm, "state", "rival-signals.json"), JSON.stringify({ generated: "2026-09-10T12:00:00Z", rivals: [] }));
  assert.equal(tour(pm, { now: NOW }).steps.find(x => x.id === "rival-signals").state, "todo");
});
