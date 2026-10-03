// roadmap.mjs: the roadmap lives in the repo. Now / Next / Later from scoop's waves become a block of ROADMAP.md,
// proposed as a PR from a throwaway worktree; merging is the approval. Real git (a bare remote), a fake `gh`, temp folders only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { model, render, splice, blockOf, changes, configOf, lineOf, lineFor, tidy, jsonOf, phrases, readGithub, scan, HEAD, FOOT } from "../tools/roadmap.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const ROADMAP = path.join(Tool, "roadmap.mjs"), dirs = [], today = new Date().toISOString().slice(0, 10);
after(() => dirs.forEach(clean));
const ID = { GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.test", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.test", GIT_TERMINAL_PROMPT: "0" };
const task = (title, extra = {}) => ({ title, ref: null, type: "Checked by psst", score: 9, effort: "M", reason_now: "Acme asked twice, ada@example.test", evidenceList: ["apps/web/secret-path.ts:12"], day: 3, ...extra });
const WAVES = { waves: [
  { name: "Now", tasks: [task("Export to CSV", { ref: "#12" }), task("Single sign-on", { ref: "K77" })] },
  { name: "When code lands", tasks: [task("Team invites")] },
  { name: "Needs backend", tasks: [task("Audit log")] },
  { name: "Open requests", tasks: [task("Dark mode"), task("Export to CSV", { ref: "#12" })] },
  { name: "Documentation fix", tasks: [task("Fix the typo page")] },
] };

function product({ roadmapFile = null, waves = WAVES, roadmap = null, language = null } = {}) {
  const root = temporary("nosy-roadmap-"); dirs.push(root);
  const remote = path.join(root, "origin.git"), work = path.join(root, "work"), bin = path.join(root, "bin");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  fs.mkdirSync(work); fs.mkdirSync(bin);
  const g = (...a) => execFileSync("git", ["-C", work, ...a], { stdio: "ignore", env: { ...process.env, ...ID } });
  g("init", "-q", "-b", "main"); fs.writeFileSync(path.join(work, "README.md"), "hello\n");
  if (roadmapFile != null) fs.writeFileSync(path.join(work, "ROADMAP.md"), roadmapFile);
  g("add", "."); g("commit", "-qm", "init"); g("remote", "add", "origin", remote); g("push", "-q", "-u", "origin", "main");
  const pm = path.join(work, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: work, ref: "main", issue: { repo: "acme/widgets" }, ...(roadmap ? { roadmap } : {}), ...(language ? { language } : {}) }));
  fs.writeFileSync(path.join(pm, "state", "waves.json"), JSON.stringify(waves));
  // A fake gh: logs every call and answers from files in <root>/ans (merged.json, open.json, issues-<label or milestone>.json, milestones.json,
  // graphql.json; graphql.fail = a stderr text and exit 1). `pr create` answers with a URL, `pr edit` with nothing. No network, ever.
  const log = path.join(root, "gh.log"), ans = path.join(root, "ans"), merged = path.join(ans, "merged.json"); fs.mkdirSync(ans);
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
printf '%s\\n' "$*" | tr '\\n' ' ' >> "${log}"; echo >> "${log}"
ans() { if [ -f "${ans}/$1" ]; then cat "${ans}/$1"; else echo "$2"; fi; }
case "$1 $2" in
 "pr list") case "$*" in *"--state open"*) if [ -f "${ans}/open.fail" ]; then cat "${ans}/open.fail" >&2; exit 1; fi; ans open.json '[]' ;; *) ans merged.json '[]' ;; esac ;;
 "pr create") echo "https://github.com/acme/widgets/pull/99" ;;
 "issue list") k=""; prev=""; for a in "$@"; do if [ "$prev" = "--label" ] || [ "$prev" = "--milestone" ]; then k="$a"; fi; prev="$a"; done; ans "issues-$(printf %s "$k" | tr -c 'A-Za-z0-9' '_').json" '[]' ;;
 "api graphql") if [ -f "${ans}/graphql.fail" ]; then cat "${ans}/graphql.fail" >&2; exit 1; fi; ans graphql.json '{}' ;;
 "api repos/acme/widgets/milestones"*) ans milestones.json '[]' ;;
