// matrix-proposals.mjs: the evidence gate for matrix cells the neighbor agents propose.
// On the first real run 10 of 75 proposals had enough evidence. Pure functions first, then the CLI against a throwaway pm/.
import { localDay } from "../tools/today.mjs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { domainOf, urlKey, classify, check, applyTo, locate, summary } from "../tools/matrix-proposals.mjs";

const dirs = [], T = path.join(Tool, "matrix-proposals.mjs"), NOSY = path.join(Tool, "nosy.mjs");
after(() => dirs.forEach(clean));
const tmp = () => { const d = temporary("nosy-mxp-"); dirs.push(d); return d; };

const ev = (url, grade, extra = {}) => ({ url, grade, page_opened: true, date_kind: "none", ...extra });
const P = (o = {}) => ({ rival: "RivalOne", step: "2", from: "u", to: "y", removal: false, evidence: [ev("https://rival.example/docs/x", "primary")], ...o });
// The step shape build-matrix.mjs writes.
const stepMatrix = () => ({ update: "2026-09-29", steps: [{ no: "1", name: "Scanning rival sites" }, { no: "2", name: "Change alerts" }, { no: "3", name: "Feature matrix" }],
  biz: { name: "Us", codes: {} },
  products: [{ name: "RivalOne", file: "rivalone.md", codes: { 1: { k: "y", evidence: "old text https://old.example" }, 2: { k: "u", evidence: "not found" }, 3: { k: "p", evidence: "partial" } } },
    { name: "RivalTwo", codes: { 1: "n", 2: "n", 3: "y" } }] });
const lineMatrix = () => ({ products: ["Us", "RivalOne"], lines: [{ feature: "Change alerts", not: "", codes: { Us: "n", RivalOne: "u" } }, { feature: "Bulk export", codes: { Us: "y", RivalOne: "p" } }] });

test("registrable domain: no www, last two labels; the same page written two ways is one url", () => {
  assert.equal(domainOf("https://www.rival.com/a"), "rival.com");
  assert.equal(domainOf("https://docs.rival.com/a"), "rival.com");
  assert.equal(domainOf("https://rival.com"), "rival.com");
  assert.equal(domainOf("not a url"), "");
  assert.equal(urlKey("https://www.rival.com/changelog/#top"), urlKey("https://rival.com/changelog"));
  assert.notEqual(urlKey("https://rival.com/a"), urlKey("https://rival.com/b"));
});

test("apply: one opened primary item, or two opened secondary items from different domains", () => {
  assert.equal(classify(P()).class, "apply");
  const two = [ev("https://blog.one.com/a", "secondary"), ev("https://news.two.com/b", "secondary")];
  assert.equal(classify(P({ evidence: two })).class, "apply", "two independent secondaries carry even a y");
  assert.equal(classify(P({ evidence: [ev("https://docs.one.com/a", "secondary"), ev("https://www.one.com/b", "secondary")] })).class, "hold", "two pages of one site are one source");
  assert.equal(classify(P({ evidence: [ev("https://one.com/a", "secondary")] })).class, "hold");
});

test("a page that wasn't opened proves nothing: hold, whatever its grade", () => {
  const c = classify(P({ evidence: [ev("https://rival.example/docs/x", "primary", { page_opened: false })] }));
  assert.equal(c.class, "hold"); assert.equal(c.opened, false); assert.equal(c.ceiling, null);
  assert.match(c.reasons.join(" "), /no evidence page was opened/);
  assert.equal(classify(P({ evidence: [] })).class, "hold");
  // An unopened primary next to an opened secondary doesn't add up to either rule.
  assert.equal(classify(P({ evidence: [ev("https://r.example/a", "primary", { page_opened: false }), ev("https://x.com/b", "secondary")] })).class, "hold");
});

test("marketing-only and gated-only evidence cap the cell at p and are held, never applied as y", () => {
  const m = classify(P({ evidence: [ev("https://rival.example/", "marketing")] }));
  assert.deepEqual([m.class, m.ceiling], ["hold", "p"]); assert.match(m.reasons.join(" "), /marketing page only \(at most p\)/);
  const g = classify(P({ evidence: [ev("https://rival.example/listing", "gated")] }));
  assert.deepEqual([g.class, g.ceiling], ["hold", "p"]); assert.match(g.reasons.join(" "), /behind a login/);
  assert.equal(classify(P()).ceiling, "y");
});

