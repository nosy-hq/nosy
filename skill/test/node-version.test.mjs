// The suite spawns `node` (and a fake `gh` whose shebang is `env node`) through PATH. If the runner is one Node and PATH
// resolves another, a run "on Node 18.17" quietly tests Node 22 in every child. This pins them to the same version, and
// checks the fake gh loads on this Node (it must be CommonJS: Node 18 cannot load an extensionless ES module).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fakeGhSetup, clean } from "./helpers.mjs";

const gh = fakeGhSetup({ repoView: { name: "acme" } });
after(() => clean(gh.dir));

test("`node` on PATH is the Node running the tests", t => {
  const r = spawnSync("node", ["-p", "process.version"], { encoding: "utf8" });
  t.diagnostic(`runner ${process.version}, spawned child ${r.stdout.trim()}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), process.version, "put the Node under test first on PATH for the whole run");
});

test("the fake gh runs under this Node (through PATH, as the tools spawn it)", () => {
  const r = spawnSync("gh", ["repo", "view", "acme/app", "--json", "name"], { encoding: "utf8", env: gh.env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { name: "acme" });
});
