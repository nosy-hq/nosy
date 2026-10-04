// rival-tiers.mjs: tier A deep / B watch only / C reference, who needs work now, what it costs.
// A throwaway pm/ with rival files whose ages are set with utimes; no network, no model.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { plan, render, record, watchState, tierOf, TOKENS_PER_RIVAL } from "../tools/rival-tiers.mjs";

// A rival file that has been researched: a coded matrix row and a source. (A bare "# Name" is a new stub, which needs work however new it is.)
const RESEARCHED = name => `# ${name}\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Export | y | https://example.com/docs |\n\n## Sources\n- https://example.com/docs (2026-10-01)\n`;

const dirs = [], T = path.join(Tool, "rival-tiers.mjs"), NOSY = path.join(Tool, "nosy.mjs");
after(() => dirs.forEach(clean));
const NOW = Date.parse("2026-10-02T12:00:00Z"), DAY = 864e5;

// rivals: { slug: { tier?, name?, age (days, omit = no file) } }
function pmWith(rivals, { watch, sources = {}, log } = {}) {
  const root = temporary("nosy-tiers-"); dirs.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "rivals"), { recursive: true }); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const reg = {};
  for (const [slug, R] of Object.entries(rivals)) {
    reg[slug] = { name: R.name || slug.toUpperCase(), ...(R.tier !== undefined ? { tier: R.tier } : {}) };
    if (R.age !== undefined) { const f = path.join(pm, "rivals", `${slug}.md`); fs.writeFileSync(f, R.bare ? `# ${reg[slug].name}\n` : RESEARCHED(reg[slug].name)); const t = new Date(NOW - R.age * DAY); fs.utimesSync(f, t, t); }
  }
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ rivals: reg, ...sources }));
  if (watch) fs.writeFileSync(path.join(pm, "state", "watch.json"), JSON.stringify({ type: "watch", generated: watch.generated || "2026-10-01T10:00:00.000Z", rivals: Object.entries(watch.states).map(([slug, state]) => ({ slug, state })) }));
  if (log) { fs.mkdirSync(path.join(pm, "history"), { recursive: true }); fs.writeFileSync(path.join(pm, "history", "watch-states.jsonl"), log.map(x => JSON.stringify(x)).join("\n") + "\n"); }
  return pm;
}
const slugsOf = T => T.rivals.map(r => r.slug);

test("a rival with no tier is A; A needs work when the watch says changed or its file is older than 30 days or missing", () => {
  const pm = pmWith({ fresh: { age: 3 }, moved: { age: 3 }, old: { age: 31 }, edge: { age: 30 }, nofile: {}, broken: { age: 5 } },
    { watch: { states: { fresh: "same", moved: "changed", old: "same", edge: "same", broken: "unreachable" } } });
  const P = plan(pm, { now: NOW });
  assert.deepEqual(slugsOf(P.tiers.A), ["broken", "edge", "fresh", "moved", "nofile", "old"]);
  assert.deepEqual(P.tiers.A.needsWork.sort(), ["moved", "nofile", "old"]);
  const by = s => P.tiers.A.rivals.find(r => r.slug === s);
  assert.deepEqual(by("moved").why, ["its pages changed since the last watch"]);
  assert.deepEqual(by("old").why, ["file 31 days old"]);
  assert.deepEqual(by("nofile").why, ["no rival file yet"]);
  assert.equal(by("broken").watch, "error"); assert.equal(by("broken").needsWork, false, "an unreadable page is not a reason to research on its own");
  assert.equal(P.untiered.length, 6, "all six count as A by default, and the plan says so");
  assert.match(render(P), /6 rivals have no tier yet and count as A/);
});

