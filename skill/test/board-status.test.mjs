// Contract tests for board-status.mjs (`nosy board-status`): the week as a status update on the Projects board the roadmap reads. Shown first, posted
// only with --yes, once per ISO week, titles and counts only, and no status unless the owner gives one. A fake `gh` answers every call and records the writes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run as helperRun, temporary, clean, Tool } from "./helpers.mjs";
import { isoWeek, bodyOf, MARKER, STATUSES, phrases } from "../tools/board-status.mjs";
import { localDay } from "../tools/today.mjs";
const run = (file, args, opts) => { const r = helperRun(file, args, opts); return { status: r.code, stdout: r.output, stderr: r.error }; };
const BS = path.join(Tool, "board-status.mjs"), NOSY = path.join(Tool, "nosy.mjs");

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const F = JSON.parse(fs.readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
const a = process.argv.slice(2), val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const out = x => { process.stdout.write(typeof x === "string" ? x : JSON.stringify(x)); process.exit(0); };
const fail = m => { process.stderr.write(m + "\\n"); process.exit(1); };
const q = a.find(x => x.startsWith("query=")) || "";
if (/createProjectV2StatusUpdate/.test(q)) { fs.appendFileSync(F.log, JSON.stringify({ argv: a }) + "\\n"); if (F.failPost) fail("HTTP 403: Resource not accessible by personal access token"); out({ data: { createProjectV2StatusUpdate: { statusUpdate: { id: "SU1" } } } }); }
if (F.offline) fail("fake gh: offline");
if (a[0] === "api" && a[1] === "-i") out("HTTP/2 200\\nx-oauth-scopes: " + F.scopes + "\\n\\n{}");
else if (/statusUpdates/.test(q)) out({ data: { organization: { projectV2: F.board === null ? null : { id: "PROJ1", statusUpdates: { nodes: F.updates || [] } } } } });
else if (/items\\(first:100/.test(q)) out({ data: { organization: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: F.cards } } } } });
else if (a[0] === "pr" && a[1] === "list") out(F.prs || []);
else if (a[0] === "release" && a[1] === "list") out(F.releases || []);
else fail("fake gh: unrecognized call: gh " + a.join(" "));
`;

const made = [];
after(() => made.forEach(clean));
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
const card = (status, n, title) => ({ status: { name: status }, isArchived: false, content: { __typename: "Issue", number: n, title, url: `https://github.com/acme/widgets/issues/${n}`, state: "OPEN", repository: { nameWithOwner: "acme/widgets", isPrivate: false } } });

function product({ fixture = {}, sources = {} } = {}) {
  const root = temporary("nosy-board-status-"); made.push(root);
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start"]);
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", issue: { repo: "acme/widgets" },
    roadmap: { source: "github", project: { owner: "acme", number: 3, type: "organization", field: "Horizon" } }, ...sources }));
  const log = path.join(root, "gh.log"); fs.writeFileSync(log, "");
  const bin = path.join(root, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH); fs.chmodSync(path.join(bin, "gh"), 0o755);
  const fx = path.join(root, "fixture.json");
  fs.writeFileSync(fx, JSON.stringify({ log, scopes: "repo, project", cards: [card("Now", 1, "Doing it"), card("Next", 2, "Soon"), card("Later", 3, "Someday"), card("Later", 4, "Much later")],
    prs: [{ number: 40, title: "Add the export", mergedAt: iso(2) }, { number: 39, title: "Old thing", mergedAt: iso(20) }], releases: [], ...fixture }));
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_FIXTURE: fx };
  const posts = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  return { root, pm, posts, env, go: (...args) => run(BS, [pm, ...args], { env }) };
}

test("isoWeek: Monday-based, the week belongs to the year of its Thursday", () => {
  assert.equal(isoWeek(new Date("2026-10-03T12:00:00Z")), "2026-W40");
  assert.equal(isoWeek(new Date("2026-01-01T12:00:00Z")), "2026-W01");
  assert.equal(isoWeek(new Date("2027-01-01T12:00:00Z")), "2026-W53", "1 Jan 2027 is a Friday: still the last week of 2026");
  assert.equal(isoWeek(new Date("2025-12-29T12:00:00Z")), "2026-W01", "29 Dec 2025 is a Monday: the first week of 2026");
});

