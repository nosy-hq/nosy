// cite-check.mjs: every file:line, quote, commit, and #ref in an answer checked against the repo (and, with
// --gh, GitHub) before the answer goes out. Throwaway repo; GitHub is a fake lookup; no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { check, extract, quoteWhere, fold, checkRefs, outsideIndex, outsideRootsOf } from "../tools/cite-check.mjs";

const CC = path.join(Tool, "cite-check.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function repo() {
  const root = temporary("nosy-cc-"); dirs.push(root);
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { env: ENV, encoding: "utf8" }).trim();
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  git("init", "-q", "-b", "main");
  put("PRODUCT.md", ["# Cargo", "", "- **Deadlines:** a deadline is never inferred; the rule table decides.", "- **Deployment:** SaaS is the product; on-prem is not the main road.", ""].join("\n"));
  put("apps/api/review/domain/review.go", Array.from({ length: 30 }, (_, i) => i === 19 ? "const MaxRows = 500 // one review, at most 500 rows" : `// line ${i + 1}`).join("\n") + "\n");
  put("apps/api/client/http/routes.go", "package http\n// GET /clients/{id}\n");
  put("apps/web/(home)/clients/page.tsx", "export default function Page() {}\n");
  put("docs/PLAN.md", "# Plan\n\n**Clients (owner, 13 Sep: \"not now\"):** `/clients/**` and team filters.\n");
  git("add", "."); git("commit", "-q", "-m", "init");
  fs.mkdirSync(path.join(root, "pm")); fs.writeFileSync(path.join(root, "pm", "sources.json"), JSON.stringify({ repo: root, issue: { repo: "cargo/cargo" } }));
  return { root, pm: path.join(root, "pm"), sha: git("rev-parse", "HEAD"), put };
}

test("fold: case, accents, dotted/dotless i and punctuation don't matter", () => {
  assert.equal(fold("İçtihat: ŞİMDİ yok!"), "ictihat simdi yok");
  assert.equal(fold("Iğdır"), "igdir");
});

test("file:line: a real one passes; a missing file, a wrong path, a line past the end each fail with why", () => {
  const r = repo();
  const R = check([
    "Rows cap at 500 (review.go:20).",
    "The handler is in get_client.go:23.",
    "Routes: api/review/http/routes.go:5.",
    "PRODUCT.md:40 says so.",
    "Page at apps/web/(home)/clients/page.tsx:1.",
  ].join("\n"), { repo: r.root });
  const why = R.problems.map(p => `${p.at} ${p.kind}`);
  assert.deepEqual(why, ["2 file", "3 path", "4 line"]);
  assert.match(R.problems[1].why, /files with that name: apps\/api\/client\/http\/routes\.go/);
  assert.match(R.problems[2].why, /PRODUCT\.md has 4 lines/);
  assert.equal(R.counts.cites, 5);
});

test("the answer's own parenthesis isn't part of the path; a (group)/ folder is", () => {
  const X = extract("Cap (apps/api/review/domain/review.go:20) and page (apps/web/(home)/clients/page.tsx:1).");
  assert.deepEqual(X.cites.map(c => c.file), ["apps/api/review/domain/review.go", "apps/web/(home)/clients/page.tsx"]);
});

test("quotes: word for word passes (case, accents, a suffix, a dropped aside); a translation fails", () => {
  const r = repo();
  const ok = check([
    'PRODUCT.md:3 "A deadline is never inferred".',
    '"MaxRows = 500" (apps/api/review/domain/review.go:20).',
    'docs/PLAN.md:3 "Clients: not now".',
  ].join("\n"), { repo: r.root });
  assert.deepEqual(ok.problems, [], JSON.stringify(ok.problems));
  assert.equal(ok.counts.quotes, 3);
  const bad = check('PRODUCT.md:3 "süre asla çıkarım değildir"', { repo: r.root });
  assert.equal(bad.problems.length, 1);
  assert.equal(bad.problems[0].kind, "quote");
  assert.match(bad.problems[0].why, /word for word, or drop the quotation marks/);
});

