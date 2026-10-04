// Low-severity fixes, batch C: a missing `ref` never prints "undefined", bad window/audience/estimate input is refused with the
// bad value and the accepted forms, install --providers names only the chosen agents, user-facing hints say `nosy <command>`,
// facts shows merged days in the owner's zone, the privacy scan labels its UTC time. Real commands in temp folders; no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const tmp = (p = "nosy-lowsc-") => { const d = temporary(p); dirs.push(d); return d; };
const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=n", ...a], { encoding: "utf8" });
const nosy = (cwd, args, env) => run(NOSY, args, { cwd, ...(env ? { env: { ...process.env, ...env } } : {}) });
const both = r => `${r.output}\n${r.error}`;
function product() {
  const d = tmp("nosy-lowsc-prod-"); git(d, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(d, "README.md"), "# x\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "feat(x): first");
  assert.equal(nosy(d, ["setup", "."]).code, 0);
  return d;
}
const setSources = (d, f) => { const p = path.join(d, "pm", "sources.json"), K = JSON.parse(fs.readFileSync(p, "utf8")); f(K); fs.writeFileSync(p, JSON.stringify(K, null, 1)); };

test("1. no `ref` in sources.json: check, gates, metrics and psst say so instead of printing 'undefined'", () => {
  const d = product(); setSources(d, K => { delete K.ref; });
  for (const c of ["check", "gates", "metrics", "psst"]) {
    const r = nosy(d, [c]);
    assert.doesNotMatch(both(r), /undefined/, `${c} printed undefined:\n${both(r)}`);
    assert.equal(r.code === 0, false, `${c} must not succeed over a repo it cannot read`);
    assert.match(both(r), /`ref`/, `${c} names the missing setting`);
  }
});

test("1. the tools' own titles leave the ref out when it is not set", () => {
  const d = product(); setSources(d, K => { delete K.ref; });
  const pm = path.join(d, "pm");
  for (const t of ["plan-gates.mjs", "scan-metrics.mjs", "lowhanging.mjs"]) {
    const r = run(path.join(Tool, t), [pm], { cwd: d });
    assert.doesNotMatch(both(r), /undefined/, `${t}:\n${both(r).slice(0, 400)}`);
  }
});

test("2. recent --since banana is refused, naming the value and the accepted forms", () => {
  const d = product();
  const r = nosy(d, ["recent", "--since", "banana"]);
  assert.equal(r.code, 1, both(r));
  assert.match(both(r), /banana/); assert.match(both(r), /7d/); assert.match(both(r), /\d{4}-\d{2}-\d{2}/);
  assert.equal(both(r).trim().split("\n").filter(l => /banana/.test(l)).length, 1, "one line");
});

test("2. notes --for bogus is refused, naming the value and the audiences", () => {
  const d = product();
  const r = nosy(d, ["notes", "--for", "bogus"]);
  assert.equal(r.code, 1, both(r));
  assert.match(both(r), /bogus/); assert.match(both(r), /customer/); assert.match(both(r), /team/); assert.match(both(r), /manager/);
});

test("2. history 7x is refused, naming the value and the accepted forms", () => {
  const d = product();
  const r = nosy(d, ["history", "7x"]);
  assert.equal(r.code, 1, both(r));
  assert.match(both(r), /7x/); assert.match(both(r), /30d/); assert.match(both(r), /--days/);
});

test("2. bet place --estimate XL is refused as a bad size, not reported as missing", () => {
  const d = product();
  const r = nosy(d, ["bet", "place", "a thing", "--why", "because", "--estimate", "XL"]);
  assert.equal(r.code, 1, both(r));
  assert.match(both(r), /XL/); assert.match(both(r), /S, M or L/); assert.doesNotMatch(both(r), /missing/i);
  assert.equal(fs.existsSync(path.join(d, "pm", "bets")), false, "no bet file written");
});

test("3. install --providers claude,codex mentions only those agents", () => {
  const d = tmp("nosy-lowsc-inst-");
  fs.mkdirSync(path.join(d, ".cursor")); fs.mkdirSync(path.join(d, ".gemini"));
  const r = run(path.join(Tool, "install.mjs"), ["--dir", d, "--providers", "claude,codex", "--dry-run"]);
  assert.equal(r.code, 0, both(r));
  assert.doesNotMatch(r.output, /Cursor|Gemini/);
  assert.match(r.output, /Claude Code/); assert.match(r.output, /Codex/);
  const none = run(path.join(Tool, "install.mjs"), ["--dir", d, "--dry-run"]);
  assert.match(none.output, /Found: .*Cursor/, "without --providers the detected agents are still listed");
});

test("4. score and bet hints say `nosy <command>`, not a node path", () => {
  const d = product();
  assert.match(nosy(d, ["score"]).output, /`nosy bet place /);
  assert.doesNotMatch(nosy(d, ["score"]).output, /bet\.mjs/);
  const l = nosy(d, ["bet", "list"]);
  assert.match(l.output, /`nosy bet place /); assert.doesNotMatch(l.output, /bet\.mjs/);
  const u = nosy(d, ["bet", "place"]);
  assert.doesNotMatch(both(u), /bet\.mjs/); assert.match(both(u), /nosy bet place/);
});

test("4. peek with something that is not a window, date or ref says what it got", () => {
  const d = product();
  const r = nosy(d, ["peek", "zz"]);
  assert.equal(r.code, 1, both(r));
  assert.match(both(r), /"?zz"?/); assert.match(both(r), /7d/); assert.match(both(r), /date/); assert.match(both(r), /branch|tag|commit/);
  assert.doesNotMatch(both(r), /`ref`/, "does not blame sources.json");
});

test("5. privacy-scan labels its time as UTC", () => {
  const d = tmp("nosy-lowsc-priv-"); fs.writeFileSync(path.join(d, "a.txt"), "nothing here\n");
  const r = run(path.join(Tool, "privacy-scan.mjs"), [d]);
  assert.match(r.output, /^# Privacy scan · \d{4}-\d\d-\d\d \d\d:\d\d UTC$/m);
});

test("5. facts shows a PR merged late in the UTC evening on the owner's calendar day", () => {
  // 22:30 UTC on 3 Oct is already 4 Oct in Istanbul.
  const bin = tmp("nosy-lowsc-gh-"), ghFile = path.join(bin, "gh");
  fs.writeFileSync(ghFile, `#!/bin/sh
case "$1" in
  issue) echo '[]' ;;
  pr) echo '[{"number":7,"title":"late","state":"MERGED","createdAt":"2026-10-03T20:00:00Z","closedAt":"2026-10-03T22:30:00Z","mergedAt":"2026-10-03T22:30:00Z","author":{"login":"a"},"headRefName":"x","baseRefName":"main","mergeCommit":{"oid":"abcdef123456"},"isDraft":false,"body":"","comments":[]}]' ;;
esac
`); fs.chmodSync(ghFile, 0o755);
  const code = `import { githubFacts } from ${JSON.stringify(path.join(Tool, "facts.mjs"))}; const l = githubFacts("o/r"); console.log(JSON.stringify(l.find(x => x.n === 7)));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NOSY_TZ: "Europe/Istanbul" } });
  assert.equal(r.status, 0, r.stderr);
  const x = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(x.merged, "2026-10-04"); assert.equal(x.closed, "2026-10-04"); assert.equal(x.created, "2026-10-03");
});
