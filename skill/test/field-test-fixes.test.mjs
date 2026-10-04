// Fixes from the BlogFactory field test (3 Oct 2026, Codex, Nosy 0.21.0). Each test pins a bug that was reproduced on the real product:
//   build-matrix dropped the own-product column (biz: null → "0 done"); diff treated pm/history/watch as the latest snapshot;
//   canwe said "there's a decision: not doing this" because an unrelated comment ("Failures are deliberately not enforced") sat next to "enforce".
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const tmp = p => { const d = temporary(p); dirs.push(d); return d; };
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));

// --- build-matrix: our own column survives a rebuild ------------------------------------------------------------------------
const RIVAL = "# Acme\n\n- **Category:** CRM\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Draft | y | docs |\n| 2 | Review | n | none |\n";

test("build-matrix keeps the own-product column from matrix.json when there is no pm/us.json", () => {
  const pm = path.join(tmp("nosy-bm-biz-"), "pm");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  const biz = { name: "BlogFactory", codes: { 1: "y", 2: "y" }, notes: { 1: "", 2: "" } };
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify({ steps: [{ no: 1, name: "Draft" }, { no: 2, name: "Review" }], biz, products: [] }));
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), RIVAL);
  const r = run(path.join(Tool, "build-matrix.mjs"), [pm]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /own column kept from the existing matrix\.json/);
  const M = readJson(path.join(pm, "matrix.json"));
  assert.deepEqual(M.biz, biz, "biz is not null after a rebuild");
  assert.equal(M.products.length, 1);
});

test("build-matrix: pm/us.json, when present, still wins over the old column; with neither, biz stays null", () => {
  const pm = path.join(tmp("nosy-bm-biz2-"), "pm");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), RIVAL);
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [pm]).code, 0);
  assert.equal(readJson(path.join(pm, "matrix.json")).biz, null, "a first build with no own column is unchanged");
  fs.writeFileSync(path.join(pm, "us.json"), JSON.stringify({ name: "New", codes: { 1: "p" } }));
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [pm]).code, 0);
  assert.equal(readJson(path.join(pm, "matrix.json")).biz.name, "New");
});