test("quotes: the right words at the wrong line say so; someone else's words aren't tied to a nearby citation", () => {
  const r = repo();
  const R = check('review.go:3 "at most 500 rows"', { repo: r.root });
  assert.equal(R.problems[0].kind, "quote-line");
  assert.match(R.problems[0].why, /fix the line number/);
  // The site's words, then a citation later in the sentence: not a quote of that file.
  const site = check('The site says "24/7 tracking, instantly" but the code has a rule table: PRODUCT.md:3.', { repo: r.root });
  assert.deepEqual(site.problems, []); assert.equal(site.counts.quotes, 0);
  // A citation, then a new sentence quoting something else.
  const next = check('Agent in PRODUCT.md:3. The site says "artificial intelligence" once.', { repo: r.root });
  assert.equal(next.counts.quotes, 0);
});

test("quotes: a parenthesis naming another source too turns a miss into a note, not a problem", () => {
  const r = repo();
  const R = check('Contact fields are left out on purpose: "needs new fields, nobody asked" (#378 comment; PRODUCT.md:3).', { repo: r.root });
  assert.deepEqual(R.problems, []);
  assert.equal(R.notes[0].kind, "quote-shared");
});

test("quoteWhere: in order and close together; parts split by … must all be there", () => {
  const L = ["alpha beta gamma", "delta epsilon"];
  assert.equal(quoteWhere(L, 1, 1, "beta … epsilon"), "near");
  assert.equal(quoteWhere(L, 1, 1, "epsilon beta"), "nowhere");
  assert.equal(quoteWhere(L, 1, 1, "N gamma"), "near", "a lone capital letter is a placeholder");
});

test("code spans: one identifier or a path isn't a quote; a phrase is", () => {
  const X = extract("`MaxRows` and `apps/api/review/domain/review.go:20` and `GET /clients/{id}` at review.go:20; review.go:20 `MaxRows = 400`");
  assert.deepEqual(X.quotes.map(q => q.text), ["MaxRows = 400"]);
});

