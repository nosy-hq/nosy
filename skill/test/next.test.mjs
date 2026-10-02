// next.mjs: the context-aware "what to run now" picks. Temp pm/ folders and a temp git repo; no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { next, render, MENU } from "../tools/next.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const NOW = Date.parse("2026-09-28T12:00:00Z"), DAY = 864e5;
const iso = t => new Date(t).toISOString();

// A repo with `n` commits on main, one per day ending the day before NOW; `msg(i)` is each commit message.
function repo(n, msg = i => `change ${i}`, { bare = false } = {}) {
  const root = temporary("nosy-next-"); dirs.push(root);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(root, "f.txt"), String(i));
    const d = iso(NOW - (n - i) * DAY);
    execFileSync("git", ["-C", root, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "commit", "-q", "-m", msg(i)], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  }
  const pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  // The tour has been taken: without this record a repo this bare is sent to `tour` first, which is tested
  // on its own (tour.test.mjs); these tests are about the signal behind each other pick.
  if (!bare) fs.writeFileSync(path.join(pm, "state", "tour.json"), JSON.stringify({ started: iso(NOW - 30 * DAY), approved: [], done: [] }));
  return pm;
}
const write = (pm, f, obj, at) => { const p = path.join(pm, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj)); if (at) fs.utimesSync(p, at / 1000, at / 1000); };
const commands = R => R.picks.map(p => p.command);

test("no pm/ or no sources.json: move-in only", () => {
  const tmp = temporary("nosy-next-"); dirs.push(tmp);
  assert.deepEqual(commands(next(path.join(tmp, "pm"), { now: NOW })), ["move-in"]);
  fs.mkdirSync(path.join(tmp, "pm"));
  const R = next(path.join(tmp, "pm"), { now: NOW });
  assert.deepEqual(commands(R), ["move-in"]);
  assert.match(R.picks[0].reason, /sources\.json is missing/);
});

test("set up, nothing else yet: shipped first, then psst and the map; never pushes a bet", () => {
  const R = next(repo(2), { now: NOW });
  assert.deepEqual(commands(R), ["shipped", "psst", "map"]);
  assert.ok(R.picks.every(p => p.reason.length > 10), "every pick carries a reason");
});

test("old record with commits since: shipped, with the age and commit count in the reason", () => {
  const pm = repo(12);
  write(pm, "state/shipped.json", { generated: iso(NOW - 11.5 * DAY) });
  const R = next(pm, { now: NOW });
  assert.equal(R.picks[0].command, "shipped");
  assert.match(R.picks[0].reason, /11 days old and 11 commits landed/);
});

// A pm/ where everything is fresh, to test one signal at a time.
function fresh(pm) {
  write(pm, "state/shipped.json", { generated: iso(NOW - DAY) });
  write(pm, "state/lowhanging.json", { generated: iso(NOW - DAY / 2) });
  write(pm, "state/waves.json", { generated: iso(NOW - DAY / 4) });
  write(pm, "state/psst-final.json", { generated: iso(NOW - DAY / 3), items: [], dropped: [] }); // psst's check ran after the list
  write(pm, "rivals/acme.md", "# Acme", NOW - DAY);
  write(pm, "page.html", "<html></html>", NOW);
  write(pm, "map.md", "# map");
  return pm;
}

test("psst's check: an unchecked list, or one newer than its check, asks for the refuter", () => {
  const pm = fresh(repo(1));
  fs.rmSync(path.join(pm, "state", "psst-final.json"));
  assert.match(next(pm, { now: NOW }).picks.find(p => p.command === "psst").reason, /isn't checked yet: run psst's refuter/);
  write(pm, "state/psst-final.json", { generated: iso(NOW - DAY), items: [], dropped: [] });
  assert.match(next(pm, { now: NOW }).picks.find(p => p.command === "psst").reason, /changed since it was checked/);
});

