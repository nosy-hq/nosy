// Contract tests for skill/tools/nosy.mjs (the single entry point), news.mjs (Slack/Discord message) and mcp.mjs (MCP server).
// Fake product "Cargo" + a fake `gh` (no network). No real request is made to the webhook: the privacy test stops before sending.
import { localDay } from "../tools/today.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs");
let K, gh, tmp, weekly;

before(async () => {
  K = await fakeProductSetup();
  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-cli-");
  // The default weekly run is the full cycle (inventory, shipped, psst…); --short has its own test below.
  weekly = run(NOSY, ["weekly", "--pm", K.pm, "--since", "30d"], { env: { ...gh.env, NOSY_OFFLINE: "1" } }); // no network in tests: skips watch
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

test("weekly runs the full cycle and writes pm/state and the page", () => {
  assert.equal(weekly.code, 0, `weekly exit code, stderr: ${weekly.error}`);
  assert.match(weekly.output, /inventory: ✓ · shipped: ✓ · psst: ✓ · page: ✓/);
  for (const f of ["state/status.json", "state/lowhanging.json", "state/inventory.json", "page.html"])
    assert.ok(fs.existsSync(path.join(K.pm, f)), `${f} wasn't written`);
  assert.ok(fs.readdirSync(path.join(K.pm, "state")).some(f => f.endsWith("-delivery.md")), "delivery file wasn't written");
});

test("weekly --short: shipped → score (only with pm/bets/) → page; shipped runs the record and recent", () => {
  const pm = path.join(tmp, "front"); fs.cpSync(K.pm, pm, { recursive: true });
  const r = run(NOSY, ["weekly", "--short", "--pm", pm, "--since", "30d"], { env: { ...gh.env, NOSY_OFFLINE: "1" } });
  assert.match(r.output, /── nosy shipped ──[\s\S]*Work that landed, by reference[\s\S]*recent: merged since the last run/);
  assert.match(r.output, /shipped: ✓ · page: ✓$/m);
  assert.doesNotMatch(r.output, /── nosy psst ──|── nosy inventory ──/);
  fs.mkdirSync(path.join(pm, "bets"));
  const r2 = run(NOSY, ["weekly", "--short", "--pm", pm, "--since", "30d"], { env: { ...gh.env, NOSY_OFFLINE: "1" } });
  assert.match(r2.output, /shipped: ✓ · score: ✓ · page: ✓$/m);
});

test("notify leads with what merged and bets, and never sends a stale psst list", () => {
  const pm = path.join(tmp, "news"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const today = localDay();
  fs.writeFileSync(path.join(pm, "state", "shipped.json"), JSON.stringify({ recent: { merged: [{ n: 431, title: "Bulk export", merged: today, ref: "#412" }], close: [] } }));
  fs.writeFileSync(path.join(pm, "state", "score.json"), JSON.stringify({ bets: [{ bet: "Bulk export", estimate: "S", actual: "M", landed: today, status: "landed", origin: "placed" }] }));
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ generated: "2026-01-01T00:00:00Z", items: [{ title: "old item", type: "x" }] }));
  const r = run(NOSY, ["notify", "--pm", pm]);
  assert.match(r.output, /\*Merged since last time:\*\n• #431 Bulk export — for #412/);
  assert.match(r.output, /Bulk export landed .* estimated S, took M/);
  assert.doesNotMatch(r.output, /old item/);
});

test("suggests setup when sources.json is missing, doesn't crash", () => {
  const r = run(NOSY, ["psst", "--pm", tmp]);
  assert.equal(r.code, 1);
  assert.match(r.error, /nosy setup/);
});

test("page also produces a page in an empty pm folder with no matrix", () => {
  const exit = path.join(tmp, "bos.html");
  const r = run(NOSY, ["page", exit, "--pm", tmp]);
  assert.equal(r.code, 0, r.error);
  assert.ok(fs.statSync(exit).size > 1000);
});

test("notify without a webhook only prints: Psst, the first 3 items, the shareable section", () => {
  const r = run(NOSY, ["notify", "--pm", K.pm], { env: gh.env });
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /^👀 Psst…/);
  assert.equal((r.output.match(/^• .+ — /gm) || []).length, 3, "exactly 3 low-hanging items");
  assert.match(r.output, /Can be announced \(for marketing\)/);
  assert.match(r.error, /No webhook given/);
});

