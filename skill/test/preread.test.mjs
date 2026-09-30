// Contract test for skill/tools/preread.mjs: a "never" pattern is caught on an open PR, a clean PR isn't caught.
// Note: preread.mjs currently does NOT call "gh pr checks" / "gh pr diff" (confirmed by grep; it only calls
// "pr list" and "issue list", reading CI status from pr list's own statusCheckRollup field) — so the fake gh
// doesn't have those two endpoints. The "gh pr diff" mentioned in overheard.md isn't the script's job; it's a
// next step the agent still does by hand (internal request 24 isn't coded yet).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, clean, Tool } from "./helpers.mjs";
import path from "node:path";

let K, gh, output;

before(async () => {
  K = await fakeProductSetup();
  gh = fakeGhSetup(K.gh);
  const r = run(path.join(Tool, "preread.mjs"), [K.pm, "72"], { env: gh.env });
  assert.equal(r.code, 0, `preread returned an unexpected exit code, stderr: ${r.error}`);
  output = r.output;
});
after(() => { clean(K.root); clean(gh.dir); });

test("a never pattern (logging the card number) is caught on the open PR", () => {
  const line = output.split("\n").find(l => l.includes("#610"));
  assert.ok(line, "line for #610 not found");
  assert.match(line, /logging the card number/);
});

test("a PR that doesn't violate the pattern stays clean in the rule column", () => {
  const line = output.split("\n").find(l => l.includes("#611"));
  assert.ok(line, "line for #611 not found");
  assert.doesNotMatch(line, /logging the card number/);
});

test("among issues in motion, only the one matching our own pattern gets 'ours: yes'", () => {
  const line = output.split("\n").find(l => l.includes("#701"));
  assert.ok(line, "line for #701 not found");
  assert.match(line, /\|\s*yes\s*\|/);
});

test("an issue outside the window (40 days old, 72-hour window) doesn't make the list", () => {
  assert.doesNotMatch(output, /#650/);
});

test("the text explicitly states that nothing was written out", () => {
  assert.match(output, /Nothing was written to GitHub/);
});
