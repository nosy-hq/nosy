// Contract tests for skill/tools/adopt-page.mjs: `nosy page-adopt adopt|refresh|undo`.
// A hand-built page (HTML tables, `const NAME = [ {…} ]` arrays in a <script>) is matched to Nosy's data by what is IN the tables, marked
// with comments on request, then refreshed: only the marked tables change, in place, and every other byte of the page stays.
// The pm/ state is hand-written here (this test doesn't depend on the tools that write it).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const A = path.join(Tool, "adopt-page.mjs");
const made = [];
after(() => made.forEach(clean));

const iso = "2026-09-30T10:00:00.000Z";
const write = (file, o) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof o === "string" ? o : JSON.stringify(o, null, 1)); };

// Nosy's side: a step-shaped matrix (us + one rival, 5 steps) and a psst list.
function pmSetup(over = {}) {
  const root = temporary("nosy-adopt-"); made.push(root);
  const pm = path.join(root, "pm"), st = path.join(pm, "state");
  write(path.join(pm, "sources.json"), { repo: root });
  write(path.join(pm, "matrix.json"), { update: "2026-09-29", codes: { y: "exists" }, steps: [{ no: "1", name: "Product setup" }, { no: "2", name: "Scanning rivals" }, { no: "3", name: "Weekly report" }, { no: "4", name: "Roadmap" }, { no: "5", name: "New step five" }],
    biz: { name: "Nosy", codes: { 1: "y", 2: "y", 3: "p", 4: "n", 5: "y" }, notes: {} },
    products: [{ name: "Rival A (suite)", file: "a.md", statusType: "active", codes: { 1: { k: "y" }, 2: { k: "p" }, 3: { k: "n" }, 4: { k: "y" }, 5: { k: "u" } } }] });
  write(path.join(st, "lowhanging.json"), { type: "lowHanging", generated: iso, ref: "origin/main", items: over.items || [
    { score: 5, effort: "S", type: "Backend ready", title: "Pricing plans", evidence: "a.ts:1", detail: ["detail-line-xyz"], ref: null },
    { score: 4, effort: "M", type: "Backend ready", title: "Export CSV", evidence: "b.ts:1", detail: [], ref: null },
    { score: 3, effort: "S", type: "Issue opened against us", title: "#12 Dark mode", evidence: "reporter-login-xyz · 2026-09-01", detail: [], ref: "#12" },
    { score: 2, effort: "L", type: "Backend ready", title: "Audit log", evidence: "c.ts:1", detail: [], ref: null }] });
  return { root, pm };
}

const AUTO = "<!-- pm:auto -->\n<section>nosy block <table><tr><th>a</th></tr><tr><td>1</td></tr></table></section>\n<!-- /pm:auto -->";
const PAGE = `<!doctype html><html><body>
<h1>My page</h1>
<p>Hand-written intro that must not change. Dont touch me.</p>
<table id="m">
<thead><tr><th>Step</th><th>Feature</th><th>Nosy</th><th>Rival A</th><th>Owner notes</th></tr></thead>
<tbody>
<tr><td>1</td><td>Product setup</td><td class="ok">✓</td><td class="ok">✓</td><td>mine one</td></tr>
<tr><td>2</td><td>Scanning rivals</td><td class="ok">✓</td><td class="part">~</td><td>mine two</td></tr>
<tr><td>3</td><td>Weekly report</td><td class="ok">✓</td><td class="no">✗</td><td>mine three</td></tr>
<tr><td>4</td><td>Roadmap</td><td class="no">✗</td><td class="ok">✓</td><td>mine four</td></tr>
<tr><td>9</td><td>Retired step</td><td class="ok">✓</td><td class="ok">✓</td><td>mine nine</td></tr>
</tbody></table>
<table><tr><th>Name</th><th>Phone</th></tr><tr><td>a</td><td>1</td></tr><tr><td>b</td><td>2</td></tr><tr><td>c</td><td>3</td></tr></table>
${AUTO}
<footer>f</footer>
<script>
const KEEP = [1, 2, 3];
const CALLS = [ { a: compute(1) }, { a: compute(2) } ];
const WORK = [
  { name: "Pricing plans", pts: 5, size: "S", note: "keep" },
  { name: "Export CSV", pts: 3, size: "M", note: "late" },
  { name: "Audit log", pts: 2, size: "L", note: "" },
  { name: "Gone work", pts: 1, size: "S", note: "x" }
];
</script>
</body></html>
`;
const pageIn = (root, text = PAGE) => { const f = path.join(root, "page.html"); fs.writeFileSync(f, text); return f; };
const doRun = (sub, pm, page, ...more) => run(A, [sub, pm, "--page", page, ...more]);
const backups = pm => fs.existsSync(path.join(pm, ".backup")) ? fs.readdirSync(path.join(pm, ".backup")).filter(f => /^page-.*\.html$/.test(f)).sort() : [];
// The page with every comment `adopt` wrote taken out again: must be the page the owner had.
const unmarked = t => t.replace(/<!-- pm:table [^>]*-->/g, "").replace(/<!-- \/pm:table -->/g, "").replace(/\/\/ \n/g, "").replace(/\n\/\/ /g, "");
const scriptsOk = html => { for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]); return true; };