test("reject: lowering a y or p to u or n without removal; the same lowering with removal and evidence applies", () => {
  const low = classify(P({ from: "y", to: "u", evidence: [ev("https://rival.example/changelog", "primary")] }), { current: "y" });
  assert.equal(low.class, "reject"); assert.match(low.reasons[0], /nothing found this round is not "not there"/);
  assert.equal(classify(P({ from: "p", to: "n" }), { current: "p" }).class, "reject");
  assert.equal(classify(P({ from: "p", to: "n", removal: true }), { current: "p" }).class, "apply");
  // The matrix is the authority: the proposal says it started at u, the matrix has y.
  assert.equal(classify(P({ from: "u", to: "n" }), { current: "y" }).class, "reject");
  // Raising, or lowering something that was already u/n/d, is an ordinary proposal.
  assert.equal(classify(P({ from: "u", to: "n" }), { current: "u" }).class, "apply");
  assert.equal(classify(P({ from: "y", to: "d" }), { current: "y" }).class, "apply");
});

test("reject: every opened page is dated only by a page date", () => {
  const dated = (kind, extra = {}) => ev("https://rival.example/blog/post", "primary", { date: "2026-10-02", date_kind: kind, ...extra });
  const c = classify(P({ evidence: [dated("page")] }));
  assert.equal(c.class, "reject"); assert.match(c.reasons[0], /not a ship date/);
  assert.equal(classify(P({ evidence: [dated("release")] })).class, "apply", "a release note's date is a ship date");
  assert.equal(classify(P({ evidence: [ev("https://rival.example/docs", "primary")] })).class, "apply", "no date at all is fine");
  assert.equal(classify(P({ evidence: [dated("page"), ev("https://rival.example/docs", "primary")] })).class, "apply", "a page-dated page next to an undated docs page doesn't sink the cell");
});

test("check: one url behind two rows is listed; a rival or step not in the matrix is a warning and can't be applied", () => {
  const shared = "https://rival.example/announcement";
  const R = check({ proposals: [P({ step: "1", from: "y", evidence: [ev(shared, "primary")] }), P({ step: "2", evidence: [ev(shared + "/", "primary")] }), P({ step: "3", from: "p", evidence: [ev("https://rival.example/other", "primary")] }),
    P({ rival: "Ghost" }), P({ step: "99" })] }, stepMatrix());
  const w = R.warnings.find(x => x.kind === "shared-url");
  assert.ok(w, "the shared url is a warning"); assert.equal(w.rows.length, 2); assert.match(w.text, /look again before applying/);
  assert.match(R.proposals[0].warnings.join(" "), /backs other rows/); assert.deepEqual(R.proposals[2].warnings, []);
  assert.ok(R.warnings.some(x => /rival "Ghost" is not in the matrix/.test(x.text)));
  assert.ok(R.warnings.some(x => /step "99" is not in the matrix/.test(x.text)));
  assert.deepEqual(R.counts, { total: 5, apply: 5, hold: 0, reject: 0 });
  assert.equal(applyTo(stepMatrix(), R).skipped.length, 2, "the two unlocatable proposals are skipped, not invented");
  // The same page twice on ONE row is not a warning.
  assert.equal(check([P({ evidence: [ev(shared, "primary"), ev(shared, "primary")] })], stepMatrix()).warnings.length, 0);
});

test("check: two proposals for one cell that disagree are both held", () => {
  const R = check([P({ to: "y" }), P({ to: "p", evidence: [ev("https://rival.example/other", "primary")] })], stepMatrix());
  assert.deepEqual(R.proposals.map(c => c.class), ["hold", "hold"]);
  assert.match(R.proposals[0].reasons[0], /another proposal for the same cell/);
});

test("step number or row feature finds the cell, in both matrix shapes", () => {
  assert.equal(locate(stepMatrix(), "rivalone", "2").no, "2");
  assert.equal(locate(stepMatrix(), "RivalOne", "change ALERTS").no, "2");
  assert.equal(locate(stepMatrix(), "RivalOne", "2").current, "u");
  assert.equal(locate(lineMatrix(), "RivalOne", "Change alerts").current, "u");
  assert.equal(locate(stepMatrix(), "Us", "2").ours, true);
  assert.equal(locate(lineMatrix(), "RivalOne", "Nope").stepFound, false);
});

