// atlas-seed.mjs: per-country facts from a registry file, counted without a model; flags what the numbers are not. A made-up registry, no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { read, summarize, render, CAVEATS } from "../tools/atlas-seed.mjs";

const SEED = path.join(Tool, "atlas-seed.mjs"), dirs = [];
after(() => dirs.forEach(clean));

const src = (id, country, status, o = {}) => ({ id, country, name: id, status, data_types: ["case_law"], auth: "none", url: `https://${id.split("/").pop()}.example/`, notes: "", indexing: null, ...o });
const registry = () => ({
  generated_at: "2026-10-03T06:00:00Z", summary: { total: 7, complete: 5, blocked: 2 },
  sources: [
    src("nl/court-a", "NL", "complete", { url: "https://data.court.example/api", indexing: { case_law_rows: 900, legislation_rows: 0 } }),
    src("nl/mirror-b", "NL", "complete", { url: "https://www.data.court.example/other", indexing: { case_law_rows: 300, legislation_rows: 0 } }),
    src("nl/law-c", "NL", "complete", { data_types: ["legislation"], indexing: { case_law_rows: 0, legislation_rows: 50 } }),
    src("nl/closed-d", "NL", "blocked", { auth: "registration_required", notes: "registration_required: a login is needed before any decision can be read at all, so nothing can be fetched" }),
    src("ge/court-e", "GE", "complete", { auth: "api_key", indexing: { case_law_rows: 40, legislation_rows: 0 } }),
    src("ge/court-f", "GE", "blocked", { data_types: null }),
    src("xx/empty-g", "XX", "complete", { indexing: undefined }),
  ],
});
const file = r => { const d = temporary("nosy-seed-"); dirs.push(d); const f = path.join(d, "status.json"); fs.writeFileSync(f, JSON.stringify(r)); return f; };

test("counts a country's sources, complete, blocked, open (complete and no key) and rows", () => {
  const r = summarize(registry(), { countries: ["nl", "ge"] });
  const nl = r.countries[0], ge = r.countries[1];
  assert.equal(nl.country, "NL");
  assert.deepEqual([nl.sources, nl.complete, nl.blocked, nl.open], [4, 3, 1, 3]);
  assert.deepEqual([nl.caseLawRows, nl.legislationRows], [1200, 50]);
  assert.deepEqual(nl.top.map(t => t.id), ["court-a", "mirror-b", "law-c"]);
  assert.equal(ge.open, 0, "a source that needs a key is complete but not open");
  assert.equal(ge.blocked, 1);
});

test("hosts shared by two sources that carry rows are flagged, not added up or removed", () => {
  const nl = summarize(registry(), { countries: ["NL"] }).countries[0];
  assert.equal(nl.sharedHosts.length, 1);
  assert.deepEqual(nl.sharedHosts[0], { host: "data.court.example", sources: ["court-a", "mirror-b"], rows: 1200 });
  assert.equal(nl.caseLawRows, 1200, "the total is still the registry's own");
});

test("a blocked case-law source says why, cut to 80 characters; a source with no data types doesn't crash", () => {
  const r = summarize(registry(), { countries: ["NL", "GE"] });
  assert.equal(r.countries[0].blockedCaseLaw[0].id, "closed-d");
  assert.equal(r.countries[0].blockedCaseLaw[0].note.length, 80);
  assert.equal(r.countries[1].blockedCaseLaw.length, 0);
});

test("no codes: the countries with the most rows come first, at most --top; an unlisted code says so", () => {
  const r = summarize(registry(), { top: 2 });
  assert.deepEqual(r.countries.map(c => c.country), ["NL", "GE"]);
  const u = summarize(registry(), { countries: ["BR"] }).countries[0];
  assert.equal(u.listed, false);
  assert.match(render({ ...summarize(registry(), { countries: ["BR"] }) }), /BR \| not listed in this registry/);
});

test("the text says what the numbers are not, and the registry's own date", () => {
  const out = render(summarize(registry(), { countries: ["NL"] }));
  for (const c of CAVEATS) assert.ok(out.includes(c));
  assert.match(out, /generated_at=2026-10-03T06:00:00Z total=7 complete=5 blocked=2/);
  assert.match(out, /NL \| 3\/4 \| 3 \| 1,200 \| 50 \| court-a \(900\), mirror-b \(300\), law-c \(50\)/);
});

test("the command: prints the table, writes --json with the profile, and uses only the local file", () => {
  const f = file(registry()), j = path.join(path.dirname(f), "out", "seed.json");
  const r = run(SEED, [f, "NL", "--json", j]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /^registry generated_at=/);
  const out = JSON.parse(fs.readFileSync(j, "utf8"));
  assert.equal(out.profile, "legal-data-hunter");
  assert.equal(out.countries[0].country, "NL");
  assert.equal(out.caveats.length, 3);
});

test("a file that isn't a registry, isn't JSON or is missing exits 1 with what to do, not a stack trace", () => {
  const d = temporary("nosy-seed-"); dirs.push(d);
  fs.writeFileSync(path.join(d, "bad.json"), "{ not json");
  fs.writeFileSync(path.join(d, "other.json"), JSON.stringify({ sources: [{ name: "x" }] }));
  for (const [f, re] of [["bad.json", /not valid JSON/], ["other.json", /isn't a registry I know/], ["nope.json", /no such file/]]) {
    const r = run(SEED, [path.join(d, f)]);
    assert.equal(r.code, 1);
    assert.match(r.error, re);
    assert.doesNotMatch(r.error, /at .*\.mjs:\d+/);
  }
  assert.equal(run(SEED, []).code, 1);
  assert.equal(run(SEED, [path.join(d, "bad.json"), "--profile", "nope"]).code, 1);
  assert.throws(() => read(path.join(d, "other.json")), /isn't a registry/);
});
