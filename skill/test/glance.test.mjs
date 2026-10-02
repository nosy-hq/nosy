// glance.mjs: the page's first screen, built from pm/ with nothing shown empty.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { glance, renderGlance, cut } from "../tools/glance.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
function pm(state, matrix) {
  const root = temporary("nosy-glance-"); dirs.push(root);
  const p = path.join(root, "pm"); fs.mkdirSync(path.join(p, "state"), { recursive: true });
  for (const [f, o] of Object.entries(state)) fs.writeFileSync(path.join(p, "state", f), JSON.stringify(o));
  if (matrix) fs.writeFileSync(path.join(p, "matrix.json"), JSON.stringify(matrix));
  return p;
}
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const M = { steps: [{ no: "1", name: "Rival scan" }, { no: "2", name: "After-commit nudge" }, { no: "3", name: "Self-hosted, open source" }],
  biz: { name: "Cargo", codes: { 1: "y", 2: "y", 3: "n" } },
  products: [{ name: "Acme (suite)", file: "a.md", codes: { 1: { k: "y" }, 2: { k: "n" }, 3: { k: "y" } } },
    { name: "Gone", file: "g.md", statusType: "closed", codes: { 2: { k: "y" } } }] };

test("only-we-have and behind come from active rivals only; bars rank rivals by coverage", () => {
  const G = glance(pm({}, M), { M });
  assert.deepEqual(G.only.map(s => s.no), ["2"]); // the closed rival's 'y' doesn't count
  assert.deepEqual(G.behind.map(s => s.no), ["3"]);
  assert.deepEqual([G.stand.me.score, G.stand.top[0].name, G.stand.top[0].score], [2, "Acme", 2]);
  assert.equal(G.tiles.find(t => t.label === "We're behind").note, "Self-hosted, open source");
});

test("lanes: the owner's calls from the team's own list leave Now; not-doing from outside", () => {
  const p = pm({
    "waves.json": { waves: [{ name: "Now", tasks: [{ title: "Pricing screen", effort: "S", checked: "stands" }, { title: "The CRM trial", effort: "M" }] }], owner_decision_of: [], outside: [{ title: "Task assignment", reason: "knowingly: the owner's standing call" }] },
    "team-next.json": { items: [{ file: "pm/log.md", line: 9, text: "12. The CRM trial: the owner decides when." }] },
  });
  const G = glance(p, { M: null });
  const [now, you, off] = G.lanes;
  assert.deepEqual(now.items.map(i => i.title), ["Pricing screen"]);
  assert.deepEqual(you.items.map(i => [i.title, i.meta]), [["The CRM trial", "pm/log.md:9"]]);
  assert.deepEqual(off.items.map(i => i.meta), ["your standing call"]);
  assert.equal(G.tiles.find(t => t.label === "Waiting on you").value, 1);
});

test("no data → no empty blocks; the hero says how to get a decision", () => {
  const G = glance(pm({}), { M: null });
  assert.deepEqual([G.tiles.length, G.lanes, G.stand, G.shipped], [0, undefined, undefined, undefined]);
  const html = renderGlance(G, { esc });
  assert.match(html, /None yet/); assert.doesNotMatch(html, /gl-tiles|gl-panel/);
});

test("shipped chips: newest first, prefixes dropped, duplicates once", () => {
  const G = glance(pm({ "status.json": { range: "--since 2026-09-22 00:00 main", main: 5, groups: [
    { ref: "internal request 1", last: "09.28 08:22 PM", topic: "log: older thing" },
    { ref: "nb-x", last: "09.29 09:05 AM", topic: "merge side/r83: newest thing" },
    { ref: "nb-y", last: "09.29 09:05 AM", topic: "merge side/r83: newest thing" },
    { ref: "internal request 4", last: "09.28 10:06 PM", topic: "internal request 4: middle thing" }] } }), { M: null });
  assert.deepEqual(G.shipped.tags, ["Newest thing", "Middle thing", "Older thing"]);
  assert.deepEqual([G.shipped.since, G.shipped.commits], ["2026-09-22", 5]);
});

