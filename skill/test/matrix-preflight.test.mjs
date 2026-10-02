// matrix-preflight.mjs + its use in publish.mjs. First run on a real product: `publish` said "Published" for a matrix
// the dashboard could not read (the owner's own keys, `s`/`f` for `d`/`p`), and the owner found out by reading the page. Every case is
// a way that went wrong, or the way it must not break an owner whose matrix is fine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { preflightMatrix, describe } from "../tools/matrix-preflight.mjs";
import { matrixRead } from "../tools/read-matrix.mjs";
import { temporary, clean, Tool } from "./helpers.mjs";

const line = (codes) => JSON.stringify({ update: "2026-10-02", products: ["Us", "R1"], lines: [{ feature: "Export", codes: codes[0] }, { feature: "Share", codes: codes[1] }] });

test("a readable matrix passes untouched, byte for byte", () => {
  const text = line([{ Us: "y", R1: "p" }, { Us: "n", R1: "y" }]);
  const P = preflightMatrix(text);
  assert.equal(P.ok, true);
  assert.equal(P.text, text);
  assert.deepEqual([P.report.areas, P.report.rivals, P.report.rewritten], [2, 1, false]);
});

test("the owner's codes are mapped (sources.json matrixCodes) and the matrix is sent with Nosy's", () => {
  const text = line([{ Us: "s", R1: "f" }, { Us: "y", R1: "n" }]);
  const P = preflightMatrix(text, { codes: { s: "d", f: "p" } });
  assert.equal(P.ok, true);
  const out = JSON.parse(P.text);
  assert.deepEqual(out.lines[0].codes, { Us: "d", R1: "p" });
  assert.deepEqual(out.lines[1].codes, { Us: "y", R1: "n" }, "codes Nosy already has are never remapped");
  assert.deepEqual(P.report.mapped.map(m => m.map).sort(), ["f→p", "s→d"]);
  assert.equal(P.report.unknown.length, 0);
  assert.match(describe(P.report), /2 areas × 1 rival; codes mapped: .*s→d \(1\)/);
});

test("a matrix keyed in another language is sent as the English shape", () => {
  const text = JSON.stringify({ urunler: ["Biz", "Rakip"], satirlar: [{ grup: "A", ozellik: "Dışa aktar", kodlar: { Biz: "y", Rakip: "p" }, karar: "later" }] });
  const P = preflightMatrix(text);
  assert.equal(P.ok, true);
  assert.equal(P.report.keysTranslated, true);
  const out = JSON.parse(P.text);
  assert.deepEqual(out.products, ["Biz", "Rakip"]);
  assert.deepEqual(out.lines, [{ group: "A", feature: "Dışa aktar", codes: { Biz: "y", Rakip: "p" }, decision: "later" }]);
  assert.match(describe(P.report), /keys read in another language/);
});

test("step shape: codes are mapped in place, `{ k, evidence }` cells keep their evidence", () => {
  const M = { steps: [{ no: "1", name: "Setup" }], biz: { name: "Us", codes: { 1: "s" } }, products: [{ name: "R", codes: { 1: { k: "f", evidence: "https://example.test/x" } } }] };
  const P = preflightMatrix(JSON.stringify(M), { codes: { s: "d", f: "p" } });
  const out = JSON.parse(P.text);
  assert.equal(out.biz.codes[1], "d");
  assert.deepEqual(out.products[0].codes[1], { k: "p", evidence: "https://example.test/x" });
});

