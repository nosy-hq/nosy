// rival-facts: the price line of each rival file, for the battlecard page. Single-line and nested-list shapes,
// rivals without a price left out, the template skipped.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { temporary, clean, Tool } from "./helpers.mjs";
import { priceOf, rivalFacts } from "../tools/rival-facts.mjs";

let tmp, pm;
before(() => {
  tmp = temporary("nosy-rival-facts-");
  pm = path.join(tmp, "pm");
  fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  const put = (f, s) => fs.writeFileSync(path.join(pm, "rivals", f), s);
  put("acme.md", "# Acme\n- **Site:** https://acme.test\n- **Price:** Free · Pro $12/mo (https://acme.test/pricing)\n- **Status:** active\n");
  put("nested.md", "# Nested\n- **Price:**\n  - **Plan A:** $10/mo\n  - **Plan B:** $30/mo\n- **Status:** active\n");
  put("none.md", "# None\n- **Site:** https://none.test\n");
  put("_TEMPLATE.md", "# Name\n- **Price:** <fill in>\n");
});
after(() => clean(tmp));

test("priceOf: the text after the label, on its line", () => {
  assert.equal(priceOf("- **Price:** Free · Pro $12/mo\n- **Status:** x"), "Free · Pro $12/mo");
});

test("priceOf: indented sub-bullets are joined, markdown dropped, the next top-level bullet is not", () => {
  assert.equal(priceOf("- **Price:**\n  - **Plan A:** $10/mo\n  - **Plan B:** $30/mo\n- **Status:** active"), "Plan A: $10/mo · Plan B: $30/mo");
});

test("priceOf: no price line is an empty string", () => assert.equal(priceOf("# X\n- **Site:** y"), ""));

test("rivalFacts: keyed by file name, leaves out rivals without a price and the template", () => {
  const f = rivalFacts(pm);
  assert.deepEqual(Object.keys(f).sort(), ["acme", "nested"]);
  assert.match(f.acme.price, /Pro \$12\/mo/);
});

test("rivalFacts: a long price is cut at a word boundary with an ellipsis", () => {
  fs.writeFileSync(path.join(pm, "rivals", "long.md"), "# Long\n- **Price:** " + "word ".repeat(400) + "\n");
  const p = rivalFacts(pm).long.price;
  assert.ok(p.length <= 701 && p.endsWith("…"));
});

test("publish --dry-run lists rival-facts.json when rivals have prices", () => {
  fs.writeFileSync(path.join(pm, "matrix.json"), JSON.stringify({ steps: [{ no: "1", name: "Setup" }], biz: { name: "Cargo", codes: { 1: "y" } }, products: [] }));
  const r = spawnSync(process.execPath, [path.join(Tool, "publish.mjs"), pm, "--dry-run", "--project", "cargo"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /pm\/state\/rival-facts\.json/);
});