// --- diff: only timestamped folders are snapshots --------------------------------------------------------------------------
test("diff: pm/history/watch is not a snapshot (it must not become 'the last save' or be deleted by --clean)", () => {
  const pm = path.join(tmp("nosy-diff-watch-"), "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const lh = items => fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ type: "lowHanging", generated: new Date().toISOString(), items }));
  lh([{ title: "Export endpoint", type: "Backend ready, not on screen", evidence: "x.md", score: 2.5, effort: "S" }]);
  const DIFF = path.join(Tool, "diff.mjs");
  assert.equal(run(DIFF, [pm, "save"]).code, 0);
  fs.mkdirSync(path.join(pm, "history", "watch"), { recursive: true });
  fs.writeFileSync(path.join(pm, "history", "watch", "rival.json"), "{}");
  const again = run(DIFF, [pm, "save"]);
  assert.match(again.output, /no change/, `a storage folder next to the snapshots must not count as the last save: ${again.output}`);
  const snapshots = () => fs.readdirSync(path.join(pm, "history"), { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== "watch").length;
  assert.equal(snapshots(), 1);
  assert.equal(run(DIFF, [pm, "save", "--clean", "0"]).code, 0);
  assert.ok(fs.existsSync(path.join(pm, "history", "watch", "rival.json")), "--clean leaves watch/ alone");
});

// --- canwe: one shared word is not a decision ------------------------------------------------------------------------------
function repo(files) {
  const root = tmp("nosy-canwe-lead-");
  const put = (f, s) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  // The subject's own words are in every file: too common to anchor on, as "draft", "delivery" and "sites" were on BlogFactory.
  for (let i = 0; i < 30; i++) put(`src/other/f${i}.js`, `// draft delivery sites only ${i}\n`);
  for (const [f, s] of Object.entries(files)) put(f, s);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  return pm;
}
const Q = "Can we enforce draft-only delivery across multiple sites?";
const verdictOf = o => (o.match(/## Suggested verdict[^\n]*\n\n\*\*(.*?)\*\*/) || [])[1];

test("canwe: a refusal that shares only one word with a long question is a lead, not a decision", () => {
  const pm = repo({ "src/guard.js": "// Failures are deliberately not enforced: refusing to generate because earlier calls failed\nexport const enforceLimits = () => {};\n" });
  const r = run(path.join(Tool, "canwe.mjs"), [pm, Q]);
  assert.equal(r.code, 0, r.error);
  assert.doesNotMatch(verdictOf(r.output) || "", /decision: not doing this/, r.output);
  assert.match(r.output, /guard\.js:1 .*deliberately not enforced.*\(a lead only: it shares just one word with the question/, "still listed, marked as a lead");
  assert.match(r.output, /conflict, needs review/, "the guidance tells the agent what to do with a lead");
});

test("canwe: a refusal on a line that names several of the question's words still drives the verdict", () => {
  const pm = repo({ "src/guard.js": "// enforce draft delivery on multiple sites: not supported\nexport const enforceLimits = () => {};\n" });
  const r = run(path.join(Tool, "canwe.mjs"), [pm, Q]);
  assert.equal(r.code, 0, r.error);
  assert.match(verdictOf(r.output) || "", /decision: not doing this/, r.output);
  assert.doesNotMatch(r.output, /\(a lead only: it shares/, "the line is not marked as a lead");
});

// --- the page the owner named is the page every command looks at -----------------------------------------------------------
import { pagePath, pageFromProduct } from "../tools/page-path.mjs";
import { tour } from "../tools/tour.mjs";

function pmWithPage({ product, sources = { repo: ".", ref: "main" }, files = {} } = {}) {
  const root = tmp("nosy-pagepath-"), pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify(sources));
  if (product) fs.writeFileSync(path.join(pm, "product.md"), product);
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); }
  return pm;
}
const PRODUCT = "# P\n\n- **Roadmap source:** `FEATURE_PLAN.md`. (inferred: `AGENTS.md:6`)\n- **Page:** `pm/status-page.html` · scope: product decisions; no secrets. (inferred: `AGENTS.md:19`)\n- **Other pages:** `https://example.com/index.html` — marketing.\n";

test("page-path: product.md's English 'Page:' line (repo-relative, with a pm/ prefix) is found, and other lines naming a page are not", () => {
  const pm = pmWithPage({ product: PRODUCT, files: { "pm/status-page.html": "<html></html>" } });
  assert.equal(pageFromProduct(pm), "pm/status-page.html");
  const r = pagePath(pm, readJson(path.join(pm, "sources.json")));
  assert.equal(r.path, path.join(path.dirname(pm), "pm", "status-page.html"), "not pm/pm/status-page.html");
  assert.deepEqual([r.exists, r.configured, r.source], [true, true, "product.md Page line"]);
});

test("page-path: order is explicit · sources.json page (pm-relative) · product.md · pm/page.html · pm/status-page.html · default", () => {
  const pm = pmWithPage({ product: PRODUCT, sources: { repo: ".", page: "mine.html" }, files: { "pm/mine.html": "x", "pm/status-page.html": "x", "pm/page.html": "x" } });
  const K = readJson(path.join(pm, "sources.json"));
  assert.equal(pagePath(pm, K, { explicit: "/tmp/x.html" }).path, "/tmp/x.html");
  assert.equal(pagePath(pm, K).path, path.join(pm, "mine.html"), "sources.json beats product.md");
  assert.equal(pagePath(pm, { repo: "." }).path, path.join(path.dirname(pm), "pm", "status-page.html"), "then product.md");
  const bare = pmWithPage({ files: { "pm/status-page.html": "x" } });
  assert.deepEqual([pagePath(bare, {}).path, pagePath(bare, {}).configured], [path.join(bare, "status-page.html"), false], "an unconfigured pm/status-page.html is found");
  fs.writeFileSync(path.join(bare, "page.html"), "x");
  assert.equal(pagePath(bare, {}).path, path.join(bare, "page.html"), "pm/page.html wins when both exist");
  const none = pmWithPage();
  assert.deepEqual([pagePath(none, {}).path, pagePath(none, {}).exists], [path.join(none, "page.html"), false]);
  assert.equal(pagePath(pmWithPage({ sources: { page: "https://x.example/p.html" } }), { page: "https://x.example/p.html" }).source, "default", "a URL is not a file");
});

test("tour (and so next): a page at the configured path is a page; it said 'no page yet' for pm/status-page.html", () => {
  const old = new Date(Date.now() - 3600_000).toISOString(), now = Date.now() + 10_000;
  const make = withPage => {
    const pm = pmWithPage({ product: PRODUCT, files: withPage ? { "pm/status-page.html": "<html></html>" } : {} });
    fs.writeFileSync(path.join(pm, "state", "shipped.json"), JSON.stringify({ generated: old }));
    return tour(pm, { now }).steps.find(x => x.id === "tea");
  };
  assert.deepEqual([make(true).state, make(true).why], ["fresh", "the page is current"]);
  assert.deepEqual([make(false).state, make(false).why], ["todo", "no page yet"], "no page at all still suggests tea");
});

test("freshness reads the same page (it looked for pm/pm/status-page.html and, with no Turkish label, for nothing)", () => {
  const pm = pmWithPage({ product: PRODUCT, files: { "pm/status-page.html": "<html><body>2026-10-03</body></html>" } });
  const r = run(path.join(Tool, "freshness.mjs"), [pm]);
  assert.match(r.output, /\| page: auto section \|/, "the page was opened (that row only exists for a page that is there)");
  assert.doesNotMatch(r.output, /no page path|status-page\.html not found/);
  const none = run(path.join(Tool, "freshness.mjs"), [pmWithPage({ product: PRODUCT })]);
  assert.match(none.output, /status-page\.html not found/, "a named page that isn't there is said by name");
});

// --- the calendar day is the owner's, not UTC's -------------------------------------------------------------------------------
import { localDayOf, localDay } from "../tools/today.mjs";
import { addNote } from "../tools/rival-signals.mjs";

const withTz = (tz, fn) => { const old = process.env.NOSY_TZ; process.env.NOSY_TZ = tz; try { return fn(); } finally { if (old === undefined) delete process.env.NOSY_TZ; else process.env.NOSY_TZ = old; } };

test("today.mjs: 02:00 on 4 October in Istanbul is 4 October, while its UTC day is still 3 October", () => {
  const at = new Date("2026-10-03T23:00:00Z"); // 02:00 on the 4th in Europe/Istanbul (UTC+3)
  assert.equal(at.toISOString().slice(0, 10), "2026-10-03", "the bug: this is what the tools stamped");
  assert.equal(withTz("Europe/Istanbul", () => localDayOf(at)), "2026-10-04");
  assert.equal(withTz("America/Los_Angeles", () => localDayOf(at)), "2026-10-03");
  assert.equal(withTz("Not/AZone", () => localDayOf(at)) !== null, true, "a bad zone name falls back to the machine's, it never throws");
  assert.equal(localDayOf("junk"), null);
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test("rival-signals note: a note dated today is accepted at 02:00 east of UTC (it was refused as 'in the future')", () => {
  const pm = pmWithPage({ sources: { repo: ".", rivals: { acme: { name: "Acme" } } } });
  const now = new Date("2026-10-03T23:00:00Z");
  const args = { slug: "acme", text: "Acme shipped bulk export.", source: "https://acme.example/changelog", date: "2026-10-04" };
  assert.equal(withTz("Europe/Istanbul", () => addNote(pm, args, { now })).code ?? 0, 0, "today, in the owner's zone");
  const tomorrow = withTz("Europe/Istanbul", () => addNote(pm, { ...args, date: "2026-10-05" }, { now }));
  assert.equal(tomorrow.code, 1); assert.match(tomorrow.text, /in the future/, "a real future day is still refused");
});

test("nosy.mjs: sources.json timezone sets the day for the scripts it runs (bet placed-on date)", () => {
  const pm = pmWithPage({ sources: { repo: ".", timezone: "Pacific/Kiritimati" } }); // UTC+14: its day is ahead of UTC for ten hours a day
  const r = run(path.join(Tool, "nosy.mjs"), ["bet", "place", "Probe", "--why", "x", "--estimate", "S", "--basis", "intent", "--rests-on", "none", "--expect", "y", "--pm", pm]);
  const file = fs.readdirSync(path.join(pm, "bets")).find(x => x.endsWith(".md"));
  assert.ok(file, `a bet file was written: ${r.output}${r.error}`);
  const expected = withTz("Pacific/Kiritimati", () => localDay()).slice(2).replace(/-/g, ""); // nb-yyMMdd-slug
  assert.match(file, new RegExp(`^nb-${expected}-`), file);
});

// --- privacy scan: a person called Claude is not "Claude Code" -----------------------------------------------------------------
test("privacy-scan: a commit author named Claude does not match the product 'Claude Code', but still matches the person", () => {
  const dir = tmp("nosy-privacy-name-");
  fs.writeFileSync(path.join(dir, "rivals.md"), "# Rival\n\nThey ship a plugin for Claude Code and for Claude Desktop, and test on Claude Sonnet 4.\n");
  const SCAN = path.join(Tool, "privacy-scan.mjs");
  const clean1 = run(SCAN, [path.join(dir, "rivals.md"), "--names", "Claude"]);
  assert.equal(clean1.code, 0, `${clean1.output}${clean1.error}`);
  fs.writeFileSync(path.join(dir, "person.md"), "Thanks to Claude for the fix, and Claude Code too.\n");
  const person = run(SCAN, [path.join(dir, "person.md"), "--names", "Claude"]);
  assert.equal(person.code, 2, "the bare name is still found");
  assert.match(person.output, /name: Claude/);
  fs.writeFileSync(path.join(dir, "other.md"), "Ask Mehmet Yilmaz about it. Mehmet Code is not a product.\n");
  assert.equal(run(SCAN, [path.join(dir, "other.md"), "--names", "Mehmet"]).code, 2, "a name that is not a known product name is matched everywhere, as before");
});

test("privacy-scan: private.json nameSource says where a name came from", () => {
  const pm = path.join(tmp("nosy-privacy-src-"), "pm"); fs.mkdirSync(pm);
  fs.writeFileSync(path.join(pm, "private.json"), JSON.stringify({ names: ["Mehmet Yilmaz"], nameSource: { "Mehmet Yilmaz": "a commit author" } }));
  const f = path.join(pm, "..", "note.md"); fs.writeFileSync(f, "Mehmet Yilmaz wrote this.\n");
  const r = run(path.join(Tool, "privacy-scan.mjs"), [f, "--pm", pm]);
  assert.equal(r.code, 2); assert.match(r.output, /name: Mehmet Yilmaz \(a commit author\)/);
});

// --- install: a copy keeps its version when it updates itself ----------------------------------------------------------------
test("install: `update` run from an installed copy keeps the version in the marker (it wrote 'unknown')", () => {
  const proj = tmp("nosy-install-ver-");
  const realVersion = readJson(path.join(Tool, "..", "..", "package.json")).version;
  const first = run(path.join(Tool, "install.mjs"), ["--dir", proj, "--providers", "codex"]);
  assert.equal(first.code, 0, first.error);
  assert.match(first.output, /Nosy is installed and works now/, "success is said first");
  assert.match(first.output, /Optional automation is off, and Nosy doesn't need it/, "hooks are optional, said second");
  assert.doesNotMatch(first.output, /no hooks of its own/);
  const marker = path.join(proj, ".agents", "skills", "nosy", ".nosy-install.json");
  assert.equal(readJson(marker).version, realVersion);
  const copy = path.join(proj, ".agents", "skills", "nosy", "tools", "install.mjs");
  const again = run(copy, ["update", "--dir", proj]);
  assert.equal(again.code, 0, again.error);
  assert.equal(readJson(marker).version, realVersion, `still ${realVersion} after an update run from the copy: ${again.output}`);
});

test("doctor --check: two Nosy copies are listed, with their versions, and a new chat is advised", async () => {
  const { check } = await import("../tools/health.mjs");
  const proj = tmp("nosy-copies-"), home = tmp("nosy-copies-home-");
  for (const sub of [[".agents", "skills"], [".claude", "skills"]]) {
    const d = path.join(proj, ...sub, "nosy"); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "SKILL.md"), "---\nname: nosy\n---\n");
    fs.writeFileSync(path.join(d, ".nosy-install.json"), JSON.stringify({ version: "0.21.0", files: 1 }));
  }
  const R = await check({ cwd: proj, home, env: {}, run: (cmd, args) => ({ status: 0, stdout: cmd === "git" ? "git version 2.43.0" : "gh version 2.40.0 (2026-01-01)" }) });
  const l = R.lines.find(x => /more than one Nosy is installed/.test(x.what));
  assert.ok(l, R.lines.map(x => x.what).join(" | ")); assert.equal(l.level, "note");
  assert.match(l.what, /Codex here \(\.agents\/skills\/nosy\) 0\.21\.0/); assert.match(l.what, /Claude Code here \(\.claude\/skills\/nosy\) 0\.21\.0/);
  assert.match(l.fix, /new chat/);
});

// --- rival-tiers: what is in the file decides, not when it was touched --------------------------------------------------------
import { plan as tierPlan, stubOf } from "../tools/rival-tiers.mjs";

test("rival-tiers: a rival file created minutes ago from the template is a new stub that needs work; a researched one is current", () => {
  const STUB = "# Acme\n\n- **Category:** <what kind of product>\n- **Site:** <url>\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Draft | | |\n| 2 | Review | | |\n\n## Sources\n- <url> (date read)\n";
  const DONE = "# Beta\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Draft | y | https://beta.example/docs |\n| 2 | Review | u | not found |\n\n## Sources\n- https://beta.example/docs (2026-10-03)\n";
  const pm = pmWithPage({ sources: { repo: ".", rivals: { acme: { name: "Acme" }, beta: { name: "Beta" } } }, files: { "pm/rivals/acme.md": STUB, "pm/rivals/beta.md": DONE } });
  const P = tierPlan(pm, { now: Date.now() });
  const by = Object.fromEntries(P.tiers.A.rivals.map(r => [r.slug, r]));
  assert.equal(by.acme.status, "new stub"); assert.equal(by.acme.needsWork, true);
  assert.match(by.acme.why.join(" "), /new stub/);
  assert.equal(by.beta.status, "complete and current"); assert.equal(by.beta.needsWork, false);
  assert.deepEqual(P.tiers.A.needsWork, ["acme"]);
  assert.deepEqual([stubOf("# X\n").stub, stubOf(DONE).stub, stubOf(STUB).stub], [true, false, true]);
});

// --- "Rivals this week" has an input; a page has one check ---------------------------------------------------------------------
import { load as loadWeek } from "../tools/rivals-week.mjs";
import { validate } from "../tools/page-validate.mjs";

const matrixFor = biz => ({ update: "2026-10-04", codes: { y: "exists" }, steps: [{ no: "1", name: "Draft" }, { no: "2", name: "Review" }], biz, products: [] });
function builtPage({ biz, week } = {}) {
  const root = tmp("nosy-page-"), pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true }); fs.mkdirSync(path.join(pm, "rivals"));
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main", rivals: { acme: { name: "Acme" } } }));
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify({ ...matrixFor(biz), products: [{ name: "Acme", file: "acme.md", category: "CRM", codes: { 1: { k: "y", evidence: "docs" }, 2: { k: "n", evidence: "" } } }] }));
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), "# Acme\n\n- **Category:** CRM\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Draft | y | docs |\n| 2 | Review | n | none |\n");
  if (week) fs.writeFileSync(path.join(pm, "state", "rivals-this-week.json"), JSON.stringify(week));
  const out = path.join(pm, "page.html");
  const r = run(path.join(Tool, "build-page.mjs"), [pm, out]);
  assert.equal(r.code, 0, r.error);
  return { pm, out };
}

