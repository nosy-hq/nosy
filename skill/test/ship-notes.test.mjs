// Contract tests for ship-notes.mjs (`nosy ship-notes`): the issues a merged PR closes get ONE neutral comment each, shown first, posted only
// with --yes. The suite never touches the network: a fake `gh` of this file's own answers every call (and records each one, with the
// comment body it was given on stdin), and the repo is a real throwaway git repo with two release tags.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { phrases, commentBody, MARKER } from "../tools/ship-notes.mjs";

const SHIP = path.join(Tool, "ship-notes.mjs"), NOSY = path.join(Tool, "nosy.mjs");

// CommonJS on purpose, like helpers.mjs's fake gh: a file with no extension in a folder with no package.json.
const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const F = JSON.parse(fs.readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
const a = process.argv.slice(2), val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
fs.appendFileSync(F.log, JSON.stringify({ argv: a }) + "\\n");
const out = x => { process.stdout.write(typeof x === "string" ? x : JSON.stringify(x)); process.exit(0); };
const fail = m => { process.stderr.write(m + "\\n"); process.exit(1); };
if (F.fail) fail("fake gh: simulated failure (offline)");
if (a[0] === "pr" && a[1] === "list" && val("--state") === "merged") out(F.prs);
else if (a[0] === "issue" && a[1] === "view") { const i = F.issues[a[2]]; if (!i) fail("fake gh: no issue " + a[2]); out(i); }
else if (a[0] === "api" && /^repos\\/[^/]+\\/[^/]+\\/issues\\/(\\d+)$/.test(a[1] || "") && val("--jq") === ".locked") out(((F.locked || []).includes(+a[1].split("/").pop()) ? "true" : "false") + "\\n");
else if (a[0] === "issue" && a[1] === "comment") {
  const body = fs.readFileSync(0, "utf8");
  fs.appendFileSync(F.log, JSON.stringify({ comment: +a[2], repo: val("-R"), bodyFile: val("--body-file"), body }) + "\\n");
  if ((F.commentFail || []).includes(+a[2])) fail("HTTP 403: Resource not accessible by personal access token");
  out("https://github.com/acme/widgets/issues/" + a[2] + "#issuecomment-1\\n");
} else fail("fake gh: unrecognized call: gh " + a.join(" "));
`;

let tmp, repo, shas;
const made = [];
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const commit = (msg, date) => { fs.writeFileSync(path.join(repo, "f.txt"), msg); git("add", "."); execFileSync("git", ["-C", repo, "commit", "-q", "-m", msg], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }); return git("rev-parse", "HEAD"); };

before(() => {
  tmp = temporary("nosy-ship-notes-"); repo = path.join(tmp, "repo"); fs.mkdirSync(repo);
  git("init", "-q", "-b", "main");
  const c1 = commit("init", "2026-09-01T10:00:00Z"); git("tag", "v1.0");
  const c2 = commit("export", "2026-09-10T10:00:00Z");
  const c3 = commit("dark theme", "2026-09-11T10:00:00Z"); git("tag", "v1.1");
  const c4 = commit("import", "2026-09-20T10:00:00Z"); // after the latest tag: not in a release yet
  shas = { c1, c2, c3, c4 };
});
after(() => { clean(tmp); made.forEach(clean); });

const pr = (number, mergedAt, author, closes, oid) => ({ baseRefName: "main", number, title: `PR ${number} title`, mergedAt, author: { login: author }, closingIssuesReferences: closes.map(n => ({ number: n, repository: { name: "widgets", owner: { login: "acme" } } })), mergeCommit: oid ? { oid } : null });
const issue = (number, author, extra = {}) => ({ number, title: `Issue ${number} title`, author: { login: author }, state: "CLOSED", comments: [], url: `https://github.com/acme/widgets/issues/${number}`, ...extra });

// One product: a pm/ with sources.json, a fake gh with the fixture, and the call log. Returns the helpers a test needs.
function product({ fixture = {}, sources = {} } = {}) {
  const root = temporary("nosy-ship-prod-"); made.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo, ref: "main", issue: { repo: "acme/widgets" }, ...sources }));
  const log = path.join(root, "gh.log"); fs.writeFileSync(log, "");
  const bin = path.join(root, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH); fs.chmodSync(path.join(bin, "gh"), 0o755);
  const fx = path.join(root, "fixture.json"); fs.writeFileSync(fx, JSON.stringify({ log, prs: [], issues: {}, ...fixture }));
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_FIXTURE: fx };
  const calls = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const posted = () => calls().filter(c => c.comment !== undefined);
  const stateFile = path.join(pm, "state", "ship-notes.json");
  return { root, pm, env, calls, posted, stateFile, ship: (...args) => run(SHIP, [pm, ...args], { env }), state: () => JSON.parse(fs.readFileSync(stateFile, "utf8")) };
}
// The default window starts at the release before the latest tag (v1.0, 2026-09-01), so v1.1's own PRs are in it.
const D = "2026-09-21T09:00:00Z";
const basic = () => ({
  prs: [pr(30, D, "ada", [7, 8]), pr(31, "2026-09-22T09:00:00Z", "ada", [9])],
  issues: { 7: issue(7, "grace"), 8: issue(8, "linus"), 9: issue(9, "ada") },
});

