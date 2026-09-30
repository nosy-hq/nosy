// The top user-facing failures (no git repo, no pm/, unreadable sources.json, a repo or branch that isn't there, gh missing or
// signed out, no network, empty repo, a mistyped command) each say what to do next, in one line, and never end in a raw
// Node stack trace. hints.mjs holds the wording; these run the real commands in temp folders. No network (a closed
// localhost port stands in for "unreachable").
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { advice, cleanTrace, closest, netError, repoProblem, sourcesProblem } from "../tools/hints.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const tmp = (p = "nosy-fail-") => { const d = temporary(p); dirs.push(d); return d; };
const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=n", ...a], { encoding: "utf8" });
const nosy = (cwd, args, env = {}) => run(NOSY, args, { cwd, env: { ...process.env, ...env } });
const both = r => `${r.output}\n${r.error}`;
const noTrace = r => assert.doesNotMatch(both(r), /node:internal|^\s+at .*:\d+:\d+/m, "no Node stack trace");
// A product with one commit and a proposed pm/sources.json.
function product() {
  const d = tmp("nosy-fail-prod-"); git(d, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(d, "README.md"), "# x\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "feat(x): first");
  assert.equal(nosy(d, ["setup", "."]).code, 0);
  return d;
}
const setSources = (d, f) => { const p = path.join(d, "pm", "sources.json"), K = JSON.parse(fs.readFileSync(p, "utf8")); f(K); fs.writeFileSync(p, JSON.stringify(K, null, 1)); };
// A PATH holding only node and git, so `gh` is not installed; or also a fake gh that says it isn't signed in.
function bin({ gh = null } = {}) {
  const b = tmp("nosy-bin-");
  fs.symlinkSync(process.execPath, path.join(b, "node"));
  fs.symlinkSync(spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim(), path.join(b, "git"));
  if (gh) { fs.writeFileSync(path.join(b, "gh"), `#!/bin/sh\necho "${gh}" >&2\nexit 4\n`); fs.chmodSync(path.join(b, "gh"), 0o755); }
  return b;
}

test("advice: each known raw failure maps to a one-line next step with the command or link", () => {
  const cases = [
    ["Error: spawnSync git ENOENT", /git isn't installed.*git-scm\.com\/downloads/],
    ["spawnSync gh ENOENT", /gh \(the GitHub CLI\) isn't installed.*cli\.github\.com.*gh auth login/],
    ["To get started with GitHub CLI, please run:  gh auth login", /gh isn't signed in: run `gh auth login`/],
    ["HTTP 401: Bad credentials", /gh isn't signed in/],
    ["API rate limit exceeded", /rate limit.*wait a few minutes/],
    ["GraphQL: Could not resolve to a Repository with the name 'a/b'", /`issue\.repo`.*owner\/name/],
    ["getaddrinfo ENOTFOUND api.github.com", /no network.*NOSY_OFFLINE=1/],
    ["fetch failed", /no network/],
    ["fatal: not a git repository (or any of the parent directories): .git", /isn't a git repo Nosy can read.*`repo` in pm\/sources\.json/],
    ["fatal: your current branch 'main' does not have any commits yet", /no commits yet.*git commit --allow-empty/],
    ["fatal: ambiguous argument 'nope': unknown revision or path not in the working tree.", /`ref`.*git branch -a.*git fetch/],
    ["fatal: ref refs/remotes/origin/HEAD is not a symbolic ref", /no `origin` to follow.*git remote set-head origin -a/],
    ["EACCES: permission denied, mkdir '/x'", /permission denied/],
    ["Unexpected token } in JSON at position 4", /typo.*move the file aside/],
  ];
  for (const [raw, re] of cases) assert.match(advice(raw), re, raw);
  assert.equal(advice("something nobody has seen"), null);
  assert.equal(advice(""), null);
});

test("cleanTrace: a raw crash becomes 'couldn't run: <cause>' plus the fix; a real message passes through as null", () => {
  const trace = "fatal: cannot change to '../nowhere': No such file or directory\nnode:internal/errors:983\n  const err = new Error(message);\n              ^\n\nError: Command failed: git -C ../nowhere log --since x\nfatal: cannot change to '../nowhere': No such file or directory\n\n    at genericNodeError (node:internal/errors:983:15)\n    at checkExecSyncError (node:child_process:891:11)\n";
  const c = cleanTrace(trace);
  assert.match(c, /^Psst… couldn't run: fatal: cannot change to '\.\.\/nowhere'/);
  assert.match(c, /isn't a git repo Nosy can read/);
  assert.doesNotMatch(c, /node:internal|genericNodeError/);
  assert.match(cleanTrace("Error: something odd\n    at foo (/x/y.mjs:1:2)\n"), /couldn't run: something odd\n.*nosy doctor --check/);
  assert.equal(cleanTrace("Psst… pm/sources.json is missing.\n"), null);
  assert.equal(cleanTrace(""), null);
});

test("netError and closest", () => {
  assert.match(netError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })), /no network or the host doesn't exist \(ENOTFOUND\)/);
  assert.match(netError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), /couldn't connect \(ECONNREFUSED\)/);
  assert.equal(netError({ name: "AbortError" }), "timed out");
  assert.match(netError(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("x"), { errors: [{ code: "ECONNREFUSED" }] }) })), /couldn't connect \(ECONNREFUSED\)/, "an AggregateError cause");
  const names = ["shipped", "peek", "psst", "setup", "doctor", "weekly"];
  assert.equal(closest("shiped", names), "shipped");
  assert.equal(closest("docter", names), "doctor");
  assert.equal(closest("zzzzzzzz", names), null);
});

test("sourcesProblem: no pm/, a pm/ without sources.json, an older Nosy's, a typo, a wrong shape; a good one is null", () => {
  const d = tmp(), pm = path.join(d, "pm");
  assert.match(sourcesProblem(pm), /no .*pm\/ folder here.*`nosy setup \.` \(or \/nosy:move-in in your agent\)/);
  fs.mkdirSync(pm);
  assert.match(sourcesProblem(pm), /sources\.json is missing\. Run `nosy setup \.`/);
  fs.writeFileSync(path.join(pm, "kaynaklar.json"), "{}");
  assert.match(sourcesProblem(pm), /older Nosy.*`nosy doctor --fix`/);
  fs.rmSync(path.join(pm, "kaynaklar.json"));
  fs.writeFileSync(path.join(pm, "sources.json"), "{ nope");
  assert.match(sourcesProblem(pm), /isn't valid JSON \(.*\)\. Fix that spot by hand.*`nosy doctor --check` says where/);
  fs.writeFileSync(path.join(pm, "sources.json"), "[]");
  assert.match(sourcesProblem(pm), /isn't a JSON object/);
  fs.writeFileSync(path.join(pm, "sources.json"), "{}");
  assert.equal(sourcesProblem(pm), null);
});

test("repoProblem: not a repo, no commits, a branch that isn't there, and the good case", () => {
  const d = tmp();
  assert.match(repoProblem({ repo: "nowhere" }, { cwd: d }), /`repo` in pm\/sources\.json \(nowhere\) isn't a git repo/);
  git(d, "init", "-q", "-b", "main");
  assert.match(repoProblem({ repo: "." }, { cwd: d }), /has no commits yet.*git commit --allow-empty/);
  fs.writeFileSync(path.join(d, "a"), "x"); git(d, "add", "-A"); git(d, "commit", "-qm", "one");
  assert.match(repoProblem({ repo: ".", ref: "trunk" }, { cwd: d }), /`ref` in pm\/sources\.json \(trunk\) isn't a branch or commit.*git branch -a/);
  assert.equal(repoProblem({ repo: ".", ref: "main" }, { cwd: d }), null);
  assert.equal(repoProblem({ repo: "." }, { cwd: d }), null);
});

test("1. no pm/ yet: every command that needs it says the setup command; exit 1", () => {
  const d = tmp();
  for (const c of ["shipped", "peek", "psst", "weekly", "canwe"]) {
    const r = nosy(d, c === "canwe" ? [c, "bulk export"] : [c]);
    assert.equal(r.code, 1, c);
    assert.match(r.error, /^Psst… no pm\/ folder here\. Run this from the product's folder .*`nosy setup \.` \(or \/nosy:move-in in your agent\)/, c);
  }
});

test("2. sources.json that doesn't parse says so (not 'missing') and where to look, for nosy and for the scripts run directly", () => {
  const d = tmp(); fs.mkdirSync(path.join(d, "pm")); fs.writeFileSync(path.join(d, "pm", "sources.json"), "{ bad");
  for (const args of [["psst"], ["find", "x"], ["never-check"], ["sweep"], ["check"]]) {
    const r = nosy(d, args);
    assert.equal(r.code, 1, args.join(" "));
    assert.match(both(r), /sources\.json isn't valid JSON \(.*\)\. Fix that spot by hand, or move the file aside and run `nosy setup \.`/, args.join(" "));
    assert.doesNotMatch(both(r), /is missing/, args.join(" "));
  }
  for (const f of ["facts.mjs", "cite-check.mjs", "nudge.mjs", "team-next.mjs", "undecided.mjs"]) {
    const r = run(path.join(Tool, f), f === "facts.mjs" ? ["pm", "find", "x"] : f === "cite-check.mjs" ? ["pm", "answer.md"] : ["pm"], { cwd: d });
    assert.equal(r.code, 1, f); assert.match(both(r), /isn't valid JSON/, f);
  }
});

test("3. a repo path that isn't a git repo, and 4. a branch that isn't there: one line with the fix, no stack trace", () => {
  const d = product();
  setSources(d, K => { K.repo = "../nowhere"; });
  for (const args of [["peek"], ["shipped"], ["notes"], ["psst"], ["find", "x"], ["recent"]]) {
    const r = nosy(d, args);
    assert.equal(r.code, 1, args.join(" ")); noTrace(r);
    assert.match(r.error, /`repo` in pm\/sources\.json \(\.\.\/nowhere\) isn't a git repo \(looked in .*nowhere\)\. Fix `repo` there, or run this from the product's folder\./, args.join(" "));
  }
  setSources(d, K => { K.repo = "."; K.ref = "nope"; });
  for (const args of [["peek"], ["shipped"], ["inventory"], ["canwe", "x"]]) {
    const r = nosy(d, args);
    assert.equal(r.code, 1, args.join(" ")); noTrace(r);
    assert.match(r.error, /`ref` in pm\/sources\.json \(nope\) isn't a branch or commit.*`git branch -a` lists them; fix `ref`, or `git fetch`/, args.join(" "));
  }
  // `check` is the one that reports it as a table row instead.
  assert.match(nosy(d, ["check"]).output, /nope doesn't resolve/);
});

test("5. an empty repo and 6. no git repo: setup says what to run", () => {
  const empty = tmp(); git(empty, "init", "-q", "-b", "main");
  const a = nosy(empty, ["setup", "."]);
  assert.equal(a.code, 1);
  assert.match(a.output, /No default branch found.*probably has no commits yet: make one \(`git commit --allow-empty -m start`\).*`git branch -m main`.*`nosy setup \.` again/);
  const plain = tmp();
  const b = nosy(plain, ["setup", "."]);
  assert.equal(b.code, 1);
  assert.match(b.output, /is not a git repo\. Run this inside the product's git folder .*`git init`/);
});

test("7. gh not installed: psst's warning says how to install it and that git-only commands still work", () => {
  const d = product(); setSources(d, K => { K.issue = { repo: "acme/widgets" }; });
  const r = nosy(d, ["psst"], { PATH: bin() });
  assert.equal(r.code, 0, r.error); noTrace(r);
  assert.match(r.output, /gh could not be read.*gh \(the GitHub CLI\) isn't installed: install it from https:\/\/cli\.github\.com and run `gh auth login`/);
  const s = nosy(d, ["shipped"], { PATH: bin() });
  assert.match(s.output, /explicit links not read\. gh \(the GitHub CLI\) isn't installed.*The record below still stands\./);
});

test("8. gh installed but signed out: psst and shipped say to run gh auth login", () => {
  const d = product(); setSources(d, K => { K.issue = { repo: "acme/widgets" }; });
  const env = { PATH: bin({ gh: "To get started with GitHub CLI, please run:  gh auth login" }) };
  const r = nosy(d, ["psst"], env);
  assert.match(r.output, /gh could not be read.*gh isn't signed in: run `gh auth login`/);
  assert.match(nosy(d, ["shipped"], env).output, /explicit links not read\. gh isn't signed in: run `gh auth login`/);
  const u = run(path.join(Tool, "undecided.mjs"), ["pm"], { cwd: d, env: { ...process.env, ...env } });
  assert.equal(u.code, 1); assert.match(u.error, /gh issue list failed for acme\/widgets.*\ngh isn't signed in/s);
});

// A localhost port nothing listens on (fetch refuses a few well-known ports outright, so 9 won't do).
const closedPort = () => new Promise(res => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

test("9. no network: publish says nothing was sent and what to check; a mistyped webhook says the same", async () => {
  const port = await closedPort();
  const d = product();
  fs.mkdirSync(path.join(d, "pm", "state"), { recursive: true });
  const r = nosy(d, ["publish", "--url", `http://127.0.0.1:${port}`, "--yes"], { NOSY_CLOUD_TOKEN: "test-token-not-real" });
  assert.equal(r.code, 1);
  assert.match(r.error, new RegExp(`couldn't reach http://127\\.0\\.0\\.1:${port}: couldn't connect \\(ECONNREFUSED\\)\\. Nothing was sent; check your connection \\(or --url / NOSY_CLOUD_URL\\) and run it again\\.`));
  assert.equal(nosy(d, ["peek"]).code, 0); // gives notify something to say
  const n = nosy(d, ["notify", "--slack", `http://127.0.0.1:${port}/hook`]);
  assert.equal(n.code, 1, n.error);
  assert.match(n.output, /Slack: failed \(no network, or the webhook URL is wrong or was revoked: check it, then run notify again; --dry-run prints the message\)/);
});

test("10. a mistyped command suggests the nearest; doctor and install name what to check", () => {
  const d = tmp();
  const r = nosy(d, ["shiped"]);
  assert.equal(r.code, 1);
  assert.equal(r.error.trim(), "Unknown command: shiped. Did you mean `nosy shipped`? `nosy help` lists them all.");
  assert.equal(nosy(d, ["zzzz"]).error.trim(), "Unknown command: zzzz. `nosy help` lists them all.");
  const doc = nosy(d, ["doctor"]);
  assert.equal(doc.code, 1);
  assert.match(doc.error, /no folder at pm\. Run this from the product's folder.*`nosy setup \.`.*`nosy doctor --check` checks the install itself\./);
  const ins = nosy(d, ["install", "--dir", path.join(d, "nope")]);
  assert.equal(ins.code, 1);
  assert.match(ins.error, /No folder at .*nope\. Check the path given to --dir/);
});
