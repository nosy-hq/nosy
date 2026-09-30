// Shipped versus announced: the matrix reads the "d" code (announced, not shipped)
// and doesn't count it as "exists"; lowhanging's "widespread among rivals" count skips it, only mentioning
// it in the detail; the `delivery:` suffix on the announcement line is parsed out.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let root, pm;
const rival = (name, announcement, code2) => `# ${name}

- **Category:** AI PM agent
- **Status:** active
- **Latest major announcement:** ${announcement}

## Loop matrix

| # | Step | Code | Evidence |
|---|---|---|---|
| 1 | Product definition | y | (Sep 28) |
| 2 | Backend inventory | ${code2} | (Sep 28) |
`;

before(() => {
  root = temporary("nosy-announcement-");
  pm = path.join(root, "pm"); const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true }); fs.mkdirSync(path.join(pm, "state"), { recursive: true }); fs.mkdirSync(repo);
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(pm, "rivals", "alfa.md"), rival("Alfa", "2026-09-20 — backend map, coming soon, https://alfa.example · delivery: announced · importance: high · why it matters: our step 20", "d — waitlist"));
  fs.writeFileSync(path.join(pm, "rivals", "beta.md"), rival("Beta", "2026-09-10 — inventory shipped · delivery: shipped · importance: medium · why it matters: x", "y"));
  fs.writeFileSync(path.join(pm, "rivals", "gamma.md"), rival("Gamma", "2026-08-01 — general update", "y"));
  fs.writeFileSync(path.join(pm, "us.json"), JSON.stringify({ name: "Us", codes: { 1: "y", 2: "p" }, notes: { 2: "partial" } }));
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", matrix: path.join(pm, "matrix.json") }));
  const r = run(path.join(Tool, "build-matrix.mjs"), [pm]);
  assert.equal(r.code, 0, r.error);
});
after(() => clean(root));

const M = () => JSON.parse(fs.readFileSync(path.join(pm, "matrix.json"), "utf8"));

test("build-matrix reads the 'd' code and adds it to the glossary", () => {
  const alfa = M().products.find(u => u.name === "Alfa");
  assert.equal(alfa.codes["2"].k, "d");
  assert.equal(M().codes.d, "announced, not shipped");
});

test("the delivery suffix on the announcement line is parsed out, doesn't stay in the text; empty if absent", () => {
  const [alfa, beta, gamma] = ["Alfa", "Beta", "Gamma"].map(a => M().products.find(u => u.name === a));
  assert.equal(alfa.announcementDelivery, "announced");
  assert.equal(beta.announcementDelivery, "output");
  assert.equal(gamma.announcementDelivery, "");
  assert.doesNotMatch(alfa.announcementText, /delivery/);
  assert.equal(alfa.announcementSeverity, "high");
});

test("lowhanging: a 'd' rival doesn't count toward commonality, only gets mentioned in the detail", () => {
  const out = path.join(pm, "state", "lowhanging.json");
  const r = run(path.join(Tool, "lowhanging.mjs"), [pm, "--json", out]);
  assert.equal(r.code, 0, r.error);
  const m = JSON.parse(fs.readFileSync(out, "utf8")).items.find(m => m.title === "Backend inventory");
  assert.ok(m, "shipped in Beta and Gamma, partial for us: an item should be produced");
  assert.match(m.detail[0], /^Present in 2 rivals: Beta, Gamma$/);
  assert.ok(m.detail.includes("Announced, not shipped yet: Alfa"));
});

test("rivals that only announced don't clear the 'widespread' threshold", () => {
  for (const f of ["beta.md", "gamma.md"]) fs.writeFileSync(path.join(pm, "rivals", f), fs.readFileSync(path.join(pm, "rivals", f), "utf8").replace("| 2 | Backend inventory | y |", "| 2 | Backend inventory | d |"));
  run(path.join(Tool, "build-matrix.mjs"), [pm]);
  const out = path.join(pm, "state", "lowhanging.json");
  run(path.join(Tool, "lowhanging.mjs"), [pm, "--json", out]);
  assert.ok(!JSON.parse(fs.readFileSync(out, "utf8")).items.some(m => m.title === "Backend inventory"));
});

test("the page prints a symbol and a 'not shipped yet' label for 'd'", () => {
  const html = path.join(root, "page.html");
  fs.writeFileSync(path.join(pm, "product.md"), "# Us\n");
  const r = run(path.join(Tool, "build-page.mjs"), [pm, html]);
  assert.equal(r.code, 0, r.error);
  const s = fs.readFileSync(html, "utf8");
  assert.match(s, /announced, not shipped yet/);
  assert.match(s, /not shipped yet/);
});
