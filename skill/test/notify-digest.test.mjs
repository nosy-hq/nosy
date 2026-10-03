// The quiet digest in `nosy notify` (news.mjs): rivals whose public signals moved, and one line on whether the roadmap file is behind.
// Both come from optional files other commands write (pm/state/rival-signals.json, pm/state/roadmap.json); the fixtures here are hand-made.
// Quiet: nothing when nothing moved, at most 5 lines added, a rival once. The privacy scan and the stale-psst rule are tested in nosy-cli.test.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs");
const tmp = temporary("nosy-notify-digest-");
after(() => clean(tmp));

const day = n => new Date(Date.now() - n * 864e5).toISOString();
let k = 0;
// A pm/state with one merge (so there is always something to say) plus whatever files the test adds.
function pmWith({ rivals, roadmap, merged = [{ n: 5, title: "Bulk export", merged: day(1).slice(0, 10), ref: null }] } = {}) {
  const pm = path.join(tmp, `pm-${k++}`), st = path.join(pm, "state"); fs.mkdirSync(st, { recursive: true });
  if (merged) fs.writeFileSync(path.join(st, "shipped.json"), JSON.stringify({ recent: { merged, close: [] } }));
  if (rivals !== undefined) fs.writeFileSync(path.join(st, "rival-signals.json"), JSON.stringify(rivals));
  if (roadmap !== undefined) fs.writeFileSync(path.join(st, "roadmap.json"), JSON.stringify(roadmap));
  return pm;
}
const notify = pm => { const r = run(NOSY, ["notify", "--pm", pm]); assert.equal(r.code, 0, r.error); return r.output; };
const sig = (label, value, previous, since = "2026-09-24") => ({ label, value, previous, since });
const road = (generated, now = [1, 2, 3], next = [1, 2], later = [1, 2, 3, 4, 5], shipped = [1, 2, 3, 4]) => ({ generated, sections: { now, next, later, shipped } });

test("rivals whose signals moved get one line each: 10% or 5 units, a numeric `previous`, biggest first, three at most, a rival once", () => {
  const out = notify(pmWith({ rivals: { rivals: [
    { name: "Acme", signals: [sig("GitHub stars", 1200, 1000), sig("releases", 8, 4)] },   // +20% and +100%: the bigger one is the line
    { name: "Bolt", signals: [sig("GitHub stars", 1050, 1000)] },                            // +5%, but 50 units
    { name: "Cobalt", signals: [sig("open issues", 100, 104)] },                             // -4 units, -3.8%: quiet
    { name: "Delta", signals: [{ label: "stars", value: 90 }, { label: "forks", value: 90, previous: "80" }] }, // no numeric previous: never a move
    { name: "Echo", signals: [sig("contributors", 30, 20)] },                                // +50%
    { name: "Foxtrot", signals: [sig("stars", 55, 50), sig("forks", 3, 4)] },                // +10%: forks 25% (1 unit) is the bigger relative one
    { name: "acme", signals: [sig("stars", 2000, 1900)] },                                   // the same rival again: not named twice
  ] } }));
  const lines = out.split("\n").filter(l => /^• .*→/.test(l));
  assert.deepEqual(lines, ["• Acme: releases 4 → 8 (+100%), since 2026-09-24", "• Echo: contributors 20 → 30 (+50%), since 2026-09-24", "• Foxtrot: forks 4 → 3 (-25%), since 2026-09-24"]);
  assert.equal((out.match(/Acme/gi) || []).length, 1);
  assert.doesNotMatch(out, /Bolt|Cobalt|Delta/);
});

