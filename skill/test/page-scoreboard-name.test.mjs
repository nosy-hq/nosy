// `nosy page --scoreboard` writes pm/scoreboard.html (the name tea.md and DATA.md promise) and never overwrites the
// decision page, pm/page.html.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs");
let K;
before(async () => { K = await fakeProductSetup(); assert.equal(run(path.join(Tool, "build-matrix.mjs"), [K.pm]).code, 0); });
after(() => clean(K.root));

const record = { repo: "acme/app", branch: "main", window: { from: "2026-07-01", to: "2026-09-28" }, generated: "2026-09-28T10:00:00Z", linkTypes: ["closes", "mentions", "timeline"], shipped: [], counts: { requests: 1, open: 1 } };

test("--scoreboard writes pm/scoreboard.html and leaves pm/page.html alone", () => {
  const first = run(NOSY, ["page", "--pm", K.pm]);
  assert.equal(first.code, 0, first.error);
  const decision = fs.readFileSync(path.join(K.pm, "page.html"), "utf8");
  fs.mkdirSync(path.join(K.pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(K.pm, "state", "shipped.json"), JSON.stringify(record));
  const r = run(NOSY, ["page", "--scoreboard", "--pm", K.pm]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /scoreboard\.html/);
  assert.match(fs.readFileSync(path.join(K.pm, "scoreboard.html"), "utf8"), /What shipped/);
  assert.equal(fs.readFileSync(path.join(K.pm, "page.html"), "utf8"), decision, "the decision page was overwritten");
});

test("--scoreboard with an explicit output path writes there", () => {
  const dir = temporary("nosy-sb-out-"); const out = path.join(dir, "board.html");
  try {
    const r = run(NOSY, ["page", "--scoreboard", out, "--pm", K.pm]);
    assert.equal(r.code, 0, r.error);
    assert.ok(fs.existsSync(out));
  } finally { clean(dir); }
});

test("--scoreboard with no shipped record falls back to the decision page, at page.html", () => {
  const dir = temporary("nosy-sb-none-"); const pm = path.join(dir, "pm");
  try {
    fs.cpSync(K.pm, pm, { recursive: true }); fs.rmSync(path.join(pm, "state", "shipped.json"), { force: true }); fs.rmSync(path.join(pm, "page.html"), { force: true }); fs.rmSync(path.join(pm, "scoreboard.html"), { force: true });
    const r = run(NOSY, ["page", "--scoreboard", "--pm", pm]);
    assert.equal(r.code, 0, r.error);
    assert.ok(fs.existsSync(path.join(pm, "page.html")));
    assert.ok(!fs.existsSync(path.join(pm, "scoreboard.html")));
  } finally { clean(dir); }
});