test("rivals-this-week: sourced, dated lines are drawn on the page; a line with no source or day is left out and counted", () => {
  const week = { generated: "2026-10-04T09:00:00Z", window: { from: "2026-09-27", to: "2026-10-04" }, items: [
    { rival: "Acme", text: "Shipped bulk export", url: "https://acme.example/changelog", date: "2026-10-02", delivery: "shipped" },
    { rival: "Acme", text: "Teased a mobile app", url: "https://acme.example/blog/x", date: "2026-10-01" },
    { rival: "Acme", text: "Rumour with no source", date: "2026-10-03" },
    { rival: "Acme", text: "No day", url: "https://acme.example/y" }] };
  const { pm, out } = builtPage({ biz: { name: "Us", codes: { 1: "y", 2: "y" } }, week });
  const R = loadWeek(pm);
  assert.equal(R.items.length, 2); assert.deepEqual(R.dropped.map(d => d.why), ["no source address", "no date (YYYY-MM-DD)"]);
  assert.equal(R.items[0].date, "2026-10-02", "newest first"); assert.equal(R.items[1].delivery, "announced", "announced is the default");
  const html = fs.readFileSync(out, "utf8");
  assert.match(html, /id="rivals-week"/); assert.match(html, /Shipped bulk export/); assert.match(html, /href="https:\/\/acme\.example\/changelog"/);
  assert.doesNotMatch(html, /Rumour with no source/);
  const cli = run(path.join(Tool, "nosy.mjs"), ["rivals-week", "--pm", pm]);
  assert.equal(cli.code, 2, "some lines were left out: exit 2"); assert.match(cli.output, /2 left out/);
  assert.equal(loadWeek(pmWithPage()), null, "no file: null, nothing drawn");
  const none = builtPage({ biz: { name: "Us", codes: { 1: "y" } } });
  assert.doesNotMatch(fs.readFileSync(none.out, "utf8"), /id="rivals-week"/, "no file, no box");
  const quiet = builtPage({ biz: { name: "Us", codes: { 1: "y" } }, week: { window: { from: "2026-09-27", to: "2026-10-04" }, items: [], nothing: true } });
  assert.match(fs.readFileSync(quiet.out, "utf8"), /nothing new from the rivals/, "checked and found nothing is said, unlike a missing file");
});