test("adopt: reports each table, its Nosy source and rows match/differ; matches by content; writes nothing", () => {
  const { root, pm } = pmSetup(), page = pageIn(root);
  const r = doRun("adopt", pm, page);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /4 tables found, 2 can be fed from Nosy data/);
  assert.match(r.output, /your table \| -> Nosy source \| -> rows/);
  // The HTML matrix: 4 of its 5 rows are Nosy's steps; row 3 says ✓ where Nosy has partial.
  assert.match(r.output, /table at line 4 \(Step, Feature, Nosy, Rival A, Owner notes\) \| matrix \(pm\/matrix\.json\), key "Step" = no \| 3 match, 1 differ \(1 only on your page, 1 new in Nosy\)/);
  assert.match(r.output, /table at line 4: fed columns .*Feature \(feature\).*left alone: Owner notes/);
  // The JS array, keyed by "name" = psst title, columns fed by value although the headers are other words.
  assert.match(r.output, /const WORK \(\{ name, pts, size, note \}\) \| lowhanging \(pm\/state\/lowhanging\.json\), key "name" = title \| 2 match, 1 differ/);
  assert.match(r.output, /const WORK: fed columns size \(effort\), pts \(score\); left alone: note/);
  // The phone table is nothing of Nosy's; an array of numbers is no table and isn't mentioned; an array of objects built by calls is one the reader won't guess at.
  assert.match(r.output, /table at line 13 \(Name, Phone\) \| not matched \| no column holds/);
  assert.match(r.output, /const CALLS \(…\) \| not matched \| it holds code, not plain data/);
  assert.ok(!/KEEP/.test(r.output), r.output);
  assert.match(r.output, /Nothing was changed\./);
  assert.equal(fs.readFileSync(page, "utf8"), PAGE, "the page is as it was");
  assert.deepEqual(backups(pm), [], "no backup is made by a report");
  const dry = doRun("adopt", pm, page, "--apply", "--yes", "--dry-run");
  assert.equal(dry.code, 0); assert.equal(fs.readFileSync(page, "utf8"), PAGE, "--dry-run writes nothing even with --apply --yes");
});

