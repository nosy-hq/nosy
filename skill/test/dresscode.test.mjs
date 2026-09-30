// Contract test for skill/tools/read-design.mjs + dresscode.mjs. Sets up its own small product ("Cargo web": a
// design system under apps/web) and doesn't touch any other test's fixture product. No network; git is local.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { read, match } from "../tools/read-design.mjs";
import { score } from "../tools/dresscode.mjs";

const DIRECTION = `# Direction

## Goals

| # | Goal | Problem and evidence | Success signal |
|---|---|---|---|
| G1 | **An operator finds a shipment in one click.** | Support tickets, 12 Sep. | Search is on every page. |
| G2 | **Every page reads the same.** | Audit, 14 Sep. | Page layer test passes. |

### Non-goals

- A public component library.

## Principles, in the order they win

| # | Principle | What it decides | Kept | Broken |
|---|---|---|---|---|
| P1 | **A person approves.** | AI surfaces | A proposal card. | An auto-apply switch. |
| P2 | **Show what the backend says.** | Data | PendingBackend. | A sample chart. |

A rule no principle supports is a proposal. Principles do not change without a goal to justify it.

## Scope

| Area | Status | Depth |
|---|---|---|
| apps/web | **Included** | Full |
| apps/mobile | **Deferred** | Revisit in Q1 |
| marketing site | **Excluded** | Own system |

Code is the design source; the catalogue at /design is the visual reference.
`;
const DESIGN = `# Design System: Cargo

## Colors
Primary is petrol; destructive is red. Both themes (light and dark) pass WCAG AA contrast.

## Typography
Geist 14/20.

## Spacing
Rows are 44px.
`;
const REGISTRY = `export const registry = [
  { module: "button", exports: ["Button"], category: "actions", status: "stable", use: "Every action.", notFor: "Navigation.", a11y: "Native button." },
  { module: "table", exports: ["Table"], category: "data", status: "beta", use: "Rows.", a11y: "Native table." },
  { module: "old-select", exports: ["OldSelect"], category: "inputs", status: "legacy", insteadOf: "select", use: "Do not use." },
];
`;
const TOKENS = JSON.stringify({ color: { primary: { $value: "#0b5563" }, destructive: { $value: "#b42318" } }, density: { "row-h": { $value: "44px" } }, radius: { control: { $value: "6px" } } });
const AGENTS = "# Agents\n\nRead `DESIGN.md` first, then `docs/design-system/DIRECTION.md` and `docs/design-system/TOKENS-GUIDE.md`.\n";
const Waves = "# Waves\n\n## Now\n- Shipment list screen: filter and bulk select\n- Invoice page\n";

function gitRepo(dir, files) {
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (!fs.existsSync(path.join(dir, ".git"))) g("init", "-q", "-b", "main");
  g("add", "."); g("commit", "-q", "-m", "ds");
}

let root, repo, pm;
before(() => {
  root = temporary("nosy-dresscode-"); repo = path.join(root, "repo"); pm = path.join(root, "pm");
  gitRepo(repo, {
    "README.md": "# Cargo\n",
    "apps/api/server.js": "// api\n",
    "apps/web/DESIGN.md": DESIGN,
    "apps/web/AGENTS.md": AGENTS,
    "apps/web/design-tokens.json": TOKENS,
    "apps/web/docs/design-system/DIRECTION.md": DIRECTION,
    "apps/web/docs/design-system/PATTERNS.md": "# Patterns\n\n## A list page\n\nStates: loading skeleton; empty state with the create action; error with Retry. Example: Shipment.\n\n## Bulk actions\n\nOne bar with the count.\n",
    "apps/web/src/components/ui/registry.ts": REGISTRY,
    "apps/web/src/components/ui/button.tsx": "export {}\n",
    "apps/web/tests/design-tokens.test.mjs": "// tokens\n",
  });
  fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main" }));
  fs.writeFileSync(path.join(pm, "waves.md"), Waves);
});
after(() => clean(root));

