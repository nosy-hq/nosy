// The release acceptance scenario from the BlogFactory field report (Codex, 3-4 Oct 2026), as far as it needs no model: one product walked from install to a published
// dashboard payload, with every trap the field test fell into set on purpose. Each step is a thing that went wrong once; the test fails if any of them comes back.
//   install (success first, hooks optional) → own column in place → four blank rival stubs need work → first research applied without seeding → rebuild keeps everything →
//   a known capability and a real refusal in canwe → architecture prose is not a task → the sweep and the files are compared → the market is more than four →
//   a page at a non-default path is found, validated and drawn with its rivals-this-week box → a bot author called Claude and "Claude Code" evidence publish with no override,
//   a secret still stops → the date is the owner's → losing the own column stops the publish.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { teamNext } from "../tools/team-next.mjs";
import { tour } from "../tools/tour.mjs";
import { plan as tierPlan } from "../tools/rival-tiers.mjs";
import { localDay } from "../tools/today.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const J = JSON.stringify, readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
const env = { ...process.env, GIT_AUTHOR_NAME: "Claude", GIT_AUTHOR_EMAIL: "bot@example.invalid", GIT_COMMITTER_NAME: "Claude", GIT_COMMITTER_EMAIL: "bot@example.invalid" };
const git = (root, ...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env });

// ---- the product: BlogFactory in miniature ------------------------------------------------------------------------------------------
const root = temporary("nosy-journey-"); dirs.push(root);
const pm = path.join(root, "pm");
const put = (f, body) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof body === "string" ? body : J(body, null, 1)); };
const rivalStub = (name, rows = ["Draft", "Review"]) => `# ${name}\n\n- **Category:** content agent\n- **Site:** https://${name.toLowerCase().replace(/\W+/g, "")}.example\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n${rows.map((r, i) => `| ${i + 1} | ${r} | | |`).join("\n")}\n\n## Sources\n- https://${name.toLowerCase().replace(/\W+/g, "")}.example/docs (2026-10-03)\n`;
const RIVALS = { mercury: "Mercury CMS", lightcms: "LightCMS", pagible: "Pagible", ghostly: "Ghostly" };

test("0. the product repo: commits by an author called Claude, architecture prose, a plan with open items, and a guard comment that shares a word with a question", () => {
  git(root, "init", "-q", "-b", "main");
  put("src/delivery.ts", "// Draft-only delivery: the connector can create drafts and nothing else.\nexport const createDraft = () => 'draft';\n");
  put("src/guardrails.ts", "// Failures are deliberately not enforced: refusing to generate because earlier calls failed.\nexport const enforceCeilings = () => {};\n");
  put("src/api.ts", "export {}\n");
  put("src/queue.ts", "export {}\n");
  put("docs/architecture.md", "# Architecture\n");
  put("FEATURE_PLAN.md", "# Plan\n");
  put("AGENTS.md", "# Agents\n");
  for (let i = 0; i < 30; i++) put(`src/filler/f${i}.ts`, `// draft delivery sites only ${i}\n`);
  git(root, "add", "."); git(root, "commit", "-qm", "init");
  const arch = ["Production runs the API in `src/api.ts` with Bun.", "The queue worker lives in `src/queue.ts` and reads one table.", "This repository is the canonical shared core of `src/delivery.ts`.", "Sessions are signed cookies in `src/api.ts`.", "The scheduler in `src/queue.ts` ticks once a minute.", "Static files are served from `src/api.ts`."];
  arch.forEach((t, i) => { fs.appendFileSync(path.join(root, "docs/architecture.md"), `\n${t}\n`); fs.appendFileSync(path.join(root, "FEATURE_PLAN.md"), i < 5 ? `\n- [ ] **Step ${i}.** Wire \`src/queue.ts\` to the new retry (K${i + 1}).\n` : "\n"); git(root, "add", "."); git(root, "commit", "-qm", `docs ${i}`); });
  assert.ok(fs.existsSync(path.join(root, ".git")));
});

