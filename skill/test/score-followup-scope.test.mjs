// score.mjs's "possible follow-up, check" list was identical across same-day bets
// because the "same files, no reference" check wasn't scoped per bet — a same-day landing of one bet,
// touching a file another bet's own landing also touched, got flagged as the OTHER bet's follow-up even
// though it's just its own separate, unrelated landing. Two same-day bets touching DIFFERENT files must
// get DIFFERENT (non-identical) follow-up lists, and a commit that lands bet B must never appear as a
// "possible follow-up" for bet A just because it shares a file with A's own work.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const NOW = "2026-09-28T12:00:00Z", DAY = 864e5, HOUR = 36e5;
const at = d => new Date(Date.parse(NOW) - d * DAY).toISOString();
// Same-day, but strictly ordered by the hour (score.mjs's "after this bet's own landing" check needs a
// real ordering — commits placed at the exact same instant as a landing are excluded as "not after it").
const atH = (d, h) => new Date(Date.parse(NOW) - d * DAY + h * HOUR).toISOString();
let root, repo, pm, S, ids = {}, hashes = {};

before(() => {
  root = temporary("nosy-followup-"); repo = path.join(root, "repo"); pm = path.join(root, "pm");
  fs.mkdirSync(repo, { recursive: true }); fs.mkdirSync(pm, { recursive: true });
  const g = (args, iso) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, ...(iso != null ? { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } : {}) } });
  const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
  const commit = (msg, files, iso) => { for (const [f, t] of Object.entries(files)) write(f, t); g(["add", "-A"]); g(["commit", "-q", "-m", msg], iso); return g(["rev-parse", "HEAD"]).trim().slice(0, 9); };
  g(["init", "-q", "-b", "main"]); g(["config", "user.name", "T"]); g(["config", "user.email", "t@t.test"]);
  commit("chore: start", { "README.md": "# app\n" }, at(60));
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main" }));
  const place = (what, extra) => { const r = run(path.join(Tool, "bet.mjs"), [pm, "place", what, "--why", "test", ...extra]); assert.equal(r.code, 0, r.error); return r.output.match(/Bet placed: (\S+)/)[1]; };
  ids.a = place("Search filters", ["--estimate", "S", "--date", at(15).slice(0, 10)]);
  ids.b = place("Billing export", ["--estimate", "S", "--date", at(15).slice(0, 10)]);
  ids.c = place("Search ranking tune", ["--estimate", "S", "--date", at(15).slice(0, 10)]);

  // A lands via a direct commit carrying its id, touching src/search.js — same day as B and C, but first.
  commit(`feat: search filters\n\nBet: ${ids.a}`, { "src/search.js": "export const f = 1;\n" }, atH(10, 0));
  // B lands the SAME day (a couple hours later) via its own direct commit, touching a DIFFERENT file.
  commit(`feat: billing export\n\nBet: ${ids.b}`, { "src/billing.js": "export const b = 1;\n" }, atH(10, 1));
  // C lands the SAME day, AFTER A, via its own commit, ALSO touching src/search.js (the same file as A's
  // own work) — this is the case internal request 94 flags: without the fix, C's own landing commit would
  // be listed as one of A's "possible follow-up" candidates, just because it shares a file and lands close by.
  hashes.c = commit(`feat: search ranking tune\n\nBet: ${ids.c}`, { "src/search.js": "export const f = 3;\n" }, atH(10, 2));
  // A follow-up to A only: touches src/search.js again, no id, within 14 days of A's landing.
  hashes.aFollowUp = commit("tweak: search result ordering", { "src/search.js": "export const f = 2;\n" }, atH(10, 3));
  // A follow-up to B only: touches src/billing.js again, no id, within 14 days of B's landing.
  hashes.bFollowUp = commit("tweak: billing currency format", { "src/billing.js": "export const b = 2;\n" }, atH(10, 4));

  // D and E: two more same-day bets, each landing via a commit that ALSO touches pm/log.md — this repo's
  // own bookkeeping file, updated on nearly every commit (a stand-in for the real collision found on Nosy's
  // own history: shippedIgnoreDocs' "md" extension already exists for exactly this reason on the decisions
  // side; score.mjs's follow-up check must apply the same exclusion, or two same-day bets that only share
  // pm/log.md would still get identical, meaningless "possible follow-up" lists).
  ids.d = place("Onboarding tour", ["--estimate", "S", "--date", at(15).slice(0, 10)]);
  ids.e = place("Export throttle", ["--estimate", "S", "--date", at(15).slice(0, 10)]);
  commit(`feat: onboarding tour\n\nBet: ${ids.d}`, { "src/onboarding.js": "export const o = 1;\n", "pm/log.md": "- D landed\n" }, atH(10, 5));
  commit(`feat: export throttle\n\nBet: ${ids.e}`, { "src/throttle.js": "export const t = 1;\n", "pm/log.md": "- D landed\n- E landed\n" }, atH(10, 6));
  // Only pm/log.md changes here — no file from D's or E's REAL work — so this must not flag as either's
  // follow-up, even though it lands within 14 days of both and the file IS in both bets' raw diff.
  commit("chore: log tidy-up", { "pm/log.md": "- D landed\n- E landed\n- tidy\n" }, atH(10, 7));

  const r = run(path.join(Tool, "score.mjs"), [pm, "--now", NOW]);
  assert.equal(r.code, 0, r.error);
  S = JSON.parse(fs.readFileSync(path.join(pm, "state", "score.json"), "utf8"));
});
after(() => clean(root));

const bet = id => S.bets.find(b => b.id === id);

test("same-day bets touching different files get DIFFERENT possible-follow-up lists", () => {
  const a = bet(ids.a), b = bet(ids.b);
  assert.equal(a.status, "landed"); assert.equal(b.status, "landed");
  assert.equal(a.landed, b.landed, "both land the same day");
  assert.notDeepEqual(a.possibleFollowUps, b.possibleFollowUps, "lists must not be byte-identical");
});

test("a commit that touches ONLY the other bet's file is never flagged as this bet's follow-up", () => {
  const a = bet(ids.a), b = bet(ids.b);
  assert.deepEqual(a.possibleFollowUps, [hashes.aFollowUp]);
  assert.deepEqual(b.possibleFollowUps, [hashes.bFollowUp]);
});

test("another bet's own landing commit is excluded even when it touches the same file", () => {
  const a = bet(ids.a), c = bet(ids.c);
  assert.equal(c.status, "landed"); assert.equal(c.landed, a.landed, "C lands the same day as A, touching the same file");
  // Without the fix, hashes.c (bet C's own landing commit, which also touches src/search.js) would show up
  // here too — the exact bug internal request 94 describes.
  assert.ok(!a.possibleFollowUps.includes(hashes.c), "C's own landing commit must not be A's follow-up");
  assert.deepEqual(a.possibleFollowUps, [hashes.aFollowUp]);
});

test("sharing only a bookkeeping doc file (pm/log.md) is not enough to flag a follow-up", () => {
  const d = bet(ids.d), e = bet(ids.e);
  assert.equal(d.status, "landed"); assert.equal(e.status, "landed");
  assert.equal(d.landed, e.landed, "same day");
  // The "chore: log tidy-up" commit touches ONLY pm/log.md, which both D and E's landings also touched —
  // without the doc-extension exclusion it would show up (identically) in both possibleFollowUps lists.
  assert.deepEqual(d.possibleFollowUps, []);
  assert.deepEqual(e.possibleFollowUps, []);
});