test("reader: finds the root from anchor files, extracts goal/principle/scope/component/token/broken references", () => {
  const m = read(pm);
  assert.equal(m.notFound, false);
  assert.equal(m.source.root, "apps/web");
  assert.ok(m.source.root_estimate);
  assert.deepEqual(m.goals.map(h => h.id), ["G1", "G2"]);
  assert.deepEqual(m.principles.map(i => i.id), ["P1", "P2"]);
  assert.deepEqual({ included: m.scope.included, deferred: m.scope.deferred, excluded: m.scope.excluded }, { included: 1, deferred: 1, excluded: 1 }, "should not miss 'Included' with tr-TR lowercasing");
  assert.equal(m.components.total, 3);
  assert.deepEqual(m.components.status, { stable: 1, beta: 1, legacy: 1 });
  assert.equal(m.components.list.find(b => b.name === "old-select").instead, "select");
  assert.ok(m.tokens.pixel.some(p => p.name === "density.row-h" && p.value === "44px"));
  assert.deepEqual(m.broken_ref.map(r => r.name), ["docs/design-system/TOKENS-GUIDE.md"], "an existing DESIGN.md should not count as broken");
  assert.ok(!m.roles.design.some(f => f.endsWith("README.md")), "the README next to design-tokens.json doesn't count as a design document");
});

test("match: brings back the component and pattern heading that fit the topic", () => {
  const e = match(read(pm), ["bulk", "table"]);
  assert.deepEqual(e.component.map(b => b.name), ["table"]);
  assert.ok(e.section.some(b => /PATTERNS\.md:\d+ Bulk actions/.test(b)));
});

test("dresscode: evidence-backed statuses; an area that can't be seen from the repo is 'ask', an unwritten one is 'missing'", () => {
  const P = score(pm, { today: "2026-09-28" });
  const al = name => P.fields.find(a => a.name === name);
  assert.equal(P.fields.length, 20);
  assert.equal(al("Goals").status, "ready");
  for (const c of al("Goals").checks) assert.match(c.evidence, /DIRECTION\.md:\d+/);
  assert.equal(al("Scope").status, "ready");
  assert.equal(al("Version").status, "missing", "no change log");
  assert.equal(al("Ownership").status, "ask", "ownership can't be seen from the repo: not 'missing', it's asked");
  assert.ok(al("Ownership").question);
  assert.equal(al("Deprecation").checks[1].evidence, "old-select → select");
  const brokenValue = al("Maintenance").checks.find(c => /point to a file/.test(c.label));
  assert.equal(brokenValue.evidence, null); assert.match(brokenValue.detail, /TOKENS-GUIDE\.md/);
  const t = P.summary; assert.equal(t.ready + t.partial + t.missing + t.ask, 20);
});

