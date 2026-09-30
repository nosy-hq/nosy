// Contract tests for skill/tools/waves-map.mjs: which wave (pm/waves.md's N1-N5
// "Direction" bullets) names a given decision/request ref.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { waveMapOf } from "../tools/waves-map.mjs";
import { temporary, clean } from "./helpers.mjs";

const WAVES_MD = `# Waves

## Direction · 28 Sep 2026: narrowed to the git shipped record

- **N1 · The record is right** · size M · internal requests 72, 73, 74, 83, 84. Explicit links only.
- **N2 · Recency** · size S. What merged since the last run.
- **N3 · bet and score** · size M · internal request 75 · done. K90 rests on this.
- **N4 · The page** · size S · internal request 85 · done.
- **N5 · Front door** · size S · done (merge be10713).

## Wave 1 · not a Direction wave

- **Backend inventory** · size M · internal request 26. Should not be read as a wave.
`;

let pm;
before(() => {
  pm = temporary("nosy-waves-");
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ refs: ["(?:internal request|iç talep) \\d+", "\\bK\\d{2,3}\\b"] }));
  fs.writeFileSync(path.join(pm, "waves.md"), WAVES_MD);
});
after(() => clean(pm));

test("a lone 'internal request N' (singular) is mapped to its wave", () => {
  const { found, map } = waveMapOf(pm);
  assert.ok(found);
  assert.equal(map.get("internal request 75"), "N3");
  assert.equal(map.get("internal request 85"), "N4");
});

test("the plural list form ('internal requests 72, 73, 74, 83, 84') is expanded to every number", () => {
  const { map } = waveMapOf(pm);
  for (const n of [72, 73, 74, 83, 84]) assert.equal(map.get(`internal request ${n}`), "N1", `internal request ${n} should map to N1`);
});

test("a decision ref (K-number) named inside a wave's own line is picked up generically", () => {
  const { map } = waveMapOf(pm);
  assert.equal(map.get("K90"), "N3");
});

test("a ref not named by any wave is simply absent from the map", () => {
  const { map } = waveMapOf(pm);
  assert.ok(!map.has("internal request 79"));
});

test("a bullet outside the Direction wave section (no N-prefix) doesn't pollute the map", () => {
  const { map } = waveMapOf(pm);
  assert.ok(!map.has("internal request 26"), "internal request 26 is only under Wave 1, not a Direction (N-)wave");
});

test("missing waves.md: found is false, map is empty - callers can drop the column entirely", () => {
  const empty = temporary("nosy-waves-empty-");
  fs.writeFileSync(path.join(empty, "sources.json"), JSON.stringify({}));
  const { found, map } = waveMapOf(empty);
  assert.equal(found, false);
  assert.equal(map.size, 0);
  clean(empty);
});

test("no pm folder / no sources.json at all: also found: false, never throws", () => {
  const { found } = waveMapOf(null);
  assert.equal(found, false);
});

test("sources.json's roadmap.path overrides the pm/waves.md default", () => {
  const alt = temporary("nosy-waves-alt-");
  fs.mkdirSync(path.join(alt, "docs"));
  fs.writeFileSync(path.join(alt, "docs", "roadmap.md"), "- **N1 · Only wave** · internal request 99.\n");
  fs.writeFileSync(path.join(alt, "sources.json"), JSON.stringify({ roadmap: { path: path.join(alt, "docs", "roadmap.md") } }));
  const { found, map } = waveMapOf(alt);
  assert.ok(found);
  assert.equal(map.get("internal request 99"), "N1");
  clean(alt);
});