test("page validate: a good page passes every check; a page with no own-product column, a broken script or a secret fails", () => {
  const ok = builtPage({ biz: { name: "Us", codes: { 1: "y", 2: "y" } } });
  const good = validate(ok.pm);
  assert.deepEqual(good.checks.filter(c => !c.ok && !c.skipped).map(c => c.name), [], JSON.stringify(good.checks));
  assert.match(good.checks.find(c => c.name === "data").detail, /2 steps × 1 rival \+ our own column/);
  const cli = run(path.join(Tool, "nosy.mjs"), ["page", "validate", "--pm", ok.pm]);
  assert.equal(cli.code, 0, cli.output + cli.error); assert.match(cli.output, /✓ scripts parse/);
  // biz: null → the "0 done" page
  const noBiz = builtPage({ biz: null });
  const bad = validate(noBiz.pm);
  const data = bad.checks.find(c => c.name === "data");
  assert.equal(data.ok, false); assert.match(data.detail, /no column for your own product/);
  assert.equal(run(path.join(Tool, "nosy.mjs"), ["page", "validate", "--pm", noBiz.pm]).code, 2);
  // a script that doesn't parse
  fs.writeFileSync(ok.out, fs.readFileSync(ok.out, "utf8") + "\n<script>const x = ;</script>\n");
  const broken = validate(ok.pm).checks.find(c => c.name === "scripts parse");
  assert.equal(broken.ok, false); assert.match(broken.detail, /line \d+/);
  // personal data in the page
  fs.writeFileSync(ok.out, fs.readFileSync(ok.out, "utf8") + "\n<p>Write to jane.doe.work@gmail.com</p>\n");
  assert.equal(validate(ok.pm).checks.find(c => c.name === "privacy scan").ok, false);
  // no page at all
  const missing = validate(pmWithPage());
  assert.match(missing.error, /no page at .*page\.html/);
});