test("commits: real ones pass, made-up ones fail, 'missing' ones stay missing, a commit named as a place is fine", () => {
  const r = repo();
  // A short hash counts as a commit only with both a letter and a digit (so "2026" or "deadbeef" never do); pick a
  // prefix that has both, or this test fails for the ~1 in 60 hashes whose first 9 characters are all digits.
  const short = [9, 10, 11, 12].map(n => r.sha.slice(0, n)).find(s => /[a-f]/.test(s) && /\d/.test(s)) || r.sha;
  const R = check([
    `Landed in ${short}.`,
    "Fixed in deadbee42.",
    "The backend fix ea9556d9c isn't in the repo.",
    `The flag ${short} is missing.`,
    `This file is not in ${short}.`,
  ].join("\n"), { repo: r.root });
  assert.deepEqual(R.problems.map(p => `${p.at} ${p.ref}`), ["2 deadbee42", `4 ${short}`]);
  assert.match(R.problems[1].why, /says it's missing, but the commit is in the repo/);
});

test("#refs: 'couldn't find' an existing PR, 'issue' for a PR, 'open' for a closed one; lists share their words", () => {
  const gh = { 377: { kind: "pr", state: "closed", merged: true, date: "2026-09-26", title: "official links" }, 378: { kind: "issue", state: "closed", date: "2026-09-28", title: "client page" },
    435: { kind: "issue", state: "open", date: "", title: "a" }, 441: { kind: "issue", state: "open", date: "", title: "b" } };
  const X = extract([
    "I couldn't find issue #377 on GitHub.",
    "Issue #377 is where it was decided.",
    "#378 is still open.",
    "#435, #441 are open.",
    "#394 is queued but has no design yet.",
  ].join("\n"));
  const R = checkRefs(X.refs, n => gh[n] ?? null, "cargo/cargo");
  assert.deepEqual(R.problems.map(p => `${p.at} ${p.ref}`), ["1 #377", "2 #377", "3 #378", "5 #394"]);
  assert.match(R.problems[0].why, /it exists: a pull request, merged 2026-09-26/);
  assert.match(R.problems[1].why, /not an issue/);
  assert.match(R.problems[2].why, /says open; it's an issue, closed/);
  assert.match(R.problems[3].why, /no #394 in cargo\/cargo/);
});

test("CLI: exit 2 with the problems listed; 0 when all hold; 1 when the answer can't be read; --gh needs a repo", () => {
  const r = repo(), bad = path.join(r.root, "bad.md"), good = path.join(r.root, "good.md");
  fs.writeFileSync(bad, 'Rule table: PRODUCT.md:3 "süre asla çıkarım değildir". Handler: get_client.go:23. See #377.\n');
  fs.writeFileSync(good, "Rows cap at 500 (review.go:20).\n");
  const out = run(CC, [r.pm, bad]);
  assert.equal(out.code, 2, out.error);
  assert.match(out.output, /Psst… 2 references in bad\.md don't hold up:/);
  assert.match(out.output, /1 #refs not checked \(add --gh\)/);
  const ok = run(CC, [r.pm, good]);
  assert.equal(ok.code, 0); assert.match(ok.output, /Every reference in good\.md holds up\.\nChecked 1 file:line/);
  assert.equal(run(CC, [r.pm, path.join(r.root, "nope.md")]).code, 1);
  assert.equal(run(CC, [path.join(r.root, "nopm"), good]).code, 1);
  const json = path.join(r.root, "out", "cc.json");
  run(CC, [r.pm, bad, "--json", json]);
  assert.equal(JSON.parse(fs.readFileSync(json, "utf8")).problems.length, 2);
});

// The hook: the check runs for the agent (Stop / SubagentStop on its last answer, PostToolUse on a written .md).
const HOOK = path.join(Tool, "..", "..", "hooks", "cite-check.mjs");
const hook = (input, env = {}) => run(HOOK, [], { input: JSON.stringify(input), env: { ...process.env, NOSY_CITE_GH: "0", ...env } });
test("hook, Stop: a made-up quote in the last answer sends the agent back once; a clean answer or a second stop goes through", () => {
  const r = repo();
  const bad = 'Deadlines: PRODUCT.md:3 "süre asla çıkarım değildir".';
  const out = hook({ hook_event_name: "Stop", cwd: r.root, last_assistant_message: bad });
  assert.equal(out.code, 0, out.error);
  const j = JSON.parse(out.output);
  assert.equal(j.decision, "block");
  assert.match(j.reason, /1 reference in your answer doesn't hold up[\s\S]*Fix or drop those lines/);
  assert.equal(hook({ hook_event_name: "Stop", cwd: r.root, last_assistant_message: bad, stop_hook_active: true }).output, "", "never loops");
  const good = "Rows cap at 500 (review.go:20).";
  assert.equal(hook({ hook_event_name: "SubagentStop", cwd: r.root, last_assistant_message: good }).output, "");
  assert.equal(hook({ hook_event_name: "Stop", cwd: r.root, last_assistant_message: bad }, { NOSY_NO_CITE_CHECK: "1" }).output, "", "off switch");
  // An option Claude Code exports as "false" must not shadow the env switch, and must not switch the check off.
  // (A fresh answer each time: the check asks once per answer, so an answer it already flagged stays quiet either way.)
  const optionFalse = { CLAUDE_PLUGIN_OPTION_DISABLE_CITE_CHECK: "false" }, r2 = repo();
  const bad2 = 'Deadlines: PRODUCT.md:3 "süre asla çıkarım değildir".';
  assert.equal(hook({ hook_event_name: "Stop", cwd: r2.root, last_assistant_message: bad2 }, { ...optionFalse, NOSY_NO_CITE_CHECK: "1" }).output, "", "option \"false\" + NOSY_NO_CITE_CHECK=1: still off");
  assert.equal(JSON.parse(hook({ hook_event_name: "Stop", cwd: r2.root, last_assistant_message: bad2 }, optionFalse).output).decision, "block", "option \"false\" alone: it still checks (the off run did not use up the answer)");
});

test("hook, Stop: it reads the answer from last_assistant_message and never opens a transcript; without the field it is silent", () => {
  const r = repo(), bad = 'Deadlines: PRODUCT.md:3 "süre asla çıkarım değildir".';
  // A transcript that would flag a problem if it were read, a directory (reading it throws) and a file that
  // could be a hidden transcript: none of them may be opened.
  const canary = path.join(r.root, "canary.jsonl");
  fs.writeFileSync(canary, [{ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: bad }] } }].map(x => JSON.stringify(x)).join("\n") + "\n");
  const dir = path.join(r.root, "transcript-dir"); fs.mkdirSync(dir);
  const before = fs.statSync(canary).atimeMs;
  const paths = { transcript_path: canary, agent_transcript_path: dir };
  assert.equal(hook({ hook_event_name: "Stop", cwd: r.root, ...paths }).output, "", "no last_assistant_message: silent, no fallback to the transcript");
  assert.equal(hook({ hook_event_name: "SubagentStop", cwd: r.root, ...paths }).output, "");
  assert.equal(hook({ hook_event_name: "Stop", cwd: r.root, ...paths, last_assistant_message: 42 }).output, "", "not a string: silent");
  assert.equal(hook({ hook_event_name: "Stop", cwd: r.root, ...paths, last_assistant_message: "Rows cap at 500 (review.go:20)." }).output, "", "a clean answer, with paths present");
  const flagged = hook({ hook_event_name: "SubagentStop", cwd: r.root, ...paths, last_assistant_message: bad });
  assert.equal(flagged.code, 0, flagged.error);
  assert.equal(JSON.parse(flagged.output).decision, "block", "the answer comes from the field, not from the canary file");
  assert.equal(fs.statSync(canary).atimeMs, before, "the canary transcript was not read");
  // Stronger than atime: the hook source has no transcript file access at all.
  const src = fs.readFileSync(HOOK, "utf8");
  assert.doesNotMatch(src, /(?:readFileSync|createReadStream|readFile|openSync)\([^)]*transcript/i);
  assert.doesNotMatch(src, /\binput\.(?:agent_)?transcript_path\b/);
});

test("hook, PostToolUse: a written .md with a wrong reference is flagged; code files, no pm/, nothing to check: silent", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, "answer.md"), "The handler is in get_client.go:23.\n");
  const j = JSON.parse(hook({ hook_event_name: "PostToolUse", tool_name: "Write", cwd: r.root, tool_input: { file_path: "answer.md" } }).output);
  assert.equal(j.decision, "block"); assert.match(j.reason, /answer\.md[\s\S]*get_client\.go[\s\S]*before you give it to the owner/);
  assert.equal(hook({ hook_event_name: "PostToolUse", tool_name: "Write", cwd: r.root, tool_input: { file_path: "apps/api/client/http/routes.go" } }).output, "");
  fs.writeFileSync(path.join(r.root, "plain.md"), "Nothing to check here.\n");
  assert.equal(hook({ hook_event_name: "PostToolUse", tool_name: "Write", cwd: r.root, tool_input: { file_path: "plain.md" } }).output, "");
  const elsewhere = temporary("nosy-cc-nopm-"); dirs.push(elsewhere);
  fs.writeFileSync(path.join(elsewhere, "a.md"), "get_client.go:23\n");
  assert.equal(hook({ hook_event_name: "PostToolUse", tool_name: "Write", cwd: elsewhere, tool_input: { file_path: "a.md" } }).output, "");
});