test("1. install: success first, hooks said to be optional, the copy keeps its version, no hook was touched", () => {
  const r = run(path.join(Tool, "install.mjs"), ["--dir", root, "--providers", "codex"]);
  assert.equal(r.code, 0, r.error);
  assert.ok(r.output.indexOf("Nosy is installed and works now") < r.output.indexOf("Optional automation is off"), "success before the hooks line");
  assert.equal(fs.existsSync(path.join(root, ".git", "hooks", "post-commit")), false, "no git hook was added");
  assert.notEqual(readJson(path.join(root, ".agents", "skills", "nosy", ".nosy-install.json")).version, "unknown");
});

test("2. setup: the owner's own column is in matrix.json, the page is named in product.md, a time zone is set", () => {
  put("pm/sources.json", { repo: ".", ref: "main", timezone: "Europe/Istanbul", matrix: path.join(pm, "matrix.json"),
    rivals: Object.fromEntries(Object.entries(RIVALS).map(([slug, name]) => [slug, { name }])) });
  put("pm/product.md", "# BlogFactory\n\n- **Page:** `pm/status-page.html` · scope: product decisions\n");
  put("pm/matrix.json", { update: "2026-10-03", codes: { y: "exists" }, steps: [{ no: "1", name: "Draft" }, { no: "2", name: "Review" }], biz: { name: "BlogFactory", codes: { 1: "y", 2: "y" }, notes: { 1: "", 2: "" } }, products: [] });
  assert.equal(readJson(path.join(pm, "matrix.json")).biz.name, "BlogFactory");
});

test("3. four new blank rival stubs are 'new stub', not fresh, and a first rebuild changes nothing it shouldn't", () => {
  for (const [slug, name] of Object.entries(RIVALS)) put(`pm/rivals/${slug}.md`, rivalStub(name));
  const P = tierPlan(pm, { now: Date.now() });
  assert.deepEqual(P.tiers.A.needsWork.sort(), Object.keys(RIVALS).sort());
  assert.ok(P.tiers.A.rivals.every(r => r.status === "new stub"));
  const before = fs.readFileSync(path.join(pm, "matrix.json"), "utf8");
  const b = run(path.join(Tool, "build-matrix.mjs"), [pm]);
  assert.equal(b.code, 0); assert.match(b.output, /No rival file has a feature table yet/);
  assert.equal(fs.readFileSync(path.join(pm, "matrix.json"), "utf8"), before, "blank stubs leave the owner's matrix alone");
});

test("4. the first research is applied with nothing seeded by hand: columns appear, our own survives a rebuild", () => {
  const evidence = slug => [{ url: `https://${slug}.example/docs`, grade: "primary", page_opened: true, date_kind: "none" }];
  put("pm/state/matrix-proposals.json", { proposals: Object.keys(RIVALS).flatMap(slug => [{ rival: RIVALS[slug], step: "1", from: "u", to: slug === "ghostly" ? "n" : "y", evidence: evidence(slug) }]) });
  const MP = path.join(Tool, "matrix-proposals.mjs");
  assert.equal(run(MP, ["check", pm]).code, 0);
  const ap = run(MP, ["apply", pm]); assert.equal(ap.code, 0, ap.error + ap.output);
  assert.deepEqual(readJson(path.join(pm, "matrix.json")).products.map(p => p.name).sort(), Object.values(RIVALS).sort());
  const b = run(path.join(Tool, "build-matrix.mjs"), [pm]); assert.equal(b.code, 0, b.error);
  const M = readJson(path.join(pm, "matrix.json"));
  assert.equal(M.products.length, 4); assert.deepEqual(M.biz.codes, { 1: "y", 2: "y" }, "our own column is still there after the rebuild");
  assert.equal(M.products.find(p => p.name === "Ghostly").codes["1"].k, "n");
});

