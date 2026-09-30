// Contract tests for skill/tools/freshness.mjs: ✗/✓ based on status.json's age, peek shows up in "order", the
// --strict exit code, and the deliberate rule that "Sources read" and "Latest major announcement" dates in rival
// files are evaluated SEPARATELY (a stale announcement alone does NOT count as stale). Runs on copies of the fake product "Cargo".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dayBefore = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const copies = [];
function copyAl(K) {
  const k = temporary("nosy-freshness-");
  fs.cpSync(K.pm, k, { recursive: true });
  copies.push(k);
  return k;
}

let K;
after(() => { clean(K?.root); for (const k of copies) clean(k); });

test("a stale status.json gives ✗, peek shows up in 'order', --strict exit code 2", async () => {
  K = await fakeProductSetup();
  const pm = copyAl(K);
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "status.json"), JSON.stringify({ type: "state", generated: new Date(Date.now() - 10 * 86400000).toISOString() }, null, 1));
  const jsonPath = path.join(temporary("nosy-freshness-out-"), "freshness.json");
  copies.push(path.dirname(jsonPath));
  const r = run(path.join(Tool, "freshness.mjs"), [pm, "--json", jsonPath, "--strict"]);
  assert.equal(r.code, 2, `--strict should return 2 with a stale status: ${r.output}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "freshness");
  assert.ok(j.order.includes("peek"), `expected peek in the order: ${JSON.stringify(j.order)}`);
  const g = j.inputs.find(x => x.name.startsWith("state/status.json"));
  assert.ok(g, "state/status.json input not found");
  assert.equal(g.status, "✗");
});

test("a fresh input gives ✓, --strict exit code 0", async () => {
  const pm = copyAl(K);
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "status.json"), JSON.stringify({ type: "state", generated: new Date().toISOString() }, null, 1));
  // Also needs a psst output: freshness counts the absence of a base output (status, lowhanging) as ✗ too.
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ type: "lowHanging", generated: new Date().toISOString(), items: [] }, null, 1));
  // Add an update field to matrix.json (without it, it always produces ✗, not the point of this test).
  // sources.json.matris holds the ORIGINAL pm's absolute path (that's how fake-product.mjs sets it up); for
  // editing the copy's file to have an effect, first point sources.json.matris at the COPY's path.
  const matrixPath = path.join(pm, "matrix.json");
  const kj = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  kj.matrix = matrixPath;
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(kj, null, 1));
  const M = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  M.update = new Date().toISOString();
  fs.writeFileSync(matrixPath, JSON.stringify(M, null, 1));
  const r = run(path.join(Tool, "freshness.mjs"), [pm, "--strict"]);
  assert.equal(r.code, 0, `--strict should return 0 when fresh: ${r.output}`);
  assert.match(r.output, /state\/status\.json[^\n]*✓/);
});

test("rival: ✗ if the Sources-read date is stale; ✓ if only 'Latest major announcement' is stale (read date is fresh)", async () => {
  const pm = copyAl(K);
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pm, "rivals", "oldrival.md"),
    `# OldRival\n\nRival description.\n\n## Sources\n\n- Review: done on ${dayBefore(60)}.\n`);
  fs.writeFileSync(path.join(pm, "rivals", "quietrival.md"),
    `# QuietRival\n\nRival description.\n\n## Sources\n\n- Review: done on ${dayBefore(1)}.\n\n- **Latest major announcement:** made a big announcement on ${dayBefore(200)}.\n`);
  const jsonPath = path.join(temporary("nosy-freshness-out2-"), "freshness.json");
  copies.push(path.dirname(jsonPath));
  const r = run(path.join(Tool, "freshness.mjs"), [pm, "--json", jsonPath]);
  assert.equal(r.code, 0, `--strict wasn't given, should return 0: ${r.error}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const old = j.inputs.find(x => x.name === "rival: OldRival");
  const hidden = j.inputs.find(x => x.name === "rival: QuietRival");
  assert.ok(old, "rival: OldRival input missing");
  assert.ok(hidden, "rival: QuietRival input missing");
  assert.equal(old.status, "✗", "a rival with a stale Sources-read date should count as stale");
  assert.equal(hidden.status, "✓", "a rival where only the Latest-major-announcement is stale (read date is fresh) should NOT count as stale");
});

test("rival announcement/status format check flags a free-text announcement, an ok one, a 'no date' one, and an empty Status", async () => {
  const pm = copyAl(K);
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  // free-text announcement (no leading parseable date), Status filled -> badDate only
  fs.writeFileSync(path.join(pm, "rivals", "freetext.md"),
    `# FreeText\n\n- **Status:** active\n- **Latest major announcement:** In 2026, launched a thing (https://example.com)\n`);
  // compliant: ISO date + " — ", Status filled -> no issue
  fs.writeFileSync(path.join(pm, "rivals", "okrival.md"),
    `# OkRival\n\n- **Status:** active\n- **Latest major announcement:** 2026-09-15 — shipped a thing (https://example.com)\n`);
  // "no date" is an accepted announcement value (item 2 of internal request 45), Status filled -> no issue
  fs.writeFileSync(path.join(pm, "rivals", "nodaterival.md"),
    `# NoDateRival\n\n- **Status:** active\n- **Latest major announcement:** no date — nothing dated was found\n`);
  // ok date, but Status empty -> badStatus only
  fs.writeFileSync(path.join(pm, "rivals", "emptystatus.md"),
    `# EmptyStatus\n\n- **Status:**\n- **Latest major announcement:** 2026 Q2 — announced a beta\n`);
  const jsonPath = path.join(temporary("nosy-freshness-out3-"), "freshness.json");
  copies.push(path.dirname(jsonPath));
  const r = run(path.join(Tool, "freshness.mjs"), [pm, "--json", jsonPath]);
  assert.equal(r.code, 0, `unexpected failure: ${r.error}`);
  assert.match(r.output, /Rival file format \(internal request 45\)/);
  assert.match(r.output, /freetext\.md/);
  assert.match(r.output, /emptystatus\.md/);
  assert.doesNotMatch(r.output.split("Rival file format")[1], /okrival\.md/);
  assert.doesNotMatch(r.output.split("Rival file format")[1], /nodaterival\.md/);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.ok(j.announcementFormat, "announcementFormat missing from json");
  const byFile = Object.fromEntries(j.announcementFormat.issues.map(g => [g.file, g]));
  assert.ok(byFile["freetext.md"]?.badDate, "freetext.md should be flagged for badDate");
  assert.equal(byFile["freetext.md"]?.badStatus, false);
  assert.ok(byFile["emptystatus.md"]?.badStatus, "emptystatus.md should be flagged for badStatus");
  assert.equal(byFile["emptystatus.md"]?.badDate, false);
  assert.ok(!byFile["okrival.md"], "okrival.md should have no issue");
  assert.ok(!byFile["nodaterival.md"], "nodaterival.md should have no issue");
});

test("if the base outputs are missing entirely (empty pm/state), doesn't say 'fresh': ✗ and order peek → psst", async () => {
  const pm = copyAl(K);
  fs.rmSync(path.join(pm, "state"), { recursive: true, force: true });
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const r = run(path.join(Tool, "freshness.mjs"), [pm, "--strict"]);
  assert.equal(r.code, 2, `--strict should return 2 with an empty state folder: ${r.output}`);
  assert.match(r.output, /state\/status\.json[^\n]*✗[^\n]*missing/);
  assert.match(r.output, /next up: peek → psst/);
});