test("dresscode plan: 3-5 gaps, screen work on the roadmap bumps the related gaps up, check date is +14 days", () => {
  const P = score(pm, { today: "2026-09-28" });
  assert.equal(P.screen_task_of, 2);
  assert.ok(P.plan.length >= 3 && P.plan.length <= 5, `plan ${P.plan.length}`);
  for (const p of P.plan) { assert.ok(p.reason && p.step && p.owner); assert.equal(p.check_date_of, "2026-10-12"); }
  const scores = P.plan.map(p => p.score); assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test("CLI: writes its files; a second run shows the area that changed in between", () => {
  const r1 = run(path.join(Tool, "dresscode.mjs"), [pm, "--today", "2026-09-28"]);
  assert.equal(r1.code, 0, r1.error);
  assert.match(r1.output, /# dresscode · 2026-09-28/);
  assert.match(r1.output, /Talking to the designer/);
  assert.match(r1.output, /designsystems\.surf/, "credits the inspiration source");
  for (const f of ["state/design.json", "state/dresscode.json", "design/2026-09-28.md"]) assert.ok(fs.existsSync(path.join(pm, f)), f);
  gitRepo(repo, { "apps/web/docs/design-system/CHANGELOG.md": "# Changelog\n\n| Class | Means | Existing screens |\n|---|---|---|\n\n## 2026-09-29 — tables\n\nBreaking: none.\n" });
  const r2 = run(path.join(Tool, "dresscode.mjs"), [pm, "--today", "2026-09-29"]);
  assert.equal(r2.code, 0, r2.error);
  assert.match(r2.output, /Since the last run \(2026-09-28\): .*Version missing → ready/);
});

test("folder mode: reads maturity in the Artifact layout (project/components/<Name>/README.md)", () => {
  const d = temporary("nosy-dresscode-folder-");
  try {
    for (const [f, t] of Object.entries({
      "project/README.md": DESIGN, "project/direction.md": DIRECTION, "project/tokens.json": TOKENS,
      "project/components/Button/README.md": "# Button\n\n**Actions** · Stable — use it.\n\n## When not\n\nNavigation.\n\n## Accessibility\n\nNative.\n",
      "project/components/Chart/README.md": "# Chart\n\n**Data** · Beta — may change.\n",
    })) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
    const emptyPm = path.join(d, "pm"); fs.mkdirSync(emptyPm);
    const m = read(emptyPm, { folder: d });
    assert.equal(m.source.type, "folder");
    assert.deepEqual(m.components.status, { stable: 1, beta: 1 });
    assert.equal(m.components.when_not, 1);
    assert.ok(m.roles.design.includes("project/README.md"), "the README next to tokens.json is a design document");
    assert.match(run(path.join(Tool, "dresscode.mjs"), [emptyPm, "--folder", d]).output, /Folder mode/);
  } finally { clean(d); }
});

// --- an Artifact design system downloaded to a local folder by the agent ---
test("--from-artifact is an alias for --folder; --artifact-url records provenance in the report", () => {
  const d = temporary("nosy-dresscode-artifact-");
  try {
    for (const [f, t] of Object.entries({
      "project/README.md": DESIGN, "project/direction.md": DIRECTION, "project/tokens.json": TOKENS,
      "project/components/Button/README.md": "# Button\n\n**Actions** · Stable — use it.\n",
    })) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
    const emptyPm = path.join(d, "pm"); fs.mkdirSync(emptyPm);
    const r = run(path.join(Tool, "dresscode.mjs"), [emptyPm, "--from-artifact", d, "--artifact-url", "https://claude.ai/artifact/abc123"]);
    assert.equal(r.code, 0, r.error);
    assert.match(r.output, /Folder mode/);
    assert.match(r.output, /Source: downloaded from an Artifact \(`https:\/\/claude\.ai\/artifact\/abc123`\)/);
  } finally { clean(d); }
});

test("in a product with no design system: says how it will be shown, writes no file, exit 0", () => {
  const d = temporary("nosy-dresscode-missing-");
  try {
    const r = path.join(d, "repo"), p = path.join(d, "pm");
    gitRepo(r, { "README.md": "# x\n", "server/index.js": "//\n" });
    fs.mkdirSync(p); fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: r, ref: "main" }));
    const c = run(path.join(Tool, "dresscode.mjs"), [p]);
    assert.equal(c.code, 0);
    assert.match(c.output, /Design system not found/);
    assert.match(c.output, /"design"/);
    assert.ok(!fs.existsSync(path.join(p, "state", "dresscode.json")));
  } finally { clean(d); }
});

test("an open-decision list doesn't count as a decision; the topmost docs/ root becomes the repo root", () => {
  const d = temporary("nosy-dresscode-open-");
  try {
    const r = path.join(d, "repo"), p = path.join(d, "pm");
    gitRepo(r, {
      "docs/design-system/README.md": "# Design system\n\n## Not decided yet\n\n- **Ownership:** who approves a change, decision rights, exceptions.\n",
      "docs/design-system/DIRECTION.md": DIRECTION,
      "web/src/index.css": ":root { --primary: 13 100% 55%; --radius: 0.375rem; }\n.dark { --primary: 13 100% 57%; }\n",
      "web/src/components/ui/button.tsx": "export {}\n",
    });
    fs.mkdirSync(p); fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: r, ref: "main" }));
    const P = score(p, { today: "2026-09-28" });
    assert.equal(P.model.source.root, "");
    assert.equal(P.model.tokens.total, 2, "the dark theme redefines the same variable; counted once");
    assert.equal(P.model.components.total, 1);
    assert.equal(P.fields.find(a => a.name === "Ownership").status, "ask");
  } finally { clean(d); }
});

// --- two-pass verification: candidate → judge/owner verdict → approvals.json → rescoring ---
function pmCopy() { const d = temporary("nosy-dresscode-approval-"); fs.cpSync(pm, d, { recursive: true }); fs.rmSync(path.join(d, "design"), { recursive: true, force: true }); fs.rmSync(path.join(d, "state"), { recursive: true, force: true }); return d; }

test("verification: line evidence becomes a 'waiting' candidate, count evidence doesn't; CLI writes dresscode-verify.json", () => {
  const p = pmCopy();
  try {
    const P = score(p, { today: "2026-09-28" });
    const goal = P.fields.find(a => a.name === "Goals").checks;
    assert.equal(goal[0].verification, null, "Goals#1 is count evidence (a table), not a line");
    assert.equal(goal[1].id, "Goals#2"); assert.equal(goal[1].verification, "waiting");
    assert.ok(P.candidates.some(x => x.id === "Goals#2" && x.context.includes("Success signal")));
    assert.equal(P.verification.pending, P.candidates.length);
    const r = run(path.join(Tool, "dresscode.mjs"), [p, "--today", "2026-09-28"]);
    assert.match(r.output, /awaiting verification \(✓\?\)/);
    const j = JSON.parse(fs.readFileSync(path.join(p, "state", "dresscode-verify.json"), "utf8"));
    assert.ok(j.instruction.includes("DESIGN SYSTEM")); assert.equal(j.candidates.length, P.candidates.length);
  } finally { clean(p); }
});

