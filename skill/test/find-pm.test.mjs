// findPm (sources-file.mjs) and the way nosy.mjs uses it: on a real product pm/ sat next to the repo
// folder, not inside it, so commands worked from one folder only. --pm / NOSY_PM wins; else ./pm; else the nearest ancestor's pm/
// (one that holds sources.json, or the old kaynaklar.json); else "pm". Walking up says so once on stderr.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findPm } from "../tools/sources-file.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), dirs = [];
after(() => dirs.forEach(clean));

// <root>/pm/sources.json (next to the repo folder), <root>/repo/sub/deeper
function layout() {
  const root = fs.realpathSync(temporary("nosy-findpm-")); dirs.push(root);
  fs.mkdirSync(path.join(root, "pm"), { recursive: true });
  fs.writeFileSync(path.join(root, "pm", "sources.json"), JSON.stringify({ repo: false }));
  const deeper = path.join(root, "repo", "sub", "deeper"); fs.mkdirSync(deeper, { recursive: true });
  return { root, pm: path.join(root, "pm"), repo: path.join(root, "repo"), deeper };
}

test("findPm: ./pm first, then the nearest ancestor's pm/, else \"pm\"; explicit always wins", () => {
  const L = layout();
  assert.equal(findPm(L.root), "pm", "pm/ right here: unchanged");
  assert.equal(findPm(L.repo), L.pm, "pm/ next to the repo folder");
  assert.equal(findPm(L.deeper), L.pm, "from any depth");
  assert.equal(findPm(L.deeper, { explicit: "elsewhere/pm" }), "elsewhere/pm");
  assert.equal(findPm(L.root, { explicit: "elsewhere/pm" }), "elsewhere/pm", "even when ./pm exists");
  // A nearer pm/ hides a farther one; ./pm hides every ancestor's.
  fs.mkdirSync(path.join(L.repo, "sub", "pm")); fs.writeFileSync(path.join(L.repo, "sub", "pm", "sources.json"), "{}");
  assert.equal(findPm(L.deeper), path.join(L.repo, "sub", "pm"));
  fs.mkdirSync(path.join(L.deeper, "pm")); fs.writeFileSync(path.join(L.deeper, "pm", "sources.json"), "{}");
  assert.equal(findPm(L.deeper), "pm");
});

test("findPm: a pm/ without sources.json doesn't count; the old kaynaklar.json does; nothing found falls back to \"pm\"", () => {
  const root = fs.realpathSync(temporary("nosy-findpm-none-")); dirs.push(root);
  const inner = path.join(root, "a", "b"); fs.mkdirSync(inner, { recursive: true });
  fs.mkdirSync(path.join(root, "pm"));                       // an empty pm/ (notes only)
  fs.writeFileSync(path.join(root, "pm", "log.md"), "x");
  assert.equal(findPm(inner), "pm", "no sources file anywhere");
  fs.writeFileSync(path.join(root, "pm", "kaynaklar.json"), "{}");
  assert.equal(findPm(inner), path.join(root, "pm"), "an old pm/ is still found, so doctor can run on it");
});

test("nosy.mjs: from a nested folder it uses the pm/ above and says so once on stderr; from the folder with pm/, --pm and NOSY_PM, it says nothing", () => {
  const L = layout();
  const up = run(NOSY, ["doctor"], { cwd: L.deeper });
  assert.equal(up.code, 2, "doctor exits 2 when it found something to do: it read a pm/");
  assert.match(up.output, /no product\.md: run move-in/, "it read the pm/ above");
  assert.deepEqual(up.error.trim().split("\n").filter(l => /^Using /.test(l)), [`Using ${L.pm} (found above this folder)`], "exactly one line");

  assert.ok(!/Using /.test(run(NOSY, ["doctor"], { cwd: L.root }).error), "pm/ right here: silent");
  const explicit = run(NOSY, ["doctor", "--pm", L.pm], { cwd: L.deeper });
  assert.ok(!/Using /.test(explicit.error), "--pm given: silent");
  assert.match(explicit.output, /no product\.md/);
  assert.ok(!/Using /.test(run(NOSY, ["doctor"], { cwd: L.deeper, env: { ...process.env, NOSY_PM: L.pm } }).error), "NOSY_PM given: silent");
  assert.ok(!/Using /.test(run(NOSY, ["help"], { cwd: L.deeper }).error), "help doesn't need a pm/: silent");
});

test("nosy.mjs: with no pm/ anywhere it behaves as before (reads ./pm, says nothing extra)", () => {
  const root = fs.realpathSync(temporary("nosy-findpm-empty-")); dirs.push(root);
  const r = run(NOSY, ["doctor"], { cwd: root });
  assert.ok(!/Using /.test(r.error), r.error);
});
