// Low-severity fixes, batch B: hand-written to-do files, interview notes in .docx, rival-demand / build-page / team-next with a missing or
// damaged file, `**Label**:` product fields, `#L5` and "line 3" citations, and the Cloud project name for a pm/ inside docs/.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { check } from "../tools/cite-check.mjs";
import { pageFromProduct } from "../tools/page-path.mjs";

process.env.NOSY_TZ = "UTC";
const dirs = [];
after(() => dirs.forEach(clean));
const tmp = prefix => { const d = temporary(prefix); dirs.push(d); return d; };
const put = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
const sources = (root, extra = {}) => put(path.join(root, "pm", "sources.json"), JSON.stringify({ repo: root, ref: "main", ...extra }));

// 1. todo ----------------------------------------------------------------------------------------------------------------------
test("todo: a hand-written file in pm/todo is listed, and `Status: Done` in any case closes it", () => {
  const root = tmp("nosy-lowsb-todo-"), pm = path.join(root, "pm"); sources(root);
  put(path.join(pm, "todo", "pay-domain.md"), "# Pay the domain\n\n- **Who:** ali\n- **Why:** needs the company card\n- **Status:** Open\n");
  put(path.join(pm, "todo", "old-thing.md"), "# Renew the certificate\n\n- **Who:** ali\n- **Status:** Done\n");
  put(path.join(pm, "todo", "nt-260930-sign-form.md"), "# Todo nt-260930-sign-form\n\n- **Todo:** Sign the form\n- **Who:** ali\n- **Added:** 2026-09-30\n- **Status:** DONE\n- **Done:** 2026-10-01\n");
  const list = run(path.join(Tool, "todo.mjs"), [pm, "list"]);
  assert.equal(list.code, 0, list.error);
  assert.match(list.output, /pay-domain/);
  assert.match(list.output, /Pay the domain/);
  assert.ok(!/old-thing|Renew the certificate/.test(list.output), "a hand-written file marked Done is closed");
  assert.ok(!/sign-form|Sign the form/.test(list.output), "`DONE` closes an nt- file too");
  const done = run(path.join(Tool, "todo.mjs"), [pm, "done", "pay-domain"]);
  assert.equal(done.code, 0, done.error);
  assert.match(done.output, /pay-domain done/);
});

// 2. interview-themes ----------------------------------------------------------------------------------------------------------
test("interview-themes: .docx notes are named as skipped, not met with a bare 'no interview notes found'", () => {
  const root = tmp("nosy-lowsb-iv-"), pm = path.join(root, "pm"); sources(root);
  put(path.join(pm, "signal", "interviews", "2026-09-01-acme.docx"), "PK");
  put(path.join(pm, "signal", "interviews", "2026-09-02-beta.docx"), "PK");
  const r = run(path.join(Tool, "interview-themes.mjs"), [pm]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /skipped 2 \.docx files/i);
  assert.match(r.output, /2026-09-01-acme\.docx/);
  assert.match(r.output, /convert to \.md\/\.txt/);
  // With one readable note beside them, the skipped files are still named.
  put(path.join(pm, "signal", "interviews", "2026-09-03-gamma.md"), "- A monthly bulk export of shipments to CSV would help our accounting team a lot.\n");
  const r2 = run(path.join(Tool, "interview-themes.mjs"), [pm]);
  assert.match(r2.output, /skipped 2 \.docx files/i);
});

// 3. rival-demand --------------------------------------------------------------------------------------------------------------
test("rival-demand: a missing or damaged sources.json is named, with what to do (no ENOENT, no bare JSON error)", () => {
  const root = tmp("nosy-lowsb-rd-"), pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true });
  const missing = run(path.join(Tool, "rival-demand.mjs"), [pm]);
  assert.equal(missing.code, 1);
  assert.match(missing.error, /sources\.json/);
  assert.ok(!/ENOENT/.test(missing.error + missing.output), missing.error);
  put(path.join(pm, "sources.json"), '{ "repo": ".", }');
  const bad = run(path.join(Tool, "rival-demand.mjs"), [pm]);
  assert.equal(bad.code, 1);
  assert.match(bad.error, /sources\.json/);
  assert.match(bad.error, /valid JSON/);
});

// 4. build-page ----------------------------------------------------------------------------------------------------------------
test("build-page: a malformed sources.json stops the build, names the file, writes nothing", () => {
  const root = tmp("nosy-lowsb-page-"), pm = path.join(root, "pm"); put(path.join(pm, "sources.json"), '{ "repo": ".", }');
  const out = path.join(root, "page.html");
  const r = run(path.join(Tool, "build-page.mjs"), [pm, out]);
  assert.notEqual(r.code, 0, "exit code must not be 0");
  assert.match(r.error, /sources\.json/);
  assert.ok(!/written/.test(r.output), "no 'written' line");
  assert.ok(!fs.existsSync(out), "no page");
});