test("B is never researched: a change is reported only; C is due after 90 days or without a file", () => {
  const pm = pmWith({ watched: { tier: "B", age: 200 }, calm: { tier: "b", age: 1 }, ref1: { tier: "C", age: 91 }, ref2: { tier: "C", age: 89 }, ref3: { tier: "C" } },
    { watch: { states: { watched: "changed", calm: "same" } } });
  const P = plan(pm, { now: NOW });
  assert.deepEqual(P.tiers.B.needsWork, [], "B: nobody needs work, however old the file");
  assert.deepEqual(P.tiers.B.changed, ["watched"]);
  assert.deepEqual(P.tiers.C.needsWork.sort(), ["ref1", "ref3"]);
  assert.equal(P.tiers.B.tokens, 0);
  assert.deepEqual(P.untiered, []);
  const md = render(P);
  assert.match(md, /Changed since the last watch \(reported, not researched\): WATCHED/);
  assert.match(md, /Cost: no model/);
  assert.match(md, /Due \(2\): REF1 \(file 91 days old\); REF3 \(no rival file yet\)/);
});

test("estimates: 98,000 per deep rival said to come from one earlier run, the owner's own figure when set, a thin read at a quarter", () => {
  const rivals = { a1: { tier: "A", age: 40 }, a2: { tier: "A", age: 40 }, a3: { tier: "A", age: 1 }, c1: { tier: "C", age: 100 } };
  const P = plan(pmWith(rivals), { now: NOW });
  assert.equal(TOKENS_PER_RIVAL, 98000);
  assert.deepEqual([P.perRival.tokens, P.tiers.A.tokens, P.tiers.C.tokens, P.tokens], [98000, 196000, 24500, 220500]);
  assert.match(P.perRival.source, /one earlier run/);
  const md = render(P);
  assert.match(md, /about 98,000 tokens per deep rival, from one earlier run/);
  assert.match(md, /Estimate: 2 × 98,000 = about 196,000 tokens/);
  assert.match(md, /This round: about 220,500 tokens\*\* \(2 deep passes \+ 1 thin read\)/);
  const mine = plan(pmWith(rivals, { sources: { tour: { tokensPerRival: 40000 } } }), { now: NOW });
  assert.deepEqual([mine.perRival.tokens, mine.tiers.A.tokens], [40000, 80000]);
  assert.match(mine.perRival.source, /tour\.tokensPerRival/);
  assert.doesNotMatch(render(mine), /set sources\.json `tour\.tokensPerRival`/);
});

test("more than 10 tier-A rivals: a line that suggests Nosy Cloud's scheduled watch for the surplus, nothing blocked", () => {
  const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`r${i}`, { tier: "A", age: 50 }]));
  const P = plan(pmWith(eleven), { now: NOW });
  const s = P.suggestions.find(x => x.kind === "surplus");
  assert.ok(s); assert.equal(s.surplus, 1); assert.match(s.text, /11 rivals are tier A \(more than 10\)/); assert.match(s.text, /Nosy Cloud's scheduled watch is the better home/); assert.match(s.text, /nothing is held back/);
  assert.equal(P.tiers.A.needsWork.length, 11, "every rival is still planned");
  assert.equal(plan(pmWith(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`r${i}`, { age: 50 }]))), { now: NOW }).suggestions.length, 0, "ten is fine");
});

