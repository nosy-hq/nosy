// publish.mjs: sends only the dashboard files of pm/ to Nosy Cloud, with the token from the environment or a token file,
// after the privacy scan. A local HTTP server stands in for the cloud; no real network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";

const PUBLISH = path.join(Tool, "publish.mjs");
let tmp, pm, server, url, got, home;

// spawnSync would block the in-process server, so the child runs async. HOME is a temp folder, so the real ~/.config/nosy/token is never read.
const run = (args, env = {}) => new Promise(resolve => {
  const c = spawn(process.execPath, [PUBLISH, ...args], { env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...env } });
  let output = "", error = "";
  c.stdout.on("data", d => (output += d)); c.stderr.on("data", d => (error += d));
  c.on("close", code => resolve({ code, output, error }));
});

before(async () => {
  tmp = temporary("nosy-publish-");
  home = path.join(tmp, "home"); fs.mkdirSync(home);
  pm = path.join(tmp, "cargo", "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify({ steps: [{ no: "1", name: "Setup" }], biz: { name: "Cargo", codes: { 1: "y" } }, products: [] }));
  fs.writeFileSync(path.join(pm, "state", "status.json"), JSON.stringify({ groups: [] }));
  fs.writeFileSync(path.join(pm, "decisions.md"), "# Decisions\n- internal only\n");
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", () => {
      got = { method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") };
      const ok = req.headers.authorization === "Bearer nsy_good";
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { ok: true, url: `http://cloud/p/me/${got.body.project}` } : { error: "Invalid or expired publish token." }));
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); server.unref();
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); clean(tmp); });

test("publishes only the dashboard files, with the env token, replacing the project", async () => {
  got = null;
  const r = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Published\. Dashboard: http:\/\/cloud\/p\/me\/cargo/);
  assert.equal(got.method, "POST");
  assert.equal(got.url, "/api/publish");
  assert.equal(got.auth, "Bearer nsy_good");
  assert.equal(got.body.project, "cargo", "project defaults to the repo folder's name");
  assert.equal(got.body.replace, true);
  assert.deepEqual(Object.keys(got.body.files).sort(), ["pm/matrix.json", "pm/state/glance.json", "pm/state/status.json"]);
  const g = JSON.parse(got.body.files["pm/state/glance.json"]);
  assert.ok(g.generated && Array.isArray(g.tiles), "the first screen is computed and sent");
  assert.ok(!JSON.stringify(got.body).includes("internal only"), "decisions.md must never leave");
});