test("every string is cut at a word, with an ellipsis", () => {
  assert.equal(cut("one two three four", 10), "one two…");
  assert.equal(cut("short", 10), "short");
});

test("an empty Now shows the checked work waiting in a later wave", () => {
  const G = glance(pm({ "waves.json": { waves: [{ name: "Now", tasks: [] }, { name: "After", tasks: [{ title: "Field dropped signal", effort: "L", checked: "weakened" }, { title: "Raw idea", effort: "S" }] }], outside: [] } }), { M: null });
  assert.equal(G.lanes[0].name, "Next up");
  assert.deepEqual(G.lanes[0].items.map(i => [i.title, i.size, i.meta]), [["Field dropped signal", "L", "After · checked"]]);
});

// ---- review of the 2 Oct 2026 change set ----
test("declined: the same predicate as read-matrix.mjs and Cloud (`true` or a non-empty reason; whitespace, false and numbers are not decisions; a built step never is)", () => {
  const steps = ["a", "b", "c", "d", "e", "f"].map((n, i) => ({ no: String(i + 1), name: `Step ${n}` }));
  const biz = { name: "Cargo", codes: { 1: "n", 2: "n", 3: "n", 4: "n", 5: "n", 6: "y" }, declined: { 1: "Not for this audience", 2: true, 3: "   ", 4: false, 5: 1, 6: "built anyway" } };
  const Mx = { steps, biz, products: [{ name: "Acme", codes: Object.fromEntries(steps.map(s => [s.no, { k: "y" }])) }] };
  const G = glance(pm({}, Mx), { M: Mx });
  assert.deepEqual(G.stand.strip.map(s => s.kind), ["declined", "declined", "behind", "behind", "behind", "shared"]);
  assert.deepEqual(G.behind.map(s => s.no), ["3", "4", "5"]);
});

test("refsOnly: what the refuter dropped, the decision's why and the text of a decision stay home; the card keeps its title and a fixed reason", () => {
  const p = pm({
    "waves.json": { generated: "2026-10-01T00:00:00Z", waves: [{ name: "Now", tasks: [{ title: "Share links", effort: "M", checked: "weakened", reason_now: "checked by psst (corrected: M: already on side/zq-branch) · src/s.ts:3" }] }], owner_decision_of: [],
      outside: [{ title: "Dropped idea", reason: "refuted after checking: zq-why", source: "psst refuter" }, { title: "Decided idea", reason: "decision: zq-summary", source: "decisions.md" },
        { title: "Matrix idea", reason: "matrix: decided not doing — zq-note", source: "matrix.json" }, { title: "Habit", reason: "knowingly: the owner's standing call (learn.mjs)", source: "learned.json" }] },
  });
  const full = glance(p, { M: null }), safe = glance(p, { M: null, refsOnly: true });
  assert.match(JSON.stringify(full), /zq-why|Dropped idea/, "the owner's own page keeps them");
  const off = safe.lanes.find(l => l.key === "off");
  assert.deepEqual(off.items.map(i => [i.title, i.meta]), [["Decided idea", "decided"], ["Matrix idea", "decided in the matrix"], ["Habit", "your standing call"]]);
  assert.doesNotMatch(JSON.stringify(safe.lanes), /zq-|Dropped idea/);
});

test("the page's own first screen names a decided-against square, in its tooltip and its legend", () => {
  const Mx = { steps: [{ no: "1", name: "Kep" }, { no: "2", name: "Offline" }], biz: { name: "Cargo", codes: { 1: "n", 2: "y" }, declined: { 1: "not for us" } }, products: [{ name: "Acme", codes: { 1: { k: "y" }, 2: { k: "n" } } }] };
  const html = renderGlance(glance(pm({}, Mx), { M: Mx }), { esc });
  assert.match(html, /class="declined" title="1\. Kep: we decided against it"/);
  assert.match(html, /<i class="declined"><\/i>decided against/);
  const none = renderGlance(glance(pm({}, M), { M }), { esc });
  assert.doesNotMatch(none, /decided against/, "no decision, no legend entry");
});
