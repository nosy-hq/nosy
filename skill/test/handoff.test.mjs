// Contract tests for handoff.mjs (`nosy handoff`): one item of the team's list becomes an issue (or edits the issue it already is), with a
// suggested assignee, an agent or a label, and a project card. Shown first, written only with --yes. The suite never touches the network: a fake
// `gh` of this file's own answers every call and records each one (with the body it was given on stdin).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run as helperRun, temporary, clean, Tool } from "./helpers.mjs";
const run = (file, args, opts) => { const r = helperRun(file, args, opts); return { status: r.code, stdout: r.output, stderr: r.error }; };
import { suggestOwner, evidencePath, issueRefOf, bodyOf, MARKER, phrases, areaOf, cardFields, WANTED_FIELDS } from "../tools/handoff.mjs";

const HANDOFF = path.join(Tool, "handoff.mjs"), NOSY = path.join(Tool, "nosy.mjs");

// CommonJS on purpose, like the fake gh of the other suites.
const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const F = JSON.parse(fs.readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
const a = process.argv.slice(2), val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
const log = o => fs.appendFileSync(F.log, JSON.stringify(o) + "\\n");
const out = x => { process.stdout.write(typeof x === "string" ? x : JSON.stringify(x)); process.exit(0); };
const fail = m => { process.stderr.write(m + "\\n"); process.exit(1); };
const key = a.slice(0, 2).join(" ");
const WRITES = ["issue create", "issue edit", "label create", "project item-add", "project item-edit", "project create", "project link", "project field-create"];
if (WRITES.includes(key) || (a[0] === "api" && val("-X") === "POST")) { log({ argv: a, stdin: a.includes("-") ? fs.readFileSync(0, "utf8") : "" }); if ((F.failOn || []).includes(key)) fail("HTTP 403: Resource not accessible by personal access token"); }
if (F.offline) fail("fake gh: offline");
if (key === "api -i") out("HTTP/2 200\\nx-oauth-scopes: " + F.scopes + "\\n\\n{}");
else if (a[0] === "api" && a[1] === "repos/acme/widgets") out((F.private ? "true" : "false") + "\\n");
else if (key === "issue view" && (F.viewFail || []).includes(a[2])) fail("fake gh: could not resolve to an Issue");
else if (key === "issue view") out((F.views && F.views[a[2]]) || F.view || { state: "OPEN", assignees: [] });
else if (key === "pr view") out((F.prViews && F.prViews[a[2]]) || { state: "MERGED", mergedAt: "2026-10-02T10:00:00Z" });
else if (a[0] === "api" && /\\/assignees$/.test(a[1]) && !val("-X")) out(F.assignable.join("\\n") + "\\n");
else if (a[0] === "api" && /\\/commits\\?path=/.test(a[1])) out((F.commits[decodeURIComponent(a[1].split("path=")[1].split("&")[0])] || []).join("\\n") + "\\n");
else if (a[0] === "api" && a[1] === "graphql") out({ data: { repository: { suggestedActors: { nodes: F.actors } } } });
else if (a[0] === "api" && a[1] === "user") out("owner-login\\n");
else if (a[0] === "api" && val("-X") === "POST") out("{}");
else if (key === "issue list") { if (!/^"[^"]*" in:title$/.test(val("--search") || "")) fail("fake gh: the title search must be a quoted phrase (an unquoted title with a colon finds nothing on GitHub)"); out(F.existing || []); }
else if (key === "issue create") out("https://github.com/acme/widgets/issues/" + (F.nextIssue || 501) + "\\n");
else if (key === "issue edit") out("https://github.com/acme/widgets/issues/" + a[2] + "\\n");
else if (key === "label create") { if (F.labelExists) fail("label already exists"); out("ok\\n"); }
else if (key === "project item-add") out({ id: "ITEM1" });
else if (key === "project view") out({ id: "PROJ1" });
else if (key === "project create") out({ number: 9, url: "https://github.com/orgs/acme/projects/9" });
else if (key === "project link" || key === "project field-create") out("ok\\n");
else if (a[0] === "api" && /^users\\//.test(a[1])) out((F.ownerType || "Organization") + "\\n");
else if (key === "project field-list") out(F.fields ? { fields: F.fields } : { fields: [{ id: "FLD1", name: "Status", options: [{ id: "OPT1", name: "Todo" }, { id: "OPT2", name: "In progress" }] }, { id: "FLD2", name: "Horizon", options: [{ id: "H1", name: "Now" }, { id: "H2", name: "Next" }, { id: "H3", name: "Later" }] }] });
else if (key === "project item-edit") out("ok\\n");
else fail("fake gh: unrecognized call: gh " + a.join(" "));
`;

import { createHash } from "node:crypto";
const require_key = t => createHash("sha1").update(String(t).trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 10);
const made = [];
after(() => made.forEach(clean));

const ITEMS = [
  { title: "Rate limit the export endpoint", type: "On the team's next list", evidence: "src/export.ts:42", ref: null, demand: null },
  { title: "Fix the broken invite link", type: "Asked for", evidence: "src/invite.ts:7", ref: "#31", demand: { count: 4 } },
  { title: "Dark theme", type: "Ready in the backend", evidence: "the settings screen", ref: null },
];
const FIXTURE = { assignable: ["ada", "grace"], scopes: "repo, read:org, project", actors: [{ __typename: "User", login: "ada" }], commits: { "src/export.ts": ["ada", "ada", "ada", "grace"], "src/invite.ts": ["grace", "ada"] } };

function product({ fixture = {}, sources = {}, items = ITEMS, state } = {}) {
  const root = temporary("nosy-handoff-"); made.push(root);
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]); // the dispatcher wants `repo` to be a git repo with a commit
  execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start"]);
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", issue: { repo: "acme/widgets" }, ...sources }));
  if (items) fs.writeFileSync(path.join(pm, "state", "lowhanging.filtered.json"), JSON.stringify({ type: "lowhanging", items }));
  if (state) fs.writeFileSync(path.join(pm, "state", "handoff.json"), JSON.stringify(state));
  const log = path.join(root, "gh.log"); fs.writeFileSync(log, "");
  const bin = path.join(root, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH); fs.chmodSync(path.join(bin, "gh"), 0o755);
  const fx = path.join(root, "fixture.json"); fs.writeFileSync(fx, JSON.stringify({ log, ...FIXTURE, ...fixture }));
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_FIXTURE: fx };
  const writes = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const stateFile = path.join(pm, "state", "handoff.json");
  return { root, pm, writes, stateFile, env, go: (...args) => run(HANDOFF, [pm, ...args], { env }), state: () => JSON.parse(fs.readFileSync(stateFile, "utf8")) };
}

test("suggestOwner: the login behind most recent commits wins, counted only if assignable; bots and a thin lead give nothing", () => {
  assert.deepEqual(suggestOwner(["ada", "ada", "grace", "ada"], ["ada", "grace"], "f.ts"), { login: "ada", k: 3, n: 4, path: "f.ts" });
  assert.equal(suggestOwner(["ghost", "ghost", "ghost"], ["ada"], "f.ts"), null, "not assignable here");
  assert.equal(suggestOwner(["ada", "grace", "linus", "ada"], ["ada", "grace", "linus"], "f.ts"), null, "2 of 4 is not a majority");
  assert.equal(suggestOwner(["ada"], ["ada"], "f.ts"), null, "one commit is not a pattern");
  assert.equal(suggestOwner(["dependabot[bot]", "dependabot[bot]", "ada", "ada"], ["ada"], "f.ts")?.n, 2, "bots are not counted at all");
});

test("pure helpers: evidencePath, issueRefOf, the body and its marker", () => {
  assert.equal(evidencePath("src/a.ts:42"), "src/a.ts");
  assert.equal(evidencePath("src/a.ts:4-9"), "src/a.ts");
  assert.equal(evidencePath("the settings screen"), null);
  assert.equal(issueRefOf("#31"), 31); assert.equal(issueRefOf("K12"), null); assert.equal(issueRefOf(null), null);
  const b = bodyOf(ITEMS[0], { lang: "en", owner: { login: "ada", k: 3, n: 4, path: "src/export.ts" }, key: "abc" });
  assert.match(b, /@ada: 3 of the last 4 commits touching src\/export\.ts \(a suggestion, not an assignment\)/);
  assert.ok(b.trimEnd().endsWith(MARKER("abc")));
  assert.match(bodyOf({ ...ITEMS[0], demand: { count: 4 } }, { key: "k" }), /Asked for in 4 places/);
  assert.equal(phrases("tr").why, "Neden şimdi");
});

test("the list: numbered, with the suggested owner and what is already on GitHub; writes nothing", () => {
  const p = product({ state: { done: [] } });
  const r = p.go();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| 1 \| Rate limit the export endpoint \| src\/export\.ts:42 \| @ada \(3 of 4\) \| not on GitHub yet \|/);
  assert.match(r.stdout, /already issue #31/);
  assert.equal(p.writes().length, 0);
});

test("preview by default: the plan and the body are shown, nothing is written anywhere", () => {
  const p = product();
  const r = p.go("1");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Action: open a new issue/);
  assert.match(r.stdout, /Assignees: @ada \(suggested from 3 of the last 4 commits on src\/export\.ts; a suggestion\)/);
  assert.match(r.stdout, /Nothing was written\. Add `--yes`/);
  assert.equal(p.writes().length, 0);
  assert.equal(fs.existsSync(p.stateFile), false);
});

test("--yes opens ONE issue with the suggested assignee, the body on stdin ending in the marker, then records it", () => {
  const p = product();
  const r = p.go("1", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const w = p.writes();
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].argv.slice(0, 5), ["issue", "create", "-R", "acme/widgets", "--title"]);
  assert.ok(w[0].argv.includes("--assignee") && w[0].argv[w[0].argv.indexOf("--assignee") + 1] === "ada");
  assert.match(w[0].stdin, /<!-- nosy:handoff [0-9a-f]{10} -->\n$/);
  assert.match(r.stdout, /Opened #501 https:\/\/github\.com\/acme\/widgets\/issues\/501/);
  assert.equal(p.state().done[0].issue, 501);
});

test("a second run stops: already handed off, nothing written", () => {
  const p = product();
  p.go("1", "--yes");
  const before = p.writes().length;
  const r = p.go("1", "--yes");
  assert.equal(r.status, 0);
  assert.match(r.stderr, /already handed off as #501/);
  assert.equal(p.writes().length, before);
});

test("an issue on GitHub with the exact title is never duplicated", () => {
  const p = product({ fixture: { existing: [{ number: 12, title: "rate limit the export endpoint", state: "OPEN" }] } });
  const r = p.go("1", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing to open: #12 \(open\) has this title/);
  assert.equal(p.writes().length, 0);
});

test("an item that is already an issue (#N) is edited, never opened twice", () => {
  const p = product();
  const r = p.go("2", "--to", "grace", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const w = p.writes();
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].argv.slice(0, 4), ["issue", "edit", "31", "-R"]);
  assert.equal(w[0].argv[w[0].argv.indexOf("--add-assignee") + 1], "grace");
  assert.match(r.stdout, /Looked at #31/);
  const none = product().go("2", "--yes"); // no suggestion, no --to, no agent: nothing to change, and it says so instead of "edited"
  assert.match(none.stdout, /Nothing to change on #31/);
});

test("--agent with no assignable coding agent: a label (created first), the person stays accountable, and the preview says so", () => {
  const p = product();
  const pre = p.go("1", "--agent");
  assert.match(pre.stdout, /no coding agent is assignable in this repo, so the issue gets the label `agent-ready`; @ada stays accountable/);
  assert.equal(p.writes().length, 0);
  const r = p.go("1", "--agent", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const w = p.writes();
  assert.deepEqual(w.map(x => x.argv.slice(0, 2).join(" ")), ["label create", "issue create"]);
  assert.equal(w[1].argv[w[1].argv.indexOf("--label") + 1], "agent-ready");
  assert.doesNotMatch(r.stdout, /Assigned/);
});

test("--agent with a configured mention puts one line in the body, and a label that already exists is fine", () => {
  const p = product({ sources: { handoff: { agentMention: "@claude" } }, fixture: { labelExists: true } });
  const r = p.go("1", "--agent", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.match(p.writes().find(x => x.argv[1] === "create" && x.argv[0] === "issue").stdin, /^@claude please pick this up/m);
});

test("--agent with a Copilot actor assignable: the person is assigned on create, the agent by one API call after", () => {
  const p = product({ fixture: { actors: [{ __typename: "User", login: "ada" }, { __typename: "Bot", login: "copilot-swe-agent" }] } });
  const pre = p.go("1", "--agent", "copilot");
  assert.match(pre.stdout, /copilot-swe-agent\[bot\] will be assigned\. \*\*This uses your Copilot plan\*\*/);
  assert.equal(p.writes().length, 0);
  const r = p.go("1", "--agent", "copilot", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const w = p.writes();
  assert.deepEqual(w.map(x => x.argv[0] + " " + x.argv[1]), ["issue create", "api -X"]);
  assert.ok(w[0].argv.includes("ada") && !w[0].argv.some(a => /copilot/.test(a)));
  assert.ok(w[1].argv.includes("assignees[]=copilot-swe-agent[bot]"));
  assert.match(r.stdout, /Assigned copilot-swe-agent\[bot\]\./);
});

test("plain --agent never picks the paid Copilot agent on its own: it takes the free label path and says Copilot is available", () => {
  const p = product({ fixture: { actors: [{ __typename: "User", login: "ada" }, { __typename: "Bot", login: "copilot-swe-agent" }] } });
  const pre = p.go("1", "--agent");
  assert.match(pre.stdout, /Agent: the free path, so the issue gets the label `agent-ready`/);
  assert.match(pre.stdout, /`--agent copilot` would assign it instead \(it uses your Copilot plan\)/);
  const r = p.go("1", "--agent", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(p.writes().map(x => x.argv[0] + " " + x.argv[1]), ["label create", "issue create"], "no assignment of the bot");
});

test("--agent copilot where Copilot isn't assignable stops before anything is written, and points at the free path", () => {
  const p = product();
  const r = p.go("1", "--agent", "copilot", "--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Copilot's coding agent can't be assigned in acme\/widgets/);
  assert.match(r.stderr, /Use `--agent` \(the label path, no cost\)/);
  assert.equal(p.writes().length, 0);
});

test("`--agent copilot` doesn't turn the word copilot into an item number", () => {
  const p = product({ fixture: { actors: [{ __typename: "Bot", login: "copilot-swe-agent" }] } });
  const r = p.go("--agent", "copilot");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Hand-off candidates/);
});

test("--agent with no suggestion falls back to the signed-in user as the accountable person", () => {
  const p = product();
  const r = p.go("3", "--agent", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const create = p.writes().find(x => x.argv[1] === "create" && x.argv[0] === "issue");
  assert.equal(create.argv[create.argv.indexOf("--assignee") + 1], "owner-login");
});

test("--to must be assignable here; nothing is written when it isn't", () => {
  const p = product();
  const r = p.go("1", "--to", "stranger", "--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stranger can't be assigned in acme\/widgets/);
  assert.equal(p.writes().length, 0);
});

test("a project card: needs the `project` scope, checked BEFORE anything is written", () => {
  const p = product({ fixture: { scopes: "repo, read:org, read:project" } });
  const r = p.go("1", "--project", "3", "--owner", "acme", "--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs the `project` scope/);
  assert.match(r.stderr, /gh auth refresh -s project/);
  assert.equal(p.writes().length, 0);
});

test("a project card with the scope: issue, then card, then Status from the board's own options", () => {
  const p = product({ sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } });
  const r = p.go("1", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const w = p.writes();
  assert.deepEqual(w.map(x => x.argv.slice(0, 2).join(" ")), ["issue create", "project item-add", "project item-edit"]);
  assert.ok(w[2].argv.includes("OPT1") && w[2].argv.includes("FLD1") && w[2].argv.includes("PROJ1") && w[2].argv.includes("ITEM1"));
  assert.match(r.stdout, /Status: Todo\./);
});

test("the first failed write stops everything after it, and says what already went out", () => {
  const p = product({ fixture: { failOn: ["project item-add"] }, sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } });
  const r = p.go("1", "--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /couldn't add the card to project acme\/3 \(the issue is open\)/);
  assert.deepEqual(p.writes().map(x => x.argv.slice(0, 2).join(" ")), ["issue create", "project item-add"]);
  assert.equal(p.state().done[0].issue, 501, "the issue that did open is remembered, so a retry does not open another");
});

test("the privacy scan runs over the issue: personal data in a --body-file stops it (exit 2), nothing written", () => {
  const p = product();
  const f = path.join(p.root, "body.md"); fs.writeFileSync(f, `Call the customer on ${"jane.doe"}@${"gmail.com"} about this.\n`);
  const r = p.go("1", "--body-file", f, "--yes");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /privacy scan found something/);
  assert.equal(p.writes().length, 0);
});

test("a --body-file replaces the body and still ends with the marker", () => {
  const p = product();
  const f = path.join(p.root, "body.md"); fs.writeFileSync(f, "The export endpoint has no limit.\n\n**Done when:** 429 after 60 requests a minute.\n");
  p.go("1", "--body-file", f, "--yes");
  const create = p.writes().find(x => x.argv[0] === "issue");
  assert.match(create.stdin, /^The export endpoint has no limit\./);
  assert.match(create.stdin, /<!-- nosy:handoff [0-9a-f]{10} -->\n$/);
});

test("gh offline: it says what to do and writes nothing", () => {
  const p = product({ fixture: { offline: true } });
  const r = p.go("1", "--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /couldn't search existing issues/);
  assert.match(r.stderr, /Nothing was written/);
});

test("no list yet: it says to run psst first; an item that isn't there is refused", () => {
  const none = product({ items: null });
  assert.match(none.go().stderr, /run `nosy psst` first/);
  const p = product();
  assert.match(p.go("9").stderr, /item 9 is not on the list \(1-3\)/);
  assert.match(p.go("--item", "xyz").stderr, /no item on the list matches "xyz"/);
  assert.match(p.go("--item", "theme").stdout, /Dark theme/);
});

test("`nosy handoff` is wired into the dispatcher and the help text", () => {
  const p = product();
  const r = run(NOSY, ["handoff", "1", "--pm", p.pm], { env: p.env });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Hand-off · acme\/widgets/);
  assert.match(run(NOSY, ["help"], { env: p.env }).stdout, /nosy handoff/);
  assert.equal(p.writes().length, 0);
});

test("the body never carries prose evidence or a path inside the notes folder; a real repo file is kept", () => {
  const prose = bodyOf({ title: "t", evidence: "the licensing decision (28 Sep, Alex); release prep on a branch" }, { key: "k", notesDir: "pm" });
  assert.doesNotMatch(prose, /Alex|licensing/);
  assert.match(prose, /no file to point at/);
  const notes = bodyOf({ title: "t", evidence: "pm/log.md:824" }, { key: "k", notesDir: "pm" });
  assert.doesNotMatch(notes, /pm\/log\.md/);
  assert.match(notes, /the team's own notes \(not in this repo\)/);
  assert.match(bodyOf({ title: "t", evidence: "src/export.ts:42" }, { key: "k", notesDir: "pm" }), /`src\/export\.ts:42`/);
});

test("the preview warns when the body is the short default, and not when a --body-file was given", () => {
  const p = product();
  assert.match(p.go("1").stdout, /Heads-up: this is the short default body/);
  const f = path.join(p.root, "b.md"); fs.writeFileSync(f, "A real description.\n");
  assert.doesNotMatch(p.go("1", "--body-file", f).stdout, /Heads-up/);
});

test("a private repo's preview says only people with access can read it", () => {
  assert.match(product({ fixture: { private: true } }).go("1").stdout, /Who can read it: people with access to acme\/widgets/);
});

test("a public repo's preview names everyone as the audience", () => {
  const out = product({ fixture: { private: false } }).go("1").stdout;
  assert.match(out, /Who can read it: \*\*everyone\*\* \(acme\/widgets is a public repo/);
});

test("a run that stopped after the issue opened is finished by running again with the same flags: no second issue, the card gets added", () => {
  const sources = { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } };
  const p = product({ fixture: { failOn: ["project item-add"] }, sources });
  assert.equal(p.go("1", "--yes").status, 1);
  const fx = JSON.parse(fs.readFileSync(p.env.FAKE_GH_FIXTURE, "utf8")); delete fx.failOn; fs.writeFileSync(p.env.FAKE_GH_FIXTURE, JSON.stringify(fx));
  const before = p.writes().length;
  const r = p.go("1", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const after = p.writes().slice(before).map(x => x.argv.slice(0, 2).join(" "));
  assert.ok(!after.includes("issue create"), "never a second issue");
  assert.ok(after.includes("project item-add") && after.includes("project item-edit"));
  assert.match(r.stdout, /Looked at #501/);
});

test("the list shows the live state of what was handed off", () => {
  const p = product({ state: { done: [{ key: require_key("Rate limit the export endpoint"), issue: 77, url: "u", at: "x" }] }, fixture: { view: { state: "CLOSED", assignees: [{ login: "ada" }], projectItems: [{ status: { name: "Done" } }] } } });
  assert.match(p.go().stdout, /handed off: #77 closed \(@ada\) · card: Done/);
});

test("the preview of an existing issue says its text is not touched, and shows no body or short-body warning", () => {
  const out = product().go("2", "--to", "grace").stdout;
  assert.match(out, /Action: edit issue #31/);
  assert.match(out, /The issue's own text is not touched/);
  assert.doesNotMatch(out, /Heads-up|nosy:handoff/);
});

test("--horizon sets the board's Horizon field next to Status, from the board's own options", () => {
  const p = product({ sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } });
  const pre = p.go("1", "--horizon", "later");
  assert.match(pre.stdout, /Project card: acme\/3 · Status Todo · Horizon later/);
  assert.equal(p.writes().length, 0);
  const r = p.go("1", "--horizon", "later", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const edits = p.writes().filter(x => x.argv[1] === "item-edit");
  assert.equal(edits.length, 2);
  assert.ok(edits[0].argv.includes("OPT1") && edits[1].argv.includes("FLD2") && edits[1].argv.includes("H3"));
  assert.match(r.stdout, /Status: Todo\./); assert.match(r.stdout, /Horizon: Later\./);
});

test("an unknown Horizon option is said out loud, lists what the board has, and does not stop the other field", () => {
  const p = product({ sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo", horizon: "Soonish" } } } });
  const r = p.go("1", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /the board has no Horizon "Soonish" \(it has: Now, Next, Later\)/);
  assert.match(r.stdout, /Status: Todo\./);
});

test("--horizon with no project to put the card on is refused before anything is written", () => {
  const p = product();
  const r = p.go("1", "--horizon", "Now", "--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--horizon sets a field on the project card/);
  assert.equal(p.writes().length, 0);
});

// ---- A2: the card's own fields, --area, --setup-board, and the hardening found on the way ----------------------------------------------------------
const FIELDS_ALL = [
  { id: "FLD1", name: "Status", type: "ProjectV2SingleSelectField", options: [{ id: "OPT1", name: "Todo" }, { id: "OPT2", name: "In progress" }] },
  { id: "FLD2", name: "Horizon", type: "ProjectV2SingleSelectField", options: [{ id: "H1", name: "Now" }, { id: "H2", name: "Next" }, { id: "H3", name: "Later" }] },
  { id: "FLD3", name: "Signal", type: "ProjectV2Field" }, { id: "FLD4", name: "Asked for", type: "ProjectV2Field" },
  { id: "FLD5", name: "Area", type: "ProjectV2Field" }, { id: "FLD6", name: "Rivals with it", type: "ProjectV2Field" },
];
const MATRIX = { update: "x", codes: {}, steps: [{ no: "11", name: "Roadmap waves" }, { no: "12", name: "Task distribution, assignment to people" }], biz: { name: "Us", codes: { 11: "y", 12: "p" }, notes: {} },
  products: [{ name: "A", codes: { 12: { k: "y" } }, statusType: "active" }, { name: "B", codes: { 12: { k: "y" } } }, { name: "C", codes: { 12: { k: "n" } } }, { name: "Gone", codes: { 12: { k: "y" } }, statusType: "closed" }] };
const withMatrix = p => { fs.writeFileSync(path.join(p.pm, "matrix.json"), JSON.stringify(MATRIX)); const s = JSON.parse(fs.readFileSync(path.join(p.pm, "sources.json"), "utf8")); s.matrix = "pm/matrix.json"; fs.writeFileSync(path.join(p.pm, "sources.json"), JSON.stringify(s)); };

test("cardFields: fields the board has are set by their kind, the rest are reported absent, nothing is skipped when the list couldn't be read", () => {
  const r = cardFields([["Status", "Todo"], ["Signal", "On the list"], ["Asked for", 4], ["Area", null], ["Nope", "x"]], FIELDS_ALL.slice(0, 4));
  assert.deepEqual(r.will.map(f => [f.name, f.kind]), [["Status", "single"], ["Signal", "text"], ["Asked for", "number"]]);
  assert.deepEqual(r.absent, ["Nope"]);
  assert.equal(cardFields([["Signal", "x"]], null).will.length, 1);
});

test("areaOf: a number, a unique piece of the name; rivals that are closed don't count; an ambiguous or unknown spec gives nothing", () => {
  const M = matrixRead_(MATRIX);
  assert.deepEqual(areaOf(M, "12"), { no: "12", name: "Task distribution, assignment to people", rivals: 2, total: 3 });
  assert.equal(areaOf(M, "distribution").no, "12");
  assert.equal(areaOf(M, "o"), null, "matches both areas");
  assert.equal(areaOf(M, "99"), null);
  assert.equal(areaOf(M, ""), null);
});
import { matrixRead } from "../tools/read-matrix.mjs";
const matrixRead_ = m => matrixRead(m);

test("the card gets Signal and, with --area, Area and Rivals with it, in the board's own kinds; Asked for only when the item has a count", () => {
  const p = product({ fixture: { fields: FIELDS_ALL }, sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } }); withMatrix(p);
  const pre = p.go("2", "--to", "grace", "--area", "12");
  assert.match(pre.stdout, /Project card: acme\/3 · Status Todo · Signal Asked for · Asked for 4 · Area 12 · Task distribution, assignment to people · Rivals with it 2/);
  assert.equal(p.writes().length, 0);
  const r = p.go("2", "--to", "grace", "--area", "12", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const edits = p.writes().filter(x => x.argv[1] === "item-edit");
  const by = id => edits.find(e => e.argv.includes(id));
  assert.ok(by("OPT1"));
  assert.deepEqual(by("FLD3").argv.slice(-2), ["--text", "Asked for"]);
  assert.deepEqual(by("FLD4").argv.slice(-2), ["--number", "4"]);
  assert.deepEqual(by("FLD5").argv.slice(-2), ["--text", "12 · Task distribution, assignment to people"]);
  assert.deepEqual(by("FLD6").argv.slice(-2), ["--number", "2"]);
  assert.match(r.stdout, /Rivals with it: 2\./);
});

test("fields the board lacks are said out loud and left out; the others are still set", () => {
  const p = product({ fixture: { fields: FIELDS_ALL.slice(0, 2) }, sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } });
  const pre = p.go("1");
  assert.match(pre.stdout, /Not on the board \(left out\): Signal\. `nosy handoff --setup-board` adds them\./);
  const r = p.go("1", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(p.writes().filter(x => x.argv[1] === "item-edit").length, 1, "only Status");
});

test("--area must name exactly one area; it needs a project card; nothing is written when it can't", () => {
  const p = product({ sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } }); withMatrix(p);
  const bad = p.go("1", "--area", "o", "--yes");
  assert.equal(bad.status, 1); assert.match(bad.stderr, /doesn't match exactly one area/); assert.equal(p.writes().length, 0);
  const none = product(); withMatrix(none);
  assert.match(none.go("1", "--area", "12").stderr, /--area sets fields on the project card/);
});

test("--setup-board on a board that exists: lists the missing fields, writes nothing until --yes, then creates only those", () => {
  const p = product({ fixture: { fields: FIELDS_ALL.slice(0, 2) }, sources: { handoff: { project: { owner: "acme", number: 3 } } } });
  const pre = p.go("--setup-board");
  assert.equal(pre.status, 0, pre.stderr);
  assert.match(pre.stdout, /Project: acme\/3 \(exists/);
  assert.match(pre.stdout, /Fields to create: Signal \(text\), Asked for \(number\), Area \(text\), Rivals with it \(number\)/);
  assert.match(pre.stdout, /can only be set in the GitHub UI/);
  assert.equal(p.writes().length, 0);
  const r = p.go("--setup-board", "--yes");
  assert.equal(r.status, 0, r.stderr);
  const made = p.writes().filter(x => x.argv[1] === "field-create").map(x => x.argv[x.argv.indexOf("--name") + 1]);
  assert.deepEqual(made, ["Signal", "Asked for", "Area", "Rivals with it"]);
  assert.ok(p.writes().every(x => x.argv[1] === "field-create"), "no project was created, none linked");
});

test("--setup-board with no project: creates it for the owner, links it to the repo, makes every field, and prints the sources.json line", () => {
  const p = product();
  const pre = p.go("--setup-board");
  assert.match(pre.stdout, /none set\. It would create a project "widgets" for acme and link it to acme\/widgets/);
  assert.equal(p.writes().length, 0);
  const r = p.go("--setup-board", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(p.writes().slice(0, 2).map(x => x.argv.slice(0, 2).join(" ")), ["project create", "project link"]);
  assert.deepEqual(p.writes().filter(x => x.argv[1] === "field-create").map(x => x.argv[x.argv.indexOf("--name") + 1]), WANTED_FIELDS.map(f => f.name));
  assert.match(r.stdout, /"handoff": \{ "project": \{ "owner": "acme", "number": 9, "type": "organization", "status": "Todo" \} \}/);
});

test("--setup-board needs the `project` scope, checked before anything is created", () => {
  const p = product({ fixture: { scopes: "repo, read:project" } });
  const r = p.go("--setup-board", "--yes");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs the `project` scope/);
  assert.equal(p.writes().length, 0);
});

test("a board that already has everything: --setup-board says there is nothing to do", () => {
  const p = product({ fixture: { fields: FIELDS_ALL }, sources: { handoff: { project: { owner: "acme", number: 3 } } } });
  assert.match(p.go("--setup-board", "--yes").stdout, /Nothing to do\./);
  assert.equal(p.writes().length, 0);
});

test("the duplicate-title search is a quoted phrase, and a title with a colon and a quote is searched safely", () => {
  const p = product({ items: [{ title: 'Cloud: the "live" path', type: "t", evidence: "x", ref: null }] });
  const r = p.go("1", "--yes"); // the fake gh refuses an unquoted search
  assert.equal(r.status, 0, r.stderr);
  assert.equal(p.writes().filter(x => x.argv[0] === "issue").length, 1);
});

test("the state file keeps the title next to the key, so a reader doesn't have to hash", () => {
  const p = product(); p.go("1", "--yes");
  const e = p.state().done[0];
  assert.equal(e.title, "Rate limit the export endpoint"); assert.equal(e.issue, 501);
});

test("a repo name that is not owner/name is refused before any call", () => {
  const p = product({ sources: { issue: { repo: 'acme/widgets"){x}#' } } });
  const r = p.go("1");
  assert.equal(r.status, 1); assert.match(r.stderr, /is not owner\/name/);
});

// ---- A4: --review, what became of what was handed off ---------------------------------------------------------------------------------------------
const entry = (key, issue, extra = {}) => ({ key, title: `Item ${issue}`, issue, url: `https://github.com/acme/widgets/issues/${issue}`, at: "2026-10-01T00:00:00.000Z", ...extra });
const closedBy = (n, author = "customer") => ({ state: "CLOSED", closedAt: "2026-10-02T10:00:00Z", closedByPullRequestsReferences: [{ number: n }], author: { login: author, is_bot: false }, projectItems: [{ status: { name: "Done" } }] });

test("--review with nothing handed off says so and writes nothing", () => {
  const p = product();
  const r = p.go("--review");
  assert.equal(r.status, 0);
  assert.match(r.stderr, /nothing has been handed off yet/);
  assert.equal(p.writes().length, 0);
});

test("--review: an open issue shows its state and card, and no proposal", () => {
  const p = product({ state: { done: [entry("k1", 7, { area: "12" })] }, fixture: { view: { state: "OPEN", assignees: [], projectItems: [{ status: { name: "In progress" } }], author: { login: "ada" } } } });
  const r = p.go("--review");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| #7 \| Item 7 \| open \| In progress \| – \| 12 \|/);
  assert.match(r.stdout, /No proposals/);
});

test("--review: closed by a merged pull request with a recorded matrix area proposes the cell and, for an outside asker, ship-notes; nothing is written", () => {
  const p = product({ state: { done: [entry("k1", 7, { area: "12" })] }, fixture: { views: { 7: closedBy(40, "customer") } } }); withMatrix(p);
  const r = p.go("--review");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| #7 \| Item 7 \| closed by a merged pull request \| Done \| #40 \(2026-10-02\) \| 12 \|/);
  assert.match(r.stdout, /Matrix area 12 \(Task distribution, assignment to people\): Nosy p → y\? #7 was closed by merged pull request #40 on 2026-10-02/);
  assert.match(r.stdout, /it is yours to change/);
  assert.match(r.stdout, /`nosy ship-notes` will tell whoever asked for #7/);
  assert.equal(p.writes().length, 0, "nothing is written to GitHub");
  assert.equal(JSON.parse(fs.readFileSync(path.join(p.pm, "matrix.json"), "utf8")).biz.codes["12"], "p", "the matrix is not touched");
  const j = JSON.parse(fs.readFileSync(path.join(p.pm, "state", "handoff-review.json"), "utf8"));
  assert.equal(j.rows[0].matrix.to, "y"); assert.equal(j.rows[0].tell, true);
});

test("--review: no ship-notes line for the team's own or a bot's issue; a cell that already says y is only noted", () => {
  const sources = { team: ["ada"] };
  const p = product({ sources, state: { done: [entry("k1", 7, { area: "11" }), entry("k2", 8, { area: "12" })] }, fixture: { views: { 7: closedBy(40, "ada"), 8: { ...closedBy(41, "dependabot[bot]"), author: { login: "dependabot[bot]", is_bot: true } } } } }); withMatrix(p);
  const r = p.go("--review");
  assert.doesNotMatch(r.stdout, /ship-notes/);
  assert.match(r.stdout, /Matrix area 11 \(Roadmap waves\) already says y; #7 is merged \(#40\)/);
});

test("--review: closed with no merged pull request, a merged one with no recorded area, and an unreadable issue are each said, with no proposal to change anything", () => {
  const p = product({ state: { done: [entry("k1", 7, { area: "12" }), entry("k2", 8), entry("k3", 9)] },
    fixture: { views: { 7: { state: "CLOSED", closedByPullRequestsReferences: [], author: { login: "x" }, projectItems: [] }, 8: closedBy(41) }, prViews: {} } }); withMatrix(p);
  const fx = JSON.parse(fs.readFileSync(p.env.FAKE_GH_FIXTURE, "utf8")); fx.viewFail = ["9"]; fs.writeFileSync(p.env.FAKE_GH_FIXTURE, JSON.stringify(fx));
  const r = p.go("--review");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#7 is closed with no merged pull request: was it fixed\?/);
  assert.match(r.stdout, /#8 is merged \(#41\) but no matrix area was recorded/);
  assert.match(r.stdout, /#9 couldn't be read/);
  assert.match(r.stdout, /\| #9 \| Item 9 \| unreadable \|/);
});

test("handing an item off with --area records the area in the state file, also on an issue the item already is; it is added to a known entry, never replacing its date", () => {
  const p = product({ sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } }); withMatrix(p);
  p.go("1", "--yes");
  const at = p.state().done[0].at;
  assert.equal(p.state().done[0].area, undefined);
  p.go("1", "--area", "12", "--yes");
  const e = p.state().done[0];
  assert.equal(e.area, "12"); assert.equal(e.at, at, "the date of the first hand-off stays");
  const q = product({ sources: { handoff: { project: { owner: "acme", number: 3, status: "Todo" } } } }); withMatrix(q);
  q.go("2", "--to", "grace", "--area", "12", "--yes"); // item 2 is already issue #31
  const f = q.state().done.find(x => x.issue === 31);
  assert.ok(f && f.area === "12", "an item that is already an issue is remembered too");
});