test("applyTo, step shape: apply writes { k, evidence: first primary url, verified_at }; hold and reject only re-date, and only when opened", () => {
  const M = stepMatrix();
  const R = check([
    P({ step: "2", to: "y", evidence: [ev("https://news.com/a", "secondary"), ev("https://rival.example/release-notes", "primary")] }), // apply
    P({ step: "1", from: "y", to: "u", evidence: [ev("https://rival.example/blog", "primary")] }),                                          // reject (lowering)
    P({ step: "3", to: "y", evidence: [ev("https://rival.example/", "marketing")] }),                                                       // hold, opened
    P({ rival: "RivalTwo", step: "1", from: "n", to: "y", evidence: [ev("https://two.example/p", "primary", { page_opened: false })] }),    // hold, NOT opened
    P({ rival: "RivalTwo", step: "3", from: "y", to: "n", evidence: [ev("https://two.example/q", "primary")] }),                            // reject, opened, cell is a bare string
  ], M);
  assert.deepEqual(R.proposals.map(c => c.class), ["apply", "reject", "hold", "hold", "reject"]);
  const A = applyTo(M, R, { today: "2026-10-02" }), r1 = A.matrix.products[0].codes, r2 = A.matrix.products[1].codes;
  assert.deepEqual(r1[2], { k: "y", evidence: "https://rival.example/release-notes", verified_at: "2026-10-02" });
  assert.deepEqual(r1[1], { k: "y", evidence: "old text https://old.example", verified_at: "2026-10-02" }, "rejected: code and evidence kept, date refreshed");
  assert.deepEqual(r1[3], { k: "p", evidence: "partial", verified_at: "2026-10-02" }, "held, opened: code kept, date refreshed");
  assert.equal(r2[1], "n", "held and nothing opened: not touched at all");
  assert.deepEqual(r2[3], { k: "y", verified_at: "2026-10-02" }, "a bare-string cell becomes { k, verified_at } with the same code");
  assert.deepEqual(M, stepMatrix(), "the input is never changed");
  assert.deepEqual(A.changes.map(c => c.kind), ["code", "re-dated", "re-dated", "re-dated"]);
});

test("applyTo, line shape: the code string only (there is nowhere to keep a date); other rows untouched", () => {
  const M = lineMatrix();
  const A = applyTo(M, check([P({ step: "Change alerts", to: "p" })], M), { today: "2026-10-02" });
  assert.equal(A.matrix.lines[0].codes.RivalOne, "p");
  assert.deepEqual(A.matrix.lines[1], M.lines[1]);
  assert.equal(JSON.stringify(A.matrix).includes("verified_at"), false);
});

test("summary names the three classes, the reasons and the look-again list", () => {
  const md = summary(check([P(), P({ step: "1", from: "y", to: "n" }), P({ step: "3", evidence: [ev("https://rival.example/", "marketing")] })], stepMatrix()));
  assert.match(md, /3 checked: 1 to apply, 1 held, 1 rejected/);
  assert.match(md, /## Apply \(1\)[\s\S]*## Hold[\s\S]*## Reject \(1\)/);
});

// --- the CLI ---------------------------------------------------------------------------------------------------------------
function pmWith(proposals, matrix = stepMatrix()) {
  const root = tmp(), pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify(matrix, null, 1));
  fs.writeFileSync(path.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals }));
  return pm;
}

