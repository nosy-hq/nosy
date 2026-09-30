// Contract tests for internal request 77a (demand × readiness by default): skill/tools/demand.mjs, the demand column
// and ranking in lowhanging (psst), the Demand section in canwe, and `nosy psst` running collect-signals when
// pm/signal/ has files. Fake product "Cargo" + fake `gh` (no network). signals.json is hand-written for the psst and
// canwe tests so they don't depend on collect-signals' own matching.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";
import { demandFor, demandForQuestion, demandLine, demandInputs } from "../tools/demand.mjs";

let K, gh, tmp;
before(async () => { K = await fakeProductSetup(); gh = fakeGhSetup(K.gh); tmp = temporary("nosy-demand-"); });
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

const goal = (o) => ({ type: "psst", ref: null, count: 1, customer: 1, first: "2026-06-01", last: "2026-09-20", trend: { last30: 1, previous30: 0 }, ready: false, notDoing: false, examples: [], ...o });
const signalsWrite = (pm, goals) => { fs.mkdirSync(path.join(pm, "state"), { recursive: true }); fs.writeFileSync(path.join(pm, "state", "signals.json"), JSON.stringify({ type: "signal", generated: "2026-09-28T10:00:00Z", total: 20, goals }, null, 1)); };

test("demandFor: ref first, then exact title, then strong word overlap; unsure → null", () => {
  const D = { goals: [goal({ ref: "§21", title: "§21 shipments · 1 field", count: 9 }), goal({ title: "Bulk export of shipments to CSV", count: 4 }), goal({ title: "Invoice PDF archive", count: 2 })] };
  assert.equal(demandFor(D, { ref: "§21", title: "anything" }).count, 9);
  assert.equal(demandFor(D, { title: "Bulk export of shipments to CSV (in #601)" }).count, 4, "PR suffix is ignored");
  assert.equal(demandFor(D, { title: "shipments bulk export screen" }).count, 4, "3 of 4 roots overlap");
  assert.equal(demandFor(D, { title: "Route optimization" }), null);
  assert.equal(demandFor(null, { title: "x" }), null);
});

test("demandLine reads like a sentence; old `ilk` field still works", () => {
  assert.equal(demandLine(goal({ count: 14, customer: 6, first: "2026-03-02", trend: { last30: 5, previous30: 2 } })),
    "asked 14 times by 6 customers since 2026-03-02 · rising (5 in the last 30 days, 2 before)");
  assert.match(demandLine({ count: 1, ilk: "2026-01-05" }), /^asked 1 time since 2026-01-05$/);
});

test("demandForQuestion matches a free-text question against titles and masked examples", () => {
  const D = { goals: [goal({ title: "Toplu dışa aktarma", count: 5, examples: [{ text: "we need bulk export to excel" }] }), goal({ title: "Barcode scanning", count: 3 })] };
  assert.deepEqual(demandForQuestion(D, "bulk export").map(g => g.count), [5]);
  assert.deepEqual(demandForQuestion(D, "dark mode"), []);
});

test("psst: an asked-for item gets the demand column, +1 value, and ranks above an equal item without demand", () => {
  const pm = path.join(tmp, "pm-psst"); fs.cpSync(K.pm, pm, { recursive: true });
  const first = path.join(tmp, "low1.json");
  assert.equal(run(path.join(Tool, "lowhanging.mjs"), [pm, "--json", first], { env: gh.env }).code, 0);
  const before = JSON.parse(fs.readFileSync(first, "utf8")).items;
  // Pick the lowest-ranked item that shares its score with an item above it, and give it demand.
  const target = [...before].reverse().find(i => before.some(j => j !== i && j.score === i.score));
  assert.ok(target, "fixture has two items with the same score");
  signalsWrite(pm, [goal({ title: target.title, count: 7, customer: 3 })]);
  const second = path.join(tmp, "low2.json");
  const r = run(path.join(Tool, "lowhanging.mjs"), [pm, "--json", second], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  const after = JSON.parse(fs.readFileSync(second, "utf8"));
  const t = after.items.find(i => i.title === target.title);
  assert.deepEqual({ count: t.demand.count, customer: t.demand.customer }, { count: 7, customer: 3 });
  assert.match(t.detail[0], /^Demand: asked 7 times by 3 customers/);
  // Every asked-for item in the score group comes before every item in it that nobody asked for. (The fixture's
  // "Bulk export" matrix row and "§3 Bulk export" request item are the same feature, so both pick up the demand.)
  const peers = after.items.filter(i => i.score === t.score), lastAsked = peers.map(i => !!i.demand).lastIndexOf(true), firstNot = peers.findIndex(i => !i.demand);
  assert.ok(firstNot === -1 || lastAsked < firstNot, "asked-for items lead their score group");
  const nobodyAsked = after.items.filter(i => !i.demand && i.score === t.score).map(i => after.items.indexOf(i));
  assert.ok(nobodyAsked.every(ix => ix > after.items.indexOf(t)), "ranked above equal-score items nobody asked for");
  assert.match(r.output, /\| Asked for \|/); assert.match(r.output, /7× · 3 cust\./);
  assert.equal(after.demand.goals, 1);
});

test("psst without demand data says how to get it", () => {
  const r = run(path.join(Tool, "lowhanging.mjs"), [K.pm], { env: gh.env });
  assert.match(r.output, /No demand data yet/);
});

test("canwe: Demand section with the count next to the size, and in the suggested verdict", () => {
  const pm = path.join(tmp, "pm-canwe"); fs.cpSync(K.pm, pm, { recursive: true });
  signalsWrite(pm, [goal({ title: "Bulk export of shipments", count: 5, customer: 4, examples: [{ text: "please add bulk export" }] })]);
  const r = run(path.join(Tool, "canwe.mjs"), [pm, "bulk export", "export"]);
  assert.equal(r.code, 0, r.error);
  const sec = (r.output.match(/## Demand\n\n([\s\S]*?)\n\n## /) || [])[1] || "";
  assert.match(sec, /asked 5 times by 4 customers/);
  assert.match(r.output, /Customers asked for it: asked 5 times/);
  assert.ok(r.output.indexOf("## Demand") < r.output.indexOf("## Suggested verdict"));
});

test("nosy psst runs collect-signals when pm/signal/ has files, then ranks with demand", () => {
  const pm = path.join(tmp, "pm-cli"); fs.cpSync(K.pm, pm, { recursive: true });
  assert.deepEqual(demandInputs(pm, {}), []);
  fs.mkdirSync(path.join(pm, "signal"));
  fs.writeFileSync(path.join(pm, "signal", "support.csv"), "date,customer,text\n2026-09-20,a@x.test,We need bulk export of shipments to CSV\n2026-09-21,b@y.test,bulk export shipments please\n");
  assert.equal(demandInputs(pm, {}).length, 1);
  const r = run(path.join(Tool, "nosy.mjs"), ["psst", "--pm", pm], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  assert.ok(fs.existsSync(path.join(pm, "state", "signals.json")), "signals.json written");
  const L = JSON.parse(fs.readFileSync(path.join(pm, "state", "lowhanging.json"), "utf8"));
  assert.ok(L.demand, "psst's JSON records that demand data was read");
});