test("a B-tier rival changed in 3 of the last 4 watch snapshots is suggested for promotion, never promoted", () => {
  const log = [{ at: "t0", states: { busy: "changed", calm: "same", other: "changed" } }, { at: "t1", states: { busy: "changed", calm: "same", other: "same" } },
    { at: "t2", states: { busy: "same", calm: "same", other: "same" } }, { at: "t3", states: { busy: "changed", calm: "changed", other: "same" } }];
  const pm = pmWith({ busy: { tier: "B", age: 1 }, calm: { tier: "B", age: 1 }, other: { tier: "A", age: 1 } }, { log });
  const P = plan(pm, { now: NOW });
  assert.deepEqual(P.suggestions.map(s => s.kind), ["promote"]);
  assert.equal(P.suggestions[0].text, "BUSY: changed 3 times in 4 snapshots: promote to tier A? (sources.json rivals.busy.tier)");
  assert.equal(P.tiers.B.rivals.find(r => r.slug === "busy").tier, "B", "still B");
  assert.equal(JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8")).rivals.busy.tier, "B", "sources.json untouched");
  // Only the last four count: an older change falls out of the window.
  const old = plan(pmWith({ busy: { tier: "B", age: 1 } }, { log: [{ at: "a", states: { busy: "changed" } }, ...[1, 2, 3].map(i => ({ at: `b${i}`, states: { busy: i === 1 ? "changed" : "same" } })), { at: "z", states: { busy: "changed" } }] }), { now: NOW });
  assert.deepEqual(old.suggestions, [], "changed in 2 of the last 4");
  assert.deepEqual(plan(pmWith({ busy: { tier: "B", age: 1 } }, { log: log.slice(0, 2).map(x => ({ ...x, states: { busy: "changed" } })) }), { now: NOW }).suggestions, [], "two snapshots can't make three changes");
});

test("record: the watch's states go into pm/history/watch-states.jsonl once per run; the watch's own words are mapped", () => {
  assert.deepEqual(["changed", "same", "baseline", "first", "unreachable", "no pages", "error", "weird"].map(watchState), ["changed", "same", "first", "first", "error", "error", "error", null]);
  assert.deepEqual(["A", "b", " c ", "D", "", undefined].map(tierOf), ["A", "B", "C", null, null, null]);
  const pm = pmWith({ a: { age: 1 }, b: { tier: "B", age: 1 } }, { watch: { generated: "2026-10-01T10:00:00.000Z", states: { a: "changed", b: "baseline" } } });
  assert.equal(record(pm), true); assert.equal(record(pm), false, "the same run is never added twice");
  const lines = fs.readFileSync(path.join(pm, "history", "watch-states.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines, [{ at: "2026-10-01T10:00:00.000Z", states: { a: "changed", b: "first" } }]);
  fs.writeFileSync(path.join(pm, "state", "watch.json"), JSON.stringify({ generated: "2026-10-02T10:00:00.000Z", rivals: [{ slug: "a", state: "same" }] }));
  assert.equal(record(pm), true); assert.equal(fs.readFileSync(path.join(pm, "history", "watch-states.jsonl"), "utf8").trim().split("\n").length, 2);
  assert.equal(record(pmWith({ a: { age: 1 } })), false, "no watch.json: nothing to record");
});

test("an invalid tier counts as A and says so; a registry rival with no file and a file with no registry entry are both planned", () => {
  const pm = pmWith({ odd: { tier: "gold", age: 1 }, reg: { tier: "B" } });
  fs.writeFileSync(path.join(pm, "rivals", "fileonly.md"), RESEARCHED("File Only"));
  const P = plan(pm, { now: NOW });
  assert.equal(P.total, 3);
  assert.equal(P.tiers.A.rivals.find(r => r.slug === "odd").tierInvalid, "gold");
  assert.match(render(P), /Not a tier \(use A, B or C\), counted as A: ODD \("gold"\)/);
  assert.equal(P.tiers.A.rivals.find(r => r.slug === "fileonly").name, "File Only", "the name comes from the file's heading when the registry has none");
  assert.deepEqual(P.tiers.B.needsWork, []);
});

test("CLI: plan prints the text, --json <file> also writes the file, --json alone prints JSON, a pm with no rivals says what to do and exits 1", () => {
  const pm = pmWith({ a: { age: 40 } }, { watch: { states: { a: "same" } } });
  const r = run(T, ["plan", pm, "--now", "2026-10-02"]);
  assert.equal(r.code, 0, r.error); assert.match(r.output, /# Rival tiers · 1 rivals: 1 deep \(A\)/); assert.match(r.output, /A \(file 40 days old\)|\(file 40 days old\)/);
  assert.equal(fs.existsSync(path.join(pm, "history", "watch-states.jsonl")), false, "plan is read-only: it never writes the watch log");
  const file = path.join(path.dirname(pm), "tiers.json");
  assert.equal(run(T, ["plan", pm, "--json", file, "--no-record"]).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).type, "tiers");
  const j = run(T, ["plan", pm, "--json"]); assert.equal(JSON.parse(j.output).tiers.A.rivals[0].slug, "a");
  const empty = path.join(temporary("nosy-tiers-empty-"), "pm"); fs.mkdirSync(empty, { recursive: true }); dirs.push(path.dirname(empty));
  const e = run(T, ["plan", empty]); assert.equal(e.code, 1); assert.match(e.error, /No rivals yet/);
  assert.equal(run(T, []).code, 1);
});

test("--no-record leaves the log alone", () => {
  const pm = pmWith({ a: { age: 1 } }, { watch: { states: { a: "same" } } });
  assert.equal(run(T, ["plan", pm, "--no-record"]).code, 0);
  assert.equal(fs.existsSync(path.join(pm, "history", "watch-states.jsonl")), false);
});

test("nosy tiers is wired (writes pm/state/rival-tiers.json), and nosy watch logs its run for the promotion rule", () => {
  const pm = pmWith({ a: { age: 40, bare: true } }); // a bare file: no public url for the watch to read
  const t = run(NOSY, ["tiers", "--pm", pm]);
  assert.equal(t.code, 0, t.error); assert.match(t.output, /Tier A · deep research/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pm, "state", "rival-tiers.json"), "utf8")).tiers.A.needsWork[0], "a");
  assert.match(run(NOSY, ["help"]).output, /nosy tiers \[--json\]/);
  // A rival file with no public url: the watch reads nothing (no network) but still writes watch.json, which gets logged.
  const w = run(NOSY, ["watch", "--pm", pm]);
  assert.equal(w.code, 0, w.error);
  const log = fs.readFileSync(path.join(pm, "history", "watch-states.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(log.length, 1); assert.deepEqual(log[0].states, { a: "error" });
});

// ---- review of 2 Oct: `plan` is read-only, `record` is idempotent and mends a half-written log ----
function tree(dir, rel = "") { return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => { const r = rel ? `${rel}/${e.name}` : e.name; return e.isDirectory() ? [r + "/", ...tree(dir, r)] : [`${r}:${fs.statSync(path.join(dir, r)).size}:${fs.statSync(path.join(dir, r)).mtimeMs}`]; }); }

test("plan writes nothing: not through the library, not through the CLI (with or without --no-record), not the watch log", () => {
  const pm = pmWith({ a: { age: 40 }, b: { age: 2, tier: "B" } }, { watch: { states: { a: "changed", b: "changed" } } });
  const before = tree(path.dirname(pm));
  plan(pm); render(plan(pm));
  assert.deepEqual(tree(path.dirname(pm)), before, "the library");
  for (const args of [["plan", pm], ["plan", pm, "--no-record"], ["plan", pm, "--json"]]) { assert.equal(run(T, args).code, 0); assert.deepEqual(tree(path.dirname(pm)), before, args.join(" ")); }
  assert.equal(fs.existsSync(path.join(pm, "history", "watch-states.jsonl")), false);
  assert.equal(record(pm), true, "record is what writes it");
});

test("record is idempotent, and a log whose last line was cut off gets a newline before the next line", () => {
  const pm = pmWith({ a: { age: 1 } }, { watch: { states: { a: "same" } } });
  assert.equal(record(pm), true); assert.equal(record(pm), false); assert.equal(record(pm), false);
  const log = path.join(pm, "history", "watch-states.jsonl");
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1);
  fs.appendFileSync(log, '{"at":"2026-10-01T00:00:00Z","stat'); // a crash mid-write
  const W = JSON.parse(fs.readFileSync(path.join(pm, "state", "watch.json"), "utf8"));
  fs.writeFileSync(path.join(pm, "state", "watch.json"), JSON.stringify({ ...W, generated: "2026-10-03T00:00:00Z" }));
  assert.equal(record(pm), true);
  const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[2]).at, "2026-10-03T00:00:00Z", "the new line is whole, not glued to the broken one");
  assert.equal(record(pm), false, "and the same run is still not added twice");
});

test("a dangling rival file, a registry that is a list and an entry that isn't an object don't crash the plan", () => {
  const pm = pmWith({ a: { age: 1 } });
  fs.symlinkSync(path.join(pm, "rivals", "nowhere.md"), path.join(pm, "rivals", "ghost.md"));
  const K = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8")); K.rivals = ["a", "b"];
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(K));
  assert.doesNotThrow(() => plan(pm));
  K.rivals = { a: "A", ghost: null, z: { name: 7, tier: "b" } }; fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(K));
  const P = plan(pm);
  assert.ok(P.total >= 3);
  assert.equal(P.tiers.A.rivals.find(r => r.slug === "ghost").ageDays, null, "unreadable counts as no file");
});