test("check writes pm/state/matrix-proposals.checked.json and prints the summary, and changes nothing else", () => {
  const pm = pmWith([P(), P({ step: "3", evidence: [ev("https://rival.example/", "marketing")] })]);
  const before = fs.readFileSync(path.join(pm, "matrix.json"), "utf8");
  const r = run(T, ["check", pm]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /2 checked: 1 to apply, 1 held, 0 rejected/);
  const J = JSON.parse(fs.readFileSync(path.join(pm, "state", "matrix-proposals.checked.json"), "utf8"));
  assert.deepEqual(J.proposals.map(c => c.class), ["apply", "hold"]);
  assert.equal(fs.readFileSync(path.join(pm, "matrix.json"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(pm, ".backup")), false);
});

test("apply --dry-run lists the changes and writes nothing; apply backs up first, writes the cells, and undo puts the matrix back", () => {
  const pm = pmWith([P({ evidence: [ev("https://rival.example/release-notes", "primary")] }), P({ step: "3", evidence: [ev("https://rival.example/", "marketing")] })]);
  const file = path.join(pm, "matrix.json"), before = fs.readFileSync(file, "utf8");
  const d = run(T, ["apply", pm, "--dry-run"]);
  assert.equal(d.code, 0, d.error); assert.match(d.output, /Would change 1 cell\(s\), re-dated 1/); assert.match(d.output, /RivalOne \/ step 2: u → y/);
  assert.equal(fs.readFileSync(file, "utf8"), before); assert.equal(fs.existsSync(path.join(pm, ".backup")), false);

  const a = run(T, ["apply", pm]);
  assert.equal(a.code, 0, a.error); assert.match(a.output, /Backed up first: .*matrix-\d{8}T\d{6}\.json\. To put it back: `.*matrix-proposals undo`\./);
  const M = JSON.parse(fs.readFileSync(file, "utf8")), today = localDay();
  assert.deepEqual(M.products[0].codes[2], { k: "y", evidence: "https://rival.example/release-notes", verified_at: today });
  assert.equal(M.products[0].codes[3].k, "p"); assert.equal(M.products[0].codes[3].verified_at, today);
  const bak = fs.readdirSync(path.join(pm, ".backup")).filter(f => /^matrix-.*\.json$/.test(f) && !/meta/.test(f));
  assert.equal(bak.length, 1); assert.equal(fs.readFileSync(path.join(pm, ".backup", bak[0]), "utf8"), before, "the backup is the matrix as it was");
  assert.equal(fs.readFileSync(path.join(pm, ".backup", ".gitignore"), "utf8"), "*\n");

  const u = run(T, ["undo", pm]);
  assert.equal(u.code, 0, u.error); assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(run(T, ["undo", pm]).code, 1, "nothing left to undo");
});

test("undo leaves a matrix alone that changed after the apply, unless --force; two applies undo one at a time", () => {
  const pm = pmWith([P()]), file = path.join(pm, "matrix.json"), original = fs.readFileSync(file, "utf8");
  run(T, ["apply", pm]);
  const applied = fs.readFileSync(file, "utf8"), edited = applied.replace("RivalTwo", "RivalTwo (edited by hand)");
  fs.writeFileSync(file, edited);
  const u = run(T, ["undo", pm]);
  assert.equal(u.code, 1); assert.match(u.error, /changed after the apply/); assert.equal(fs.readFileSync(file, "utf8"), edited);
  assert.equal(run(T, ["undo", pm, "--force"]).code, 0); assert.equal(fs.readFileSync(file, "utf8"), original);
  // Two applies in a row: undo goes back one step each time.
  fs.writeFileSync(path.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals: [P({ step: "1", from: "y", to: "d", evidence: [ev("https://rival.example/a", "primary")] })] }));
  run(T, ["apply", pm]); const one = fs.readFileSync(file, "utf8");
  fs.writeFileSync(path.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals: [P({ step: "2", evidence: [ev("https://rival.example/b", "primary")] })] }));
  run(T, ["apply", pm]);
  assert.equal(run(T, ["undo", pm]).code, 0); assert.equal(fs.readFileSync(file, "utf8"), one);
  assert.equal(run(T, ["undo", pm]).code, 0); assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("apply with nothing that earned it changes no cell and makes no backup; --matrix points at another file", () => {
  const pm = pmWith([P({ evidence: [ev("https://rival.example/", "marketing", { page_opened: false })] })]);
  const a = run(T, ["apply", pm]);
  assert.equal(a.code, 0, a.error); assert.match(a.output, /Nothing to change/); assert.equal(fs.existsSync(path.join(pm, ".backup")), false);
  const other = path.join(path.dirname(pm), "other-matrix.json"); fs.writeFileSync(other, JSON.stringify(lineMatrix()));
  fs.writeFileSync(path.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals: [P({ step: "Change alerts", to: "p" })] }));
  assert.equal(run(T, ["apply", pm, "--matrix", other]).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(other, "utf8")).lines[0].codes.RivalOne, "p");
  assert.equal(JSON.parse(fs.readFileSync(path.join(pm, "matrix.json"), "utf8")).products[0].codes[2].k, "u", "pm/matrix.json untouched");
});