// --- page-adopt says what a Nosy-built page is -------------------------------------------------------------------------------
test("page-adopt on the page `nosy page` built: says it is already built from pm/, not 'No tables on the page'", () => {
  const { pm, out } = builtPage({ biz: { name: "Us", codes: { 1: "y", 2: "y" } } });
  const r = run(path.join(Tool, "adopt-page.mjs"), ["adopt", pm, "--page", out]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /built by `nosy page` from pm\/.*nothing to adopt/s);
  assert.doesNotMatch(r.output, /No tables on the page/);
  const hand = path.join(pm, "hand.html"); fs.writeFileSync(hand, "<html><body><p>No table here.</p></body></html>");
  assert.match(run(path.join(Tool, "adopt-page.mjs"), ["adopt", pm, "--page", hand]).output, /No <table> and no `const NAME/);
});

// --- rivals-import: a file that looks like a rival but doesn't use the codes is explained, not waved through ------------------
test("rivals-import: a feature table with Yes/No cells is listed with the reason it was passed over, and the exit code is 2", () => {
  const root = tmp("nosy-import-why-"), pm = path.join(root, "pm"), refs = path.join(root, "references", "acme");
  fs.mkdirSync(pm, { recursive: true }); fs.mkdirSync(refs, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", rivalsPath: "references" }));
  fs.writeFileSync(path.join(refs, "competitive-2026-09.md"), "# Acme\n\n| Feature | Acme | Us |\n|---|---|---|\n| Bulk export | Yes | Yes |\n| Draft only | No | Yes |\n| Review queue | Yes | No |\n\nSources: https://acme.example\n");
  fs.writeFileSync(path.join(refs, "notes.md"), "Some prose, no table at all.\n");
  const r = run(path.join(Tool, "rivals-import.mjs"), [pm]);
  assert.equal(r.code, 2, r.output + r.error);
  assert.match(r.output, /Nothing imported/); assert.match(r.output, /acme\/competitive-2026-09\.md: a table with 3 Yes\/No-style cells/); assert.match(r.output, /acme\/notes\.md: no table/);
  assert.match(r.output, /y yes, p partial, n no, u not found, d announced/);
  assert.match(r.output, /skill\/templates\/rival\.md/);
  // an empty folder is still a plain 0
  const empty = path.join(root, "references2"); fs.mkdirSync(empty);
  const none = run(path.join(Tool, "rivals-import.mjs"), [pm, "--from", empty]);
  assert.equal(none.code, 0); assert.match(none.output, /holds no markdown file/);
});

// --- the first research pass on a new rival: stub → proposals → apply → rebuild, with nothing seeded by hand -----------------------
test("a new rival stub with a blank table: its first checked proposal creates the column and the cell, and a rebuild keeps both", () => {
  const root = tmp("nosy-bootstrap-"), pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true }); fs.mkdirSync(path.join(pm, "state"));
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main", rivals: { acme: { name: "Acme" } } }));
  const biz = { name: "BlogFactory", codes: { 1: "y", 2: "y" }, notes: { 1: "", 2: "" } };
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify({ update: "2026-10-03", codes: { y: "exists" }, steps: [{ no: "1", name: "Draft" }, { no: "2", name: "Review" }], biz, products: [] }, null, 1));
  const STUB = "# Acme\n\n- **Category:** CMS agent\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Draft | | |\n| 2 | Review | | |\n";
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), STUB);
  const evidence = [{ url: "https://acme.example/docs/draft", grade: "primary", page_opened: true, date_kind: "none" }];
  fs.writeFileSync(path.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals: [
    { rival: "Acme", step: "1", from: "u", to: "y", evidence },
    { rival: "Nobody", step: "1", from: "u", to: "y", evidence }] }));
  const MP = path.join(Tool, "matrix-proposals.mjs");
  const chk = run(MP, ["check", pm]);
  assert.equal(chk.code, 0, chk.error); assert.match(chk.output, /Acme.*has a rival file.*applying adds it/s);
  const ap = run(MP, ["apply", pm]);
  assert.equal(ap.code, 0, ap.error + ap.output);
  const M = readJson(path.join(pm, "matrix.json"));
  assert.deepEqual(M.products.map(p => p.name), ["Acme"], "the column is there; a rival with no file ('Nobody') was not invented");
  assert.equal(M.products[0].codes["1"].k, "y"); assert.equal(M.products[0].codes["2"], undefined, "only the cell that earned it");
  assert.deepEqual(M.biz, biz, "our own column untouched");
  assert.match(fs.readFileSync(path.join(pm, "rivals", "acme.md"), "utf8"), /\| 1 \| Draft \| y \| https:\/\/acme\.example\/docs\/draft \[verified: \d{4}-\d{2}-\d{2}\] \|/, "written into the rival's own table");
  // A rebuild from the rival tables keeps the rival, its cell and our column.
  const b = run(path.join(Tool, "build-matrix.mjs"), [pm]);
  assert.equal(b.code, 0, b.error);
  const R = readJson(path.join(pm, "matrix.json"));
  assert.deepEqual(R.products.map(p => p.name), ["Acme"]); assert.equal(R.products[0].codes["1"].k, "y"); assert.deepEqual(R.biz, biz);
  // undo puts the matrix and the stub back (the rebuild changed the matrix since the apply, so it needs --force, as it always did)
  const u = run(MP, ["undo", pm, "--force"]);
  assert.equal(u.code, 0, u.error + u.output);
  assert.deepEqual(readJson(path.join(pm, "matrix.json")).products, [], "undone");
  assert.equal(fs.readFileSync(path.join(pm, "rivals", "acme.md"), "utf8"), STUB, "the rival's table is back as it was");
});

// --- one invariant for build, doctor, verify-setup and publish: no own column, no competitive numbers ----------------------------
import { ownColumnProblem, preflightMatrix } from "../tools/matrix-preflight.mjs";

test("own column: rows but no usable biz is refused everywhere; partial codes, a new empty matrix and the line shape are fine", () => {
  const steps = [{ no: "1", name: "A" }, { no: "2", name: "B" }], base = { steps, products: [{ name: "R", codes: { 1: { k: "y", evidence: "" }, 2: { k: "n", evidence: "" } } }] };
  for (const biz of [null, undefined, "us", [], {}, { name: "" }, { name: "Us" }, { name: "Us", codes: {} }, { name: "Us", codes: [] }]) {
    const p = ownColumnProblem({ ...base, biz });
    assert.ok(p && p.reason === "own-column", `refused: ${JSON.stringify(biz)}`);
    const r = preflightMatrix(JSON.stringify({ ...base, biz }));
    assert.equal(r.ok, false); assert.match(r.problem, /no usable column for your own product/); assert.match(r.problem, /pm\/us\.json/);
  }
  assert.equal(ownColumnProblem({ ...base, biz: { name: "Us", codes: { 1: "y" } } }), null, "only some rows coded: the rest read as unknown");
  assert.equal(preflightMatrix(JSON.stringify({ ...base, biz: { name: "Us", codes: { 1: "y" } } })).ok, true);
  assert.equal(ownColumnProblem({ steps: [], biz: null, products: [] }), null, "a new product has nothing to compare yet");
  assert.equal(ownColumnProblem({ products: ["Us", "R"], lines: [{ feature: "A", codes: { Us: "y", R: "n" } }] }), null, "the line shape's own product is its first column");
});

test("publish refuses a matrix with no own column, says how to fix it, and sends nothing; a complete one goes", () => {
  const mk = biz => {
    const root = tmp("nosy-own-publish-"), pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true });
    fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main" }));
    fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify({ update: "2026-10-04", codes: { y: "exists" }, steps: [{ no: "1", name: "Draft" }, { no: "2", name: "Review" }], biz, products: [{ name: "Acme", codes: { 1: { k: "y", evidence: "" }, 2: { k: "n", evidence: "" } } }] }));
    return pm;
  };
  const go = pm => run(path.join(Tool, "publish.mjs"), [pm, "--url", "http://127.0.0.1:9", "--dry-run"]);
  const bad = go(mk(null));
  assert.equal(bad.code, 1, bad.output + bad.error);
  assert.match(bad.error + bad.output, /no usable column for your own product/); assert.match(bad.error + bad.output, /matrix-before-build-\*\.json/);
  const good = go(mk({ name: "Us", codes: { 1: "y", 2: "y" } }));
  assert.equal(good.code, 0, good.output + good.error);
});

test("build-matrix says it out loud when nothing supplies the own column, and doctor/verify-setup see it", () => {
  const root = tmp("nosy-own-build-"), pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main", matrix: path.join(pm, "matrix.json") }));
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), RIVAL);
  const b = run(path.join(Tool, "build-matrix.mjs"), [pm]);
  assert.equal(b.code, 0, "the rivals are still written"); assert.match(b.error, /no column for your own product.*pm\/us\.json/s);
});

// --- the sweep and the rival files are compared, not just both run -------------------------------------------------------------
import { announcementDate, laterThan, reconcile } from "../tools/sweep-reconcile.mjs";

test("sweep-check: five releases on 1-2 October against a file that says July is 'behind'; a file that agrees is not; a page that couldn't be read is not 'agrees'", () => {
  const pm = pmWithPage({ sources: { repo: ".", rivals: { lightcms: { name: "LightCMS" }, pagible: { name: "Pagible" }, ghost: { name: "Ghost" } } },
    files: {
      "pm/rivals/lightcms.md": "# LightCMS\n\n- **Latest major announcement:** 2026-07-14 — LightCMS 7.2.2 (https://lightcms.example/releases) · delivery: shipped\n",
      "pm/rivals/pagible.md": "# Pagible\n\n- **Latest major announcement:** 2026-10 — Pagible 2 (https://pagible.example/news) · delivery: shipped\n",
      "pm/rivals/ghost.md": "# Ghost\n\n- **Latest major announcement:** 2026-09-01 — x (https://ghost.example) · delivery: announced\n" } });
  const ok = (page, entries) => ({ kind: "releases", url: page, ok: true, entries });
  fs.writeFileSync(path.join(pm, "state", "rival-sweep.json"), JSON.stringify({ from: "2026-09-04", to: "2026-10-04", rivals: [
    { slug: "lightcms", name: "LightCMS", pages: [ok("https://lightcms.example/releases", [{ date: "2026-10-02", text: "7.3.1" }, { date: "2026-10-01", text: "7.3.0" }, { date: "2026-09-20", text: "7.2.5" }])] },
    { slug: "pagible", name: "Pagible", pages: [ok("https://pagible.example/news", [{ date: "2026-10-02", text: "Pagible 2.1" }])] },
    { slug: "ghost", name: "Ghost", pages: [{ kind: "releases", url: "https://ghost.example/changelog", ok: false, entries: [], problem: "HTTP 404" }] }] }));
  const R = reconcile(pm), by = Object.fromEntries(R.rivals.map(r => [r.slug, r]));
  assert.equal(by.lightcms.status, "behind"); assert.equal(by.lightcms.newest.date, "2026-10-02"); assert.equal(by.lightcms.fileSays, "2026-07-14");
  assert.equal(by.pagible.status, "agrees", "a file that says 2026-10 is not behind an entry in October");
  assert.match(by.ghost.status, /not compared/, "a 404 is never 'agrees'");
  assert.deepEqual(R.behind, ["lightcms"]);
  const cli = run(path.join(Tool, "nosy.mjs"), ["sweep-check", "--pm", pm]);
  assert.equal(cli.code, 2, cli.output + cli.error); assert.match(cli.output, /LightCMS: the file says 2026-07-14, the sweep found 2026-10-02/); assert.match(cli.output, /may not say "nothing new"/);
  assert.ok(fs.existsSync(path.join(pm, "state", "sweep-reconcile.json")));
  assert.equal(run(path.join(Tool, "nosy.mjs"), ["sweep-check", "--pm", pmWithPage()]).code, 1, "no sweep yet: say so");
  assert.deepEqual([laterThan("2026-07-20", announcementDate("- **Latest major announcement:** 2026-07 — x")), laterThan("2026-08-01", announcementDate("- **Latest major announcement:** 2026-07 — x")), laterThan("2026-07-14", announcementDate("- **Latest major announcement:** 2026-07-14 — x")), laterThan("2026-07-15", null)], [false, true, false, true]);
});

// --- the repository's past before Nosy arrived is readable on day one -------------------------------------------------------------
test("history: 90 days of commits, tags and areas from git, written as a typed 'before-nosy' record that is not a Nosy snapshot", () => {
  const root = tmp("nosy-history-"), pm = path.join(root, "pm"); fs.mkdirSync(pm);
  const day = n => new Date(Date.now() - n * 864e5).toISOString();
  const at = (d, ...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  at(day(200), "init", "-q", "-b", "main");
  const commit = (n, msg) => { fs.writeFileSync(path.join(root, `f${n}.txt`), String(n)); at(day(n), "add", "."); at(day(n), "commit", "-qm", msg); };
  commit(150, "feat(export): too old, outside the window"); commit(60, "feat(export): CSV export"); commit(30, "fix(review): queue order"); commit(8, "feat(export): XLSX"); commit(2, "docs: README");
  at(day(30), "tag", "v1.0.0"); // tagged 30 days ago by the date of the commit
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  const r = run(path.join(Tool, "nosy.mjs"), ["history", "90d", "--pm", pm]);
  assert.equal(r.code, 0, r.error + r.output);
  const H = readJson(path.join(pm, "state", "history.json"));
  assert.deepEqual([H.type, H.kind, H.window.days], ["history", "before-nosy", 90]);
  assert.equal(H.commits.count, 4, "the 150-day-old commit is outside the 90-day window");
  assert.deepEqual(H.commits.byArea[0], { area: "export", count: 2 });
  assert.ok(H.commits.byWeek.length >= 3 && H.commits.byWeek.every(w => /^\d{4}-\d{2}-\d{2}$/.test(w.week)));
  assert.match(H.note || "", /issue\.repo/, "no issue.repo: said, not guessed");
  assert.match(H.baseline, /not Nosy's own snapshots|different thing/);
  assert.ok(fs.existsSync(path.join(pm, "state", "history.md")));
  assert.match(r.output, /Before Nosy/); assert.match(r.output, /4 commits/);
  assert.equal(fs.existsSync(path.join(pm, "history")), false, "it does not create a Nosy snapshot folder");
  const bad = run(path.join(Tool, "nosy.mjs"), ["history", "--days", "0", "--pm", pm]);
  assert.equal(bad.code, 1); assert.match(bad.error, /--days needs a whole number/);
  // `publish` doesn't send it
  assert.doesNotMatch(fs.readFileSync(path.join(Tool, "publish.mjs"), "utf8"), /history\.json/);
});
