// notify and the MCP publish tool follow the same rule as publish: personal data stops a send unless the owner overrides it,
// and the MCP tool only lists what it would send until the call says confirm: true.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), MCP = path.join(Tool, "mcp.mjs");
let tmp, K;
before(async () => { tmp = temporary("nosy-notify-personal-"); K = await fakeProductSetup(); });
after(() => { clean(tmp); clean(K.root); });

function pmWithTitle(title) {
  const pm = path.join(tmp, `pm-${Math.abs(title.length * 7 + title.charCodeAt(0))}`);
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "lowhanging.json"), JSON.stringify({ generated: new Date().toISOString(), items: [{ title, type: "Backend ready, not on screen", effort: "S" }] }));
  return pm;
}

test("notify: an e-mail address alone stops the send (nothing is contacted); the dry run says a real send would stop", () => {
  const pm = pmWithTitle("Ask jamie.fakeperson@mailbox.invalid about export");
  const real = run(NOSY, ["notify", "--pm", pm, "--slack", "http://127.0.0.1:9/missing"]);
  assert.equal(real.code, 1);
  assert.match(real.error, /not sent/);
  assert.match(real.error, /E-mail/);
  assert.match(real.error, /--allow-sensitive/);
  assert.doesNotMatch(real.output, /Slack: (sent|failed)/, "the webhook must not even be tried");
  const dry = run(NOSY, ["notify", "--pm", pm, "--dry-run"]);
  assert.match(dry.error, /A real send would stop here/);
});

test("notify: --allow-sensitive goes on to send (here the unreachable webhook fails, which proves it was tried)", () => {
  const pm = pmWithTitle("Ask jamie.fakeperson@mailbox.invalid about the export");
  const r = run(NOSY, ["notify", "--pm", pm, "--slack", "http://127.0.0.1:9/missing", "--allow-sensitive"]);
  assert.match(r.output, /Slack: failed/);
});

test("mcp: nosy_publish lists what it would send unless confirm is true, and says what leaves", () => {
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [K.pm]).code, 0);
  const call = args => {
    const msgs = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" }, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nosy_publish", arguments: { pm: K.pm, ...args } } }];
    const r = spawnSync(process.execPath, [MCP], { input: msgs.map(m => JSON.stringify(m)).join("\n") + "\n", encoding: "utf8", env: { PATH: process.env.PATH, NOSY_CLOUD_URL: "http://127.0.0.1:9" } });
    return r.stdout.trim().split("\n").map(l => JSON.parse(l));
  };
  const plain = call({});
  const tool = plain[1].result.tools.find(t => t.name === "nosy_publish");
  assert.ok(tool.inputSchema.properties.confirm, "confirm is part of the tool");
  assert.match(tool.description, /no commit subjects, author names, PR or issue titles/);
  const text = plain[2].result.content[0].text;
  assert.match(text, /Would publish \d+ file\(s\) to http:\/\/127\.0\.0\.1:9/);
  assert.equal(plain[2].result.isError, false);
  const confirmed = call({ confirm: true });
  assert.match(confirmed[2].result.content[0].text, /NOSY_CLOUD_TOKEN is not set/, "with confirm it goes on to a real send, which needs the token");
});
