// update-check.mjs: the "a newer Nosy is out" line. The network is never touched here: fetch is injected, and the hook
// is run with a pre-filled cache (a fresh "checked" time means it never asks).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { compareVersions, updateNotice, updateCheckOff, cacheFile, fetchLatest, howToUpdate, LATEST_URL, CHECK_EVERY_MS, RETRY_AFTER_MS, SAY_EVERY_MS } from "../tools/update-check.mjs";

const HOOK = path.join(Tool, "..", "..", "hooks", "psst-summary.mjs");
const REPO = path.join(Tool, "..", "..");
const dirs = [];
after(() => dirs.forEach(clean));
const state = () => { const d = temporary("nosy-update-"); dirs.push(d); return d; };
const NOW = Date.parse("2026-10-01T09:00:00Z");
const ok = v => async () => ({ ok: true, text: async () => JSON.stringify({ name: "nosy", version: v }) });
const counting = (impl) => { const f = async (...a) => { f.calls++; return impl(...a); }; f.calls = 0; return f; };

test("compareVersions: numbers, not strings; anything odd says nothing", () => {
  assert.equal(compareVersions("0.17.0", "0.14.4"), 1);
  assert.equal(compareVersions("0.9.0", "0.10.0"), -1, "0.10 is newer than 0.9");
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("v0.18.0", "0.17.0"), 1);
  for (const odd of ["unknown", "", null, "0.17", "0.17.0-beta", undefined]) assert.equal(compareVersions(odd, "0.1.0"), 0, String(odd));
});

test("a newer version: one line with both versions and the plugin commands", async () => {
  const env = { NOSY_STATE_DIR: state() };
  const n = await updateNotice({ env, now: NOW, installed: "0.14.4", fetchImpl: ok("0.17.0"), plugin: true });
  assert.match(n, /Nosy 0\.17\.0 is out; this is 0\.14\.4/);
  assert.match(n, /\/plugin marketplace update nosy/);
  assert.match(n, /\/plugin update nosy@nosy/);
  assert.match(n, /new session/);
  assert.match(n, /NOSY_NO_UPDATE_CHECK=1/, "says how to turn it off");
  assert.doesNotMatch(n, /\/home\/|\/Users\//, "no personal path");
});

test("a skill-only copy is told `nosy update`, not plugin commands", async () => {
  const n = await updateNotice({ env: { NOSY_STATE_DIR: state() }, now: NOW, installed: "0.14.4", fetchImpl: ok("0.17.0"), plugin: false });
  assert.match(n, /nosy update/);
  assert.doesNotMatch(n, /\/plugin /);
  assert.match(howToUpdate({ plugin: false }), /nosy update/);
});

test("up to date, or ahead of GitHub (a dev checkout): nothing is said", async () => {
  for (const [installed, latest] of [["0.17.0", "0.17.0"], ["0.18.0", "0.17.0"]]) {
    assert.equal(await updateNotice({ env: { NOSY_STATE_DIR: state() }, now: NOW, installed, fetchImpl: ok(latest), plugin: true }), null, `${installed} vs ${latest}`);
  }
});

test("the network is asked at most once a day, and the same notice is said at most once a day", async () => {
  const env = { NOSY_STATE_DIR: state() };
  const f = counting(ok("0.17.0"));
  const go = (t) => updateNotice({ env, now: NOW + t, installed: "0.14.4", fetchImpl: f, plugin: true });
  assert.ok(await go(0));
  assert.equal(await go(60_000), null, "a second session a minute later: already said");
  assert.equal(await go(SAY_EVERY_MS - 1), null);
  assert.ok(await go(SAY_EVERY_MS + 1), "a day later, still behind: said again");
  assert.equal(f.calls, 2, "one ask at the start, one after a day; never one per session");
  assert.ok(f.calls < 3 && CHECK_EVERY_MS === SAY_EVERY_MS);
});

test("offline or GitHub down: silent, and it does not retry at every session", async () => {
  const env = { NOSY_STATE_DIR: state() };
  const down = counting(async () => { throw new Error("offline"); });
  assert.equal(await updateNotice({ env, now: NOW, installed: "0.14.4", fetchImpl: down, plugin: true }), null);
  assert.equal(await updateNotice({ env, now: NOW + 60_000, installed: "0.14.4", fetchImpl: down, plugin: true }), null);
  assert.equal(down.calls, 1);
  assert.equal(await updateNotice({ env, now: NOW + RETRY_AFTER_MS + 1, installed: "0.14.4", fetchImpl: ok("0.17.0"), plugin: true }) !== null, true, "later it asks again and succeeds");
});

test("garbage answers are not a version: HTTP 404, HTML, no version field, a version with text in it", async () => {
  const bad = [async () => ({ ok: false, text: async () => "" }), async () => ({ ok: true, text: async () => "<html>" }),
    async () => ({ ok: true, text: async () => "{}" }), ok("9.9.9-evil; rm -rf"), ok("latest")];
  for (const f of bad) assert.equal(await fetchLatest(f), null);
  for (const f of bad) assert.equal(await updateNotice({ env: { NOSY_STATE_DIR: state() }, now: NOW, installed: "0.14.4", fetchImpl: f, plugin: true }), null);
});

test("the request is a plain GET of one public file: no version, no identifier, no body, no cookie", async () => {
  let seen;
  await fetchLatest(async (url, init) => { seen = { url, init }; return { ok: true, text: async () => "{}" }; });
  assert.equal(seen.url, LATEST_URL);
  assert.equal(new URL(seen.url).search, "", "no query string");
  assert.ok(!seen.init.method && !seen.init.body, "GET, no body");
  assert.deepEqual(Object.keys(seen.init.headers), ["accept"], "one header, nothing identifying");
  assert.ok(seen.init.signal, "a time limit");
  assert.match(LATEST_URL, /^https:\/\/raw\.githubusercontent\.com\/nosy-hq\/nosy\/main\/\.claude-plugin\/plugin\.json$/);
});

test("the off switches: env var, plugin option (true), and never the option's default 'false'", async () => {
  const f = counting(ok("0.17.0"));
  for (const env of [{ NOSY_NO_UPDATE_CHECK: "1" }, { CLAUDE_PLUGIN_OPTION_DISABLE_UPDATE_CHECK: "true" }, { CLAUDE_PLUGIN_OPTION_DISABLE_UPDATE_CHECK: "false", NOSY_NO_UPDATE_CHECK: "1" }]) {
    assert.equal(updateCheckOff(env), true);
    assert.equal(await updateNotice({ env: { ...env, NOSY_STATE_DIR: state() }, now: NOW, installed: "0.14.4", fetchImpl: f, plugin: true }), null);
  }
  assert.equal(f.calls, 0, "switched off means the network is not touched");
  assert.equal(updateCheckOff({ CLAUDE_PLUGIN_OPTION_DISABLE_UPDATE_CHECK: "false" }), false);
  assert.equal(await updateNotice({ env: { NOSY_STATE_DIR: state() }, now: NOW, installed: "unknown", fetchImpl: f, plugin: true }), null, "an unknown own version says nothing");
  assert.equal(f.calls, 0);
});

test("the hook: a newer version in the cache is shown to the owner (systemMessage), once, with the old whisper intact", () => {
  const dir = state(), cwd = state();
  fs.writeFileSync(path.join(dir, "nosy-loaded.json"), "{}\n"); // the first-run greeting already happened
  fs.writeFileSync(cacheFile({ NOSY_STATE_DIR: dir }), JSON.stringify({ checked: Date.now(), latest: "99.0.0", failed: false }) + "\n");
  const hook = env => run(HOOK, [], { input: JSON.stringify({ cwd }), env: { ...process.env, NOSY_STATE_DIR: dir, NOSY_NO_UPDATE_CHECK: "", ...env } });
  const first = JSON.parse(hook({}).output);
  assert.match(first.systemMessage, /Nosy 99\.0\.0 is out/);
  assert.match(first.systemMessage, /\/plugin marketplace update nosy/);
  assert.equal(hook({}).output, "", "the same day: quiet");
  fs.writeFileSync(cacheFile({ NOSY_STATE_DIR: dir }), JSON.stringify({ checked: Date.now(), latest: "99.0.0", failed: false }) + "\n");
  assert.equal(hook({ NOSY_NO_UPDATE_CHECK: "1" }).output, "", "switched off");
  assert.equal(hook({ NOSY_NO_PSST: "1" }).output, "", "the whole hook off");
});

test("the plugin manifest has the option, and the docs name the switch, the URL and the once-a-day limit", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.userConfig.disable_update_check.type, "boolean");
  assert.equal(manifest.userConfig.disable_update_check.default, false);
  const data = fs.readFileSync(path.join(REPO, "docs", "DATA.md"), "utf8");
  assert.match(data, /NOSY_NO_UPDATE_CHECK/);
  assert.ok(data.includes("raw.githubusercontent.com/nosy-hq/nosy/main/.claude-plugin/plugin.json"));
  assert.match(data, /once a day|once every 24 hours|at most once a day/i);
  const install = fs.readFileSync(path.join(REPO, "docs", "INSTALL.md"), "utf8");
  assert.match(install, /\/plugin marketplace update nosy/);
  assert.match(install, /\/plugin update nosy@nosy/);
  assert.match(install, /NOSY_NO_UPDATE_CHECK/);
});