test("verification: a rejected match is skipped and the next candidate is tried; an approved one becomes 'verified'; a verdict survives a line shift", () => {
  const p = pmCopy();
  try {
    run(path.join(Tool, "dresscode.mjs"), [p, "--today", "2026-09-28"]);
    const cand = JSON.parse(fs.readFileSync(path.join(p, "state", "dresscode-verify.json"), "utf8")).candidates;
    const principle = cand.find(x => x.id === "Principles#2"), tema = cand.find(x => x.id === "Tokens#3");
    const verdict = path.join(p, "verdicts.json");
    fs.writeFileSync(verdict, JSON.stringify([{ key: principle.key, decision: "no", reason: "a heading, not an ordering rule" }, { key: tema.key, decision: "yes", reason: "two themes written down" }]));
    const k = run(path.join(Tool, "dresscode.mjs"), [p, "decision", verdict]);
    assert.equal(k.code, 0, k.error); assert.match(k.output, /2 verdict\(s\) recorded/);
    let P = score(p, { today: "2026-09-28" });
    const c = P.fields.find(a => a.name === "Principles").checks[1];
    assert.equal(c.rejected[0].evidence, principle.evidence);
    assert.notEqual(c.evidence, principle.evidence, "a rejected line never becomes evidence again");
    assert.equal(P.fields.find(a => a.name === "Tokens").checks[2].verification, "yes");
    // A line is added to the top of the document: the line number shifts, but the verdict (the window summary) still holds.
    const f = path.join(repo, "apps/web/docs/design-system/DIRECTION.md"), old = fs.readFileSync(f, "utf8");
    try {
      gitRepo(repo, { "apps/web/docs/design-system/DIRECTION.md": "<!-- intro -->\n\n" + old });
      P = score(p, { today: "2026-09-28" });
      const c2 = P.fields.find(a => a.name === "Principles").checks[1];
      assert.equal(c2.rejected?.length, 1, "should still count as rejected on the shifted line");
    } finally { gitRepo(repo, { "apps/web/docs/design-system/DIRECTION.md": old }); }
  } finally { clean(p); }
});

test("owner: reject overrides the agent's approval, the agent can't override the owner's; add shows evidence the script missed", () => {
  const p = pmCopy();
  try {
    run(path.join(Tool, "dresscode.mjs"), [p, "--today", "2026-09-28"]);
    const cand = JSON.parse(fs.readFileSync(path.join(p, "state", "dresscode-verify.json"), "utf8")).candidates.find(x => x.id === "Goals#2");
    const r = run(path.join(Tool, "dresscode.mjs"), [p, "reject", "Goals#2", cand.evidence, "--reason", "a general sentence"]);
    assert.equal(r.code, 0, r.error);
    const verdict = path.join(p, "h.json"); fs.writeFileSync(verdict, JSON.stringify([{ key: cand.key, decision: "yes", reason: "agent" }]));
    run(path.join(Tool, "dresscode.mjs"), [p, "decision", verdict]);
    const o = JSON.parse(fs.readFileSync(path.join(p, "design", "approvals.json"), "utf8"));
    assert.equal(o.decisions[cand.key].source, "owner"); assert.equal(o.decisions[cand.key].decision, "no");
    // Governance#3 (exceptions) isn't in the fixture; the owner points out a line in DESIGN.md.
    const e = run(path.join(Tool, "dresscode.mjs"), [p, "add", "Governance#3", "apps/web/DESIGN.md:4", "--reason", "the exception is here"]);
    assert.equal(e.code, 0, e.error);
    const P = score(p, { today: "2026-09-28" });
    const c = P.fields.find(a => a.name === "Governance").checks[2];
    assert.equal(c.evidence, "apps/web/DESIGN.md:4"); assert.equal(c.verification, "owner");
    const broken = run(path.join(Tool, "dresscode.mjs"), [p, "reject", "Goals#2", "missing.md:3"]);
    assert.equal(broken.code, 1); assert.match(broken.error, /not found in the design system documents/);
  } finally { clean(p); }
});