esac
`, { mode: 0o755 });
  const env = { ...ID, PATH: `${bin}:${process.env.PATH}`, NOSY_NO_UPDATE_CHECK: "1" };
  const put = (name, v) => fs.writeFileSync(path.join(ans, name), typeof v === "string" ? v : JSON.stringify(v));
  return { root, remote, work, pm, g, log, merged, put, env, rm: (...a) => execFileSync("git", ["-C", remote, ...a], { encoding: "utf8" }) };
}

test("the block: Now, Next, Later and Shipped from the waves; issue refs link, decision refs and reason text never appear", () => {
  const cfg = configOf({});
  const m = model({ waves: WAVES, cfg, repoUrl: "https://github.com/acme/widgets",
    merged: [{ number: 40, title: "Add CSV export", mergedAt: new Date().toISOString() }, { number: 3, title: "Too old", mergedAt: "2020-01-01T00:00:00Z" }] });
  assert.deepEqual(m.now.map(lineFor), ["- Export to CSV ([#12](https://github.com/acme/widgets/issues/12))", "- Single sign-on", "- Team invites"]);
  assert.deepEqual(m.next.map(lineFor), ["- Audit log"]);
  assert.deepEqual(m.later.map(lineFor), ["- Dark mode"], "Export to CSV (#12) is already in Now: an item appears once, in the earliest section");
  assert.equal(m.shipped.length, 1);
  assert.deepEqual(m.shipped[0], { title: "Add CSV export", ref: "#40", url: "https://github.com/acme/widgets/pull/40", date: today });
  const block = render(m, { day: "2026-10-03" });
  assert.ok(block.startsWith(HEAD) && block.endsWith(FOOT));
  for (const secret of ["Acme asked", "ada@example.test", "secret-path", "K77", "Fix the typo page"]) assert.ok(!block.includes(secret), secret);
  assert.match(block, /### Now\n\n- Export to CSV[\s\S]*### Next[\s\S]*### Later[\s\S]*### Shipped recently\n\n- Add CSV export \(\[#40\]\(https:\/\/github\.com\/acme\/widgets\/pull\/40\)\) · \d{4}-\d{2}-\d{2}\n/);
});

test("config maps wave names, skips by title, and release tags stand in when no PR merged", () => {
  const cfg = configOf({ roadmap: { now: ["Needs backend"], next: ["Now"], later: [], skip: ["sign-on"] } });
  const m = model({ waves: WAVES, cfg, tags: [{ name: "v1.2.0", date: new Date().toISOString() }, { name: "v0.1.0", date: "2020-01-01T00:00:00Z" }] });
  assert.deepEqual(m.now.map(lineFor), ["- Audit log"]);
  assert.deepEqual(m.next.map(lineFor), ["- Export to CSV (#12)"]);
  assert.deepEqual(m.later, []);
  assert.deepEqual(m.shipped.map(s => [s.title, s.ref, s.url]), [["v1.2.0", null, null]]);
  assert.equal(lineOf({ title: "Fix #5 crash", ref: "#5" }, null), "- Fix #5 crash", "a title that already names the issue isn't repeated");
});

test("titles: one the earlier tool cut mid-sentence ends at its last whole word with an ellipsis; whitespace collapses; nothing is invented", () => {
  const cut = "Let customers pick a delivery window at checkout, so the courier can plan the day while the";
  assert.equal(cut.length < 105, true, "a short title is never touched");
  assert.equal(tidy(cut), cut);
  const whole = "Internal request 162 (delete my project / account) is built in Cloud but the log still lists it open";
  assert.equal(whole.length, 100); assert.equal(tidy(whole), whole, "a title of 100 characters is a normal title, not a cut one");
  const long = "Let customers pick a delivery window at checkout and let the courier plan the whole day around it, while the";
  assert.ok(long.length >= 105 && long.length <= 112);
  assert.equal(tidy(long), "Let customers pick a delivery window at checkout and let the courier plan the whole day around it, while…");
  assert.equal(tidy(`  ${long.replace(/ /g, "  ")}\n`), tidy(long), "whitespace collapses first");
  assert.equal(tidy(long + "."), long + ".", "closing punctuation: the title is whole");
  assert.equal(tidy("Short   title\t here"), "Short title here");
  assert.equal(tidy(tidy(long)), tidy(long), "already ended with an ellipsis: left as it is");
  assert.equal(tidy("A".repeat(110)), "A".repeat(110) + "…", "one long word: nothing to cut at, still marked");
  assert.equal(tidy(long, false), long, "titles a person typed on GitHub are only whitespace-collapsed");
  const words = long.split(" "); for (const w of tidy(long).replace(/…$/, "").split(" ")) assert.ok(words.includes(w), `${w} is one of the original words`);
});

test("one item, once: the same #N (else the same title) sits only in the earliest of Now, Next, Later; caps cut with a final line and the count goes to the JSON", () => {
  const W = { waves: [
    { name: "Now", tasks: [task("Export CSV", { ref: "#12" }), task("Dark  mode!")] },
    { name: "Needs backend", tasks: [task("Different words for the same issue", { ref: "#12" }), task("dark mode"), task("Audit log", { ref: "K3" }), task("Search"), task("SSO")] },
    { name: "Open requests", tasks: [task("Audit log"), task("Export CSV", { ref: "#12" }), task("Webhooks"), task("Themes"), task("Plugins")] },
  ] };
  const cfg = configOf({ roadmap: { max: { now: 8, next: 2, later: 1 } } });
  const m = model({ waves: W, cfg, repoUrl: "https://github.com/acme/widgets" });
  assert.deepEqual(m.now.map(i => i.title), ["Export CSV", "Dark mode!"]);
  assert.deepEqual(m.next.map(i => i.title), ["Audit log", "Search"], "same title with a decision ref is the same item; capped at 2");
  assert.deepEqual(m.later.map(i => i.title), ["Webhooks"]);
  assert.deepEqual(m.hidden, { now: 0, next: 1, later: 2 });
  assert.ok(!m.later.some(i => i.title === "Audit log"), "SSO, cut from Next, doesn't come back in Later either");
  const block = render(m, { day: "2026-10-03" });
  assert.match(block, /### Next\n\n- Audit log\n- Search\n\n_…and 1 more_\n/);
  assert.match(block, /### Later\n\n- Webhooks\n\n_…and 2 more_\n/);
  assert.ok(!/_…and/.test(block.split("### Now")[1].split("### Next")[0]), "Now isn't cut: no line");
  assert.deepEqual(configOf({}).max, { now: 8, next: 10, later: 10 });
  assert.deepEqual(configOf({ roadmap: { max: { now: 0, next: "x", later: 3 } } }).max, { now: 8, next: 10, later: 3 });
  // A changed "and N more" is a changed block.
  const ch = changes(block, block.replace("_…and 2 more_", "_…and 3 more_"));
  assert.equal(ch.added.length + ch.removed.length, 2);
});

test("splice replaces only the block, keeps the owner's text above and below, and starts a new file with a heading", () => {
  const block = `${HEAD}\nnew\n${FOOT}`;
  assert.equal(splice(null, block), `# Roadmap\n\n${block}\n`);
  const had = `# Our plans\n\nHand-written intro.\n\n${HEAD}\nold\n${FOOT}\n\nHand-written outro.\n`;
  assert.equal(splice(had, block), `# Our plans\n\nHand-written intro.\n\n${block}\n\nHand-written outro.\n`);
  assert.equal(splice("# Notes\n\ntext", block), `# Notes\n\ntext\n\n${block}\n`, "no block yet: appended");
  assert.equal(blockOf(had), `${HEAD}\nold\n${FOOT}`);
});

test("changes: added, removed, moved; the date line and a shipped item's date are not changes", () => {
  const a = `${HEAD}\n> on 2026-10-01\n\n### Now\n\n- A\n- B\n\n### Shipped recently\n\n- S · 2026-10-01\n${FOOT}`;
  const b = `${HEAD}\n> on 2026-10-03\n\n### Now\n\n- A\n- C\n\n### Next\n\n- B\n\n### Shipped recently\n\n- S · 2026-10-03\n${FOOT}`;
  const c = changes(a, b);
  assert.deepEqual(c.added.map(x => x.line), ["- C"]);
  assert.deepEqual(c.moved.map(x => [x.line, x.from, x.to]), [["- B", "Now", "Next"]]);
  assert.deepEqual(c.removed, []);
  assert.deepEqual(changes(a, a.replace("2026-10-01\n\n", "2026-10-09\n\n")), { added: [], removed: [], moved: [] });
});