test("everything fresh: stakeout only", () => {
  assert.deepEqual(commands(next(fresh(repo(1)), { now: NOW })), ["stakeout"]);
});

test("psst: missing, a week old, or older than the record", () => {
  const pm = fresh(repo(1));
  write(pm, "state/lowhanging.json", { generated: iso(NOW - 9 * DAY) });
  assert.match(next(pm, { now: NOW }).picks.find(p => p.command === "psst").reason, /9 days old/);
  write(pm, "state/lowhanging.json", { generated: iso(NOW - 2 * DAY) });
  assert.match(next(pm, { now: NOW }).picks.find(p => p.command === "psst").reason, /record moved/);
});

test("neighbors: rivals not checked in 30+ days are named", () => {
  const pm = fresh(repo(1));
  write(pm, "rivals/globex.md", "# Globex", NOW - 40 * DAY);
  write(pm, "rivals/_TEMPLATE.md", "# template", NOW - 90 * DAY);
  const R = next(pm, { now: NOW });
  assert.deepEqual(commands(R), ["neighbors"]);
  assert.match(R.picks[0].reason, /1 rival not checked in 30\+ days \(globex\)/);
});

test("scoop: the psst list changed since the waves were built", () => {
  const pm = fresh(repo(1));
  write(pm, "state/waves.json", { generated: iso(NOW - DAY) });
  assert.deepEqual(commands(next(pm, { now: NOW })), ["scoop"]);
});

test("bets are optional: score only speaks when bets exist, and names a flagged one", () => {
  const pm = fresh(repo(1));
  write(pm, "bets/bets.json", { generated: iso(NOW - 5 * DAY), bets: [{ id: "nb-260901-sso", status: "open" }] });
  assert.match(next(pm, { now: NOW }).picks[0].reason, /1 bet placed, never scored/);
  write(pm, "state/score.json", { generated: iso(NOW - DAY), bets: [{ id: "nb-260901-sso", openTooLong: true }] });
  write(pm, "page.html", "<html></html>", NOW);
  const R = next(pm, { now: NOW });
  assert.equal(R.picks[0].command, "score");
  assert.match(R.picks[0].reason, /nb-260901-sso/);
});

test("tea: the page is older than pm/state; never more than 3 picks", () => {
  const pm = fresh(repo(1));
  write(pm, "page.html", "<html></html>", NOW - 3 * DAY);
  assert.deepEqual(commands(next(pm, { now: NOW })), ["tea"]);
  assert.ok(next(repo(12), { now: NOW }).picks.length <= 3);
});

test("frontyard: a weekly roundup, never per commit; only features count, at least 2", () => {
  const pm = fresh(repo(10, i => i < 4 ? `chore: tidy ${i}` : i < 7 ? `feat(export): bulk export step ${i}` : `feat(sso): SAML step ${i}`));
  assert.ok(!commands(next(pm, { now: NOW })).includes("frontyard"), "no page set up: no frontyard");
  write(pm, "sources.json", { repo: path.dirname(pm), ref: "main", frontyard: { path: "README.md" } });
  assert.match(next(pm, { now: NOW }).picks.find(p => p.command === "frontyard").reason, /never been checked/);
  write(pm, "state/frontyard.json", { generated: iso(NOW - 5.5 * DAY) });
  assert.ok(!commands(next(pm, { now: NOW })).includes("frontyard"), "5 days since the check: not yet, however many commits");
  write(pm, "state/frontyard.json", { generated: iso(NOW - 9.5 * DAY) });
  assert.match(next(pm, { now: NOW }).picks.find(p => p.command === "frontyard").reason, /roundup is due: 2 features shipped since the last check 9 days ago \(sso, export\); one page change/);
  write(pm, "sources.json", { repo: path.dirname(pm), ref: "main", frontyard: { path: "README.md", min: 3 } });
  assert.ok(!commands(next(pm, { now: NOW })).includes("frontyard"), "2 features, owner's minimum is 3: not yet");
  write(pm, "sources.json", { repo: path.dirname(pm), ref: "main", frontyard: { path: "README.md", every: 3, min: 1 } });
  write(pm, "state/frontyard.json", { generated: iso(NOW - 3.5 * DAY) });
  assert.match(next(pm, { now: NOW }).picks.find(p => p.command === "frontyard").reason, /1 feature shipped .*\(sso\)/, "every/min are the owner's to set");
});