test("hook, PostToolUse: pm/ is found above the written file even when the agent works elsewhere", () => {
  const r = repo(), elsewhere = temporary("nosy-cc-cwd-"); dirs.push(elsewhere);
  fs.mkdirSync(path.join(r.root, "answers")); fs.writeFileSync(path.join(r.root, "answers", "q1.md"), "The handler is in get_client.go:23.\n");
  const j = JSON.parse(hook({ hook_event_name: "PostToolUse", tool_name: "Write", cwd: elsewhere, tool_input: { file_path: path.join(r.root, "answers", "q1.md") } }).output);
  assert.equal(j.decision, "block"); assert.match(j.reason, /get_client\.go/);
});

test("hook, PostToolUse Bash: an answer written from the shell (heredoc, tee) is checked; a command that only reads is not", () => {
  const r = repo();
  fs.mkdirSync(path.join(r.root, "answers"));
  execFileSync("sh", ["-c", `cat > answers/q1.md <<'X'\nThe handler is in get_client.go:23.\nX`], { cwd: r.root });
  const cmd = "cat > answers/q1.md <<'X'\nThe handler is in get_client.go:23.\nX";
  const j = JSON.parse(hook({ hook_event_name: "PostToolUse", tool_name: "Bash", cwd: r.root, tool_input: { command: cmd } }).output);
  assert.equal(j.decision, "block"); assert.match(j.reason, /q1\.md[\s\S]*get_client\.go/);
  execFileSync("sh", ["-c", "printf 'Rows cap at 500 (review.go:20).\\n' | tee answers/q2.md >/dev/null"], { cwd: r.root });
  assert.equal(hook({ hook_event_name: "PostToolUse", tool_name: "Bash", cwd: r.root, tool_input: { command: "printf '…' | tee answers/q2.md" } }).output, "", "a clean answer stays quiet");
  assert.equal(hook({ hook_event_name: "PostToolUse", tool_name: "Bash", cwd: r.root, tool_input: { command: "cat answers/q1.md" } }).output, "", "reading is not writing");
});