test("preview: writes pm/state/roadmap.md and prints the block; no waves says to run scoop", () => {
  const p = product();
  const r = run(ROADMAP, [p.pm], { env: p.env });
  assert.equal(r.code, 0, r.error + r.output);
  assert.match(r.output, /### Now\n\n- Export to CSV/);
  assert.match(r.output, /3 now, 1 next, 1 later, 0 shipped/);
  assert.equal(fs.readFileSync(path.join(p.pm, "state", "roadmap.md"), "utf8").split("\n")[0], HEAD);
  fs.rmSync(path.join(p.pm, "state", "waves.json"));
  const none = run(ROADMAP, [p.pm], { env: p.env });
  assert.equal(none.code, 1);
  assert.match(none.error, /run scoop first/);
});

test("the privacy scan stops a title that carries personal data: exit 2, nothing written", () => {
  const p = product({ waves: { waves: [{ name: "Now", tasks: [task("Call jane.doe@customer.test about billing")] }] } });
  const r = run(ROADMAP, [p.pm], { env: p.env });
  assert.equal(r.code, 2, r.output);
  assert.match(r.error, /privacy scan found something/);
  assert.ok(!fs.existsSync(path.join(p.pm, "state", "roadmap.md")));
  assert.ok(!fs.existsSync(path.join(p.pm, "state", "roadmap.json")), "the JSON is held back with the block");
});

test("--check: no block yet is stale (2), the committed block is current (0), a changed wave is stale again", () => {
  const p = product();
  const first = run(ROADMAP, [p.pm, "--check"], { env: p.env });
  assert.equal(first.code, 2);
  assert.match(first.output, /has no Nosy roadmap block on main yet/);
  const block = fs.readFileSync(path.join(p.pm, "state", "roadmap.md"), "utf8").trim();
  fs.writeFileSync(path.join(p.work, "ROADMAP.md"), splice(null, block)); p.g("add", "ROADMAP.md"); p.g("commit", "-qm", "roadmap"); p.g("push", "-q", "origin", "main");
  assert.equal(run(ROADMAP, [p.pm, "--check"], { env: p.env }).code, 0);
  const W = JSON.parse(fs.readFileSync(path.join(p.pm, "state", "waves.json"), "utf8")); W.waves[1].tasks.push(task("New thing"));
  fs.writeFileSync(path.join(p.pm, "state", "waves.json"), JSON.stringify(W));
  const stale = run(ROADMAP, [p.pm, "--check"], { env: p.env });
  assert.equal(stale.code, 2);
  assert.match(stale.output, /is behind: 1 to add, 0 to remove, 0 moved/);
});

test("--pr without --yes pushes nothing and says why", () => {
  const p = product();
  const r = run(ROADMAP, [p.pm, "--pr"], { env: p.env });
  assert.equal(r.code, 1);
  assert.match(r.output, /Say yes, then run it again with --yes/);
  assert.equal(p.rm("branch", "--list").includes("nosy/"), false);
  assert.ok(!fs.existsSync(p.log) || !/pr create/.test(fs.readFileSync(p.log, "utf8")));
});

test("--pr --yes: a branch with only the block changed, a PR through gh, and the owner's checkout untouched", () => {
  const p = product({ roadmapFile: "# Roadmap\n\nOur own intro.\n\n## Principles\n\nBe kind.\n" });
  fs.writeFileSync(path.join(p.work, "scratch.txt"), "my unfinished work\n"); // an untracked file in the checkout
  const headBefore = execFileSync("git", ["-C", p.work, "rev-parse", "HEAD"], { encoding: "utf8" });
  const r = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(r.code, 0, r.error + r.output);
  assert.match(r.output, /Opened https:\/\/github\.com\/acme\/widgets\/pull\/99/);
  const branch = `nosy/roadmap-${today}`;
  assert.match(p.rm("branch", "--list", branch), new RegExp(branch));
  const file = p.rm("show", `${branch}:ROADMAP.md`);
  assert.ok(file.startsWith("# Roadmap\n\nOur own intro.\n\n## Principles\n\nBe kind.\n"), "hand-written text kept");
  assert.match(file, new RegExp(`${HEAD}[\\s\\S]*### Now[\\s\\S]*Export to CSV[\\s\\S]*${FOOT}`));
  assert.equal(p.rm("diff", "--name-only", "main", branch).trim(), "ROADMAP.md");
  // gh was asked for the right PR, with a body that lists what was added.
  const calls = fs.readFileSync(p.log, "utf8").split("\n").filter(l => l.startsWith("pr create"));
  assert.equal(calls.length, 1);
  assert.match(calls[0], new RegExp(`--base main --head ${branch}`));
  assert.match(calls[0], /-R acme\/widgets/);
  assert.match(calls[0], /Added/);
  // Nothing in the owner's checkout moved: same HEAD, same branch, the scratch file, no ROADMAP.md, no leftover worktree.
  assert.equal(execFileSync("git", ["-C", p.work, "rev-parse", "HEAD"], { encoding: "utf8" }), headBefore);
  assert.equal(execFileSync("git", ["-C", p.work, "branch", "--show-current"], { encoding: "utf8" }).trim(), "main");
  assert.ok(fs.existsSync(path.join(p.work, "scratch.txt")));
  assert.equal(fs.readFileSync(path.join(p.work, "ROADMAP.md"), "utf8").includes(HEAD), false);
  assert.equal(execFileSync("git", ["-C", p.work, "worktree", "list"], { encoding: "utf8" }).trim().split("\n").length, 1);
});

test("a roadmap that is already current opens no PR; a second run the same day takes the next branch name", () => {
  const p = product();
  const first = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(first.code, 0, first.error);
  // Merge it: put the branch's file on main.
  p.g("fetch", "-q", "origin"); p.g("merge", "-q", "--ff-only", `origin/nosy/roadmap-${today}`); p.g("push", "-q", "origin", "main");
  const calls = () => fs.readFileSync(p.log, "utf8").split("\n").filter(l => l.startsWith("pr create")).length;
  const again = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(again.code, 0);
  assert.match(again.output, /already has this roadmap: no PR/);
  assert.equal(calls(), 1);
  // A change opens a second PR on a fresh branch name.
  const W = JSON.parse(fs.readFileSync(path.join(p.pm, "state", "waves.json"), "utf8")); W.waves[0].tasks.push(task("One more"));
  fs.writeFileSync(path.join(p.pm, "state", "waves.json"), JSON.stringify(W));
  const second = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(second.code, 0, second.error + second.output);
  assert.match(p.rm("branch", "--list", `nosy/roadmap-${today}-2`), /roadmap/);
});

test("no origin remote: it says so and points at the preview", () => {
  const p = product();
  p.g("remote", "remove", "origin");
  const r = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(r.code, 1);
  assert.match(r.output, /no `origin` remote.*pm\/state\/roadmap\.md/);
});

// ---- an open PR from an earlier run is updated, not duplicated ---------------------------------------------------------------------------
const calls = (p, verb) => (fs.existsSync(p.log) ? fs.readFileSync(p.log, "utf8") : "").split("\n").filter(l => l && l.startsWith(verb));
const PR99 = branch => [{ number: 99, headRefName: branch, url: "https://github.com/acme/widgets/pull/99" }, { number: 5, headRefName: "feature/x", url: "https://github.com/acme/widgets/pull/5" }];
const addTask = (p, wave, t) => { const W = JSON.parse(fs.readFileSync(path.join(p.pm, "state", "waves.json"), "utf8")); W.waves[wave].tasks.push(task(t)); fs.writeFileSync(path.join(p.pm, "state", "waves.json"), JSON.stringify(W)); };

test("an open Nosy roadmap PR is UPDATED: one commit on the current base, force-with-lease, 'Updated <url>', no second PR, no second branch", () => {
  const p = product(), branch = `nosy/roadmap-${today}`;
  assert.equal(run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env }).code, 0);
  p.put("open.json", PR99(branch));
  // The base moves on while the PR waits, and the roadmap changes.
  fs.writeFileSync(path.join(p.work, "OTHER.md"), "more work\n"); p.g("add", "."); p.g("commit", "-qm", "more work"); p.g("push", "-q", "origin", "main");
  addTask(p, 0, "One more thing");
  const before = p.rm("rev-parse", branch).trim();
  const r = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(r.code, 0, r.error + r.output);
  assert.match(r.output, /Updated https:\/\/github\.com\/acme\/widgets\/pull\/99/);
  assert.notEqual(p.rm("rev-parse", branch).trim(), before, "the branch moved");
  assert.equal(p.rm("rev-list", "--count", `main..${branch}`).trim(), "1", "one commit");
  p.rm("merge-base", "--is-ancestor", "main", branch); // exit 0: it sits on the current base
  assert.equal(p.rm("diff", "--name-only", "main", branch).trim(), "ROADMAP.md");
  assert.match(p.rm("show", `${branch}:ROADMAP.md`), /One more thing/);
  assert.equal(calls(p, "pr create").length, 1, "only the first run created a PR");
  assert.equal(calls(p, "pr edit").length, 1);
  assert.match(calls(p, "pr edit")[0], /^pr edit 99 --title Roadmap: update from Nosy .* -R acme\/widgets/);
  assert.equal(p.rm("branch", "--list", `nosy/roadmap-${today}-2`).trim(), "", "no second branch");
  assert.equal(execFileSync("git", ["-C", p.work, "branch", "--list", "nosy/*"], { encoding: "utf8" }).trim(), "", "no local branch left in the owner's repo");
  assert.match(calls(p, "pr list").join("\n"), /pr list --state open --json number,headRefName,url/);
  // Same roadmap again: nothing to push.
  const sha = p.rm("rev-parse", branch).trim(), again = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(again.code, 0); assert.match(again.output, /already has this roadmap: nothing to update/);
  assert.equal(p.rm("rev-parse", branch).trim(), sha);
  assert.equal(calls(p, "pr edit").length, 1);
});