// 5. team-next -----------------------------------------------------------------------------------------------------------------
test("team-next: a next.path that does not exist is said, and exits 1", () => {
  const root = tmp("nosy-lowsb-tn-"), pm = path.join(root, "pm");
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  sources(root, { next: { path: "docs/NOPE.md" } });
  const r = run(path.join(Tool, "team-next.mjs"), [pm]);
  assert.equal(r.code, 1, r.output);
  assert.match(r.error, /docs\/NOPE\.md/);
  assert.match(r.error, /does not exist/);
});

// 6. `**Label**:` product fields ------------------------------------------------------------------------------------------------
test("build-page: product fields are read as `**Label**:` too", () => {
  const root = tmp("nosy-lowsb-label-"), pm = path.join(root, "pm"); sources(root);
  put(path.join(pm, "product.md"), "# Plainname\n\n**Page name**: Zorbo\n**What**: A tool that counts sheep.\n");
  const out = path.join(root, "page.html");
  const r = run(path.join(Tool, "build-page.mjs"), [pm, out]);
  assert.equal(r.code, 0, r.error);
  const html = fs.readFileSync(out, "utf8");
  assert.match(html, /Zorbo/);
  assert.match(html, /A tool that counts sheep/);
});
test("page-path: the old urun.md is read when product.md is absent, in either label form", () => {
  const pm = path.join(tmp("nosy-lowsb-urun-"), "pm");
  put(path.join(pm, "urun.md"), "- **Sayfa**: pm/status.html\n");
  assert.equal(pageFromProduct(pm), "pm/status.html");
  put(path.join(pm, "urun.md"), "- **Page:** pm/other.html\n");
  assert.equal(pageFromProduct(pm), "pm/other.html");
});

// 7. cite-check ----------------------------------------------------------------------------------------------------------------
function citeRepo() {
  const root = tmp("nosy-lowsb-cite-");
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  put(path.join(root, "README.md"), Array.from({ length: 10 }, (_, i) => `line ${i + 1} of the readme`).join("\n") + "\n");
  execFileSync("git", ["-C", root, "add", "."]);
  return root;
}
test("cite-check: `README.md#L5` and 'line N' / 'lines N-M' next to a file name are checked", () => {
  const repo = citeRepo(), bad = t => check(t, { repo }).problems;
  assert.equal(bad("See README.md#L5 for it.").length, 0);
  assert.equal(bad("See README.md#L3-L5 for it.").length, 0);
  assert.equal(bad("See README.md line 3.").length, 0);
  assert.equal(bad("See `README.md`, lines 2-4.").length, 0);
  assert.equal(bad("It is on line 3 of README.md.").length, 0);
  assert.match(bad("See README.md#L50.").map(p => p.why).join(), /has 10 lines/);
  assert.match(bad("See README.md (line 99).").map(p => p.why).join(), /has 10 lines/);
  assert.match(bad("See lines 2-40 of README.md.").map(p => p.why).join(), /has 10 lines/);
  assert.equal(check("See README.md#L5 and README.md line 3.", { repo }).counts.cites, 2);
});
test("cite-check: no false alarms for prose that only looks like a citation", () => {
  const repo = citeRepo(), bad = t => check(t, { repo }).problems;
  assert.equal(bad("Node.js line 5 of the table says it works.").length, 0, "a name that is not a repo file, beside 'line N', is not a miss");
  assert.equal(bad("Row #3 of the table and tablo #2.").length, 0, "a one-digit #N with no issue/PR word is still ignored");
  assert.equal(bad("Version 1.2 line 4 is old.").length, 0);
});

// 8. publish -------------------------------------------------------------------------------------------------------------------
function publishDry(root, args = [], extraSources = {}) {
  const pm = path.join(root, "docs", "pm");
  put(path.join(pm, "matrix.json"), JSON.stringify({ steps: [{ no: "1", name: "Setup" }], biz: { name: "Cargo", codes: { 1: "y" } }, products: [] }));
  put(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ...extraSources }));
  const home = path.join(root, "..", "home-" + path.basename(root)); fs.mkdirSync(home, { recursive: true });
  return run(path.join(Tool, "publish.mjs"), [pm, "--dry-run", ...args], { env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home } });
}
test("publish: a pm/ inside docs/ takes the project name from the git repo's root, not 'docs'", () => {
  const parent = tmp("nosy-lowsb-pub-"), root = path.join(parent, "myproj"); fs.mkdirSync(root);
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  const r = publishDry(root);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /as "myproj"/);
});
test("publish: without a git root, docs/pm keeps the old name; sources.json cloud.project and --project win", () => {
  const parent = tmp("nosy-lowsb-pub2-"), root = path.join(parent, "plain"); fs.mkdirSync(root);
  assert.match(publishDry(root).output, /as "docs"/);
  assert.match(publishDry(root, [], { cloud: { project: "chosen" } }).output, /as "chosen"/);
  assert.match(publishDry(root, ["--project", "given"], { cloud: { project: "chosen" } }).output, /as "given"/);
  const repo = path.join(parent, "gitted"); fs.mkdirSync(repo); execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  assert.match(publishDry(repo, [], { cloud: { project: "chosen" } }).output, /as "chosen"/);
});