test("a missing proposals file or matrix says what to do and exits 1", () => {
  const root = tmp(), pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true });
  const r = run(T, ["check", pm]);
  assert.equal(r.code, 1); assert.match(r.error, /neighbor agents write their proposed matrix cells there/);
  assert.equal(run(T, []).code, 1);
});

test("nosy matrix-proposals check|apply|undo is wired, and a flag first means check", () => {
  const pm = pmWith([P()]);
  const c = run(NOSY, ["matrix-proposals", "check", "--pm", pm]); assert.equal(c.code, 0, c.error); assert.match(c.output, /1 to apply/);
  assert.match(run(NOSY, ["matrix-proposals", "apply", "--dry-run", "--pm", pm]).output, /Would change 1 cell/);
  assert.match(run(NOSY, ["matrix-proposals", "--pm", pm]).output, /1 checked/);
  assert.match(run(NOSY, ["help"]).output, /nosy matrix-proposals \[check\|apply\|undo\]/);
});

// The rival tables are the source pm/matrix.json is rebuilt from: an applied cell has to be there too, and undo restores both.
import { syncRivals } from "../tools/matrix-proposals.mjs";
import { run as runTool, temporary as tempDir, clean as cleanDir, Tool as ToolDir } from "./helpers.mjs";
import fs2 from "node:fs";
import path2 from "node:path";
test("apply writes the cell and its verified date into the rival table, build-matrix reads it back, undo restores matrix and table", () => {
  const root = tempDir("nosy-mp-sync-"); try {
    const pm = path2.join(root, "pm"), rivals = path2.join(pm, "rivals"); fs2.mkdirSync(path2.join(pm, "state"), { recursive: true }); fs2.mkdirSync(rivals);
    fs2.writeFileSync(path2.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main" }));
    fs2.writeFileSync(path2.join(rivals, "acme.md"), "# Acme\n\n**Category:** crm\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Export | p | blog post |\n| 2 | Share | n | none |\n");
    fs2.writeFileSync(path2.join(pm, "us.json"), JSON.stringify({ name: "Us", codes: { 1: "y", 2: "y" }, notes: {} }));
    assert.equal(runTool(path2.join(ToolDir, "build-matrix.mjs"), [pm]).code, 0);
    fs2.writeFileSync(path2.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals: [{ rival: "Acme", step: "1", from: "p", to: "y", evidence: [{ url: "https://acme.example/docs/export", grade: "primary", page_opened: true }] }] }));
    const r = runTool(path2.join(ToolDir, "matrix-proposals.mjs"), ["apply", pm]);
    assert.equal(r.code, 0, r.error + r.output);
    assert.match(r.output, /Also written into 1 row\(s\) of the rival tables/);
    const md = fs2.readFileSync(path2.join(rivals, "acme.md"), "utf8");
    assert.match(md, /\| 1 \| Export \| y \| https:\/\/acme\.example\/docs\/export \[verified: \d{4}-\d{2}-\d{2}\] \|/);
    assert.match(md, /\| 2 \| Share \| n \| none \|/, "other rows untouched");
    // A rebuild from the tables keeps the code and the verified date, and the date isn't part of the evidence text.
    assert.equal(runTool(path2.join(ToolDir, "build-matrix.mjs"), [pm]).code, 0);
    const cell = JSON.parse(fs2.readFileSync(path2.join(pm, "matrix.json"), "utf8")).products[0].codes[1];
    assert.equal(cell.k, "y"); assert.equal(cell.evidence, "https://acme.example/docs/export"); assert.match(cell.verified_at, /^\d{4}-\d{2}-\d{2}$/);
    // Undo: the matrix and the rival table go back together.
    const u = runTool(path2.join(ToolDir, "matrix-proposals.mjs"), ["undo", pm, "--force"]);
    assert.equal(u.code, 0, u.error + u.output);
    assert.match(fs2.readFileSync(path2.join(rivals, "acme.md"), "utf8"), /\| 1 \| Export \| p \| blog post \|/);
  } finally { cleanDir(root); }
});