test("the block is already on the base and an old PR is open: it says the PR is now empty and closes nothing", () => {
  const p = product(), branch = `nosy/roadmap-${today}`;
  assert.equal(run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env }).code, 0);
  p.g("fetch", "-q", "origin"); p.g("merge", "-q", "--ff-only", `origin/${branch}`); p.g("push", "-q", "origin", "main");
  p.put("open.json", PR99(branch));
  const sha = p.rm("rev-parse", branch).trim(), r = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /already has this roadmap, so https:\/\/github\.com\/acme\/widgets\/pull\/99 is now empty\. Nosy never closes a PR/);
  assert.equal(p.rm("rev-parse", branch).trim(), sha);
  assert.equal(calls(p, "pr create").length, 1);
  assert.equal(calls(p, "pr edit").length, 0);
  assert.ok(!calls(p, "").some(l => /^pr (close|merge|ready)/.test(l)), "no PR is ever closed or merged");
});

test("an open PR from another branch, or a roadmap PR whose branch is gone from origin, is not Nosy's to update: a new PR opens", () => {
  const p = product();
  p.put("open.json", [{ number: 7, headRefName: "feature/x", url: "https://github.com/acme/widgets/pull/7" }, { number: 8, headRefName: "nosy/roadmap-2020-01-01", url: "https://github.com/acme/widgets/pull/8" }]);
  const r = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Opened https:\/\/github\.com\/acme\/widgets\/pull\/99/);
  assert.equal(calls(p, "pr edit").length, 0);
});