// --- exception patterns ---
test("suggest: derives a bounded, filler-free expression from a rejected line; a pattern that would eliminate a protected line isn't suggested; after --apply the line never goes to the judge", () => {
  const p = pmCopy(), general = path.join(p, "general.json");
  fs.writeFileSync(general, JSON.stringify({ patterns: [] }));
  const env = { ...process.env, NOSY_EXCEPTION: general };
  try {
    run(path.join(Tool, "dresscode.mjs"), [p, "--today", "2026-09-28"], { env });
    const name = JSON.parse(fs.readFileSync(path.join(p, "state", "dresscode-verify.json"), "utf8")).candidates;
    const goal = name.find(x => x.id === "Goals#4"); // "Goals are backed by evidence": the "evidence" heading line in the fixture
    assert.ok(goal, "there should be a Goals#4 candidate");
    const h = path.join(p, "h.json"); fs.writeFileSync(h, JSON.stringify([{ key: goal.key, decision: "no", reason: "a table heading" }]));
    run(path.join(Tool, "dresscode.mjs"), [p, "decision", h], { env });
    const o = run(path.join(Tool, "dresscode.mjs"), [p, "suggest"], { env });
    assert.equal(o.code, 0, o.error);
    const line = o.output.split("\n").find(l => l.includes("`Goals#4`"));
    assert.ok(line, o.output);
    const pattern = line.match(/\/(.+?)\/ ·/)[1];
    assert.ok(!/\b(the|of|and)\W*\\b$/.test(pattern), `should not end on a filler word: ${pattern}`);
    assert.ok(!pattern.includes("|"), "should not cross a cell boundary");
    const u = run(path.join(Tool, "dresscode.mjs"), [p, "suggest", "--sec", "Goals#4", "--apply"], { env });
    assert.match(u.output, /1 pattern\(s\) written to this product/);
    const P = score(p, { today: "2026-09-28", general: [] });
    const c = P.fields.find(a => a.name === "Goals").checks[3];
    assert.equal(c.eliminated?.[0]?.scope, "product");
    assert.ok(!P.candidates.some(x => x.key === goal.key), "an eliminated line never becomes a candidate again");
  } finally { clean(p); }
});

