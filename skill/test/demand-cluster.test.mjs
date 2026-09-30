// A count taken from GitHub issues is a topic cluster ("N related issues, M people"), never "asked N times", it is printed with the
// window it was counted over, and it is the same for the same input whatever order gh lists the issues in.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";
import { demandLine, windowText, isCluster } from "../tools/demand.mjs";

let K, tmp;
let pm;
before(async () => {
  K = await fakeProductSetup(); tmp = temporary("nosy-demand-cluster-");
  // A copy of the product's pm with a low match threshold and one psst item, so the four issues below land on it.
  pm = path.join(tmp, "pm"); fs.cpSync(K.pm, pm, { recursive: true });
  const src = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8")); src.signal = { threshold: 1 };
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(src));
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ items: [{ title: "Bulk shipment export to CSV", type: "Issue opened against us", evidence: "" }] }));
});
after(() => { clean(K.root); clean(tmp); });

const day = n => new Date(Date.now() - n * 864e5).toISOString();
const issue = (number, title, login, ago) => ({ number, title, body: "", author: { login }, state: "OPEN", createdAt: day(ago), updatedAt: day(ago), comments: [] });
const ISSUES = [
  issue(801, "Bulk shipment export to CSV", "u1", 3), issue(802, "Export shipments in bulk as CSV file", "u2", 5),
  issue(803, "Bulk export shipments CSV please", "u2", 9), issue(804, "Bulk shipment export CSV", "u3", 40),
  // Identical text from two people: only one is kept, and it must be the same one whatever order gh lists them in.
  issue(805, "Bulk export shipments CSV twice", "u4", 2), issue(806, "Bulk export shipments CSV twice", "u5", 30),
];
function collect(issues, tag) {
  const gh = fakeGhSetup({ ...K.gh, issueListAll: issues }), out = path.join(tmp, `${tag}.json`);
  try { const r = run(path.join(Tool, "collect-signals.mjs"), [pm, "--gh", "--json", out], { env: gh.env }); assert.ok([0, 2].includes(r.code), r.error);
    return { md: r.output, json: JSON.parse(fs.readFileSync(out, "utf8")) }; } finally { clean(gh.dir); }
}

test("collect-signals records the window the GitHub count was taken over", () => {
  const { json, md } = collect(ISSUES, "window");
  const src = json.sources.find(s => s.format === "github");
  assert.equal(src.window.count, 6);
  assert.equal(src.window.limit, 200);
  assert.equal(src.window.complete, true, "fewer issues than the limit means all of them");
  assert.equal(src.window.as_of, new Date().toISOString().slice(0, 10));
  assert.match(md, /GitHub window: all 6 issues \(open and closed, opened \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d\), as of \d{4}-\d\d-\d\d\. A count from these issues is a topic cluster/);
});

test("a goal matched only by GitHub issues is a cluster, and the line says related issues and people, with the window", () => {
  const { json } = collect(ISSUES, "line");
  const g = json.goals.find(x => x.source?.github >= 2);
  assert.ok(g, JSON.stringify(json.goals.map(x => [x.title, x.source])));
  assert.equal(isCluster(g), true);
  const D = { window: json.sources.find(s => s.format === "github").window };
  const line = demandLine(g, D);
  assert.match(line, new RegExp(`^${g.count} related issues?, ${g.customer} (people|person) since \\d{4}-\\d\\d-\\d\\d`));
  assert.doesNotMatch(line, /asked \d+ times?/);
  assert.match(line, /counted over all 6 issues \(open and closed, opened/);
});

test("the same issues in a different order give the same counts", () => {
  const a = collect(ISSUES, "order-a").json, b = collect([...ISSUES].reverse(), "order-b").json;
  const strip = j => JSON.stringify(j.goals.map(g => [g.title, g.count, g.customer, g.first, g.last, g.trend]));
  assert.equal(strip(a), strip(b));
  assert.ok(a.goals.length > 0);
});

test("exports (not GitHub) keep the 'asked N times by M customers' wording; the window text handles a truncated list", () => {
  assert.match(demandLine({ count: 3, customer: 2, source: { csv: 3 }, first: "2026-05-01" }), /^asked 3 times by 2 customers since 2026-05-01$/);
  assert.equal(windowText({ kind: "github issues", limit: 200, count: 200, complete: false, states: "open and closed", oldest: "2026-08-01", newest: "2026-09-30", as_of: "2026-09-30" }),
    "newest 200 issues (open and closed, opened 2026-08-01 to 2026-09-30), as of 2026-09-30");
  assert.match(demandLine({ count: 1, customer: 1, source: { github: 1 } }), /^1 related issue, 1 person$/);
});