test("gh can't list the open PRs: it stops before pushing anything, so a second PR is never opened by mistake", () => {
  const p = product();
  p.put("open.fail", "HTTP 401: Bad credentials");
  const r = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(r.code, 1);
  assert.match(r.output, /couldn't ask GitHub for the open pull requests \(HTTP 401: Bad credentials\).*Nothing was pushed/);
  assert.equal(p.rm("branch", "--list", "nosy/*").trim(), "");
});

// ---- the JSON a dashboard reads ------------------------------------------------------------------------------------------------------------------
test("pm/state/roadmap.json has exactly the agreed shape, only the block's public fields; --json copies it", () => {
  const p = product(); p.put("merged.json", [{ number: 40, title: "Add CSV export", mergedAt: new Date().toISOString() }]);
  const copy = path.join(p.root, "copy.json"), r = run(ROADMAP, [p.pm, "--json", copy], { env: p.env });
  assert.equal(r.code, 0, r.error + r.output);
  const raw = fs.readFileSync(path.join(p.pm, "state", "roadmap.json"), "utf8"), J = JSON.parse(raw);
  assert.deepEqual(Object.keys(J), ["type", "generated", "path", "sections", "hidden"]);
  assert.equal(J.type, "roadmap"); assert.equal(J.path, "ROADMAP.md"); assert.ok(!isNaN(Date.parse(J.generated)) && /^\d{4}-\d\d-\d\dT/.test(J.generated));
  assert.deepEqual(Object.keys(J.sections), ["now", "next", "later", "shipped"]);
  assert.deepEqual(J.sections.now[0], { title: "Export to CSV", ref: "#12", url: "https://github.com/acme/widgets/issues/12" });
  assert.deepEqual(J.sections.now[1], { title: "Single sign-on", ref: null, url: null }, "a decision ref (K77) never leaves the repo");
  assert.deepEqual(J.sections.shipped, [{ title: "Add CSV export", ref: "#40", url: "https://github.com/acme/widgets/pull/40", date: today }]);
  for (const k of ["now", "next", "later"]) for (const i of J.sections[k]) assert.deepEqual(Object.keys(i), ["title", "ref", "url"]);
  assert.deepEqual(Object.keys(J.sections.shipped[0]), ["title", "ref", "url", "date"]);
  assert.deepEqual(J.hidden, { now: 0, next: 0, later: 0 });
  for (const secret of ["Acme asked", "ada@example.test", "secret-path", "reason", "score", "effort"]) assert.ok(!raw.includes(secret), secret);
  assert.equal(fs.readFileSync(copy, "utf8"), raw);
  assert.deepEqual(jsonOf({ now: [], next: [], later: [], shipped: [] }, { now: 0, path: "docs/R.md" }), { type: "roadmap", generated: "1970-01-01T00:00:00.000Z", path: "docs/R.md", sections: { now: [], next: [], later: [], shipped: [] }, hidden: { now: 0, next: 0, later: 0 } });
});

test("the hidden counts reach the JSON when a section is cut", () => {
  const many = { waves: [{ name: "Now", tasks: Array.from({ length: 10 }, (_, i) => task(`Item ${String.fromCharCode(97 + i)}`)) }] };
  const p = product({ waves: many, roadmap: { max: { now: 3 } } });
  assert.equal(run(ROADMAP, [p.pm], { env: p.env }).code, 0);
  const J = JSON.parse(fs.readFileSync(path.join(p.pm, "state", "roadmap.json"), "utf8"));
  assert.equal(J.sections.now.length, 3); assert.deepEqual(J.hidden, { now: 7, next: 0, later: 0 });
  assert.match(fs.readFileSync(path.join(p.pm, "state", "roadmap.md"), "utf8"), /### Now\n\n- Item a\n- Item b\n- Item c\n\n_…and 7 more_\n/);
});

test("the privacy scan reads the JSON too: a finding that is only in the JSON stops it", () => {
  const p = product();
  assert.equal(scan("### Now\n\n- A\n", p.pm, JSON.stringify({ a: "fine" })).ok, true);
  assert.equal(scan("### Now\n\n- A\n", p.pm, JSON.stringify({ a: "jane.doe@customer.test" })).ok, false);
});

// ---- language ------------------------------------------------------------------------------------------------------------------------------------
const slots = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
const flat = (o, prefix = "") => Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);

test("the language files carry the same phrases with the same {slots}", () => {
  const en = flat(phrases("en")), tr = flat(phrases("tr"));
  assert.deepEqual(tr.map(([k]) => k), en.map(([k]) => k), "tr has the same keys as en, in the same order");
  for (const [k, v] of en) assert.equal(slots(tr.find(x => x[0] === k)[1]), slots(v), `slots of ${k}`);
  assert.deepEqual(en.map(([k]) => k), ["sections.now", "sections.next", "sections.later", "sections.shipped", "built", "sources.evidence", "sources.github", "sources.both", "more", "empty"]);
});

test("Turkish: headings and sentences come from the language file; the marker comments stay English", () => {
  const M = model({ waves: { waves: [{ name: "Now", tasks: [task("A"), task("B"), task("C")] }, { name: "Open requests", tasks: [task("D")] }] }, cfg: configOf({ roadmap: { max: { now: 1 } } }), merged: [{ number: 1, title: "Done", mergedAt: new Date().toISOString() }] });
  const block = render(M, { day: "2026-10-03", P: phrases("tr"), source: "github" });
  assert.ok(block.startsWith(HEAD) && block.endsWith(FOOT));
  for (const w of ["### Şimdi", "### Daha sonra", "### Yakın zamanda çıkanlar", "_…ve 2 tane daha_", "tarihinde oluşturuldu", "GitHub etiketleri"]) assert.ok(block.includes(w), w);
  assert.ok(!/### (Now|Later|Shipped)|and 2 more|Built from/.test(block));
  assert.match(render(model({ waves: { waves: [] }, cfg: configOf({}) }), { day: "2026-10-03", P: phrases("tr") }), /Henüz planlanmış ya da çıkmış bir şey yok\./);
  assert.match(render(model({ waves: { waves: [] }, cfg: configOf({}) }), { day: "2026-10-03" }), /Nothing is planned or shipped yet\./);
});

test("the language is --lang, else sources.json language, else English; an unknown one is English with one stderr line", () => {
  const tr = product({ language: "tr" });
  const a = run(ROADMAP, [tr.pm], { env: tr.env });
  assert.match(a.output, /### Şimdi\n\n- Export to CSV/); assert.equal(a.error, "");
  const b = run(ROADMAP, [tr.pm, "--lang", "en"], { env: tr.env });
  assert.match(b.output, /### Now\n\n- Export to CSV/, "--lang beats sources.json");
  const c = run(ROADMAP, [tr.pm, "--lang", "xx"], { env: tr.env });
  assert.equal(c.code, 0); assert.match(c.output, /### Now\n/);
  assert.equal(c.error.trim().split("\n").length, 1);
  assert.match(c.error, /no phrases for language "xx" yet \(skill\/data\/lang\/xx\/roadmap\.json\); using English/);
  const d = product({ language: "Turkish" }), e = run(ROADMAP, [d.pm], { env: d.env });
  assert.match(e.output, /### Now/); assert.match(e.error, /no phrases for language "Turkish"/);
  // The same file is the one the Turkish PR carries: block headings differ, the markers don't.
  assert.match(fs.readFileSync(path.join(tr.pm, "state", "roadmap.md"), "utf8"), /^<!-- nosy:roadmap -->\n> /);
});

// ---- GitHub-curated sources (read-only; gh is injected or a fake on PATH) --------------------------------------------------------------------------
const KR = { issue: { repo: "acme/widgets" } }, issueUrl = n => `https://github.com/acme/widgets/issues/${n}`;
const gi = (number, title) => ({ number, title, url: issueUrl(number) });
const flag = (a, k) => a[a.indexOf(k) + 1];

test("labels: the open issues carrying a roadmap label become items, read with gh issue list", () => {
  const seen = [], answers = { "roadmap:now": [gi(7, "Ship   CSV export")], "roadmap:next": [gi(8, "Audit log")] };
  const gh = a => { seen.push(a); return JSON.stringify(answers[flag(a, "--label")] || []); };
  const R = readGithub(KR, configOf({ roadmap: { source: "github", labels: { now: "roadmap:now", next: "roadmap:next", later: "roadmap:later" } } }), { gh });
  assert.deepEqual(R.warnings, []);
  assert.deepEqual(R.sections, { now: [{ title: "Ship CSV export", ref: "#7", url: issueUrl(7) }], next: [{ title: "Audit log", ref: "#8", url: issueUrl(8) }], later: [] });
  assert.deepEqual(seen[0], ["issue", "list", "-R", "acme/widgets", "--state", "open", "--label", "roadmap:now", "--json", "number,title,url", "--limit", "100"]);
  assert.equal(seen.length, 3);
});

test("milestones: soonest due date = Now, the next = Next, the rest and the undated = Later, with their open issues", () => {
  const seen = [];
  const MS = [{ title: "v3", due_on: "2027-01-01T00:00:00Z" }, { title: "Someday", due_on: null }, { title: "v1", due_on: "2026-11-01T00:00:00Z" }, { title: "v2", due_on: "2026-12-01T00:00:00Z" }, { title: "Empty", due_on: "2027-05-01T00:00:00Z" }];
  const items = { v1: [gi(1, "First")], v2: [gi(2, "Second"), gi(3, "Third")], v3: [gi(4, "Fourth")], Someday: [gi(5, "Maybe")], Empty: [] };
  const gh = a => { seen.push(a); return JSON.stringify(a[0] === "api" ? MS : items[flag(a, "--milestone")]); };
  const R = readGithub(KR, configOf({ roadmap: { source: "github", milestones: true } }), { gh });
  assert.deepEqual(R.sections.now.map(i => i.title), ["First"]);
  assert.deepEqual(R.sections.next.map(i => i.title), ["Second", "Third"]);
  assert.deepEqual(R.sections.later.map(i => i.title), ["Fourth", "Maybe"], "dated ones first, the undated last");
  assert.deepEqual(seen[0], ["api", "repos/acme/widgets/milestones?state=open&per_page=100"]);
  assert.deepEqual(seen[1], ["issue", "list", "-R", "acme/widgets", "--state", "open", "--milestone", "v1", "--json", "number,title,url", "--limit", "100"]);
  const only = readGithub(KR, configOf({ roadmap: { source: "github", milestones: true } }), { gh: a => JSON.stringify(a[0] === "api" ? [{ title: "Undated" }] : [gi(9, "Nine")]) });
  assert.deepEqual([only.sections.now, only.sections.next, only.sections.later.map(i => i.title)], [[], [], ["Nine"]], "no dated milestone: everything is Later");
});

const node = (status, content, extra = {}) => ({ status: status && { name: status }, content, isArchived: false, ...extra });
const iss = (number, title, over = {}) => ({ __typename: "Issue", number, title, url: issueUrl(number), state: "OPEN", repository: { nameWithOwner: "acme/widgets", isPrivate: false }, ...over });
const PAGE = { data: { organization: { projectV2: { items: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [
  node("In progress", iss(1, "Building now")), node("Todo", iss(2, "Closed already", { state: "CLOSED" })),
  node("Ready", iss(3, "Secret repo thing", { repository: { nameWithOwner: "acme/private-stuff", isPrivate: true } })),
  node("Backlog", { __typename: "DraftIssue", title: "An idea" }), node("In progress", null), node("Done", iss(4, "Finished")), node("Todo", iss(5, "Archived one"), { isArchived: true }),
  node("Todo", iss(6, "Elsewhere", { url: "https://github.com/acme/other/issues/6", repository: { nameWithOwner: "acme/other", isPrivate: false } })), node(null, iss(7, "No status")),
  node("in progress", { __typename: "PullRequest", title: "A PR" }), node("ready", iss(8, "Lower-case status"))] } } } } };
const PAGE2 = { data: { organization: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node("Backlog", iss(9, "Second page"))] } } } } };
const PROJECT = { source: "github", project: { owner: "acme", number: 3, type: "organization", status: { now: ["In progress"], next: ["Todo", "Ready"], later: ["Backlog"] } } };

test("project: a Projects v2 board is read with gh api graphql (Status field, 100 a page); closed, archived, redacted, private-repo and unmapped items stay off", () => {
  const seen = [];
  const gh = a => { seen.push(a); return JSON.stringify(a.some(x => x === "after=c1") ? PAGE2 : PAGE); };
  const R = readGithub(KR, configOf({ roadmap: PROJECT }), { gh });
  assert.deepEqual(R.warnings, []);
  assert.deepEqual(R.sections.now, [{ title: "Building now", ref: "#1", url: issueUrl(1) }]);
  assert.deepEqual(R.sections.next, [{ title: "Elsewhere", ref: null, url: null }, { title: "Lower-case status", ref: "#8", url: issueUrl(8) }], "another repo's issue: title only, no #N that would point at the wrong issue");
  assert.deepEqual(R.sections.later, [{ title: "An idea", ref: null, url: null }, { title: "Second page", ref: "#9", url: issueUrl(9) }]);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].slice(0, 2), ["api", "graphql"]);
  const q = flag(seen[0], "-f").replace(/^query=/, "");
  assert.match(q, /organization\(login:\$owner\)\{ projectV2\(number:\$number\)\{ items\(first:100,after:\$after\)/);
  assert.match(q, /fieldValueByName\(name:\$field\)/);
  assert.ok(seen[0].includes("field=Status"), "the field is a variable, not text pasted into the query");
  assert.match(q, /\.\.\. on Issue\{ number title url state repository\{ nameWithOwner isPrivate \} \} \.\.\. on DraftIssue\{ title \}/);
  assert.ok(seen[0].includes("owner=acme") && seen[0].includes("number=3") && !seen[0].some(x => /^after=/.test(x)));
  assert.ok(seen[1].includes("after=c1"));
  assert.ok(!/mutation/i.test(q));
  // A user's board asks `user(login:`.
  const u = []; readGithub(KR, configOf({ roadmap: { ...PROJECT, project: { ...PROJECT.project, type: "user" } } }), { gh: a => { u.push(a); return JSON.stringify({ data: { user: { projectV2: { items: { pageInfo: { hasNextPage: false }, nodes: [] } } } } }); } });
  assert.match(flag(u[0], "-f"), /user\(login:\$owner\)/);
});

test("project: at most 300 items (three pages) are read, and it says so", () => {
  let n = 0;
  const gh = () => { n++; return JSON.stringify({ data: { organization: { projectV2: { items: { pageInfo: { hasNextPage: true, endCursor: `c${n}` }, nodes: [node("In progress", iss(n, `Item ${n}`))] } } } } }); };
  const R = readGithub(KR, configOf({ roadmap: PROJECT }), { gh });
  assert.equal(n, 3); assert.equal(R.sections.now.length, 3);
  assert.match(R.warnings.join("\n"), /more than 300 items; only the first 300 were read/);
});

test("project: a missing read:project scope says exactly that, what to run, and the block falls back to the evidence only", () => {
  const scope = Object.assign(new Error("Command failed"), { stderr: "gh: Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes.\n" });
  const R = readGithub(KR, configOf({ roadmap: PROJECT }), { gh: () => { throw scope; } });
  assert.equal(R.sections, null);
  assert.equal(R.warnings.length, 1);
  assert.match(R.warnings[0], /^Psst… roadmap\.project: the GitHub token can't read Projects \(missing the read:project scope\)\. Run `gh auth refresh -s read:project`, then run this again\. Using the evidence only\.$/);
  // The same through a GraphQL error that came back with exit 0.
  const J = readGithub(KR, configOf({ roadmap: PROJECT }), { gh: () => JSON.stringify({ data: null, errors: [{ type: "INSUFFICIENT_SCOPES", message: "Your token has not been granted the required scopes ... read:project" }] }) });
  assert.match(J.warnings[0], /missing the read:project scope/);
});

test("project: not found, no gh, and a label that can't be read each say what happened; nothing is ever half-read", () => {
  const nf = readGithub(KR, configOf({ roadmap: PROJECT }), { gh: () => { throw Object.assign(new Error("x"), { stderr: "gh: Could not resolve to an Organization with the login of 'acme'.\n" }); } });
  assert.equal(nf.sections, null); assert.match(nf.warnings[0], /no organization project #3 for "acme" was found, or the token can't see it\. .*gh auth refresh -s read:project.*Using the evidence only\./);
  assert.match(readGithub(KR, configOf({ roadmap: PROJECT }), { gh: () => JSON.stringify({ data: { organization: { projectV2: null } } }) }).warnings[0], /no organization project #3/);
  const none = readGithub(KR, configOf({ roadmap: PROJECT }), { gh: () => { throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }); } });
  assert.match(none.warnings[0], /gh couldn't read project #3 of acme \(gh isn't installed\)\. Check `gh auth status`\. Using the evidence only\./);
  // Labels: the first read fine, the second fails: the whole curated set is dropped, with a line saying so.
  let k = 0;
  const part = readGithub(KR, configOf({ roadmap: { source: "both", labels: { now: "a", next: "b" } } }), { gh: () => { if (k++) throw Object.assign(new Error("x"), { stderr: "HTTP 502\n" }); return "[]"; } });
  assert.equal(part.sections, null); assert.match(part.warnings[0], /roadmap\.labels: couldn't list the open issues labelled "b" in acme\/widgets \(HTTP 502\)\. Using the evidence only\./);
  assert.match(readGithub(KR, configOf({ roadmap: { source: "github" } }), { gh: () => "[]" }).warnings[0], /no roadmap\.labels, roadmap\.milestones or roadmap\.project is set/);
  assert.match(readGithub({}, configOf({ roadmap: { source: "github", labels: { now: "a" } } }), { gh: () => "[]" }).warnings[0], /need `issue\.repo`/);
});

test("source: evidence is today's behaviour, github is only what was curated, both lets a curated item decide its own section", () => {
  const cur = { now: [{ title: "Audit log", ref: null, url: null }], next: [], later: [{ title: "Export to CSV", ref: "#12", url: issueUrl(12) }] };
  const lines = (src, over = {}) => { const m = model({ waves: WAVES, cfg: configOf({ roadmap: { source: src, ...over } }), repoUrl: "https://github.com/acme/widgets", curated: src === "evidence" ? null : cur }); return { now: m.now.map(i => i.title), next: m.next.map(i => i.title), later: m.later.map(i => i.title) }; };
  assert.deepEqual(lines("evidence"), { now: ["Export to CSV", "Single sign-on", "Team invites"], next: ["Audit log"], later: ["Dark mode"] });
  assert.deepEqual(lines("github"), { now: ["Audit log"], next: [], later: ["Export to CSV"] });
  assert.deepEqual(lines("both"), { now: ["Audit log", "Single sign-on", "Team invites"], next: [], later: ["Export to CSV", "Dark mode"] }, "Audit log: evidence said Next, the board says Now; Export to CSV (#12): evidence said Now, the board says Later");
  assert.deepEqual(lines("github", { skip: ["audit"] }).now, [], "skip applies to curated items too");
  assert.equal(configOf({ roadmap: { source: "nonsense" } }).source, "evidence");
});

test("e2e: source github needs no waves; the block says where it came from; the curated items reach the JSON", () => {
  const p = product({ roadmap: { source: "github", labels: { now: "roadmap:now", later: "roadmap:later" } } });
  fs.rmSync(path.join(p.pm, "state", "waves.json"));
  p.put("issues-roadmap_now.json", [gi(7, "Ship CSV export")]); p.put("issues-roadmap_later.json", [gi(8, "Dark mode")]);
  const r = run(ROADMAP, [p.pm], { env: p.env });
  assert.equal(r.code, 0, r.error + r.output); assert.equal(r.error, "");
  assert.match(r.output, /Built from the team's GitHub labels, milestones and project board by \[Nosy\]/);
  assert.match(r.output, /### Now\n\n- Ship CSV export \(\[#7\]\(https:\/\/github\.com\/acme\/widgets\/issues\/7\)\)\n\n### Later\n\n- Dark mode/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.pm, "state", "roadmap.json"), "utf8")).sections.now, [{ title: "Ship CSV export", ref: "#7", url: issueUrl(7) }]);
  assert.ok(calls(p, "issue list").every(l => /--state open/.test(l)), "only open issues");
});

test("e2e: a board gh can't read: the message on stderr, the evidence-only block on stdout, exit 0; a PR carries the note", () => {
  const p = product({ roadmap: { source: "both", project: { owner: "acme", number: 3 } } });
  p.put("graphql.fail", "gh: Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'].");
  const r = run(ROADMAP, [p.pm], { env: p.env });
  assert.equal(r.code, 0, r.error);
  assert.match(r.error, /Psst… roadmap\.project: the GitHub token can't read Projects \(missing the read:project scope\)\. Run `gh auth refresh -s read:project`/);
  assert.match(r.output, /Built from the team's evidence by/);
  assert.match(r.output, /### Now\n\n- Export to CSV/);
  const pr = run(ROADMAP, [p.pm, "--pr", "--yes"], { env: p.env });
  assert.equal(pr.code, 0, pr.error + pr.output);
  assert.match(calls(p, "pr create")[0], /\*\*Note\*\* - roadmap\.project: the GitHub token can't read Projects/);
});

test("--write <file>: the block goes into that file in the working tree, the rest of the file stays, nothing is committed, pushed or sent to gh", () => {
  const p = product({ roadmapFile: "# Our roadmap\n\nHand-written intro.\n" });
  const before = p.rm("rev-parse", "main").trim();
  const r = run(ROADMAP, [p.pm, "--write", "ROADMAP.md"], { env: p.env });
  assert.equal(r.code, 0, r.error);
  const text = fs.readFileSync(path.join(p.work, "ROADMAP.md"), "utf8");
  assert.match(text, /^# Our roadmap\n\nHand-written intro\./);
  assert.match(text, /<!-- nosy:roadmap -->[\s\S]*### Now\n\n- Export to CSV[\s\S]*<!-- \/nosy:roadmap -->/);
  assert.match(r.output, /Nothing is committed or pushed/);
  assert.equal(p.rm("rev-parse", "main").trim(), before, "origin did not move");
  assert.match(execFileSync("git", ["-C", p.work, "status", "--short"], { encoding: "utf8" }), /M ROADMAP\.md/, "left as an uncommitted edit");
  assert.equal(calls(p, "pr create").length, 0);
  const again = run(ROADMAP, [p.pm, "--write", "ROADMAP.md"], { env: p.env });
  assert.equal(fs.readFileSync(path.join(p.work, "ROADMAP.md"), "utf8").split("<!-- nosy:roadmap -->").length, 2, "a second run replaces the block, never doubles it" + again.error);
});

test("--write: a new file is created; a path outside the repo is refused and nothing is written", () => {
  const p = product();
  assert.equal(run(ROADMAP, [p.pm, "--write", "docs/PLAN.md"], { env: p.env }).code, 0);
  assert.match(fs.readFileSync(path.join(p.work, "docs", "PLAN.md"), "utf8"), /### Later/);
  const out = path.join(p.root, "escaped.md"), bad = run(ROADMAP, [p.pm, "--write", "../escaped.md"], { env: p.env });
  assert.equal(bad.code, 1); assert.match(bad.error, /outside the repo/); assert.equal(fs.existsSync(out), false);
});

test("GitHub is only read here: no issue, milestone or Project write anywhere in roadmap.mjs", () => {
  const code = fs.readFileSync(ROADMAP, "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /mutation|updateProjectV2|addProjectV2|deleteProjectV2|["']--method["']|["']-X["']|["']--input["']/i);
  assert.doesNotMatch(code, /["']issue["'],\s*["'](create|edit|close|reopen|comment|delete|transfer|lock|pin|develop)["']/);
  assert.doesNotMatch(code, /["']project["']|["']milestone["']\s*,\s*["'](create|edit|delete)/);
  assert.doesNotMatch(code, /["']api["'][^\n]*(POST|PATCH|PUT|DELETE)/);
  for (const [, verb] of code.matchAll(/\["pr", "(\w+)"/g)) assert.ok(["list", "create", "edit"].includes(verb), `pr ${verb}: only list, create and edit (Nosy's own PR), never close or merge`);
});

// ---- the Action ----------------------------------------------------------------------------------------------------------------------------------
const ROOT = path.resolve(Tool, "..", "..");
test("action.yml: a `roadmap` input (default false), a step after the loop that runs `roadmap --pr --yes` with the job's token, before the commit step", () => {
  const text = fs.readFileSync(path.join(ROOT, "action.yml"), "utf8");
  assert.match(text, /\n  roadmap:\n    description: "[^"\n]*contents: write[^"\n]*pull-requests: write[^"\n]*"\n    default: "false"\n/);
  assert.doesNotMatch(text, /\t/, "YAML takes spaces");
  const at = n => text.indexOf(`- name: Nosy · ${n}`);
  assert.ok(at("weekly") > 0 && at("roadmap pull request") > at("weekly") && at("commit pm/state") > at("roadmap pull request"), "weekly, then roadmap, then the commit of pm/state");
  const s = text.slice(at("roadmap pull request"), at("commit pm/state"));
  assert.match(s, /if: inputs\.roadmap == 'true'/);
  assert.match(s, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(s, /nosy\.mjs" roadmap --pr --yes/);
  assert.match(s, /GITHUB_STEP_SUMMARY/);
  assert.match(s, /K\.roadmap/, "needs a roadmap key in sources.json");
  // Every key at the top level is still there and every step still has a name and a shell.
  for (const k of ["name:", "description:", "inputs:", "outputs:", "runs:"]) assert.match(text, new RegExp(`^${k}`, "m"));
  for (const part of text.split(/\n    - name: /).slice(1)) assert.match(part, /\n      shell: bash\n/);
});

function runStep(p, extra = {}) {
  const lines = fs.readFileSync(path.join(ROOT, "action.yml"), "utf8").split("\n"), i = lines.findIndex(l => l.includes("- name: Nosy · roadmap pull request")), at = lines.findIndex((l, j) => j > i && /^ {6}run: \|$/.test(l));
  const body = []; for (let j = at + 1; j < lines.length && (/^ {8}/.test(lines[j]) || !lines[j].trim()); j++) body.push(lines[j].slice(8));
  const summary = path.join(p.root, "summary.md"); fs.writeFileSync(summary, "");
  const r = spawnSync("bash", ["-e", "-c", body.join("\n")], { cwd: p.work, encoding: "utf8", env: { ...process.env, ...p.env, NOSY_PM: "pm", GITHUB_ACTION_PATH: ROOT, GITHUB_STEP_SUMMARY: summary, ...extra } });
  return { ...r, summary: fs.readFileSync(summary, "utf8") };
}
test("action.yml: the roadmap step opens the PR and prints its URL in the job summary; without a `roadmap` key it skips with a notice", () => {
  const p = product({ roadmap: {} });
  const r = runStep(p);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.summary, /## Nosy roadmap\nhttps:\/\/github\.com\/acme\/widgets\/pull\/99\nOpened https:\/\/github\.com\/acme\/widgets\/pull\/99/);
  assert.equal(calls(p, "pr create").length, 1);
  // Next week: the PR is still open and the roadmap changed: the step updates it.
  p.put("open.json", PR99(`nosy/roadmap-${today}`)); addTask(p, 0, "Added after");
  const again = runStep(p);
  assert.equal(again.status, 0, again.stderr); assert.match(again.summary, /Updated https:\/\/github\.com\/acme\/widgets\/pull\/99/);
  const off = product(), skipped = runStep(off);
  assert.equal(skipped.status, 0); assert.match(skipped.stdout, /::notice::Nosy: roadmap is on, but pm\/sources\.json has no `roadmap` key; skipped/);
  assert.equal(calls(off, "pr create").length, 0);
  // A failing roadmap (no origin) is a warning, never a failed job.
  const bad = product({ roadmap: {} }); bad.g("remote", "remove", "origin");
  const w = runStep(bad); assert.equal(w.status, 0); assert.match(w.stdout, /::warning::Nosy roadmap: .*no `origin` remote/);
});

test("project.field: a board with its own Now / Next / Later field (Horizon) maps by those words; Status stays the default", () => {
  const board = { data: { organization: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
    node("Now", iss(1, "Doing it")), node("Next", iss(2, "Soon")), node("Later", iss(3, "Someday")), node("Todo", iss(4, "Status words mean nothing here")), node(null, iss(5, "No horizon yet")),
    node("Now", iss(6, "Done already", { state: "CLOSED" }))] } } } } };
  const seen = [];
  const R = readGithub(KR, configOf({ roadmap: { source: "github", project: { owner: "acme", number: 3, type: "organization", field: "Horizon" } } }), { gh: a => { seen.push(a); return JSON.stringify(board); } });
  assert.deepEqual([R.sections.now, R.sections.next, R.sections.later].map(s => s.map(i => i.title)), [["Doing it"], ["Soon"], ["Someday"]]);
  assert.ok(seen[0].includes("field=Horizon"));
  // An owner's own mapping still wins over the words.
  const own = readGithub(KR, configOf({ roadmap: { source: "github", project: { owner: "acme", number: 3, type: "organization", field: "Horizon", status: { now: ["Next"], next: ["Now"], later: [] } } } }), { gh: () => JSON.stringify(board) });
  assert.deepEqual([own.sections.now, own.sections.next].map(s => s.map(i => i.title)), [["Soon"], ["Doing it"]]);
  // No `field` at all: the Status field, with the old default words.
  assert.equal(configOf({ roadmap: PROJECT }).project.field, "Status");
});