test("5. canwe: the guard comment that shares 'enforce' is a lead, not a decision; a line that names the feature and refuses it is", () => {
  const Q = "Can we enforce draft-only delivery across multiple sites?";
  const lead = run(NOSY, ["canwe", Q, "--pm", pm]);
  assert.doesNotMatch(lead.output, /There's a decision: not doing this/, lead.output.slice(0, 1500));
  assert.match(lead.output, /a lead only/);
  put("src/multisite.ts", "// enforce draft delivery on multiple sites: not supported\nexport const enforceMultiSite = () => {};\n");
  git(root, "add", "."); git(root, "commit", "-qm", "multisite guard");
  const real = run(NOSY, ["canwe", Q, "--pm", pm]);
  assert.match(real.output, /decision: not doing this/i, "a refusal on a line that names the feature still counts");
});

test("6. architecture sentences are not the team's next list; the plan's open items are", () => {
  const R = teamNext(pm);
  assert.deepEqual(R.files, ["FEATURE_PLAN.md"], `the plan is proposed, the architecture page is not: ${R.found}`);
  const titles = R.items.map(i => i.title + " " + (i.text || ""));
  assert.ok(R.items.length >= 3, "the plan's open items are the list: " + titles.join(" | "));
  assert.ok(!titles.some(t => /Production runs the API|canonical shared core|Sessions are signed cookies/.test(t)), titles.join(" | "));
});

test("7. the sweep is compared with the rival files: a newer entry than the file says is 'behind' until the row is updated", () => {
  put("pm/rivals/lightcms.md", fs.readFileSync(path.join(pm, "rivals", "lightcms.md"), "utf8").replace("- **Site:**", "- **Latest major announcement:** 2026-07-14 — 7.2.2 (https://lightcms.example/releases) · delivery: shipped\n- **Site:**"));
  put("pm/state/rival-sweep.json", { from: "2026-09-04", to: "2026-10-04", rivals: [{ slug: "lightcms", name: "LightCMS", pages: [{ kind: "releases", url: "https://lightcms.example/releases", ok: true, entries: [{ date: "2026-10-02", text: "7.3.1" }] }] }] });
  assert.equal(run(NOSY, ["sweep-check", "--pm", pm]).code, 2);
  put("pm/rivals/lightcms.md", fs.readFileSync(path.join(pm, "rivals", "lightcms.md"), "utf8").replace("2026-07-14 — 7.2.2", "2026-10-02 — 7.3.1"));
  assert.equal(run(NOSY, ["sweep-check", "--pm", pm]).code, 0);
});

test("8. the market is more than the first four: 'known' candidates and the stopping rule", () => {
  put("pm/state/rival-universe.json", { searches: [{ date: "2026-10-03", query: "alternatives to X", added: 4 }, { date: "2026-10-04", query: "vs Y", added: 3 }], candidates: [
    ...Object.values(RIVALS).map(name => ({ name, class: "direct", status: "compared" })),
    { name: "SEOPro AI", class: "feature", status: "known" }, { name: "OpenGSC", class: "feature", status: "known" }, { name: "StoryRail", class: "adjacent", status: "excluded", reason: "editorial governance only" }] });
  const r = run(NOSY, ["universe", "--pm", pm]);
  assert.equal(r.code, 2, "not finished: the last search still added candidates"); assert.match(r.output, /4 compared · 2 known, not researched · 1 excluded/);
  const U = readJson(path.join(pm, "state", "rival-universe.json")); U.searches.push({ date: "2026-10-05", added: 0 }, { date: "2026-10-06", added: 0 });
  put("pm/state/rival-universe.json", U);
  assert.equal(run(NOSY, ["universe", "--pm", pm]).code, 0, "two searches in a row added nothing");
});

test("9. the page is at pm/status-page.html: built there, found by tour, valid, with a sourced rivals-this-week box", () => {
  put("pm/state/rivals-this-week.json", { window: { from: "2026-09-27", to: "2026-10-04" }, items: [{ rival: "LightCMS", text: "7.3.1 shipped", url: "https://lightcms.example/releases", date: "2026-10-02", delivery: "shipped" }, { rival: "Pagible", text: "an unsourced rumour", date: "2026-10-03" }] });
  const built = run(NOSY, ["page", "--pm", pm]); assert.equal(built.code, 0, built.error + built.output);
  const page = path.join(pm, "status-page.html");
  assert.ok(fs.existsSync(page), "built where product.md says"); assert.equal(fs.existsSync(path.join(pm, "page.html")), false, "and not beside it");
  const html = fs.readFileSync(page, "utf8");
  assert.match(html, /id="rivals-week"/); assert.match(html, /7\.3\.1 shipped/); assert.doesNotMatch(html, /unsourced rumour/);
  const v = run(NOSY, ["page", "validate", "--pm", pm]); assert.equal(v.code, 0, v.output + v.error); assert.match(v.output, /2 steps × 4 rivals \+ our own column/);
  fs.writeFileSync(path.join(pm, "state", "shipped.json"), J({ generated: new Date(Date.now() - 3600e3).toISOString() }));
  assert.equal(tour(pm).steps.find(s => s.id === "tea").state, "fresh", "tour sees the page where it is");
});

test("10. publish: a bot author called Claude and 'Claude Code' in the evidence go with no override; a secret still stops it", () => {
  put("pm/state/status.json", { generated: "2026-10-04T00:00:00Z", range: "r", main: 3, pr: 0, lastMain: "206eb1b", groups: [{ ref: "#1", n: 3, where: ["main"], who: ["Claude"], last: "09.30 10:00 AM" }], prs: [] });
  const M = readJson(path.join(pm, "matrix.json")); M.products[0].codes["1"].evidence = "Ships as a plugin for Claude Code and Claude Desktop."; put("pm/matrix.json", M);
  const dry = () => run(path.join(Tool, "publish.mjs"), [pm, "--url", "http://127.0.0.1:9", "--dry-run", "--full"]);
  const ok = dry(); assert.equal(ok.code, 0, ok.output + ok.error);
  put("pm/summary.md", "## Summary\n- Contact jane.doe.work@gmail.com about Claude Code.\n");
  const bad = dry(); assert.equal(bad.code, 1, "an e-mail address still stops it"); assert.match(bad.output + bad.error, /E-mail/);
  fs.rmSync(path.join(pm, "summary.md"));
});

test("11. the owner's day: a bet is dated by sources.json timezone, not by UTC", () => {
  const r = run(NOSY, ["bet", "place", "Probe", "--why", "x", "--estimate", "S", "--basis", "intent", "--rests-on", "none", "--expect", "y", "--pm", pm]);
  assert.equal(r.code, 0, r.error + r.output);
  const f = fs.readdirSync(path.join(pm, "bets")).find(x => x.endsWith(".md"));
  const process_tz = process.env.NOSY_TZ; process.env.NOSY_TZ = "Europe/Istanbul";
  try { assert.match(f, new RegExp(`^nb-${localDay().slice(2).replace(/-/g, "")}-`), f); } finally { if (process_tz === undefined) delete process.env.NOSY_TZ; else process.env.NOSY_TZ = process_tz; }
});

test("12. losing the own column stops the publish and the page check, with the way back; restoring it makes both pass again", () => {
  const good = fs.readFileSync(path.join(pm, "matrix.json"), "utf8"), M = JSON.parse(good);
  put("pm/matrix.json", { ...M, biz: null });
  const pub = run(path.join(Tool, "publish.mjs"), [pm, "--url", "http://127.0.0.1:9", "--dry-run"]);
  assert.equal(pub.code, 1); assert.match(pub.error + pub.output, /no usable column for your own product/);
  const doc = run(NOSY, ["doctor", "--check", "--pm", pm]); assert.match(doc.output, /no column for your own product/);
  fs.writeFileSync(path.join(pm, "matrix.json"), good);
  assert.equal(run(path.join(Tool, "publish.mjs"), [pm, "--url", "http://127.0.0.1:9", "--dry-run"]).code, 0);
});

test("13. before Nosy: the repository's past is readable on day one, locally", () => {
  const r = run(NOSY, ["history", "90d", "--pm", pm]); assert.equal(r.code, 0, r.error + r.output);
  const H = readJson(path.join(pm, "state", "history.json")); assert.equal(H.kind, "before-nosy"); assert.ok(H.commits.count >= 5);
});