test("adopt --apply refuses without --yes; with --yes it marks exactly the matched tables, backs up first and says how to undo", () => {
  const { root, pm } = pmSetup(), page = pageIn(root);
  const no = doRun("adopt", pm, page, "--apply");
  assert.equal(no.code, 1); assert.match(no.error, /changes your page.*Say yes with --yes/);
  assert.equal(fs.readFileSync(page, "utf8"), PAGE); assert.deepEqual(backups(pm), []);
  const r = doRun("adopt", pm, page, "--apply", "--yes");
  assert.equal(r.code, 0, r.error);
  const fresh = fs.readFileSync(page, "utf8");
  assert.equal((fresh.match(/<!-- pm:table /g) || []).length, 2); assert.equal((fresh.match(/<!-- \/pm:table -->/g) || []).length, 2);
  assert.match(fresh, /<!-- pm:table matrix key=no@0 cols=[^>]*-->\s*<table id="m">/);
  assert.match(fresh, /\/\/ <!-- pm:table lowhanging key=title@name cols=size=effort,pts=score top=4 -->\nconst WORK = \[/);
  assert.ok(fresh.includes("\n<table><tr><th>Name</th>"), "the unmatched table gets no marker");
  assert.equal(unmarked(fresh), PAGE, "nothing but the comments was added");
  assert.ok(scriptsOk(fresh), "the script still compiles");
  // The backup: a copy of the page as it was, next to a .gitignore that hides it.
  const [b] = backups(pm); assert.equal(backups(pm).length, 1);
  assert.equal(fs.readFileSync(path.join(pm, ".backup", b), "utf8"), PAGE);
  assert.equal(fs.readFileSync(path.join(pm, ".backup", ".gitignore"), "utf8"), "*\n");
  assert.match(r.output, /Backed up first: .*page-.*\.html\. To put the page back: `.*page-adopt undo/);
  // Run again: the marked tables are not offered twice.
  const again = doRun("adopt", pm, page);
  assert.match(again.output, /\(2 already adopted\)/);
  assert.ok(!/table at line 4 \(/.test(again.output), "an adopted table isn't listed as a candidate");
});

test("refresh: only marked tables change, in place; new rows go last, removed ones get data-gone / gone: true; everything else is byte for byte", () => {
  const { root, pm } = pmSetup(), page = pageIn(root);
  doRun("adopt", pm, page, "--apply", "--yes");
  const adopted = fs.readFileSync(page, "utf8");
  const r = doRun("refresh", pm, page);
  assert.equal(r.code, 0, r.error);
  const fresh = fs.readFileSync(page, "utf8");
  // HTML: step 3's Nosy cell now says partial, drawn the way the owner draws "partial" (class and mark); the notes column is theirs.
  assert.ok(fresh.includes('<tr><td>3</td><td>Weekly report</td><td class="part">~</td><td class="no">✗</td><td>mine three</td></tr>'), fresh);
  assert.ok(fresh.includes('<tr data-gone><td>9</td><td>Retired step</td>'), "a row Nosy no longer has is marked, not deleted");
  assert.ok(fresh.includes("mine nine"), "its hand-written note is still there");
  // The row the owner has keep their order; the new step is appended after the last row, built like it (their class on the Nosy cell).
  const order = ["Product setup", "Scanning rivals", "Weekly report", "Roadmap", "Retired step", "New step five"].map(x => fresh.indexOf(x));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "owner's order kept, new row last");
  assert.match(fresh, /<tr><td>5<\/td><td>New step five<\/td><td class="ok">✓<\/td><td>u<\/td><td><\/td><\/tr>\n<\/tbody>/);
  // JS: a changed number stays a number, a missing work row gets gone: true, a new one is appended with the array's quotes and indent.
  assert.ok(fresh.includes('{ name: "Export CSV", pts: 4, size: "M", note: "late" },'), fresh);
  assert.ok(fresh.includes('{ name: "Gone work", pts: 1, size: "S", note: "x", gone: true },'));
  assert.match(fresh, /note: "x", gone: true \},\n  \{ name: "#12 Dark mode", pts: 3, size: "S" \}\n\];/, "the last row gets its comma, the new one (the last now) has none, like before");
  assert.ok(scriptsOk(fresh), "the script still compiles");
  // Every byte outside the two marked tables is the page's own, the pm:auto block included.
  const outside = t => t.replace(/<!-- pm:table matrix[\s\S]*?<!-- \/pm:table -->/, "").replace(/\/\/ <!-- pm:table lowhanging[\s\S]*?\/\/ <!-- \/pm:table -->/, "");
  assert.equal(outside(fresh), outside(adopted));
  assert.ok(fresh.includes(AUTO) && fresh.includes("Hand-written intro that must not change. Dont touch me."));
  assert.match(r.output, /table at line 4 \(matrix\): 1 cell updated, 1 row added, 1 marked gone\n  3 · Nosy: "✓" -> "p"/, "what changed is listed, cell by cell");
  assert.match(r.output, /const WORK \(lowhanging, top 4\): 1 cell updated, 1 row added, 1 marked gone\n  Export CSV · pts: "3" -> "4"/);
  assert.equal(backups(pm).length, 2, "refresh backed the page up too");
  // A second run has nothing to do and makes no new backup.
  const again = doRun("refresh", pm, page);
  assert.match(again.output, /Already up to date/);
  assert.equal(fs.readFileSync(page, "utf8"), fresh); assert.equal(backups(pm).length, 2);
});

test("refresh: a row that comes back loses data-gone; --dry-run writes nothing; no markers is an error", () => {
  const { root, pm } = pmSetup(), page = pageIn(root);
  const none = doRun("refresh", pm, page);
  assert.equal(none.code, 1); assert.match(none.error, /No table in .* is adopted yet/);
  doRun("adopt", pm, page, "--apply", "--yes");
  const before = fs.readFileSync(page, "utf8");
  const dry = doRun("refresh", pm, page, "--dry-run");
  assert.equal(dry.code, 0); assert.match(dry.output, /--dry-run: the page was not changed/); assert.equal(fs.readFileSync(page, "utf8"), before);
  doRun("refresh", pm, page);
  assert.ok(fs.readFileSync(page, "utf8").includes("<tr data-gone><td>9</td>"));
  // Step 9 is added to Nosy's matrix: the row is Nosy's again.
  const mp = path.join(pm, "matrix.json"), M = JSON.parse(fs.readFileSync(mp, "utf8"));
  M.steps.push({ no: "9", name: "Retired step" }); M.biz.codes[9] = "y"; M.products[0].codes[9] = { k: "y" }; write(mp, M);
  doRun("refresh", pm, page);
  const back = fs.readFileSync(page, "utf8");
  assert.ok(back.includes("<tr><td>9</td><td>Retired step</td>") && !back.includes("data-gone"), back);
});

test("undo restores the newest backup, one step at a time; refuses over later hand edits unless --force, and keeps what it replaces", () => {
  const { root, pm } = pmSetup(), page = pageIn(root);
  doRun("adopt", pm, page, "--apply", "--yes");
  const adopted = fs.readFileSync(page, "utf8");
  doRun("refresh", pm, page);
  const refreshed = fs.readFileSync(page, "utf8");
  fs.writeFileSync(page, `${refreshed}<!-- a hand edit -->\n`);
  const refuse = run(A, ["undo", pm]);
  assert.equal(refuse.code, 1); assert.match(refuse.error, /changed after that backup.*--force/);
  assert.ok(fs.readFileSync(page, "utf8").endsWith("<!-- a hand edit -->\n"), "nothing was changed");
  const forced = run(A, ["undo", pm, "--force"]);
  assert.equal(forced.code, 0, forced.error);
  assert.equal(fs.readFileSync(page, "utf8"), adopted, "back to the page as it was before the refresh");
  const kept = fs.readdirSync(path.join(pm, ".backup")).filter(f => f.startsWith("undone-"));
  assert.equal(kept.length, 1); assert.ok(fs.readFileSync(path.join(pm, ".backup", kept[0]), "utf8").endsWith("<!-- a hand edit -->\n"), "the page as it was is kept");
  // One step further back: before adopt.
  const second = run(A, ["undo", pm]);
  assert.equal(second.code, 0, second.error);
  assert.equal(fs.readFileSync(page, "utf8"), PAGE);
  const third = run(A, ["undo", pm]);
  assert.equal(third.code, 1); assert.match(third.error, /nothing to put back/);
});

test("a page in another language matches by values, not header words", () => {
  const { root, pm } = pmSetup();
  const tr = `<table><tr><th>Adım</th><th>Özellik</th><th>Durum</th></tr>
<tr><td>1</td><td>Product setup</td><td>x</td></tr><tr><td>2</td><td>Scanning rivals</td><td>y</td></tr><tr><td>3</td><td>Weekly report</td><td>z</td></tr></table>
<script>const SATIRLAR = [ { adim: 1, ozellik: "Product setup" }, { adim: 2, ozellik: "Scanning rivals" }, { adim: 3, ozellik: "Weekly report" } ];</script>`;
  const r = doRun("adopt", pm, pageIn(root, tr));
  assert.match(r.output, /Adım, Özellik, Durum\) \| matrix .*key "Adım" = no \| 3 match, 0 differ/);
  assert.match(r.output, /const SATIRLAR .* matrix .*key "adim" = no \| 3 match, 0 differ/);
  assert.match(r.output, /Durum|left alone: Durum/);
});

test("not matched, honestly: too few rows, code the reader can't read, a key column of plain counting, a table nobody's data fits", () => {
  const { root, pm } = pmSetup();
  const odd = `<table><tr><th>Step</th><th>Feature</th></tr><tr><td>1</td><td>Product setup</td></tr><tr><td>2</td><td>Scanning rivals</td></tr></table>
<table><tr><th>Rank</th><th>Thing</th></tr><tr><td>1</td><td>alpha</td></tr><tr><td>2</td><td>beta</td></tr><tr><td>3</td><td>gamma</td></tr><tr><td>4</td><td>delta</td></tr></table>
<table><tr><th>A</th></tr><tr><td colspan="2">x</td></tr></table>
<script>
const ROWS = [ { title: "Pricing plans" }, { title: "Export CSV" }, { title: "Audit log" }, { title: \`a \${b}\` } ];
</script>`;
  const r = doRun("adopt", pm, pageIn(root, odd));
  assert.match(r.output, /only 2 data rows: too few to match with confidence/);
  assert.match(r.output, /Rank, Thing\) \| not matched/, "1, 2, 3, 4 matches step numbers but nothing else does: not a Nosy table");
  assert.match(r.output, /merges cells \(colspan\/rowspan\)/);
  assert.match(r.output, /const ROWS .* not matched \| it holds a template with \$\{\}/);
  assert.match(r.output, /0 can be fed from Nosy data/);
  assert.match(r.output, /Nothing to adopt\./);
});

test("two sources that fit equally well are not guessed between", () => {
  const { root, pm } = pmSetup({ items: [] });
  write(path.join(pm, "state", "lowhanging.json"), { type: "lowHanging", generated: iso, ref: "x", items: ["Alpha", "Beta", "Gamma"].map(t => ({ score: 1, effort: "S", type: "T", title: t, evidence: "", detail: [], ref: null })) });
  write(path.join(pm, "state", "waves.json"), { type: "waves", generated: iso, waves: [{ name: "Now", tasks: ["Alpha", "Beta", "Gamma"].map(t => ({ title: t, ref: null, effort: "S", score: 1, type: "T" })) }] });
  const page = `<table><tr><th>Work</th></tr><tr><td>Alpha</td></tr><tr><td>Beta</td></tr><tr><td>Gamma</td></tr></table>`;
  const r = doRun("adopt", pm, pageIn(root, page));
  assert.match(r.output, /equally close to (lowhanging and waves|waves and lowhanging); say which by hand/);
});

test("shareable: a reporter's login or detail line is never offered as a column and never written into a table", () => {
  const { root, pm } = pmSetup();
  const page = `<table>
<tr><th>Work</th><th>Score</th><th>Why</th></tr>
<tr><td>Pricing plans</td><td>5</td><td>a.ts:1</td></tr>
<tr><td>Export CSV</td><td>4</td><td>b.ts:1</td></tr>
<tr><td>Audit log</td><td>2</td><td>c.ts:1</td></tr>
</table>`;
  const f = pageIn(root, page);
  doRun("adopt", pm, f, "--apply", "--yes");
  const r = doRun("refresh", pm, f);
  assert.equal(r.code, 0, r.error);
  const fresh = fs.readFileSync(f, "utf8");
  assert.match(fresh, /<tr><td>#12 Dark mode<\/td><td>3<\/td><td><\/td><\/tr>/, "the new issue row carries its title and score; its evidence is its reporter, so the cell stays empty");
  for (const s of ["reporter-login-xyz", "detail-line-xyz"]) assert.ok(!fresh.includes(s), `${s} must not reach the page`);
});

test("stale wording: a cell that calls PR #N open, when git says it merged, is reported; the cell is never rewritten", () => {
  const { root, pm } = pmSetup();
  const g = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  fs.writeFileSync(path.join(root, "x.txt"), "x"); g("init", "-q", "-b", "main"); g("add", "x.txt"); g("commit", "-q", "-m", "feat: single sign-on (#431)");
  const page = `<table>
<tr><th>Step</th><th>Feature</th><th>Note</th></tr>
<tr><td>1</td><td>Product setup</td><td>PR #431 is open, waiting for review</td></tr>
<tr><td>2</td><td>Scanning rivals</td><td>PR #432 is open</td></tr>
<tr><td>3</td><td>Weekly report</td><td>shipped</td></tr>
<tr><td>4</td><td>Roadmap</td><td>merged in #431</td></tr>
</table>
<script>const ROWS = [ { no: 1, name: "Product setup", note: "open PR #431" }, { no: 2, name: "Scanning rivals", note: "" }, { no: 3, name: "Weekly report", note: "" } ];</script>`;
  const f = pageIn(root, page);
  const r = doRun("adopt", pm, f);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Stale wording/);
  assert.match(r.output, /line 3 · #431 merged \(\d{4}-\d\d-\d\d\) · table at line 1, row 1, "Note"/);
  assert.match(r.output, /line 8 · #431 merged .* const ROWS, row 1, "note"/);
  assert.ok(!/#432/.test(r.output.split("Stale wording")[1]), "a PR git doesn't know as merged isn't reported");
  assert.ok(!/#431.*row 4/.test(r.output), "a cell that says merged is fine");
  assert.equal(fs.readFileSync(f, "utf8"), page, "report only");
});

test("page-adopt is wired into nosy: help line, usage error, and the three subcommands", () => {
  const { root, pm } = pmSetup(), page = pageIn(root);
  const nosy = path.join(Tool, "nosy.mjs");
  const h = run(nosy, ["help"]);
  assert.match(h.output, /nosy page-adopt adopt\|refresh\|undo/);
  const bad = run(nosy, ["page-adopt", "--pm", pm]);
  assert.equal(bad.code, 1); assert.match(bad.error, /Usage: nosy page-adopt adopt/);
  const a = run(nosy, ["page-adopt", "adopt", "--pm", pm, "--page", page]);
  assert.equal(a.code, 0, a.error); assert.match(a.output, /your table/);
  assert.ok(!fs.existsSync(path.join(pm, "state", "page-adopt")), "nothing new under pm/state");
  assert.equal(run(nosy, ["page-adopt", "adopt", "--pm", pm, "--page", page, "--apply", "--yes"]).code, 0);
  assert.equal(run(nosy, ["page-adopt", "refresh", "--pm", pm, "--page", page]).code, 0);
  assert.equal(run(nosy, ["page-adopt", "undo", "--pm", pm, "--page", page, "--force"]).code, 0);
});

test("refresh keeps the array's own style: single quotes, bare keys, a trailing comma and the comment after it", () => {
  const { root, pm } = pmSetup();
  const page = `<script>
var rows = [
  {no: '1', feature: 'Product setup', nosy: 'y'},
  {no: '2', feature: 'Scanning rivals', nosy: 'n'},
  {no: '3', feature: 'Weekly report', nosy: 'y'},
  {no: '4', feature: 'Roadmap', nosy: 'y'},   // last one, trailing comma
]
</script>`;
  const f = pageIn(root, page);
  const a = doRun("adopt", pm, f, "--apply", "--yes");
  assert.equal(a.code, 0, a.error);
  const r = doRun("refresh", pm, f);
  assert.equal(r.code, 0, r.error);
  const fresh = fs.readFileSync(f, "utf8");
  assert.ok(fresh.includes("{no: '2', feature: 'Scanning rivals', nosy: 'y'},"), fresh);
  assert.ok(fresh.includes("{no: '3', feature: 'Weekly report', nosy: 'p'},") && fresh.includes("{no: '4', feature: 'Roadmap', nosy: 'n'},"));
  // The new row goes on the next line, written like the others; the comment after row 4's comma stays with row 4.
  assert.match(fresh, /nosy: 'n'\},   \/\/ last one, trailing comma\n  \{no: '5', feature: 'New step five', nosy: 'y'\},\n\]/);
  assert.ok(scriptsOk(fresh));
});

test("stale wording also asks gh when git doesn't know the PR (closed without merging, merged elsewhere)", async () => {
  const { fakeGhSetup } = await import("./helpers.mjs");
  const { root, pm } = pmSetup(), gh = fakeGhSetup({ prView: { 77: { state: "MERGED", mergedAt: "2026-09-30T10:00:00Z", closedAt: "2026-09-30T10:00:00Z", title: "Merged elsewhere" }, 78: { state: "CLOSED", mergedAt: null, closedAt: "2026-09-29T10:00:00Z", title: "Dropped" }, 79: { state: "OPEN", title: "Still open" } } });
  made.push(gh.dir);
  const sp = path.join(pm, "sources.json"); write(sp, { repo: root, issue: { repo: "o/r" } });
  fs.mkdirSync(path.join(root, ".git"), { recursive: true }); // not a repository git can read: only gh answers
  const page = `<table><tr><th>Step</th><th>Feature</th><th>Note</th></tr>
<tr><td>1</td><td>Product setup</td><td>PR #77 is open</td></tr><tr><td>2</td><td>Scanning rivals</td><td>PR #78 is open</td></tr><tr><td>3</td><td>Weekly report</td><td>PR #79 is open</td></tr></table>`;
  const r = run(A, ["adopt", pm, "--page", pageIn(root, page)], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /#77 merged \(2026-09-30\)/); assert.match(r.output, /#78 closed, not merged \(2026-09-29\)/); assert.ok(!/#79/.test(r.output.split("Stale wording")[1] || ""), "an open PR is correctly called open");
});

test("a stamped pm:auto block (data-generated, Turkish text) is never matched, marked or rewritten by adopt or refresh", () => {
  const { root, pm } = pmSetup();
  // Its table repeats Nosy data on purpose: if the block were scanned it would be offered and marked.
  const block = '<!-- pm:auto -->\n<section id="auto" data-generated="2026-10-02T13:15:00.000Z"><p>oluşturuldu 30 Eyl 13:15</p><table><tr><th>Name</th><th>Score</th><th>Effort</th></tr><tr><td>Pricing plans</td><td>5</td><td>S</td></tr><tr><td>Export CSV</td><td>3</td><td>M</td></tr></table></section>\n<!-- /pm:auto -->';
  const page = pageIn(root, PAGE.replace(AUTO, block));
  const listed = doRun("adopt", pm, page);
  assert.equal(listed.code, 0, listed.error);
  assert.ok(!/table at line 3[0-9]|oluşturuldu/.test(listed.output), "the block's table is not offered");
  doRun("adopt", pm, page, "--apply", "--yes");
  const text = () => fs.readFileSync(page, "utf8");
  assert.ok(text().includes(block), "marked page: the block is byte for byte the same");
  assert.equal(doRun("refresh", pm, page).code, 0);
  assert.ok(text().includes(block), "refreshed page: the block is byte for byte the same");
  assert.equal((text().match(/<!-- pm:table /g) || []).length, 2, "only the page's own two tables are marked");
});