test("bodyOf: what shipped in the window, the counts, the next three, the marker; titles and counts only", () => {
  const m = { now: [{ title: "A", ref: "#1", url: "u1" }], next: [{ title: "B", ref: "#2", url: "u2" }, { title: "C" }], later: [{ title: "D" }], hidden: { now: 0, next: 0, later: 2 },
    shipped: [{ title: "Add the export", ref: "#40", url: "https://x/pull/40", date: "2026-10-01" }, { title: "Old", ref: "#39", url: null, date: "2026-09-01" }] };
  const { body, week, shipped } = bodyOf(m, { now: Date.parse("2026-10-03T12:00:00Z"), days: 7 });
  assert.equal(week, "2026-W40"); assert.equal(shipped, 1);
  assert.match(body, /- Add the export \(\[#40\]\(https:\/\/x\/pull\/40\)\)/);
  assert.doesNotMatch(body, /Old/);
  assert.match(body, /1 now · 2 next · 3 later/, "hidden items are still counted");
  assert.match(body, /\*\*Next up\*\*\n- A \(\[#1\]\(u1\)\)\n- B \(\[#2\]\(u2\)\)\n- C\n/);
  assert.ok(body.trimEnd().endsWith(MARKER("2026-W40")));
});

test("bodyOf: a window with nothing shipped says so; releases count as shipping", () => {
  const empty = bodyOf({ now: [], next: [], later: [], shipped: [] }, { now: Date.parse("2026-10-03T12:00:00Z") });
  assert.match(empty.body, /No pull request was merged in this window\./);
  const rel = bodyOf({ now: [], next: [], later: [], shipped: [] }, { now: Date.parse("2026-10-03T12:00:00Z"), releases: [{ title: "Nosy 1.2", url: "https://x/releases/tag/v1.2", date: "2026-10-02" }] });
  assert.match(rel.body, /- Nosy 1\.2 \(\[release\]\(https:\/\/x\/releases\/tag\/v1\.2\)\)/);
  assert.equal(phrases("tr").shipped, "Çıkanlar");
});

test("preview by default: the board, the window, the status (not set) and the body; nothing is posted", () => {
  const p = product();
  const r = p.go();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /# Board status · acme\/3 · \d{4}-W\d{2}/);
  assert.match(r.stdout, /Status: not set \(it is a judgment/);
  assert.match(r.stdout, /Add the export/);
  assert.match(r.stdout, /1 now · 1 next · 2 later/);
  assert.match(r.stdout, /Nothing was posted\. Add `--yes`/);
  assert.equal(p.posts().length, 0);
});

test("--yes posts ONE status update with the body, the week's dates and no status when none was given", () => {
  const p = product();
  const r = p.go("--yes");
  assert.equal(r.status, 0, r.stderr);
  const w = p.posts();
  assert.equal(w.length, 1);
  const get = k => w[0].argv[w[0].argv.findIndex(x => x.startsWith(k + "=") && w[0].argv[w[0].argv.indexOf(x) - 1] === "-f")]?.slice(k.length + 1);
  assert.equal(get("p"), "PROJ1");
  assert.match(get("b"), /<!-- nosy:board-status \d{4}-W\d{2} -->\n$/);
  assert.match(get("sd"), /^\d{4}-\d{2}-\d{2}$/); assert.match(get("td"), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(get("s"), undefined, "a status is the owner's judgment: none is sent unless given");
  assert.match(r.stdout, /Posted the \d{4}-W\d{2} update on acme\/3\./);
});

test("--status is sent as the board's enum; an unknown one is refused before anything runs", () => {
  const p = product();
  assert.equal(p.go("--status", "at-risk", "--yes").status, 0);
  assert.ok(p.posts()[0].argv.includes("s=AT_RISK"));
  const bad = p.go("--status", "fine", "--yes");
  assert.equal(bad.status, 1); assert.match(bad.stderr, /--status is one of on-track, at-risk, off-track, inactive, complete/);
  assert.equal(p.posts().length, 1);
  assert.deepEqual(Object.keys(STATUSES), ["on-track", "at-risk", "off-track", "inactive", "complete"]);
});

test("once a week: an update with this week's marker already on the board means nothing is posted, and it says so", () => {
  const week = isoWeek(new Date(`${localDay()}T12:00:00Z`)); // the owner's day, as the tool reads it
  const p = product({ fixture: { updates: [{ body: `Earlier text\n${MARKER(week)}\n` }] } });
  const r = p.go("--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Nothing to post: the board already has this week's update \\(${week}\\)`));
  assert.equal(p.posts().length, 0);
  const other = product({ fixture: { updates: [{ body: `Last week\n${MARKER("2020-W01")}\n` }] } });
  assert.equal(other.go("--yes").status, 0); assert.equal(other.posts().length, 1);
});

test("GitHub releases of the window count as shipped", () => {
  const p = product({ fixture: { prs: [], releases: [{ name: "Acme 2.0", tagName: "v2.0", publishedAt: iso(1), isDraft: false }, { name: "Acme 1.0", tagName: "v1.0", publishedAt: iso(40) }] } });
  const r = p.go();
  assert.match(r.stdout, /- Acme 2\.0 \(\[release\]\(https:\/\/github\.com\/acme\/widgets\/releases\/tag\/v2\.0\)\)/);
  assert.doesNotMatch(r.stdout, /Acme 1\.0/);
});

test("it needs a board: with no roadmap.project it says so and posts nothing", () => {
  const p = product({ sources: { roadmap: { source: "github", labels: { now: "roadmap:now" } } } });
  const r = p.go("--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /board-status posts to the board named in `roadmap\.project`/);
  assert.equal(p.posts().length, 0);
});

test("it needs the `project` scope, checked before anything is posted", () => {
  const p = product({ fixture: { scopes: "repo, read:project" } });
  const r = p.go("--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs the `project` scope/); assert.match(r.stderr, /gh auth refresh -s project/);
  assert.equal(p.posts().length, 0);
});

test("a failed post says what to do and the exit code is 1", () => {
  const p = product({ fixture: { failPost: true } });
  const r = p.go("--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /couldn't post the status update/);
  assert.match(r.stderr, /Nothing was posted/);
});

test("the privacy scan runs over the text: personal data in a card title stops it (exit 2), nothing posted", () => {
  const p = product({ fixture: { cards: [card("Now", 1, `Email ${"jane.doe"}@${"gmail.com"} about it`)] } });
  const r = p.go("--yes");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /privacy scan found something/);
  assert.equal(p.posts().length, 0);
});

test("a window that isn't 1 to 90 days is refused; `nosy board-status` is wired into the dispatcher and the help", () => {
  const p = product();
  assert.match(p.go("--days", "0").stderr, /--days wants a number of days from 1 to 90/);
  const r = run(NOSY, ["board-status", "--pm", p.pm], { env: p.env });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /# Board status · acme\/3/);
  assert.match(run(NOSY, ["help"], { env: p.env }).stdout, /nosy board-status/);
  assert.equal(p.posts().length, 0);
});

test("\"On the board\" counts the board's own cards, not the evidence items a `both` roadmap adds", () => {
  const p = product({ sources: { roadmap: { source: "both", project: { owner: "acme", number: 3, type: "organization", field: "Horizon" } } } });
  fs.writeFileSync(path.join(p.pm, "state", "waves.json"), JSON.stringify({ waves: [{ name: "Open requests", tasks: [{ title: "Evidence one" }, { title: "Evidence two" }, { title: "Evidence three" }] }] }));
  const r = p.go();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 now · 1 next · 2 later/, "four cards on the board, whatever the evidence adds");
  assert.doesNotMatch(r.stdout, /Evidence/);
});
