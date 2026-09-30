// canwe's guess must never contradict the evidence lines the same run printed. A real run on a public repo said
// "Not now: no trace in the backend" under code lines that showed a retry loop. Tiny fictional repo, no network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let root, pm;
const CANWE = path.join(Tool, "canwe.mjs");
const put = (f, s) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const verdictOf = o => (o.match(/## Suggested verdict[^\n]*\n\n\*\*(.*?)\*\*/) || [])[1];

before(() => {
  root = temporary("nosy-canwe-contradiction-");
  for (let i = 0; i < 30; i++) put(`src/other/f${i}.js`, `// filler ${i}\n`);
  put("src/hooks/deliver.js", "// deliver a hook once\nexport function deliver(url) { return post(url); }\nexport function retryLater(job) { return job.retry(3); }\n");
  put("src/mail.js", "// Retry loop for outbound mail\nexport const retryMail = () => {};\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main" }));
  // One endpoint that shares a single generic word with the question: a weak match, which used to end in "no trace".
  fs.writeFileSync(path.join(pm, "state", "inventory.json"), JSON.stringify({ backend_missing: false,
    endpoints: [{ method: "POST", path: "/api/hooks", file: "src/routes.js", line: 3, used: false, infrastructure: false, area: "api" }] }));
});
after(() => clean(root));

test("code lines for the topic never end in 'no trace in the backend': the guess says partly there and names the files", () => {
  const r = run(CANWE, [pm, "retry failed hooks"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /- src\/hooks\/deliver\.js:3 /, "the code lines are printed");
  const v = verdictOf(r.output);
  assert.match(v, /^Partly there: exists in src\/hooks\/deliver\.js/);
  assert.match(v, /missing: "failed" is in no code file; no endpoint in the inventory matches strongly/);
  assert.doesNotMatch(r.output, /\*\*Not now: no trace in the backend\*\*/);
  assert.match(r.output, /The judgement of what exists and what is missing is the agent's/);
});

test("when the code has no trace either, the plain 'no trace' verdict stays", () => {
  const r = run(CANWE, [pm, "Can we show a hologram preview?"]);
  assert.equal(verdictOf(r.output), "Not now: no trace in the code");
});