// ---- review of 2 Oct: both shapes, names that differ in case or spacing, a matrix that moved on, the owner's letters, an owner's indent ----
test("a rival whose name differs in case or spacing from the matrix still finds its cell, in both shapes, and apply writes under the matrix's own spelling", () => {
  for (const name of ["rivalone", "RIVALONE", "rivalONE ", "RivalOne\t", "  rivalone"]) {
    assert.equal(locate(stepMatrix(), name, "2").rivalFound, true, JSON.stringify(name));
    assert.equal(locate(lineMatrix(), name, "Change alerts").rivalFound, true, JSON.stringify(name));
  }
  const spaced = stepMatrix(); spaced.products[0].name = "Rival One";
  assert.equal(locate(spaced, "  rival   ONE ", "2").rival, "Rival One", "inner spacing is folded too");
  const M = stepMatrix(); const R = check([P({ rival: " rivalone ", step: " change ALERTS " })], M);
  assert.equal(R.proposals[0].cell.found, true); assert.equal(R.proposals[0].class, "apply");
  const A = applyTo(M, R, { today: "2026-10-02" });
  assert.equal(A.matrix.products[0].name, "RivalOne"); assert.equal(A.matrix.products[0].codes[2].k, "y");
  assert.equal(A.changes[0].rival, "RivalOne", "the change names the rival as the matrix does");
  const L = lineMatrix(), RL = check([P({ rival: "rivalone", step: "CHANGE alerts", to: "p" })], L);
  assert.equal(applyTo(L, RL).matrix.lines[0].codes.RivalOne, "p");
  // Two spellings of one rival in one file are one cell: if they disagree, both are held.
  const two = check([P({ rival: "RivalOne", to: "y" }), P({ rival: "rivalone", to: "p" })], stepMatrix());
  assert.deepEqual(two.proposals.map(c => c.class), ["hold", "hold"]);
});

test("a proposal against a matrix that moved on is held, per cell, with the reason; a second apply of the same file is a no-op", () => {
  const M = stepMatrix(); // RivalOne step 1 is y
  const R = check([P({ step: "1", from: "n", to: "p" }), P({ step: "2", from: "u", to: "y" }), P({ step: "3", to: "y", from: "" })], M);
  assert.deepEqual(R.proposals.map(c => c.class), ["hold", "apply", "apply"], "from 'n' but the matrix says y: held; no `from` can't be compared and is applied as before");
  assert.match(R.proposals[0].reasons[0], /the matrix changed since the agent looked: it says y now, the proposal started from n; propose again/);
  const pm = pmWith([P()]);
  assert.match(run(T, ["apply", pm]).output, /Changed 1 cell/);
  const again = run(T, ["apply", pm]);
  assert.match(again.output, /1 held/); assert.match(again.output, /Nothing to change/);
  assert.equal(fs.readdirSync(path.join(pm, ".backup")).filter(f => /^matrix-.*\.json$/.test(f) && !/meta|undone/.test(f)).length, 1, "no second backup for a second run that changed nothing");
});

test("a proposals file older than the matrix is said once in the summary; one newer than the matrix says nothing", () => {
  const pm = pmWith([P()]);
  const old = new Date(Date.now() - 3600e3), now = new Date();
  fs.utimesSync(path.join(pm, "state", "matrix-proposals.json"), old, old); fs.utimesSync(path.join(pm, "matrix.json"), now, now);
  assert.match(run(T, ["check", pm]).output, /Note: the proposals file is older than the matrix/);
  fs.utimesSync(path.join(pm, "state", "matrix-proposals.json"), now, now); fs.utimesSync(path.join(pm, "matrix.json"), old, old);
  assert.doesNotMatch(run(T, ["check", pm]).output, /older than the matrix/);
});

test("with matrixCodes, a cell that holds the owner's letter gets the owner's letter back; a bare Nosy code stays one", () => {
  const M = { products: ["Us", "RivalOne"], lines: [{ feature: "Change alerts", codes: { Us: "n", RivalOne: "s" } }, { feature: "Bulk export", codes: { Us: "y", RivalOne: "n" } }] };
  const codes = { s: "d", f: "p" };
  const R = check([P({ step: "Change alerts", from: "d", to: "p" }), P({ step: "Bulk export", from: "n", to: "p" })], M, { codes });
  assert.equal(R.proposals[0].cell.current, "d", "the matrix is read through the mapping");
  const A = applyTo(M, R, { codes });
  assert.equal(A.matrix.lines[0].codes.RivalOne, "f", "p is the owner's f");
  assert.equal(A.matrix.lines[1].codes.RivalOne, "p", "a cell in Nosy's own letters stays in them");
  const amb = applyTo(M, check([P({ step: "Change alerts", from: "d", to: "y" })], M, { codes }), { codes });
  assert.equal(amb.matrix.lines[0].codes.RivalOne, "y", "no letter of the owner's means y: Nosy's is written");
});

