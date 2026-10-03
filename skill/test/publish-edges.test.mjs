// Edge cases of `nosy publish` found in review: what it prints when the dashboard read less than was sent, what it
// does with a token file that has Windows line endings, a token that is not a token, an address that is not https, a redirect, a file that is
// too big for Cloud, a long list of names for the privacy scan, and a branch name in a title. A local HTTP server stands in for Nosy Cloud.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";

const PUBLISH = path.join(Tool, "publish.mjs");
let tmp, pm, home, server, url, got, reply;
const J = JSON.stringify;
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === "string" ? v : J(v, null, 1)); };
const run = (args, env = {}) => new Promise(resolve => {
  const c = spawn(process.execPath, [PUBLISH, ...args], { env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  c.stdout.on("data", d => (output += d)); c.stderr.on("data", d => (error += d));
  c.on("close", code => resolve({ code, output, error }));
});
const MATRIX = { steps: [{ no: "1", name: "Setup" }, { no: "2", name: "Share" }], biz: { name: "Cargo", codes: { 1: "y", 2: "n" } }, products: [{ name: "RivalOne", codes: { 1: { k: "y", evidence: "" }, 2: { k: "y", evidence: "" } } }] };
const tokenFile = (name, text, mode = 0o600) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); fs.chmodSync(f, mode); return f; };

before(async () => {
  tmp = temporary("nosy-publish-edges-"); home = path.join(tmp, "home"); fs.mkdirSync(home);
  pm = path.join(tmp, "cargo", "pm"); write(path.join(pm, "matrix.json"), MATRIX);
  server = http.createServer((req, res) => {
    let body = ""; req.on("data", d => (body += d));
    req.on("end", () => { got = { url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : {} }; const r = reply(got); res.writeHead(r.status, { "content-type": "application/json", ...(r.headers || {}) }); res.end(J(r.json ?? {})); });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); server.unref();
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); clean(tmp); });
const ok = (extra = {}) => () => ({ status: 200, json: { ok: true, url: "http://cloud/p/me/cargo", ...extra } });
const send = (args = [], env = {}) => run([pm, "--url", url, "--yes", ...args], { NOSY_CLOUD_TOKEN: "nsy_good", ...env });

// ---- what it says after the send ----
test("reads: a dashboard that drew the matrix is quoted, with decided-against and unknown counts", async () => {
  reply = ok({ reads: { matrix: { areas: 2, rivals: 1, unknown: 0, declined: 1 }, status: { main: 4 }, lowhanging: 1, checked: true } });
  const r = await send();
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /The dashboard read: matrix 2 areas × 1 rivals, 1 decided against; status 4 on main; 1 list item \(the refuter's checked list\)\./);
});

test("reads: the roadmap counts and the number of rivals with signals are quoted when Cloud answers them, and only then", async () => {
  reply = ok({ reads: { matrix: { areas: 2, rivals: 1, unknown: 0 }, status: null, lowhanging: 0, checked: false, roadmap: { now: 2, next: 1, later: 0, shipped: 3 }, signals: 1 } });
  const r = await send();
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /The dashboard read: matrix 2 areas × 1 rivals; 0 list items; roadmap 2 now, 1 next, 0 later, 3 shipped; public signals for 1 rival\./);
  reply = ok({ reads: { matrix: { areas: 2, rivals: 1, unknown: 0 }, lowhanging: 0, signals: 4 } });
  assert.match((await send()).output, /; public signals for 4 rivals\./);
  reply = ok({ reads: { matrix: { areas: 2, rivals: 1, unknown: 0 }, lowhanging: 0 } });
  const old = await send();
  assert.doesNotMatch(old.output, /roadmap \d|public signals/, "a Cloud that does not answer them says nothing about them");
});

test("reads: a matrix the dashboard drew nothing from is said, and the exit code is 1 although the files arrived", async () => {
  for (const reads of [{ matrix: { areas: 0, rivals: 0, unknown: 0 } }, { matrix: null }]) {
    reply = ok({ reads });
    const r = await send();
    assert.equal(r.code, 1, J(reads));
    assert.match(r.output, /Published\. Dashboard: http:\/\/cloud\/p\/me\/cargo/);
    assert.match(r.output, /dashboard drew no matrix from pm\/matrix\.json/);
  }
});

test("reads: an empty matrix (a new product) is not a failure when the dashboard read it as empty", async () => {
  const d = path.join(tmp, "empty-matrix", "pm"); write(path.join(d, "matrix.json"), { steps: [], biz: { name: "New" }, products: [] });
  reply = ok({ reads: { matrix: { areas: 0, rivals: 0, unknown: 0 } } });
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 0, r.output + r.error);
  assert.match(r.output, /no rows yet/);
});