test("suggest --publish: with no selection, a pattern seen in only one product isn't written to Nosy; --sec publishes it deliberately, and it applies in another product", () => {
  const p = pmCopy(), general = path.join(p, "general.json");
  fs.writeFileSync(general, JSON.stringify({ patterns: [] }));
  const env = { ...process.env, NOSY_EXCEPTION: general };
  try {
    run(path.join(Tool, "dresscode.mjs"), [p, "--today", "2026-09-28"], { env });
    const goal = JSON.parse(fs.readFileSync(path.join(p, "state", "dresscode-verify.json"), "utf8")).candidates.find(x => x.id === "Goals#4");
    const h = path.join(p, "h.json"); fs.writeFileSync(h, JSON.stringify([{ key: goal.key, decision: "no", reason: "x" }]));
    run(path.join(Tool, "dresscode.mjs"), [p, "decision", h], { env });
    const y1 = run(path.join(Tool, "dresscode.mjs"), [p, "suggest", "--publish"], { env });
    assert.match(y1.output, /0 pattern\(s\) written to Nosy \(1 skipped/);
    assert.equal(JSON.parse(fs.readFileSync(general, "utf8")).patterns.length, 0);
    run(path.join(Tool, "dresscode.mjs"), [p, "suggest", "--sec", "Goals#4", "--publish"], { env });
    const written = JSON.parse(fs.readFileSync(general, "utf8")).patterns;
    assert.equal(written.length, 1); assert.ok(!("examples" in written[0]), "no product text is written to Nosy");
    const fresh = pmCopy(); // a "different product" that has never seen a verdict
    try { const P = score(fresh, { today: "2026-09-28", general: written });
      assert.equal(P.fields.find(a => a.name === "Goals").checks[3].eliminated?.[0]?.scope, "Nosy"); }
    finally { clean(fresh); }
  } finally { clean(p); }
});

// --- generalization (rejections of the same trigger with different neighbors, on the same check, into one pattern) ---
test("generalization: server/MCP catalog merge into one pattern; the protected 'component catalog' isn't included; a comma is a neighbor boundary; it replaces the old pattern", async () => {
  const d = temporary("nosy-dresscode-general-");
  try {
    const r = path.join(d, "repo"), p = path.join(d, "pm"), general = path.join(d, "general.json");
    gitRepo(r, {
      "docs/design-system/DIRECTION.md": DIRECTION,
      "docs/design-system/DESIGN.md": "# Design\n\n## Colors\n\nThe live component catalog shows every part in both themes.\n\n## Agents\n\nAgents get tokens and server catalog.\n",
      "AGENTS.md": "# Agents\n\n- `docs/mcp.md` is the current MCP catalog, OAuth, and safety boundary.\n",
      "web/src/index.css": ":root { --primary: 1 2% 3%; }\n",
    });
    fs.mkdirSync(p); fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: r, ref: "main" }));
    fs.writeFileSync(general, JSON.stringify({ patterns: [] }));
    const env = { ...process.env, NOSY_EXCEPTION: general };
    const id = "Design–Code Alignment#3";
    const { verdictWrite, suggest } = await import("../tools/dresscode.mjs");
    const P = score(p, { today: "2026-09-28", general: [] });
    const hit = t => P._everything.find(h => h.id === id && h.line.includes(t));
    verdictWrite(p, [hit("server catalog"), hit("MCP catalog")].map(h => ({ key: h.key, decision: "no", reason: "a tool catalog" })), "agent");
    fs.mkdirSync(path.join(p, "design"), { recursive: true });
    const approval = JSON.parse(fs.readFileSync(path.join(p, "design", "approvals.json"), "utf8"));
    approval.exception = [{ id, pattern: "\\bserver\\W+catalog\\b", reason: "old", date: "2026-09-27" }];
    fs.writeFileSync(path.join(p, "design", "approvals.json"), JSON.stringify(approval));
    const list = suggest([p], { general: [] });
    const b = list.find(x => x.merged);
    assert.ok(b, JSON.stringify(list));
    const bre = new RegExp(b.pattern, "i");
    assert.deepEqual(b.neighbors.sort(), ["MCP", "server"]);
    assert.ok(bre.test("tokens and server catalog.") && bre.test("the current MCP catalog, OAuth") && bre.test("server catalogs"), b.pattern);
    assert.ok(!/component/i.test(b.pattern), "a protected neighbor doesn't join the generalization");
    assert.ok(!list.some(x => /OAuth/.test(x.pattern)), "the word after a comma isn't a neighbor");
    assert.deepEqual(b.instead, [{ pattern: "\\bserver\\W+catalog\\b", scope: "product" }]);
    const u = run(path.join(Tool, "dresscode.mjs"), [p, "suggest", "--sec", id, "--apply"], { env });
    assert.equal(u.code, 0, u.error);
    const last = JSON.parse(fs.readFileSync(path.join(p, "design", "approvals.json"), "utf8")).exception.filter(x => x.id === id);
    assert.equal(last.length, 1, "the old narrow pattern is deleted, only one pattern remains"); assert.equal(last[0].pattern, b.pattern);
    assert.deepEqual(last[0].structure, { side: "left", root: ["catalog"], neighbors: ["MCP", "server"] }, "the structure is written to the record");
    const P2 = score(p, { today: "2026-09-28", general: [] });
    const c = P2.fields.find(a => a.name === "Design–Code Alignment").checks[2];
    assert.ok(c.evidence, "the check doesn't stay without evidence");
    const re = new RegExp(last[0].pattern, "i"), lines = P2._everything.filter(h => h.id === id);
    assert.deepEqual(lines.filter(h => re.test(h.line)).map(h => h.evidence).sort(), ["AGENTS.md:3", "docs/design-system/DESIGN.md:9"]);
    assert.ok(!re.test(lines.find(h => /component catalog/.test(h.line)).line), "the genuine 'component catalog' line isn't eliminated");
    // A generalization of a pattern already published to Nosy is published (without a selection) via --publish.
    fs.writeFileSync(general, JSON.stringify({ patterns: [{ id, pattern: "\\bserver\\W+catalog\\b", reason: "not a tool catalog" }] }));
    const approval2 = JSON.parse(fs.readFileSync(path.join(p, "design", "approvals.json"), "utf8")); approval2.exception = []; fs.writeFileSync(path.join(p, "design", "approvals.json"), JSON.stringify(approval2));
    const y = run(path.join(Tool, "dresscode.mjs"), [p, "suggest", "--publish"], { env });
    assert.match(y.output, /1 pattern\(s\) written to Nosy/, y.output + y.error);
    const g = JSON.parse(fs.readFileSync(general, "utf8")).patterns.filter(x => x.id === id);
    assert.equal(g.length, 1); assert.equal(g[0].pattern, b.pattern); assert.equal(g[0].reason, "not a tool catalog", "keeps the old reason");
  } finally { clean(d); }
});