test("most cells in codes nobody knows: the send stops and says how to map them", () => {
  const P = preflightMatrix(line([{ Us: "s", R1: "s" }, { Us: "s", R1: "y" }]));
  assert.equal(P.ok, false);
  assert.match(P.problem, /3 of 4 cells .* use codes the dashboard doesn't know \(`s` \(3\)\)/);
  assert.match(P.problem, /"matrixCodes": \{ "s": "d" \}/);
});

test("a few unknown codes: it goes, and the line says they show as Unknown", () => {
  const P = preflightMatrix(line([{ Us: "y", R1: "y" }, { Us: "n", R1: "z" }]));
  assert.equal(P.ok, true);
  assert.deepEqual(P.report.unknown, [{ code: "z", n: 1 }]);
  assert.match(describe(P.report), /still unknown to the dashboard: z \(1\), shown as Unknown/);
});

test("not JSON, or neither shape: each stops with its own reason; a matrix with no rows yet goes as it is", () => {
  assert.match(preflightMatrix("{oops").problem, /isn't valid JSON/);
  assert.match(preflightMatrix(JSON.stringify({ rows: [] })).problem, /neither `lines` with `products`.*nor `steps` with `biz`/);
  const empty = JSON.stringify({ products: ["A"], lines: [] }), P = preflightMatrix(empty);
  assert.equal(P.ok, true);
  assert.equal(P.text, empty);
  assert.match(describe(P.report), /no rows yet/);
});

test("matrixRead maps codes for every reader that passes them, and never a code it already has", () => {
  const M = JSON.parse(line([{ Us: "s", R1: "y" }, { Us: "f", R1: "n" }]));
  const R = matrixRead(M, { codes: { s: "d", f: "p", y: "n" } });
  assert.deepEqual(R.lines[0].codes, { Us: "d", R1: "y" });
  assert.deepEqual(R.lines[1].codes, { Us: "p", R1: "n" });
  assert.deepEqual(matrixRead(M).lines[0].codes, { Us: "s", R1: "y" }, "without a map, as before");
});

// owner decisions ("we deliberately do not do this") pass through every rewrite untouched.
test("owner decisions survive an untouched pass byte for byte, and the report counts them", () => {
  const text = JSON.stringify({ products: ["Us", "R1"], lines: [{ feature: "Kep", codes: { Us: "n", R1: "y" }, declined: true, decision: "Not doing: legal" }, { feature: "Share", codes: { Us: "n", R1: "y" } }] });
  const P = preflightMatrix(text);
  assert.equal(P.text, text);
  assert.equal(P.report.declined, 1);
  assert.match(describe(P.report), /1 decided against \(shown as "Decided against", not Missing\)/);
  assert.doesNotMatch(describe(preflightMatrix(line([{ Us: "y", R1: "y" }, { Us: "n", R1: "y" }])).report), /decided against/);
});

test("owner decisions survive a code mapping and a translation of the keys (the line shape is rewritten)", () => {
  const mapped = preflightMatrix(JSON.stringify({ products: ["Us", "R1"], lines: [
    { feature: "Kep", codes: { Us: "s", R1: "y" }, declined: true, decision: "Not doing: legal" }, { feature: "Share", codes: { Us: "f", R1: "y" }, declined: "yes" }] }), { codes: { s: "n", f: "p" } });
  const out = JSON.parse(mapped.text);
  assert.equal(out.lines[0].declined, true);
  assert.equal(out.lines[0].decision, "Not doing: legal");
  assert.equal("declined" in out.lines[1], false, "only `true` is a decision; nothing else is invented or passed on");
  const tr = JSON.parse(preflightMatrix(JSON.stringify({ urunler: ["Biz", "Rakip"], satirlar: [{ ozellik: "Kep", kodlar: { Biz: "n", Rakip: "y" }, declined: true, karar: "yapmıyoruz" }] })).text);
  assert.deepEqual(tr.lines, [{ feature: "Kep", codes: { Biz: "n", Rakip: "y" }, decision: "yapmıyoruz", declined: true }]);
});

test("owner decisions, step shape: biz.declined survives a code mapping untouched", () => {
  const M = { steps: [{ no: "1", name: "Kep" }], biz: { name: "Us", codes: { 1: "s" }, declined: { 1: "Not doing: legal" } }, products: [{ name: "R", codes: { 1: { k: "y", evidence: "e" } } }] };
  const P = preflightMatrix(JSON.stringify(M), { codes: { s: "n" } });
  assert.deepEqual(JSON.parse(P.text).biz.declined, { 1: "Not doing: legal" });
  assert.equal(P.report.declined, 1);
});

// publish.mjs end to end, against a local server standing in for Cloud.
const PUBLISH = path.join(Tool, "publish.mjs");
let tmp, pm, server, url, got, reply;
const run = (args, env = {}) => new Promise(resolve => {
  const c = spawn(process.execPath, [PUBLISH, ...args], { env: { PATH: process.env.PATH, ...env } });
  let output = "", error = "";
  c.stdout.on("data", d => (output += d)); c.stderr.on("data", d => (error += d));
  c.on("close", code => resolve({ code, output, error }));
});
before(async () => {
  tmp = temporary("nosy-preflight-"); pm = path.join(tmp, "cargo", "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  server = http.createServer((req, res) => { let b = ""; req.on("data", d => (b += d)); req.on("end", () => { got = JSON.parse(b || "{}"); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply(got))); }); });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); server.unref(); url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections?.(); clean(tmp); });
const setMatrix = (text, K = {}) => { fs.writeFileSync(path.join(pm, "matrix.json"), text); fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ...K })); };

test("publish --dry-run prints the matrix line, and sends the mapped matrix when it really sends", async () => {
  setMatrix(line([{ Us: "s", R1: "f" }, { Us: "y", R1: "n" }]), { matrixCodes: { s: "d", f: "p" } });
  const dry = await run([pm, "--url", url, "--dry-run"]);
  assert.equal(dry.code, 0, dry.error);
  assert.match(dry.output, /matrix: 2 areas × 1 rival; codes mapped: .*s→d/);
  reply = () => ({ ok: true, url: "http://cloud/p/me/cargo" });
  const r = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(r.code, 0, r.error);
  assert.deepEqual(JSON.parse(got.files["pm/matrix.json"]).lines[0].codes, { Us: "d", R1: "p" });
});

test("publish stops before sending a matrix the dashboard would show as Unknown", async () => {
  setMatrix(line([{ Us: "s", R1: "s" }, { Us: "s", R1: "s" }]));
  got = null;
  const r = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(r.code, 1);
  assert.match(r.error, /use codes the dashboard doesn't know/);
  assert.equal(got, null, "nothing was sent");
});

test("what the dashboard says it read is printed; a matrix it did not draw is a warning and a failing exit", async () => {
  setMatrix(line([{ Us: "y", R1: "p" }, { Us: "n", R1: "y" }]));
  reply = () => ({ ok: true, url: "http://cloud/p/me/cargo", reads: { matrix: { areas: 2, rivals: 1, unknown: 0 }, status: null, lowhanging: 3 } });
  const good = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(good.code, 0);
  assert.match(good.output, /Published\. Dashboard: http:\/\/cloud\/p\/me\/cargo/);
  assert.match(good.output, /The dashboard read: matrix 2 areas × 1 rivals; 3 list items\./);
  reply = () => ({ ok: true, url: "http://cloud/p/me/cargo", reads: { matrix: null, status: null, lowhanging: 0 } });
  const bad = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(bad.code, 1);
  assert.match(bad.output, /⚠ The files arrived, but the dashboard drew no matrix .*Open http:\/\/cloud\/p\/me\/cargo before telling anyone it is live/);
  setMatrix(JSON.stringify({ products: ["Us"], lines: [] }));
  reply = () => ({ ok: true, url: "http://cloud/p/me/cargo", reads: { matrix: { areas: 0, rivals: 0, unknown: 0 }, status: null, lowhanging: 0 } });
  const fresh2 = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(fresh2.code, 0, "an empty matrix sent on purpose and read back empty is not a failure");
  reply = () => ({ ok: true, url: "http://cloud/p/me/cargo" });
  const old = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(old.code, 0);
  assert.match(old.output, /This Cloud doesn't say what it drew: open the dashboard and check the matrix/);
});

test("what the dashboard read: decided-against areas and a checked list are named in the line", async () => {
  setMatrix(line([{ Us: "y", R1: "p" }, { Us: "n", R1: "y" }]));
  reply = () => ({ ok: true, url: "http://cloud/p/me/cargo", reads: { matrix: { areas: 2, rivals: 1, unknown: 0, declined: 1 }, status: null, lowhanging: 3, checked: true } });
  const r = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /The dashboard read: matrix 2 areas × 1 rivals, 1 decided against; 3 list items \(the refuter's checked list\)\./);
});

test("an owner decision in pm/matrix.json reaches Cloud as written (the matrix goes up untouched)", async () => {
  const text = JSON.stringify({ products: ["Us", "R1"], lines: [{ feature: "Kep", codes: { Us: "n", R1: "y" }, declined: true, decision: "Not doing: legal" }] });
  setMatrix(text);
  reply = () => ({ ok: true, url: "http://cloud/p/me/cargo" });
  const r = await run([pm, "--url", url, "--yes"], { NOSY_CLOUD_TOKEN: "t" });
  assert.equal(r.code, 0, r.error);
  assert.equal(got.files["pm/matrix.json"], text);
  assert.match((await run([pm, "--url", url, "--dry-run"])).output, /matrix: 1 areas × 1 rival; 1 decided against/);
});
