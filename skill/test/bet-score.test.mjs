// Contract tests for N3: skill/tools/bet.mjs (place/list/drop, one .md per bet, id) and
// skill/tools/score.mjs (settle from git with explicit links only). A local-only repo (no remote, like Nosy itself)
// with dated commits: a bet landed via a merged bet/<id> branch then patched and followed up, a bet landed by a commit
// then reverted, a bet never started (open too long), a bet with two listed PRs of which one merged (partial), a
// dropped bet, and an unrelated commit with similar words but no id (must not count).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { betId, betParse, betRender } from "../tools/bet.mjs";
// The fixtures are UTC instants and calendar days: pin the owner's zone so the suite answers the same under every zone it is run in.
process.env.NOSY_TZ = "UTC";

const NOW = "2026-09-28T12:00:00Z", DAY = 864e5;
const at = d => new Date(Date.parse(NOW) - d * DAY).toISOString();
let root, repo, pm, S, out, ids = {};

before(() => {
  root = temporary("nosy-bets-"); repo = path.join(root, "repo"); pm = path.join(root, "pm");
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(pm, { recursive: true });
  const g = (args, d) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, ...(d != null ? { GIT_AUTHOR_DATE: at(d), GIT_COMMITTER_DATE: at(d) } : {}) } });
  const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
  const commit = (msg, files, d) => { for (const [f, t] of Object.entries(files)) write(f, t); g(["add", "-A"]); g(["commit", "-q", "-m", msg], d); };
  g(["init", "-q", "-b", "main"]); g(["config", "user.name", "T"]); g(["config", "user.email", "t@t.test"]);
  commit("chore: start", { "README.md": "# app\n" }, 60);
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main" }));
  const place = (what, extra) => { const r = run(path.join(Tool, "bet.mjs"), [pm, "place", what, "--why", "test", ...extra]); assert.equal(r.code, 0, r.error); return r.output.match(/Bet placed: (\S+)/)[1]; };
  ids.a = place("Bulk export of shipments", ["--estimate", "M", "--basis", "code", "--rests-on", "#12", "--date", at(20).slice(0, 10), "--expect", "fewer support tickets about exports"]);
  ids.b = place("Dark mode toggle", ["--estimate", "S", "--date", at(12).slice(0, 10)]);
  ids.c = place("Invoice archive", ["--estimate", "S", "--date", at(40).slice(0, 10)]);
  ids.d = place("Barcode scanning", ["--estimate", "L", "--pr", "7,8", "--date", at(30).slice(0, 10)]);
  ids.e = place("Route optimization", ["--estimate", "M", "--date", at(25).slice(0, 10)]);
  assert.equal(run(path.join(Tool, "bet.mjs"), [pm, "drop", ids.e, "--reason", "decided not to"]).code, 0);

  // A: work on a branch named with the id, merged with --no-ff (message carries the branch name).
  g(["checkout", "-q", "-b", `bet/${ids.a}`]);
  commit("export: csv writer", { "src/export.js": "export const csv = 1;\n" }, 18);
  commit("export: button", { "src/ExportButton.jsx": "export const B = 1;\n" }, 16);
  g(["checkout", "-q", "main"]); g(["merge", "--no-ff", "-q", "-m", `Merge branch 'bet/${ids.a}'`, `bet/${ids.a}`], 15);
  commit(`fix: export encoding\n\nBet: ${ids.a}`, { "src/export.js": "export const csv = 2;\n" }, 10);
  commit("tweak export copy", { "src/ExportButton.jsx": "export const B = 2;\n" }, 9);
  commit("chore: unrelated bulk export shipments docs wording", { "docs/x.md": "bulk export shipments\n" }, 8);
  // B: a direct commit carrying the id, then reverted.
  commit(`feat: dark mode toggle\n\nBet: ${ids.b}`, { "src/theme.js": "export const dark = true;\n" }, 11);
  const bHash = g(["rev-parse", "HEAD"]).trim();
  g(["revert", "--no-edit", bHash], 5);
  // D: two listed PRs, only #7 merged (GitHub-style merge message, local repo).
  g(["checkout", "-q", "-b", "feat/barcode"]); commit("barcode: scanner", { "src/barcode.js": "export const s = 1;\n" }, 22);
  g(["checkout", "-q", "main"]); g(["merge", "--no-ff", "-q", "-m", "Merge pull request #7 from team/feat/barcode", "feat/barcode"], 21);

  const r = run(path.join(Tool, "score.mjs"), [pm, "--now", NOW]);
  // Exit contract: this fixture has a reverted bet and one open too long, so score says "look" (2), not "clean" (0).
  assert.equal(r.code, 2, r.error); out = r.output;
  S = JSON.parse(fs.readFileSync(path.join(pm, "state", "score.json"), "utf8"));
});
after(() => clean(root));