test("apply keeps the indent the owner's matrix file already has, and a CRLF-free trailing newline; an address typed without https:// is still that site", () => {
  const pm = pmWith([P()]), file = path.join(pm, "matrix.json");
  fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8")), null, 4) + "\n");
  assert.equal(run(T, ["apply", pm]).code, 0);
  const raw = fs.readFileSync(file, "utf8");
  assert.match(raw, /^\{\n {4}"/); assert.ok(raw.endsWith("}\n"));
  fs.writeFileSync(file, JSON.stringify(JSON.parse(raw), null, "\t"));
  fs.writeFileSync(path.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals: [P({ step: "1", from: "y", to: "p", removal: true, evidence: [ev("https://rival.example/a", "primary")] })] }));
  assert.equal(run(T, ["apply", pm]).code, 0);
  assert.match(fs.readFileSync(file, "utf8"), /^\{\n\t"/);
  assert.equal(domainOf("rival.com/changelog"), "rival.com"); assert.equal(domainOf("docs.rival.com/x?y=1"), "rival.com"); assert.equal(domainOf("localhost"), "");
  assert.equal(urlKey("rival.com/changelog/"), urlKey("https://www.rival.com/changelog"));
  const two = [ev("rival.com/a", "secondary"), ev("docs.rival.com/b", "secondary")];
  assert.equal(classify(P({ evidence: two })).class, "hold", "two pages of one site are one source, written with or without the scheme");
});

test("a proposals file with a null, a string or a corrupt body: the entries that aren't proposals are skipped, a bad file is named, nothing is changed", () => {
  const M = stepMatrix();
  assert.doesNotThrow(() => check({ proposals: [null, "x", 7, [], P()] }, M));
  assert.equal(check({ proposals: [null, "x", P()] }, M).counts.total, 1);
  const pm = pmWith([P()]), file = path.join(pm, "state", "matrix-proposals.json"), before = fs.readFileSync(path.join(pm, "matrix.json"), "utf8");
  fs.writeFileSync(file, '{ "proposals": [ { "rival": ');
  const r = run(T, ["apply", pm]);
  assert.equal(r.code, 1); assert.match(r.error, /matrix-proposals\.json isn't valid JSON .*nothing was changed/);
  assert.equal(fs.readFileSync(path.join(pm, "matrix.json"), "utf8"), before);
  fs.writeFileSync(file, JSON.stringify({ proposals: [P()] })); fs.writeFileSync(path.join(pm, "matrix.json"), "{ nope");
  const m = run(T, ["check", pm]); assert.equal(m.code, 1); assert.match(m.error, /matrix\.json isn't valid JSON/);
});

test("a proposal that names a row by its feature still lands in the rival table: the table's row is found by its number", () => {
  const root = temporary("nosy-mp-feature-"); dirs.push(root);
  const pm = path.join(root, "pm"), rivals = path.join(pm, "rivals"); fs.mkdirSync(path.join(pm, "state"), { recursive: true }); fs.mkdirSync(rivals);
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main" }));
  fs.writeFileSync(path.join(rivals, "acme.md"), "# Acme\n\n**Category:** crm\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | Export | p | blog post |\n| 2 | Share | n | none |\n");
  fs.writeFileSync(path.join(pm, "us.json"), JSON.stringify({ name: "Us", codes: { 1: "y", 2: "y" }, notes: {} }));
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [pm]).code, 0);
  fs.writeFileSync(path.join(pm, "state", "matrix-proposals.json"), JSON.stringify({ proposals: [{ rival: "acme", step: "export", from: "p", to: "y", evidence: [{ url: "https://acme.example/docs/export", grade: "primary", page_opened: true }] }] }));
  const r = run(T, ["apply", pm]);
  assert.equal(r.code, 0, r.error + r.output); assert.match(r.output, /Also written into 1 row\(s\) of the rival tables/);
  assert.match(fs.readFileSync(path.join(rivals, "acme.md"), "utf8"), /\| 1 \| Export \| y \| https:\/\/acme\.example\/docs\/export \[verified: \d{4}-\d{2}-\d{2}\] \|/);
});
