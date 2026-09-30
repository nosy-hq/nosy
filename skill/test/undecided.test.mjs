// Contract test for skill/tools/undecided.mjs: which open requests count as undecided,
// team from labels, and the CLI writes only the "undecided" key of shipped.json.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { run, temporary, clean, Tool, fakeGhSetup } from "./helpers.mjs";
import { undecidedOf } from "../tools/undecided.mjs";

const dirs = []; after(() => dirs.forEach(clean));
const now = Date.parse("2026-09-28T12:00:00Z");
const iss = (n, over = {}) => ({ number: n, title: `Thing ${n}`, createdAt: "2026-07-01T10:00:00Z", labels: [{ name: "Type:New Feature" }, { name: ".Needs Triage" }, { name: ".Team/Metabot" }], assignees: [], milestone: null, ...over });

test("an old, unassigned, unlabelled-by-decision request is undecided; team comes from the label", () => {
  const [u] = undecidedOf([iss(1)], { now });
  assert.deepEqual(u, { ref: "#1", title: "Thing 1", team: "Metabot", opened: "2026-07-01", ageDays: 89 });
});

test("any explicit decision signal takes it off the list: assignee, milestone, decision label", () => {
  const list = undecidedOf([
    iss(1, { assignees: [{ login: "a" }] }),
    iss(2, { milestone: { title: "v60" } }),
    iss(3, { labels: [{ name: "enhancement" }, { name: "Planned" }] }),
    iss(4, { labels: [{ name: "enhancement" }, { name: "wontfix" }] }),
    iss(5),
  ], { now });
  assert.deepEqual(list.map(u => u.ref), ["#5"]);
});

test("too young, bugs and non-requests are skipped; a feature-request title counts without a label", () => {
  const list = undecidedOf([
    iss(1, { createdAt: "2026-09-20T10:00:00Z" }),
    iss(2, { labels: [{ name: "bug" }] }),
    iss(3, { labels: [{ name: "question" }] }),
    iss(4, { labels: [], title: "[Feature] CSV import" }),
  ], { now, minAge: 14 });
  assert.deepEqual(list.map(u => u.ref), ["#4"]);
  assert.equal(list[0].team, null);
});

test("rules from sources.json override the defaults; oldest first", () => {
  const list = undecidedOf([
    iss(1, { labels: [{ name: "idea" }, { name: "squad:api" }], createdAt: "2026-08-01T10:00:00Z" }),
    iss(2, { labels: [{ name: "idea" }], createdAt: "2026-06-01T10:00:00Z" }),
  ], { now, rules: { request: "^idea$", team: "squad:(\\w+)" } });
  assert.deepEqual(list.map(u => [u.ref, u.team]), [["#2", null], ["#1", "api"]]);
});

test("CLI writes only the undecided key and keeps the rest of shipped.json", () => {
  const root = temporary("nosy-undecided-"); dirs.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ issue: { repo: "acme/app" } }));
  fs.writeFileSync(path.join(pm, "state", "shipped.json"), JSON.stringify({ repo: "acme/app", shipped: [{ ref: "#9" }], recent: { since: "x" } }));
  const gh = fakeGhSetup({ issueListOpen: [iss(1), iss(2, { assignees: [{ login: "a" }] })] }); dirs.push(gh.dir);
  const r = run(path.join(Tool, "undecided.mjs"), [pm], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  const s = JSON.parse(fs.readFileSync(path.join(pm, "state", "shipped.json"), "utf8"));
  assert.deepEqual(s.shipped, [{ ref: "#9" }]);
  assert.deepEqual(s.recent, { since: "x" });
  assert.deepEqual(s.undecided.map(u => u.ref), ["#1"]);
  assert.deepEqual(s.undecidedScope, { read: 2, capped: false, minAge: 14 });
  const capped = run(path.join(Tool, "undecided.mjs"), [pm, "--limit", "2"], { env: gh.env });
  assert.match(capped.output, /at least 1 undecided of 2 newest open issues \(capped at --limit 2/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pm, "state", "shipped.json"), "utf8")).undecidedScope.capped, true);
});