const bet = id => S.bets.find(b => b.id === id);

test("bet ids: nb-<yyMMdd>-<slug ≤3 words>, unique, and a file + index per bet", () => {
  assert.match(ids.a, /^nb-\d{6}-bulk-export-shipments$/);
  assert.equal(betId("Bulk export of shipments", "2026-09-28", new Set(["nb-260928-bulk-export-shipments"])), "nb-260928-bulk-export-shipments-2");
  assert.ok(fs.existsSync(path.join(pm, "bets", `${ids.a}.md`)));
  const idx = JSON.parse(fs.readFileSync(path.join(pm, "bets", "bets.json"), "utf8"));
  assert.equal(idx.bets.length, 5);
  const b = betParse(betRender({ id: "nb-1", bet: "x", why: "y", restsOn: null, estimate: "M", basis: "code", expected: "z", placed: "2026-09-01", origin: "placed", prs: [3], status: "open" }));
  assert.deepEqual([b.restsOn, b.prs, b.estimate], [null, [3], "M"]);
});

test("bet refuses a missing estimate and flags a bet that rests on nothing", () => {
  const r = run(path.join(Tool, "bet.mjs"), [pm, "place", "Something", "--why", "w"]);
  assert.equal(r.code, 1); assert.match(r.error, /ask the owner for S, M or L/);
  assert.match(fs.readFileSync(path.join(pm, "bets", `${ids.b}.md`), "utf8"), /Rests on:\*\* none ⚠/);
});

test("landed via a merged bet/<id> branch; size from active days; patched and possible follow-up kept apart", () => {
  const a = bet(ids.a);
  assert.equal(a.status, "landed"); assert.equal(a.landedVia, "merge-branch");
  assert.equal(a.landed, at(15).slice(0, 10));
  assert.equal(a.days, 2); assert.equal(a.actual, "M");
  assert.equal(a.patchedBy.length, 1, "the fix commit carrying the id");
  assert.equal(a.possibleFollowUps.length, 1, "same file, no reference: check only");
  assert.ok(!a.patchedBy.some(x => a.possibleFollowUps.includes(x)));
  assert.equal(a.held14, true); assert.equal(a.expectedChecked, false);
});

test("a revert of the bet's commit marks it reverted", () => {
  const b = bet(ids.b);
  assert.equal(b.status, "reverted"); assert.equal(b.landedVia, "commit");
  assert.match(b.revertedBy, /^[0-9a-f]{9}$/);
});

test("never landed: open, flagged open too long (more than 2× the estimate); no text similarity", () => {
  const c = bet(ids.c);
  assert.equal(c.status, "open"); assert.equal(c.openTooLong, true); assert.equal(c.landed, null);
  // The unrelated commit about "bulk export shipments" (no id) didn't change bet A's landing or patches.
  assert.equal(bet(ids.a).patchedBy.length, 1, "a commit with the same words but no id is neither a patch…");
  assert.equal(bet(ids.a).possibleFollowUps.length, 1, "…nor a follow-up (different file)");
});

test("partial: only one of the bet's listed PRs merged", () => {
  const d = bet(ids.d);
  assert.equal(d.status, "partial"); assert.equal(d.landedVia, "pr");
});

test("dropped stays dropped; calibration hidden below minN; bet files get Status and a Score section", () => {
  assert.equal(bet(ids.e).status, "dropped");
  assert.equal(S.calibration, null); assert.equal(S.minN, 10);
  assert.match(out, /too few to say \(\d+ settled, calibration needs 10\)/);
  const md = fs.readFileSync(path.join(pm, "bets", `${ids.b}.md`), "utf8");
  assert.match(md, /Status:\*\* reverted/); assert.match(md, /## Score\n\n[\s\S]*\*\*Reverted\*\* by/);
  assert.match(fs.readFileSync(path.join(pm, "bets", `${ids.a}.md`), "utf8"), /Expected outcome: not checked \(no usage source\)/);
});

test("score.json has the shape tea (N4) reads", () => {
  for (const k of ["generated", "minN", "bets", "calibration"]) assert.ok(k in S, k);
  for (const k of ["id", "bet", "estimate", "basis", "status", "placed", "landed", "days", "actual", "revertedBy", "patchedBy", "possibleFollowUps", "origin", "openTooLong", "expected", "expectedChecked"]) assert.ok(k in bet(ids.a), k);
});

test("running score twice gives the same result (the Score section is replaced, not appended)", () => {
  run(path.join(Tool, "score.mjs"), [pm, "--now", NOW]);
  const md = fs.readFileSync(path.join(pm, "bets", `${ids.a}.md`), "utf8");
  assert.equal((md.match(/## Score/g) || []).length, 1);
});