test("render: picks first, then the grouped menu; CLI mode uses the plain nosy names", () => {
  const R = { picks: [{ command: "move-in", reason: "no pm/ folder yet" }] };
  const agent = render(R), cli = render(R, { cli: true });
  assert.match(agent, /^Psst… here's what I'd run next:\n\n1\. \/nosy:move-in · no pm\/ folder yet/);
  for (const [group, cmd] of MENU) assert.match(agent, new RegExp(`${group}\\s+/nosy:${cmd}\\b`));
  for (const cmd of ["peek", "psst", "canwe", "neighbors", "overheard", "spill", "scoop", "dresscode", "frontyard"])
    assert.ok(MENU.some(([, c]) => c === cmd), `${cmd} is on the menu`);
  assert.match(cli, /1\. nosy setup · /);
  assert.match(cli, /Share\s+nosy page\b/);
  assert.match(cli, /Ahead\s+\/nosy:spill\b/, "an agent-only command keeps its agent name in CLI mode");
});

test("nosy with no command runs next (read-only: writes nothing to pm/)", () => {
  const pm = repo(2), before = fs.readdirSync(path.join(pm, "state"));
  const r = run(path.join(Tool, "nosy.mjs"), ["--pm", pm]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /1\. nosy shipped · /);
  assert.match(r.output, /nosy help/);
  assert.deepEqual(fs.readdirSync(path.join(pm, "state")), before);
});

// The SessionStart hook: one "Psst…" line from next.mjs's first pick, silent otherwise.
const HOOK = path.join(Tool, "..", "..", "hooks", "psst-summary.mjs");
// The first-run lines have their own tests (loaded.test.mjs); here the marker is already there, so the hook is in its steady state.
const seen = temporary("nosy-seen-"); dirs.push(seen); fs.writeFileSync(path.join(seen, "nosy-loaded.json"), "{}");
const hook = (cwd, env = {}) => run(HOOK, [], { input: JSON.stringify({ cwd }), env: { ...process.env, NOSY_STATE_DIR: seen, ...env } });

test("session hook: whispers the first pick when moved in, silent when not moved in or disabled", () => {
  const pm = repo(2), root = path.dirname(pm);
  const r = hook(root);
  assert.equal(r.code, 0);
  assert.equal(r.output, "Psst… next: /nosy:shipped (no record of what shipped yet: every other answer starts from it). More: /nosy:nosy\n");
  assert.equal(hook(root, { NOSY_NO_PSST: "1" }).output, "");
  const bare = temporary("nosy-next-"); dirs.push(bare);
  assert.equal(hook(bare).output, "", "no pm/sources.json: no nagging");
});

test("session hook: silent when nothing is stale (stakeout is not worth a whisper)", () => {
  const pm = repo(1), now = Date.now(), at = t => new Date(t).toISOString();
  write(pm, "state/shipped.json", { generated: at(now) });
  write(pm, "state/lowhanging.json", { generated: at(now + 1000) });
  write(pm, "state/waves.json", { generated: at(now + 2000) });
  write(pm, "state/psst-final.json", { generated: at(now + 1500), items: [], dropped: [] });
  write(pm, "rivals/acme.md", "# Acme");
  write(pm, "map.md", "# map");
  write(pm, "page.html", "<html></html>", now + 5000);
  const r = hook(path.dirname(pm));
  assert.equal(r.code, 0);
  assert.equal(r.output, "");
});