// --- internal requests 50, 54, 63 ---

test("`learn reject --type dresscode` eliminates a matching line, the same way an exception pattern does (only where approvals.json has no decision of its own on that line)", () => {
  const p = pmCopy();
  try {
    const P0 = score(p, { today: "2026-09-28" });
    assert.ok(P0.candidates.some(x => x.id === "Goals#2"), "Goals#2 should start as a waiting candidate");
    const r = run(path.join(Tool, "learn.mjs"), [p, "reject", "success signal", "--context", "Goals", "--type", "dresscode", "--reason", "test: a table heading, not a decision"]);
    assert.equal(r.code, 0, r.error);
    const P = score(p, { today: "2026-09-28" });
    const c = P.fields.find(a => a.name === "Goals").checks[1];
    assert.equal(c.eliminated?.[0]?.scope, "learn");
    assert.equal(c.eliminated?.[0]?.pattern, "success signal");
    assert.ok(!P.candidates.some(x => x.id === "Goals#2"), "an eliminated line never becomes a candidate again");
  } finally { clean(p); }
});

test("a reject rule in a different context doesn't eliminate a line for this check", () => {
  const p = pmCopy();
  try {
    run(path.join(Tool, "learn.mjs"), [p, "reject", "success signal", "--context", "a completely unrelated topic", "--type", "dresscode", "--reason", "test"]);
    const P = score(p, { today: "2026-09-28" });
    const c = P.fields.find(a => a.name === "Goals").checks[1];
    assert.ok(!c.eliminated?.length, "context didn't match: the line should still be a candidate");
    assert.ok(P.candidates.some(x => x.id === "Goals#2"));
  } finally { clean(p); }
});

test("at most `thresholds.dresscodeMaxCandidates` candidates are tried per check; past that, ✗ with a note, and no new candidate is proposed", () => {
  const p = pmCopy();
  try {
    const K = JSON.parse(fs.readFileSync(path.join(p, "sources.json"), "utf8"));
    K.threshold = { dresscodeMaxCandidates: 1 };
    fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify(K));
    fs.mkdirSync(path.join(p, "design"), { recursive: true });
    fs.writeFileSync(path.join(p, "design", "approvals.json"), JSON.stringify({ decisions: { "Goals#2|synthetic|1": { decision: "no", reason: "test", source: "agent", date: "2026-09-27" } }, add: {}, exception: [] }));
    const P = score(p, { today: "2026-09-28" });
    const c = P.fields.find(a => a.name === "Goals").checks[1];
    assert.equal(c.evidence, null);
    assert.match(c.detail, /^1 candidates rejected — owner can add evidence with `add Goals#2 <file:line>`$/);
    assert.ok(!P.candidates.some(x => x.id === "Goals#2"), "capped: no new candidate is proposed for this check");
  } finally { clean(p); }
});

test("below the cap, a candidate is still proposed as usual", () => {
  const p = pmCopy();
  try {
    fs.mkdirSync(path.join(p, "design"), { recursive: true });
    fs.writeFileSync(path.join(p, "design", "approvals.json"), JSON.stringify({ decisions: { "Goals#2|synthetic|1": { decision: "no", reason: "test", source: "agent", date: "2026-09-27" } }, add: {}, exception: [] }));
    const P = score(p, { today: "2026-09-28" }); // default cap is 3; 1 rejection isn't enough to close the check
    const c = P.fields.find(a => a.name === "Goals").checks[1];
    assert.ok(P.candidates.some(x => x.id === "Goals#2"));
    assert.equal(c.detail, undefined);
  } finally { clean(p); }
});