test("reads: a Cloud that does not answer `reads` says so, and does not claim the dashboard drew anything", async () => {
  reply = ok();
  const r = await send();
  assert.equal(r.code, 0);
  assert.match(r.output, /This Cloud doesn't say what it drew/);
  assert.doesNotMatch(r.output, /The dashboard read:/);
});

// ---- the token ----
test("a token file with Windows line endings, a trailing newline, a byte-order mark or spaces around the token works", async () => {
  for (const [name, text] of Object.entries({ crlf: "nsy_good\r\n", lf: "nsy_good\n", bom: "﻿nsy_good\n", spaces: "  nsy_good \t\r\n\r\n", bare: "nsy_good" })) {
    reply = ok(); got = null;
    const r = await run([pm, "--url", url, "--yes", "--token-file", tokenFile(`tok-${name}`, text)]);
    assert.equal(r.code, 0, `${name}: ${r.error}`);
    assert.equal(got.auth, "Bearer nsy_good", name);
  }
});

test("a token that is not one word of printable characters stops the send, naming where it came from and never quoting it", async () => {
  for (const [what, env, file] of [["env, a space inside", { NOSY_CLOUD_TOKEN: "nsy good" }], ["env, a curly quote", { NOSY_CLOUD_TOKEN: "nsy_“good" }],
    ["file, a curly quote", {}, tokenFile("tok-curly", "nsy_“good")], ["file, a null byte", {}, tokenFile("tok-nul", "nsy_\u0000good")]]) {
    got = null;
    const r = await run([pm, "--url", url, "--yes", ...(file ? ["--token-file", file] : [])], env);
    assert.equal(r.code, 1, what);
    assert.match(r.error, /a space, a line break or a character a token never has|more than one word/, what);
    assert.ok(!(r.output + r.error).includes("good"), `${what}: the token is not quoted`);
    assert.equal(got, null, `${what}: nothing sent`);
  }
});

test("a refused token says where it came from: NOSY_CLOUD_TOKEN wins over a file, and that is the likely culprit after the old advice", async () => {
  reply = () => ({ status: 401, json: { error: "Invalid or expired publish token." } });
  const viaEnv = await send([], { NOSY_CLOUD_TOKEN: "nsy_stale" });
  assert.equal(viaEnv.code, 1);
  assert.match(viaEnv.error, /came from NOSY_CLOUD_TOKEN in your environment, which wins over any token file/);
  const f = tokenFile("tok-stale", "nsy_stale");
  const viaFile = await run([pm, "--url", url, "--yes", "--token-file", f]);
  assert.match(viaFile.error, new RegExp(`came from the token file ${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(!(viaEnv.error + viaFile.error).includes("nsy_stale"));
});

// ---- where it sends ----
test("plain http to a host that is not your own machine is refused before anything leaves; https, localhost and 127.0.0.1 are fine", async () => {
  const r = await run([pm, "--url", "http://cloud.example.net", "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 1);
  assert.match(r.error, /plain http: your token and your files would cross the network unencrypted/);
  const notUrl = await run([pm, "--url", "cloud.nosy.example", "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(notUrl.code, 1);
  assert.match(notUrl.error, /isn't a web address/);
  reply = ok(); got = null;
  assert.equal((await send()).code, 0, "127.0.0.1 over http is allowed");
});

test("a redirect is not followed (it would replay the files, token or not): the address it points to is named", async () => {
  let hits = 0, elsewhere = null;
  const other = http.createServer((req, res) => { hits++; let b = ""; req.on("data", d => (b += d)); req.on("end", () => { elsewhere = b; res.writeHead(200); res.end("{}"); }); });
  await new Promise(r => other.listen(0, "127.0.0.1", r));
  const target = `http://127.0.0.1:${other.address().port}/api/publish`;
  reply = () => ({ status: 307, headers: { location: target }, json: {} });
  const r = await send();
  other.close(); other.closeAllConnections?.();
  assert.equal(r.code, 1);
  assert.match(r.error, /answered 307 and points to http:\/\/127\.0\.0\.1:\d+\/api\/publish/);
  assert.equal(hits, 0, "the files were not sent to the place it pointed to");
  assert.equal(elsewhere, null);
});

// ---- size ----
test("a file over Cloud's limit is named with its size, in a dry run and in a real send, and nothing is sent", async () => {
  const d = path.join(tmp, "huge", "pm");
  write(path.join(d, "matrix.json"), { ...MATRIX, products: [{ name: "RivalOne", codes: { 1: { k: "y", evidence: "x".repeat(1_600_000) }, 2: { k: "n", evidence: "" } } }] });
  got = null; reply = ok();
  for (const args of [["--dry-run"], ["--yes"]]) {
    const r = await run([d, "--url", url, ...args], { NOSY_CLOUD_TOKEN: "nsy_good" });
    assert.equal(r.code, 1, args.join(" "));
    assert.match(r.error, /pm\/matrix\.json is 1,6\d\d,\d\d\d characters once cut down; Nosy Cloud takes at most 1,500,000 per file/);
    assert.equal(got, null);
  }
});

test("a large but allowed matrix prints in full through a pipe that is read slowly, and arrives whole", async () => {
  const d = path.join(tmp, "big", "pm");
  const steps = Array.from({ length: 300 }, (_, i) => ({ no: String(i + 1), name: `Step ${i + 1}` }));
  write(path.join(d, "matrix.json"), { steps, biz: { name: "Cargo", codes: Object.fromEntries(steps.map(s => [s.no, "y"])) },
    products: Array.from({ length: 30 }, (_, r) => ({ name: `Rival ${r}`, codes: Object.fromEntries(steps.map(s => [s.no, { k: "p", evidence: `https://r${r}.test/${s.no} ${"e".repeat(60)}` }])) })) });
  const dry = await new Promise(resolve => {
    const c = spawn(process.execPath, [PUBLISH, d, "--url", url, "--dry-run", "--full"], { env: { PATH: process.env.PATH, HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; c.stdout.pause(); c.stdout.on("data", x => chunks.push(x));
    setTimeout(() => c.stdout.resume(), 400); // a reader that starts late: the child must not exit with output still queued
    c.on("close", code => resolve({ code, out: Buffer.concat(chunks).toString() }));
  });
  assert.equal(dry.code, 0);
  const m = dry.out.split("\n--- pm/matrix.json ---\n")[1].split("\n--- ")[0].replace(/\n$/, "");
  assert.ok(m.length > 600_000, `the printout is ${m.length} characters`);
  assert.doesNotThrow(() => JSON.parse(m), "the matrix printed is whole JSON");
  reply = ok(); got = null;
  assert.equal((await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" })).code, 0);
  assert.equal(got.body.files["pm/matrix.json"], m, "what was printed is what was sent");
});

// ---- the privacy scan's names ----
test("a long list of people and branches does not stop the scan from running, and still finds the last one", async () => {
  const d = path.join(tmp, "names", "pm"); fs.cpSync(pm, d, { recursive: true });
  const people = Array.from({ length: 3000 }, (_, i) => `Person Number${i}x`);
  write(path.join(d, "state", "status.json"), { generated: "2026-10-01T00:00:00Z", range: "r", main: 1, pr: 0, lastMain: "a", groups: [{ ref: "#1", n: 1, where: ["main"], who: people, last: "09.30", topic: "t" }] });
  reply = ok(); got = null;
  const clean = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(clean.code, 0, clean.error);
  write(path.join(d, "summary.md"), "## Summary\n- thanks to Person Number2999x for this\n");
  got = null;
  const leaky = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(leaky.code, 1);
  assert.match(leaky.error, /privacy scan found/);
  assert.equal(got, null);
});

test("the name of one of your own unmerged branches in the text that leaves stops the send; a plain word that is also a branch does not", async () => {
  const d = path.join(tmp, "branches", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "state", "facts", "branches.json"), { generated: "x", base: "main", branches: [{ branch: "side/pricing-v2-secret", author: "Dana Branch", ahead: 2, files: [] }, { branch: "main", ahead: 0 }, { branch: "release", ahead: 1 }] });
  write(path.join(d, "summary.md"), "## Summary\n- main and release went out; pricing was discussed.\n");
  reply = ok(); got = null;
  assert.equal((await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" })).code, 0, "plain words are not branch names");
  write(path.join(d, "summary.md"), "## Summary\n- work is on side/pricing-v2-secret\n");
  got = null;
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 1);
  assert.match(r.error, /privacy scan found/);
  assert.equal(got, null);
  write(path.join(d, "summary.md"), "## Summary\n- the author Dana Branch did it\n");
  assert.equal((await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" })).code, 1, "the author of a local branch is a name too");
});

test("a private.json of your own is still honoured next to the names Nosy adds", async () => {
  const d = path.join(tmp, "private", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "private.json"), { names: ["Priscilla Hush"], permission: [] });
  write(path.join(d, "summary.md"), "## Summary\n- Priscilla Hush signed off\n");
  got = null; reply = ok();
  const r = await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" });
  assert.equal(r.code, 1);
  assert.equal(got, null);
});

// ---- a summary that is not a summary ----
test("text before the first heading of summary.md, and a file with no heading, are not sent whole", async () => {
  const d = path.join(tmp, "summary", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "summary.md"), "Private preamble: do not send.\n- a bullet before any heading\n\n## Summary\n- first section\n\n## Later\n- second\n");
  reply = ok(); got = null;
  assert.equal((await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" })).code, 0);
  assert.equal(got.body.files["pm/summary.md"], "## Summary\n- first section\n");
  write(path.join(d, "summary.md"), Array.from({ length: 200 }, (_, i) => `- note ${i}`).join("\n"));
  got = null;
  assert.equal((await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" })).code, 0);
  assert.equal(got.body.files["pm/summary.md"].trim().split("\n").length, 40, "a file with no heading is cut to 40 lines");
});

// ---- the run history is cut to what Cloud reads ----
test("history/runs.jsonl leaves as time, label, ref, last commit and counts; a broken line is dropped; a private extra key never leaves", async () => {
  const d = path.join(tmp, "runs", "pm"); fs.cpSync(pm, d, { recursive: true });
  write(path.join(d, "history", "runs.jsonl"), [J({ zaman: "2026-10-01T00:00:00Z", label: "weekly", ref: "main", lastMain: "abc", folder: "snap", note: "zq-run-note", numbers: { psst: 3, text: "zq-number-text" } }), "{not json", J([1]), ""].join("\n"));
  reply = ok(); got = null;
  assert.equal((await run([d, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "nsy_good" })).code, 0);
  const lines = got.body.files["pm/history/runs.jsonl"].trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(lines, [{ zaman: "2026-10-01T00:00:00Z", label: "weekly", ref: "main", lastMain: "abc", numbers: { psst: 3 } }]);
});

// ---- a matrix that cannot be drawn is stopped here, with a message that does not quote the file ----
test("a matrix with a null row, or invalid JSON, stops the send in one line: where the parser stopped, never the text around it", async () => {
  const d = path.join(tmp, "badmatrix", "pm"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "matrix.json"), '{"steps": [{"no": "1", "name": "zq-matrix-text"} zq-after');
  got = null;
  const a = await run([d, "--url", url, "--dry-run"]);
  assert.equal(a.code, 1);
  assert.match(a.error, /isn't valid JSON \(position \d+/);
  assert.ok(!a.error.includes("zq-"), "the file's own text is not quoted");
  write(path.join(d, "matrix.json"), { products: ["Us", "R"], lines: [null, { feature: "A", codes: { Us: "y", R: "n" } }] });
  const b = await run([d, "--url", url, "--dry-run"]);
  assert.equal(b.code, 1);
  assert.match(b.error, /not an object/);
  assert.doesNotMatch(b.error, /at .*\.mjs:\d+/, "no stack trace");
});

test("two products with one name, and a row we built that is also marked declined, are reported as they are", async () => {
  const d = path.join(tmp, "dups", "pm");
  write(path.join(d, "matrix.json"), { products: ["Us", "Rival", "Rival"], lines: [{ feature: "A", declined: true, codes: { Us: "y", Rival: "n" } }, { feature: "B", declined: true, codes: { Us: "n", Rival: "y" } }] });
  const r = await run([d, "--url", url, "--dry-run"]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /more than one product is called "Rival"/);
  assert.match(r.output, /1 decided against/, "the row we have fully built is not decided against (the dashboard ignores the flag there)");
});

// ---- a dry run says what a real run would trip over, without reading or printing the token ----
test("--dry-run says where the token would come from (or that there is none), never its value, and still exits 0", async () => {
  const none = await run([pm, "--url", url, "--dry-run"]);
  assert.equal(none.code, 0, none.error);
  assert.match(none.output, /token: not usable yet, a real run would stop \(NOSY_CLOUD_TOKEN is not set and there is no token file at /);
  const env = await run([pm, "--url", url, "--dry-run"], { NOSY_CLOUD_TOKEN: "nsy_secretvalue" });
  assert.match(env.output, /token: found in NOSY_CLOUD_TOKEN; it is read only in a real run/);
  const f = tokenFile("tok-dry", "nsy_secretvalue", 0o644);
  const loose = await run([pm, "--url", url, "--dry-run", "--token-file", f]);
  assert.equal(loose.code, 0);
  assert.match(loose.output, /token: not usable yet.*can be read by other users \(mode 644\)/);
  for (const r of [none, env, loose]) assert.ok(!(r.output + r.error).includes("secretvalue"), "the token is never printed");
});

test("--dry-run refuses an address a real run would refuse (plain http to another machine)", async () => {
  const r = await run([pm, "--url", "http://cloud.example.net", "--dry-run"]);
  assert.equal(r.code, 1);
  assert.match(r.error, /plain http/);
});