test("notify doesn't send when the message contains a secret", () => {
  const pm = path.join(tmp, "sirli");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  const secret = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ generated: new Date().toISOString(), items: [{ title: `token ${secret}`, type: "Backend ready, not on screen", effort: "S" }] }));
  const r = run(NOSY, ["notify", "--pm", pm, "--slack", "http://127.0.0.1:9/missing"]);
  assert.equal(r.code, 1);
  assert.match(r.error, /not sent/);
  assert.doesNotMatch(r.output, /Slack: sent/);
});

test("mcp: answers initialize, tools/list and tools/call with one JSON-RPC line each", () => {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nosy_psst", arguments: { pm: K.pm } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "missing_boyle", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "unknown/method" },
  ];
  const r = spawnSync(process.execPath, [NOSY, "mcp"], { input: messages.map(m => JSON.stringify(m)).join("\n") + "\n", encoding: "utf8", env: gh.env });
  const answer = Object.fromEntries(r.stdout.trim().split("\n").map(l => JSON.parse(l)).map(m => [m.id, m]));
  assert.equal(Object.keys(answer).length, 5, "the notification shouldn't get a reply, the other 5 requests should");
  assert.equal(answer[1].result.serverInfo.name, "nosy");
  assert.equal(answer[1].result.protocolVersion, "2025-06-18");
  const names = answer[2].result.tools.map(t => t.name);
  for (const name of ["nosy_psst", "nosy_canwe", "nosy_peek", "nosy_inventory", "nosy_evidence", "nosy_ledger", "nosy_publish"]) assert.ok(names.includes(name), name);
  assert.ok(answer[2].result.tools.every(t => !("cmd" in t) && !("openWorld" in t) && !("readOnly" in t) && !("destructive" in t)), "an internal field shouldn't leak out");
  // Annotations tell a client what a tool does: the two that only read say so; the ones that write generated files under pm/ do not; publish is the one that replaces and talks outward.
  const ann = Object.fromEntries(answer[2].result.tools.map(t => [t.name, t.annotations]));
  for (const n of ["nosy_evidence", "nosy_ledger"]) assert.deepEqual(ann[n], { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, n);
  for (const n of ["nosy_psst", "nosy_canwe", "nosy_peek", "nosy_inventory", "nosy_todo"]) assert.deepEqual(ann[n], { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, n);
  assert.deepEqual(ann.nosy_publish, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(answer[2].result.tools.filter(t => t.annotations.openWorldHint).map(t => t.name), ["nosy_publish"], "only publish writes outward");
  assert.equal(answer[3].result.isError, false);
  assert.match(answer[3].result.content[0].text, /§21/);
  assert.equal(answer[4].error.code, -32602);
  assert.equal(answer[5].error.code, -32601);
});

test("exit contract: weekly marks a step that found something with ! and exits 2 (a bet open far past its estimate)", () => {
  const pm = path.join(tmp, "contract"); fs.cpSync(K.pm, pm, { recursive: true });
  const placed = run(path.join(Tool, "bet.mjs"), [pm, "place", "Barcode scanning", "--why", "test", "--estimate", "S", "--date", "2026-01-05"]);
  assert.equal(placed.code, 0, placed.error);
  const score = run(NOSY, ["score", "--pm", pm]);
  assert.equal(score.code, 2, "nosy passes score's 2 on");
  const r = run(NOSY, ["weekly", "--short", "--pm", pm, "--since", "30d"], { env: { ...gh.env, NOSY_OFFLINE: "1" } });
  assert.match(r.output, /score: !/);
  assert.equal(r.code, 2);
});

// BlogFactory field test: `peek --days 30` was read as a git ref and failed with `--days..origin/main`; recent, sweep, atlas and ship-notes all take --days.
test("peek and notes take --days N like the other window commands, and a bad value is said, not guessed", () => {
  const env = { ...gh.env, NOSY_OFFLINE: "1" };
  const a = run(NOSY, ["peek", "30d", "--pm", K.pm], { env }), b = run(NOSY, ["peek", "--days", "30", "--pm", K.pm], { env });
  assert.equal(b.code, a.code, `peek --days 30 behaves like peek 30d: ${b.error}`);
  assert.doesNotMatch(b.output + b.error, /--days\.\./, "not read as a git ref");
  assert.equal(b.output, a.output, "same window, same answer");
  const bad = run(NOSY, ["peek", "--days", "soon", "--pm", K.pm], { env });
  assert.equal(bad.code, 1); assert.match(bad.error, /--days needs a number of days/);
  const n = run(NOSY, ["notes", "--days", "30", "--for", "team", "--pm", K.pm], { env });
  assert.doesNotMatch(n.output + n.error, /--days\.\./);
});