test("--dry-run lists the files and sends nothing, no token needed", async () => {
  got = null;
  const r = await run([pm, "--url", url, "--dry-run", "--project", "demo"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /Would publish 3 file\(s\) to .* as "demo"/);
  assert.match(r.output, /pm\/state\/glance\.json/);
  assert.match(r.output, /not found, will be cleared on the dashboard: pm\/state\/lowhanging\.json/);
  assert.equal(got, null);
});

test("refuses without a token, and reports the cloud's error", async () => {
  const none = await run([pm, "--url", url]);
  assert.equal(none.code, 1);
  assert.match(none.error, /NOSY_CLOUD_TOKEN is not set/);
  const bad = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_bad" });
  assert.equal(bad.code, 1);
  assert.match(bad.error, /answered 401: Invalid or expired publish token/);
});

test("the privacy scan stops the upload", async () => {
  const leaky = path.join(tmp, "leaky", "pm");
  fs.cpSync(pm, leaky, { recursive: true });
  fs.writeFileSync(path.join(leaky, "summary.md"), `## Summary\n- deploy key: ${"ghp_" + "Zx8Qm2Lk9Rt4Vb7Nc1Hp5Jw3Ys6Fd0Ga2Ue4"}\n`);
  got = null;
  const r = await run([leaky, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 1);
  assert.match(r.error, /privacy scan found a secret/);
  assert.equal(got, null, "nothing may be sent");
});

test("needs pm/matrix.json and a valid project name", async () => {
  const empty = path.join(tmp, "empty", "pm"); fs.mkdirSync(empty, { recursive: true });
  assert.match((await run([empty, "--dry-run"])).error, /matrix\.json is missing/);
  assert.match((await run([pm, "--dry-run", "--project", "../x"])).error, /isn't a valid project name/);
});

test("rival demand goes up only if you ran it, cut to public tracker facts, and the promise line says so", async () => {
  const before = await run([pm, "--url", url, "--dry-run", "--full"]);
  assert.ok(!before.output.includes("rival-demand.json"), "no rival-demand file, nothing sent");
  assert.match(before.output, /^Counts and structure only: no commit subjects/m);
  fs.writeFileSync(path.join(pm, "state", "rival-demand.json"), JSON.stringify({ generated: "2026-09-30T00:00:00Z", note: "internal", source: "--repos",
    repos: [{ repo: "acme/rival", ok: true, stars: 5, asks: [{ kind: "issue", number: 7, title: "Export as CSV", votes: 31, comments: 2, openDays: 400, quietDays: 3, url: "https://github.com/acme/rival/issues/7", possibleArea: { no: "2", feature: "Data export", words: ["export"], share: 1 } }] },
      { repo: "acme/gone", ok: false, why: "Not Found" }],
    alsoAtSeveralRivals: [] }));
  const after = await run([pm, "--url", url, "--dry-run", "--full"]);
  assert.equal(after.code, 0, after.error);
  assert.match(after.output, /pm\/state\/rival-demand\.json/);
  assert.match(after.output, /apart from pm\/state\/rival-demand\.json: titles and links of public issues on your rivals' trackers/);
  const sent = JSON.parse(after.output.split("--- pm/state/rival-demand.json ---\n")[1].split("\n---")[0].trim());
  assert.deepEqual(sent.repos.map(r => r.repo), ["acme/rival"], "a rival that could not be read is not sent");
  assert.equal(sent.repos[0].asks[0].title, "Export as CSV");
  assert.equal("quietDays" in sent.repos[0].asks[0], false);
  assert.deepEqual(Object.keys(sent.repos[0].asks[0].possibleArea), ["no", "feature"]);
  assert.equal("note" in sent || "source" in sent, false);
  fs.rmSync(path.join(pm, "state", "rival-demand.json"));
});

// ---- the token is read from a file, never from the command line ----
// On the first real run the key was typed into a command, so it stayed in the shell history and in the chat log. The environment still
// works; a file is now the better way, and a file other users can read is refused before anything is sent.
const tokenFile = (dir, name, text, mode = 0o600) => { const f = path.join(dir, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); fs.chmodSync(f, mode); return f; };
const posix = process.platform === "win32" ? { skip: "mode bits don't exist on Windows" } : {};

test("the default token file ~/.config/nosy/token is used, and the token never shows in the output", async () => {
  const h = path.join(tmp, "h-default"); tokenFile(h, ".config/nosy/token", "nsy_good\n");
  got = null;
  const r = await run([pm, "--url", url, "--yes"], { HOME: h, USERPROFILE: h });
  assert.equal(r.code, 0, r.error);
  assert.equal(got.auth, "Bearer nsy_good", "surrounding whitespace is trimmed");
  assert.ok(!(r.output + r.error).includes("nsy_good"), "the token is never printed");
});

test("XDG_CONFIG_HOME moves the default file", async () => {
  const x = path.join(tmp, "xdg"); tokenFile(x, "nosy/token", "nsy_good");
  got = null;
  const r = await run([pm, "--url", url, "--yes"], { XDG_CONFIG_HOME: x });
  assert.equal(r.code, 0, r.error);
  assert.equal(got.auth, "Bearer nsy_good");
});

test("order: NOSY_CLOUD_TOKEN, then --token-file, then NOSY_CLOUD_TOKEN_FILE, then the default file", async () => {
  const h = path.join(tmp, "h-order"); tokenFile(h, ".config/nosy/token", "nsy_default");
  const flagFile = tokenFile(tmp, "flag.token", "nsy_good"), envFile = tokenFile(tmp, "env.token", "nsy_envfile");
  const env = { HOME: h, USERPROFILE: h };
  got = null;
  assert.equal((await run([pm, "--url", url, "--yes", "--token-file", flagFile], { ...env, NOSY_CLOUD_TOKEN_FILE: envFile })).code, 0);
  assert.equal(got.auth, "Bearer nsy_good", "--token-file beats NOSY_CLOUD_TOKEN_FILE");
  const viaEnvFile = await run([pm, "--url", url, "--yes"], { ...env, NOSY_CLOUD_TOKEN_FILE: tokenFile(tmp, "env2.token", "nsy_good") });
  assert.equal(viaEnvFile.code, 0, viaEnvFile.error);
  assert.equal(got.auth, "Bearer nsy_good", "NOSY_CLOUD_TOKEN_FILE beats the default file");
  const viaVar = await run([pm, "--url", url, "--yes", "--token-file", envFile], { ...env, NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(viaVar.code, 0, viaVar.error);
  assert.equal(got.auth, "Bearer nsy_good", "the environment variable beats every file");
});

test("a token file that group or others can read is refused with the chmod to run, and nothing is sent", posix, async () => {
  for (const mode of [0o644, 0o640, 0o604]) {
    const f = tokenFile(tmp, `loose-${mode.toString(8)}.token`, "nsy_good", mode);
    got = null;
    const r = await run([pm, "--url", url, "--yes", "--token-file", f]);
    assert.equal(r.code, 1, `mode ${mode.toString(8)}`);
    assert.ok(r.error.includes(`chmod 600 ${f}`), r.error);
    assert.match(r.error, new RegExp(`mode ${mode.toString(8)}`));
    assert.equal(got, null, "nothing may be sent");
    assert.ok(!(r.output + r.error).includes("nsy_good"));
  }
  // the default file is checked the same way
  const h = path.join(tmp, "h-loose"); tokenFile(h, ".config/nosy/token", "nsy_good", 0o644);
  got = null;
  const d = await run([pm, "--url", url, "--yes"], { HOME: h, USERPROFILE: h });
  assert.equal(d.code, 1);
  assert.match(d.error, /chmod 600 .*\.config\/nosy\/token/);
  assert.equal(got, null);
  // 0400 (read-only for you) is fine
  assert.equal((await run([pm, "--url", url, "--yes", "--token-file", tokenFile(tmp, "ro.token", "nsy_good", 0o400)])).code, 0);
});

test("a named token file that is missing, empty or holds more than a token stops the send", async () => {
  got = null;
  const missing = await run([pm, "--url", url, "--yes", "--token-file", path.join(tmp, "nope.token")]);
  assert.equal(missing.code, 1);
  assert.match(missing.error, /token file .*nope\.token can't be read \(ENOENT\)/);
  const empty = await run([pm, "--url", url, "--yes", "--token-file", tokenFile(tmp, "empty.token", " \n")]);
  assert.equal(empty.code, 1);
  assert.match(empty.error, /is empty/);
  const two = await run([pm, "--url", url, "--yes", "--token-file", tokenFile(tmp, "two.token", "nsy_good and more")]);
  assert.equal(two.code, 1);
  assert.match(two.error, /more than one word/);
  assert.ok(!(two.output + two.error).includes("nsy_good"), "even a refused file's content is not echoed");
  assert.equal(got, null);
});

test("with no token anywhere, the failure leads with the file: where to save it, chmod 600, and the shell-history warning", async () => {
  const h = path.join(tmp, "h-none"); fs.mkdirSync(h, { recursive: true });
  const r = await run([pm, "--url", url, "--yes"], { HOME: h, USERPROFILE: h });
  assert.equal(r.code, 1);
  assert.match(r.error, /NOSY_CLOUD_TOKEN is not set and there is no token file/);
  assert.ok(r.error.includes(path.join(h, ".config", "nosy", "token")), r.error);
  assert.match(r.error, /chmod 600/);
  assert.match(r.error, /printf '%s' '<token>' >/);
  assert.match(r.error, /shell history/);
  assert.match(r.error, /--token-file <path>/);
  assert.doesNotMatch(r.error, /export it/, "no longer tells people to export it");
});

test("the usage header names the token file", () => {
  const head = fs.readFileSync(PUBLISH, "utf8").split("\n").slice(0, 25).join("\n");
  assert.match(head, /--token-file <path>/);
  assert.match(head, /\.config\/nosy\/token/);
});
