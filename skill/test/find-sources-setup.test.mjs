// `setup` (find-sources.mjs) on repos of other shapes: which branch it reads, which folders it calls the frontend, and
// which glossary pairs it may write. Small fictional repos; gh is faked to fail so nothing touches the network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, fakeGhSetup, Tool } from "./helpers.mjs";

const copies = [];
const gh = fakeGhSetup({ fail: true });
after(() => { for (const k of copies) clean(k); clean(gh.dir); });
const FIND = path.join(Tool, "find-sources.mjs");

// A clone with a bare origin. branches: { name: { commits, when } } made in order; `head` is origin's default branch.
function repoWithOrigin({ head, branches, files = { "README.md": "# Fictional\n" } }) {
  const root = temporary("nosy-setup-branch-"); copies.push(root);
  const bare = path.join(root, "origin.git"), work = path.join(root, "work");
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const g = (cwd, ...a) => execFileSync("git", a, { cwd, env, stdio: "ignore" });
  fs.mkdirSync(bare); g(bare, "init", "-q", "--bare", "-b", head);
  fs.mkdirSync(work); g(work, "init", "-q", "-b", head);
  g(work, "remote", "add", "origin", bare);
  for (const [rel, content] of Object.entries(files)) { const p = path.join(work, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
  g(work, "add", "-A"); execFileSync("git", ["commit", "-q", "-m", "start"], { cwd: work, env: { ...env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z" }, stdio: "ignore" });
  g(work, "push", "-q", "origin", head);
  for (const [name, { commits, when }] of Object.entries(branches)) {
    g(work, "checkout", "-q", "-b", name, head);
    for (let i = 0; i < commits; i++) execFileSync("git", ["commit", "-q", "--allow-empty", "-m", `work ${i}`], { cwd: work, env: { ...env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when }, stdio: "ignore" });
    g(work, "push", "-q", "origin", name);
  }
  g(work, "checkout", "-q", head); g(work, "fetch", "-q", "origin"); g(work, "remote", "set-head", "origin", head);
  return work;
}
const setup = repo => { const j = path.join(temporary("nosy-setup-json-"), "s.json"); copies.push(path.dirname(j));
  const r = run(FIND, [repo, "--pm", path.join(repo, "pm"), "--json", j], { env: gh.env }); assert.equal(r.code, 0, r.error); return { md: r.output, json: JSON.parse(fs.readFileSync(j, "utf8")) }; };

test("default branch is master but dev is ahead and newer: setup reads origin/dev and says how to change it", () => {
  const { md, json } = setup(repoWithOrigin({ head: "master", branches: { dev: { commits: 3, when: "2026-09-01T00:00:00Z" } } }));
  assert.equal(json.ref, "origin/dev");
  assert.match(md, /\*\*Branch:\*\* read from `origin\/dev`, not the default branch `origin\/master`/);
  assert.match(md, /set `"ref": "origin\/master"` in sources\.json/);
});

test("develop exists but has nothing ahead of the default branch: the default stays, and the other name is mentioned", () => {
  const { md, json } = setup(repoWithOrigin({ head: "main", branches: { develop: { commits: 0, when: "2026-09-01T00:00:00Z" } } }));
  assert.equal(json.ref, "origin/main");
  assert.match(md, /\*\*Branch:\*\* read from `origin\/main`/);
  assert.match(md, /also present: origin\/develop \(0 commits ahead/);
});

test("the default branch is itself develop: it is kept", () => {
  const { json } = setup(repoWithOrigin({ head: "develop", branches: {} }));
  assert.equal(json.ref, "origin/develop");
});

test("a Rails-shaped repo gets its screen folders as the frontend (it used to be empty)", () => {
  const repo = repoWithOrigin({ head: "main", branches: {}, files: { "README.md": "# app\n", "config/routes.rb": "Rails.application.routes.draw {}\n", "app/javascript/dashboard/main.js": "export {};\n", "app/views/layouts/app.html.erb": "<html></html>\n", "app/models/user.rb": "class User; end\n" } });
  const { json } = setup(repo);
  assert.ok(json.suggestion.inventory.frontend.includes("app/javascript"), JSON.stringify(json.suggestion.inventory));
  assert.ok(json.suggestion.inventory.frontend.includes("app/views"));
});

test("glossary: a chat-product README gets no legal pair (file -> matter); nothing is written", () => {
  const { md, json } = setup(repoWithOrigin({ head: "main", branches: {}, files: { "README.md": "# Chat\nUpload a file to a conversation. It does not matter which file type: any file is a record of the message.\n" } }));
  assert.deepEqual(json.suggestion.glossary, {});
  assert.match(md, /nothing written: no vertical or language pack matched/);
});

test("glossary: the legal pack applies only when the docs carry its markers", () => {
  const { json } = setup(repoWithOrigin({ head: "main", branches: {}, files: { "README.md": "# Cases\nA law firm keeps each file (a matter) for a client. Muvekkil is the client; tebligat is a formal notice; an attorney handles both.\n" } }));
  assert.ok(json.suggestion.glossary.file?.includes("matter"), JSON.stringify(json.suggestion.glossary));
  assert.ok(json.suggestion.glossary.tebligat?.includes("notice"));
});
