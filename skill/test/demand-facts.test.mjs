// demand-facts: what of signals.json may be published. The rule is the test: titles only for matrix and psst goals,
// counts only for decision and request goals, and never quotes, refs, paths or unmatched themes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";
import { demandForCloud } from "../tools/demand-facts.mjs";

let tmp, pm;
const goal = (type, title, count, extra = {}) => ({ type, ref: "K42", title, code: "n", state: "exists", count, customer: 2, source: { github: count },
  first: "2026-09-01", last: "2026-09-20", trend: { last30: count, previous30: 0 }, ready: false, notDoing: false,
  examples: [{ source: "acme/app:#12", date: "2026-09-20", text: "Jane Doe from Globex says: please add CSV export" }], ...extra });
before(() => {
  tmp = temporary("nosy-demand-facts-");
  pm = path.join(tmp, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "signals.json"), JSON.stringify({
    type: "signal", generated: "2026-09-28T10:00:00Z", total: 50, matching: 40,
    sources: [{ path: "gh:acme/secret-repo", format: "github", signal: 30 }, { path: "/Users/x/support.csv", format: "csv", signal: 20 }],
    goals: [goal("matrix", "CSV export", 9), goal("psst", "Backend ready: webhooks", 4, { ready: true }), goal("decision", "K42 Drop the enterprise tier", 7), goal("request", "§3 SSO for banks", 5), goal("matrix", "Zero mentions", 0)],
    themes: [{ key: "jane doe", count: 3, examples: [{ source: "x:1", text: "Jane Doe asked" }] }],
  }));
});
after(() => clean(tmp));

test("matrix and psst goals keep their titles and numbers", () => {
  const d = demandForCloud(pm);
  assert.deepEqual(d.goals.map(g => g.title), ["CSV export", "Backend ready: webhooks"]);
  assert.equal(d.goals[0].count, 9); assert.equal(d.goals[0].customers, 2);
  assert.deepEqual(d.goals[0].trend, { last30: 9, previous30: 0 });
  assert.equal(d.goals[1].ready, true);
});

test("decision and request goals are counts only: no titles, no refs", () => {
  const d = demandForCloud(pm), text = JSON.stringify(d);
  assert.deepEqual(d.hidden, { targets: 2, mentions: 12 });
  assert.ok(!/enterprise tier|SSO for banks|K42/.test(text));
});

test("never sent: quotes, names, paths, repo names, unmatched themes", () => {
  const text = JSON.stringify(demandForCloud(pm));
  for (const bad of ["Jane", "Globex", "examples", "secret-repo", "/Users/x", "support.csv", "themes", "jane doe"]) assert.ok(!text.includes(bad), `leaked: ${bad}`);
});

test("sources are format totals only", () => assert.deepEqual(demandForCloud(pm).sources, { github: 30, csv: 20 }));

test("a goal with no mentions is left out", () => assert.ok(!demandForCloud(pm).goals.some(g => g.title === "Zero mentions")));

test("no signals.json, or nothing matched, is null", () => {
  const empty = path.join(tmp, "none"); fs.mkdirSync(path.join(empty, "state"), { recursive: true });
  assert.equal(demandForCloud(empty), null);
  fs.writeFileSync(path.join(empty, "state", "signals.json"), JSON.stringify({ goals: [goal("matrix", "X", 0)] }));
  assert.equal(demandForCloud(empty), null);
  fs.writeFileSync(path.join(empty, "state", "signals.json"), "{ not json");
  assert.equal(demandForCloud(empty), null);
});

test("publish --dry-run lists demand.json when there is demand", () => {
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify({ steps: [{ no: "1", name: "Setup" }], biz: { name: "Cargo", codes: { 1: "y" } }, products: [] }));
  const r = spawnSync(process.execPath, [path.join(Tool, "publish.mjs"), pm, "--dry-run", "--project", "cargo"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pm\/state\/demand\.json/);
});
