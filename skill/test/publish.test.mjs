// publish.mjs: sends only the dashboard files of pm/ to Nosy Cloud, with the token from the environment,
// after the privacy scan. A local HTTP server stands in for the cloud; no real network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";

const PUBLISH = path.join(Tool, "publish.mjs");
let tmp, pm, server, url, got;

// spawnSync would block the in-process server, so the child runs async.
const run = (args, env = {}) => new Promise(resolve => {
  const c = spawn(process.execPath, [PUBLISH, ...args], { env: { PATH: process.env.PATH, ...env } });
  let output = "", error = "";
  c.stdout.on("data", d => (output += d)); c.stderr.on("data", d => (error += d));
  c.on("close", code => resolve({ code, output, error }));
});

before(async () => {
  tmp = temporary("nosy-publish-");
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
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); clean(tmp); });

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