test("preview by default: a table of who asked, the PR and the comment; nothing is posted or written", () => {
  const p = product({ fixture: basic() });
  const r = p.ship();
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Merged since the release before the latest, v1\.0 \(2026-09-01\), so v1\.1's PRs are included on main: 2 PRs, 3 issues closed by them\./);
  assert.match(r.output, /\| Issue \| Asked by \| Shipped in \| Comment \|/);
  assert.match(r.output, /\| #7 Issue 7 title \| grace \| #30 PR 30 title \| Shipped in #30\. Thanks for asking for this\. \|/);
  assert.match(r.output, /\| #8 Issue 8 title \| linus \| #30 /);
  assert.doesNotMatch(r.output, /\| #9 /, "issue 9 was opened by the PR's own author");
  assert.match(r.output, /Left alone: 1 opened by the PR's own author\./);
  assert.match(r.output, /Nothing was posted\. `nosy ship-notes --yes` posts these 2 comments\./);
  assert.equal(p.posted().length, 0);
  assert.ok(!fs.existsSync(p.stateFile), "a preview writes nothing");
  assert.ok(p.calls().every(c => !c.argv.includes("comment")), "no comment call at all");
});

test("who is left alone: the PR's author, bots, the team (case and @ ignored), locked issues, issues already told, other repos, PR numbers", () => {
  const p = product({
    sources: { team: ["@Zed-Team", "mod"] },
    fixture: {
      prs: [{ ...pr(40, D, "Ada", [1, 2, 3, 4, 5, 6, 7, 8]), closingIssuesReferences: [
        ...[1, 2, 3, 4, 5, 6, 7].map(n => ({ number: n, repository: { name: "widgets", owner: { login: "acme" } } })),
        { number: 99, repository: { name: "other", owner: { login: "acme" } } }, { number: 41 }] }, pr(41, D, "ada", [])],
      issues: {
        1: issue(1, "ADA"), 2: issue(2, "zed-team"), 3: issue(3, "dependabot[bot]"), 4: issue(4, "grace"), 5: issue(5, "linus", { comments: [{ author: { login: "x" }, body: `earlier\n\n${MARKER}\n` }] }),
        6: issue(6, "hopper"), 7: issue(7, "mod"),
      },
      locked: [4],
    },
  });
  const r = p.ship();
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /\| #6 /, "hopper is the only one asked");
  for (const n of [1, 2, 3, 4, 5, 7]) assert.doesNotMatch(r.output, new RegExp(`\\| #${n} `), `#${n} is left alone`);
  assert.match(r.output, /Left alone: .*1 opened by the PR's own author/);
  assert.match(r.output, /2 opened by the team/);
  assert.match(r.output, /1 opened by a bot/);
  assert.match(r.output, /1 locked/);
  assert.match(r.output, /1 already told/);
  assert.match(r.output, /posts this 1 comment\./);
  const asked = p.calls().filter(c => c.argv[0] === "issue" && c.argv[1] === "view").map(c => c.argv[2]);
  assert.ok(!asked.includes("99") && !asked.includes("41"), "another repo's issue and a PR number are never even read");
});

test("--yes posts one comment per issue with the body on stdin (never in argv), the marker on its own line, and records it", () => {
  const p = product({ fixture: basic() });
  const r = p.ship("--yes");
  assert.equal(r.code, 0, r.error);
  const sent = p.posted();
  assert.deepEqual(sent.map(c => c.comment), [7, 8]);
  for (const c of sent) {
    assert.equal(c.repo, "acme/widgets"); assert.equal(c.bodyFile, "-");
    assert.equal(c.body, `Shipped in #30. Thanks for asking for this.\n\n${MARKER}\n`);
  }
  const argvs = p.calls().filter(c => c.argv?.[1] === "comment").map(c => c.argv.join(" "));
  assert.ok(argvs.every(a => !a.includes("Thanks") && !a.includes(MARKER)), "the body is not in argv");
  assert.match(r.output, /Posted on #7 \(1 of 2\)\.\nPosted on #8 \(2 of 2\)\.\n2 comments posted\. Nothing else was written outside pm\//);
  assert.doesNotMatch(r.output, /Nothing was posted/);
  const st = p.state();
  assert.deepEqual(st.posted.map(x => [x.issue, x.pr]), [[7, 30], [8, 30]]);
  assert.ok(st.posted.every(x => !isNaN(Date.parse(x.at))));
  const kinds = new Set(p.calls().filter(c => c.argv).map(c => c.argv.slice(0, 2).join(" ")));
  assert.deepEqual([...kinds].sort(), ["api repos/acme/widgets/issues/7", "api repos/acme/widgets/issues/8", "issue comment", "issue view", "pr list"], "reads and issue comments only: no PR comment, close, edit, label or lock");
});

test("a second run proposes nothing: from pm/state/ship-notes.json, and from the marker alone when that file is gone", () => {
  const p = product({ fixture: basic() });
  assert.equal(p.ship("--yes").code, 0);
  const again = p.ship("--yes");
  assert.equal(again.code, 0, again.error);
  assert.match(again.output, /Nobody to tell/); assert.match(again.output, /2 already told/);
  assert.equal(p.posted().length, 2, "no third comment");
  // The state file is gone, the issues now carry the marker the way GitHub would show it.
  fs.rmSync(p.stateFile);
  const bodies = Object.fromEntries(p.posted().map(c => [c.comment, c.body]));
  const issues = { 7: issue(7, "grace", { comments: [{ author: { login: "me" }, body: bodies[7] }] }), 8: issue(8, "linus", { comments: [{ author: { login: "me" }, body: bodies[8] }] }), 9: issue(9, "ada") };
  fs.writeFileSync(path.join(p.root, "fixture.json"), JSON.stringify({ log: path.join(p.root, "gh.log"), prs: basic().prs, issues }));
  const third = p.ship("--yes");
  assert.match(third.output, /2 already told/); assert.equal(p.posted().length, 2);
});

test("--yes stops at the first failure, says how many went out, and keeps what it posted", () => {
  const p = product({ fixture: { prs: [pr(30, D, "ada", [7, 8, 9])], issues: { 7: issue(7, "grace"), 8: issue(8, "linus"), 9: issue(9, "hopper") }, commentFail: [8] } });
  const r = p.ship("--yes");
  assert.equal(r.code, 1);
  assert.match(r.error, /couldn't comment on #8: HTTP 403/);
  assert.match(r.error, /1 of 3 comments went out; nothing further was tried\. Run it again/);
  assert.deepEqual(p.posted().map(c => c.comment), [7, 8], "#9 was never tried");
  assert.deepEqual(p.state().posted.map(x => x.issue), [7], "only what went out is recorded");
});

test("a GitHub failure is said once with the fix, and nothing is posted", () => {
  const p = product({ fixture: { fail: true } });
  const r = p.ship("--yes");
  assert.equal(r.code, 1);
  assert.match(r.error, /couldn't read merged PRs: fake gh: simulated failure/);
  assert.match(r.error, /Nothing was posted\./);
  assert.equal(p.posted().length, 0);
});

test("one issue closed by two PRs gets one comment, naming the later PR; a lock that can't be read is never guessed", () => {
  const p = product({ fixture: { prs: [pr(30, D, "ada", [7]), pr(33, "2026-09-25T09:00:00Z", "ada", [7])], issues: { 7: issue(7, "grace") } } });
  const r = p.ship("--yes");
  assert.deepEqual(p.posted().map(c => [c.comment, c.body.split("\n")[0]]), [[7, "Shipped in #33. Thanks for asking for this."]]);
  assert.match(r.output, /: 2 PRs, 1 issue closed by them/);
  const q = product({ fixture: basic() });
  const f = JSON.parse(fs.readFileSync(path.join(q.root, "fixture.json"), "utf8")); f.locked = null;
  // A gh that can't answer the lock question: swap the fake for one that fails only that call.
  const real = fs.readFileSync(path.join(q.root, "bin", "gh"), "utf8");
  fs.writeFileSync(path.join(q.root, "bin", "gh"), real.replace('if (a[0] === "api"', 'if (a[0] === "api") fail("fake gh: HTTP 403"); else if (a[0] === "api"'));
  const s = q.ship("--yes");
  assert.match(s.output, /2 lock state unreadable/); assert.equal(q.posted().length, 0);
});

test("--json writes the preview: numbers, who asked and the comment, no titles", () => {
  const p = product({ fixture: basic() }), f = path.join(p.root, "out", "preview.json");
  const r = p.ship("--json", f);
  assert.equal(r.code, 0, r.error);
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.equal(j.type, "shipNotes"); assert.equal(j.repo, "acme/widgets");
  assert.deepEqual(j.proposals.map(x => [x.issue, x.askedBy, x.pr, x.tag]), [[7, "grace", 30, null], [8, "linus", 30, null]]);
  assert.equal(j.proposals[0].comment, `Shipped in #30. Thanks for asking for this.\n\n${MARKER}\n`);
  assert.deepEqual(j.skipped, { "opened by the PR's own author": 1 });
  assert.doesNotMatch(JSON.stringify(j), /title/i);
});

test("the window: from the release before the latest tag by default (the newest release's PRs count); --since a tag or a date; --days wins over the tag; unknown --since stops", () => {
  const fixture = { prs: [pr(20, "2026-09-05T09:00:00Z", "ada", [1]), pr(21, "2026-09-10T20:00:00Z", "ada", [2]), pr(30, D, "ada", [3])], issues: { 1: issue(1, "u1"), 2: issue(2, "u2"), 3: issue(3, "u3") } };
  const p = product({ fixture }), rows = out => [...out.matchAll(/^\| #(\d+) /gm)].map(m => +m[1]);
  assert.deepEqual(rows(p.ship().output), [1, 2, 3], "from v1.0: v1.1's own PRs are in; a second run is safe because of the marker");
  const tag = p.ship("--since", "v1.0");
  assert.deepEqual(rows(tag.output), [1, 2, 3]); assert.match(tag.output, /Merged since v1\.0 \(2026-09-01\)/);
  assert.deepEqual(rows(p.ship("--since", "2026-09-10").output), [2, 3]);
  // 3650 days reaches everything; 1 day reaches nothing (the PRs are old); both beat the tag.
  assert.deepEqual(rows(p.ship("--days", "3650").output), [1, 2, 3]);
  assert.match(p.ship("--days", "1").output, /Nobody to tell: no merged PR in the window closes an issue/);
  const bad = p.ship("--since", "nope");
  assert.equal(bad.code, 1); assert.match(bad.error, /--since nope: not a date \(YYYY-MM-DD\) and not a tag or ref/);
  const days = p.ship("--days", "abc"); assert.equal(days.code, 1); assert.match(days.error, /--days wants a number/);
});

test("without a release tag it looks at the last 14 days", () => {
  const ago = d => new Date(Date.now() - d * 864e5).toISOString();
  const fixture = { prs: [pr(50, ago(3), "ada", [1]), pr(51, ago(20), "ada", [2])], issues: { 1: issue(1, "u1"), 2: issue(2, "u2") } };
  const bare = temporary("nosy-ship-bare-"); made.push(bare);
  execFileSync("git", ["-C", bare, "init", "-q", "-b", "main"]);
  const p = product({ fixture, sources: { repo: bare } });
  const r = p.ship();
  assert.match(r.output, /Merged since the last 14 days \(no release tag found\) on main: 1 PR, 1 issue closed/);
  assert.match(r.output, /\| #1 /); assert.doesNotMatch(r.output, /\| #2 /);
});

test("a PR that is in a release says which: the first tag that contains its merge commit", () => {
  const fixture = { prs: [pr(20, "2026-09-10T20:00:00Z", "ada", [2], shas.c3), pr(30, D, "ada", [3], shas.c4), pr(22, D, "ada", [4])], issues: { 2: issue(2, "u2"), 3: issue(3, "u3"), 4: issue(4, "u4") } };
  const p = product({ fixture });
  const r = p.ship("--since", "v1.0", "--yes");
  const sent = Object.fromEntries(p.posted().map(c => [c.comment, c.body.split("\n")[0]]));
  assert.equal(sent[2], "Shipped in #20 (v1.1). Thanks for asking for this.");
  assert.equal(sent[3], "Shipped in #30. Thanks for asking for this.", "the commit is after the last tag: no release yet");
  assert.equal(sent[4], "Shipped in #22. Thanks for asking for this.", "no merge commit in the answer: no tag guessed");
  assert.match(r.output, /Shipped in #20 \(v1\.1\)\. Thanks/);
});

test("language: sources.json `language` picks the phrases; unknown falls back to English with one stderr line", () => {
  const tr = product({ fixture: basic(), sources: { language: "tr-TR" } });
  const r = tr.ship("--yes");
  assert.equal(r.error, "");
  assert.equal(tr.posted()[0].body, `#30 ile yayınlandı. Bunu istediğiniz için teşekkürler.\n\n${MARKER}\n`);
  const xx = product({ fixture: basic(), sources: { language: "xx" } });
  const x = xx.ship("--yes");
  assert.equal(x.code, 0, x.error);
  assert.equal(x.error.trim().split("\n").length, 1);
  assert.match(x.error, /ship-notes: no phrases for language "xx" yet \(skill\/data\/lang\/xx\/ship-notes\.json\); using English/);
  assert.equal(xx.posted()[0].body, `Shipped in #30. Thanks for asking for this.\n\n${MARKER}\n`);
});

test("the language files carry the same phrases with the same {slots}, and no name, quote or promise slot", () => {
  const slots = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
  const en = phrases("en"), tr = phrases("tr");
  assert.deepEqual(Object.keys(tr), Object.keys(en));
  for (const k of Object.keys(en)) { assert.equal(slots(tr[k]), slots(en[k]), `slots of ${k}`); assert.ok(!/\{(?!pr\}|tag\})/.test(en[k]), `${k} has only pr and tag slots`); }
  assert.equal(commentBody(12, "v2.0", "en"), `Shipped in #12 (v2.0). Thanks for asking for this.\n\n${MARKER}\n`);
  assert.equal(commentBody(12, "", "en").split("\n")[0], "Shipped in #12. Thanks for asking for this.");
});

test("needs issue.repo; and nosy.mjs passes --since (a global flag there), --days, --json and --yes through", () => {
  const none = product({ sources: { issue: undefined } });
  const r = none.ship();
  assert.equal(r.code, 1); assert.match(r.error, /needs the GitHub repo that holds the issues: set `issue\.repo`/);
  const p = product({ fixture: { prs: [pr(20, "2026-09-10T20:00:00Z", "ada", [2]), pr(30, D, "ada", [3])], issues: { 2: issue(2, "u2"), 3: issue(3, "u3") } } });
  const n = run(NOSY, ["ship-notes", "--pm", p.pm, "--since", "v1.0"], { env: p.env });
  assert.equal(n.code, 0, n.error);
  assert.match(n.output, /Merged since v1\.0 \(2026-09-01\) on main: 2 PRs/); assert.match(n.output, /\| #2 /);
  const y = run(NOSY, ["ship-notes", "--pm", p.pm, "--yes"], { env: p.env });
  assert.equal(y.code, 0, y.error); assert.deepEqual(p.posted().map(c => c.comment).sort(), [2, 3], "the default window reaches back to the release before the latest");
  assert.match(run(NOSY, ["help"]).output, /nosy ship-notes \[--since tag\|date\]/);
});