test("`always`: asked what is loaded, it says it again within the day; the network is still asked once", async () => {
  const env = { NOSY_STATE_DIR: state() };
  const f = counting(ok("0.17.0"));
  const go = (extra = {}) => updateNotice({ env, now: NOW, installed: "0.14.4", fetchImpl: f, plugin: false, ...extra });
  assert.ok(await go());
  assert.equal(await go(), null, "the hook's rule: once a day");
  assert.match(await go({ always: true }), /npx github:nosy-hq\/nosy update/, "a skill copy is told the command that fetches the newest");
  assert.ok(await go({ always: true }));
  assert.equal(f.calls, 1);
});

test("`/nosy` with no command (the top-level skill, any agent): the line sits under the loaded lines, and not with --json or when off", () => {
  const dir = state(), cwd = state();
  fs.writeFileSync(cacheFile({ NOSY_STATE_DIR: dir }), JSON.stringify({ checked: Date.now(), latest: "99.0.0", failed: false }) + "\n");
  const NEXT = path.join(Tool, "next.mjs");
  const go = (args, env = {}) => run(NEXT, [path.join(cwd, "pm"), ...args], { env: { ...process.env, NOSY_STATE_DIR: dir, NOSY_NO_UPDATE_CHECK: "", CLAUDE_PLUGIN_ROOT: "", ...env } }).output;
  const out = go([]);
  assert.match(out, /is loaded[\s\S]*Nosy 99\.0\.0 is out/);
  assert.match(out, /npx github:nosy-hq\/nosy update/, "no plugin here: the skill-copy command");
  assert.match(go([]), /Nosy 99\.0\.0 is out/, "said again: the owner asked");
  assert.doesNotMatch(go(["--json", path.join(dir, "n.json")]), /is out/);
  assert.doesNotMatch(go([], { NOSY_NO_UPDATE_CHECK: "1" }), /is out/);
});