test("a rejected line (judge's `decision` or the owner's `reject`) is also written through learn's storage (type dresscode) — the bridge internal request 63 reads back", () => {
  const p = pmCopy();
  try {
    run(path.join(Tool, "dresscode.mjs"), [p, "--today", "2026-09-28"]);
    const cand = JSON.parse(fs.readFileSync(path.join(p, "state", "dresscode-verify.json"), "utf8")).candidates.find(x => x.id === "Tokens#3");
    assert.ok(cand, "Tokens#3 should have a waiting candidate");
    const r = run(path.join(Tool, "dresscode.mjs"), [p, "reject", "Tokens#3", cand.evidence, "--reason", "test: not really two themes"]);
    assert.equal(r.code, 0, r.error);
    const learned = JSON.parse(fs.readFileSync(path.join(p, "learned.json"), "utf8"));
    const rule = learned.rules.find(k => k.tip === "reject" && k.type === "dresscode");
    assert.ok(rule, JSON.stringify(learned));
    assert.equal(rule.context, "Tokens");
    assert.match(rule.reason, /not really two themes/);
    // A fresh product/run that never got an approvals.json decision on this line, but shares this learn record.
    const fresh = pmCopy();
    try {
      fs.writeFileSync(path.join(fresh, "learned.json"), JSON.stringify(learned));
      const P = score(fresh, { today: "2026-09-28" });
      const c = P.fields.find(a => a.name === "Tokens").checks[2];
      assert.equal(c.eliminated?.[0]?.scope, "learn");
    } finally { clean(fresh); }
  } finally { clean(p); }
});

test("the judge's (agent) rejection via `decision` also writes the bridge record, with the area + check label as context", () => {
  const p = pmCopy();
  try {
    run(path.join(Tool, "dresscode.mjs"), [p, "--today", "2026-09-28"]);
    const principle = JSON.parse(fs.readFileSync(path.join(p, "state", "dresscode-verify.json"), "utf8")).candidates.find(x => x.id === "Principles#2");
    assert.ok(principle);
    const verdict = path.join(p, "verdicts.json");
    fs.writeFileSync(verdict, JSON.stringify([{ key: principle.key, decision: "no", reason: "a heading, not an ordering rule" }]));
    const k = run(path.join(Tool, "dresscode.mjs"), [p, "decision", verdict]);
    assert.equal(k.code, 0, k.error);
    const learned = JSON.parse(fs.readFileSync(path.join(p, "learned.json"), "utf8"));
    const rule = learned.rules.find(x => x.tip === "reject" && x.type === "dresscode" && x.context.startsWith("Principles"));
    assert.ok(rule, JSON.stringify(learned));
    assert.match(rule.context, /^Principles /);
  } finally { clean(p); }
});

test("generalization (67): a single-word neighbor that matches a protected line falls back to a two-word predecessor; suffix flexibility merges catalog/catalogs; word boundary is respected", async () => {
  const d = temporary("nosy-dresscode-67-");
  try {
    const r = path.join(d, "repo"), p = path.join(d, "pm");
    gitRepo(r, {
      "docs/design-system/DIRECTION.md": DIRECTION,
      "docs/design-system/DESIGN.md": "# Design\n\n## Colors\n\nThe API catalog of components is drawn live.\n\n## Agents\n\nAgents read the public API catalog first.\n\nThey also read the MCP catalog.\n\nThe server catalogs stay in sync.\n",
      "web/src/index.css": ":root { --primary: 1 2% 3%; }\n",
    });
    fs.mkdirSync(p); fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: r, ref: "main" }));
    const id = "Design–Code Alignment#3";
    const { verdictWrite, suggest } = await import("../tools/dresscode.mjs");
    const P = score(p, { today: "2026-09-28", general: [] });
    const hit = t => P._everything.find(h => h.id === id && h.line.includes(t));
    const rejections = ["public API catalog", "MCP catalog", "server catalogs"].map(hit);
    assert.ok(rejections.every(Boolean), JSON.stringify(P._everything.filter(h => h.id === id).map(h => h.line)));
    verdictWrite(p, rejections.map(h => ({ key: h.key, decision: "no", reason: "a tool catalog" })), "agent");
    const list = suggest([p], { general: [] }).filter(x => x.merged);
    const en = list.find(x => x.structure.root[0] === "catalog");
    assert.ok(en, JSON.stringify(list.map(x => x.pattern)));
    assert.deepEqual(en.neighbors.sort(), ["MCP", "public API", "server"], "'API' alone matches the protected line; the two-word predecessor is chosen instead");
    const ere = new RegExp(en.pattern, "i");
    assert.ok(!ere.test("The API catalog of components is drawn live."), "the protected line isn't eliminated");
    assert.ok(ere.test("Agents read the public API catalog first."));
    assert.ok(ere.test("The server catalogs stay in sync."), "suffix flexibility: catalog/catalogs");
    assert.ok(!ere.test("theservercatalog"), "word boundary");
  } finally { clean(d); }
});