test("nothing moved, nothing said: the message is the same with or without the files", () => {
  const plain = notify(pmWith());
  const quiet = notify(pmWith({ rivals: { rivals: [{ name: "Acme", signals: [sig("stars", 1004, 1000), sig("forks", 5, null), { label: "x", value: 1, previous: 1 }] }] }, roadmap: road(day(1)) }));
  assert.doesNotMatch(quiet, /Acme/);
  assert.equal(quiet.split("\n").length - plain.split("\n").length, 2, "only the one current-roadmap line and its blank line");
  assert.match(quiet, /^Roadmap: 3 now, 2 next, 5 later, 4 shipped lately \(current\)$/m);
  // Nothing at all to say, a current roadmap and no movers: still "nothing to say".
  assert.match(notify(pmWith({ merged: null, roadmap: road(day(1)), rivals: { rivals: [] } })), /nothing to say/);
  // Broken or odd files add nothing and never crash it.
  for (const rivals of [[], { rivals: "x" }, { rivals: [null, { name: "A" }, { name: "B", signals: "x" }] }, "text"]) assert.equal(notify(pmWith({ rivals })), plain);
});

test("never more than 5 lines are added, blank one included", () => {
  const plain = notify(pmWith());
  const rivals = { rivals: ["A", "B", "C", "D", "E"].map((n, i) => ({ name: n, signals: [sig("stars", 200 + i * 50, 100)] })) };
  const out = notify(pmWith({ rivals, roadmap: road(day(40)) }));
  assert.equal(out.split("\n").length - plain.split("\n").length, 5);
  assert.equal(out.split("\n").filter(l => /^• .*→/.test(l)).length, 3);
  assert.match(out, /\n• E: .*\n• D: .*\n• C: .*\nRoadmap: .*\n/, "biggest first, then the roadmap line, before the footer");
});

test("roadmap line: the counts, and behind when it is older than two weeks or something merged after it was generated", () => {
  const merged = [{ n: 5, title: "A", merged: "2026-09-25", ref: null }, { n: 6, title: "B", merged: "2026-09-27", ref: null }, { n: 7, title: "C", merged: "2026-09-10", ref: null }];
  assert.match(notify(pmWith({ merged, roadmap: road("2026-09-24T08:00:00Z") })), /^Roadmap: 3 now, 2 next, 5 later, 4 shipped lately \(behind: 2 merges since it was generated\)$/m);
  assert.match(notify(pmWith({ merged: [], roadmap: road(day(20), [], [], [1], []) })), /^Roadmap: 0 now, 0 next, 1 later, 0 shipped lately \(behind: generated 20 days ago\)$/m);
  assert.match(notify(pmWith({ merged: [], roadmap: { sections: { now: [1], next: [], later: [], shipped: [] } } })), /^Roadmap: 1 now, 0 next, 0 later, 0 shipped lately \(behind: no date on the file\)$/m);
  assert.doesNotMatch(notify(pmWith({ roadmap: { generated: day(1) } })), /Roadmap:/, "no sections, no line");
  assert.doesNotMatch(notify(pmWith({ roadmap: { generated: day(1), sections: "x" } })), /Roadmap:/);
});

test("a stale roadmap on its own is news; a current one alone is not", () => {
  const behind = notify(pmWith({ merged: null, roadmap: road(day(30)) }));
  assert.match(behind, /^Roadmap: .*behind: generated 30 days ago/m);
  assert.doesNotMatch(behind, /nothing to say/);
  assert.match(notify(pmWith({ merged: null, roadmap: road(day(2)) })), /nothing to say/);
});

test("the privacy scan still covers the digest: a rival name that holds an e-mail address stops a real send", () => {
  const pm = pmWith({ rivals: { rivals: [{ name: "Acme jamie.fakeperson@mailbox.invalid", signals: [sig("stars", 200, 100)] }] } });
  const r = run(NOSY, ["notify", "--pm", pm, "--slack", "http://127.0.0.1:9/missing"]);
  assert.equal(r.code, 1);
  assert.match(r.error, /not sent/);
  assert.doesNotMatch(r.output, /Slack: (sent|failed)/);
});

test("a stale psst list is still never sent, with the digest around it", () => {
  const pm = pmWith({ rivals: { rivals: [{ name: "Acme", signals: [sig("stars", 200, 100)] }] }, roadmap: road(day(1)) });
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ generated: "2026-01-01T00:00:00Z", items: [{ title: "old item", type: "x" }] }));
  const out = notify(pm);
  assert.doesNotMatch(out, /old item/); assert.match(out, /• Acme: stars 100 → 200 \(\+100%\)/);
});