test("files outside the repo that sources.json points to are real: bare names resolve, and their line numbers are still checked", () => {
  const r = repo(), side = temporary("nosy-cc-side-"); dirs.push(side);
  fs.writeFileSync(path.join(side, "matris.json"), Array.from({ length: 20 }, (_, i) => `{"row": ${i}}`).join("\n") + "\n");
  const K = { repo: r.root, matrix: path.join(side, "matris.json") };
  const outside = outsideIndex(outsideRootsOf(K, r.pm));
  const ok = check("The matrix row is at matris.json:12.", { repo: r.root, outside });
  assert.deepEqual(ok.problems, [], JSON.stringify(ok.problems));
  const bad = check("The matrix row is at matris.json:120.", { repo: r.root, outside });
  assert.equal(bad.problems[0].kind, "line");
  assert.equal(check("The matrix row is at matris.json:12.", { repo: r.root }).problems[0].kind, "file", "without the setup's folders it's still unknown");
});

test("#refs: someone else's words about a ref (\"the matrix still lists #438 as open\") are not the answer's claim", () => {
  const gh = { 438: { kind: "pr", state: "closed", merged: true, date: "2026-09-28", title: "x" } };
  const X = extract(["The matrix still lists #438 as open.", "Matris #438 için hâlâ açık PR diyor.", "#438 is still open."].join("\n"));
  assert.deepEqual(checkRefs(X.refs, n => gh[n] ?? null, "cargo/cargo").problems.map(p => p.at), [3]);
});

test("hook: a file marked <!-- nosy: no-cite-check --> is skipped", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, "RUNBOOK.md"), "<!-- nosy: no-cite-check -->\nExample of a false alarm: get_client.go:23.\n");
  assert.equal(hook({ hook_event_name: "PostToolUse", tool_name: "Write", cwd: r.root, tool_input: { file_path: "RUNBOOK.md" } }).output, "");
});

// An answer that numbers its own rows ("Row #3", "tablo #2") was blocked by the Stop hook as "there's no #3 in the repo" (BlogFactory field test; the check's own author hit it twice).
test("a one-digit #N with no 'issue' or 'PR' beside it is a row number, not a GitHub reference; two digits, or the word, still check", () => {
  const none = text => checkRefs(extract(text).refs, () => null, "cargo/cargo").problems; // GitHub knows no such issue or PR
  assert.deepEqual(none("| Row | Note |\n| #3 | the third row |\nSee row #2 and step #7."), [], "ordinals are not references");
  assert.equal(none("This is tracked in issue #3.").length, 1, "with the word it is a reference, and it doesn't exist");
  assert.equal(none("Tracked in #42.").length, 1, "two digits are still checked");
  assert.equal(none("PR #5 fixed it.").length, 1, "PR #5 is a reference");
});
