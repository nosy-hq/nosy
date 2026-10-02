// find-stale.mjs: code is not a claim about status. On a real page 5 of 7 findings were dead symbol
// definitions inside <script> and sentences describing a merge. The scan skips <script>/<style>/<pre>/<code> content, fenced
// code blocks (``` and ~~~) and inline code spans, and still finds the same stale-looking PR in plain prose.
// Each place holds "#501 open PR" (the fake product's #501 is merged); the prose line must be the only finding.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

let K, gh, tmp;
before(async () => {
  K = await fakeProductSetup();
  gh = fakeGhSetup(K.gh);
  tmp = temporary("nosy-stale-code-");
});
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

const scan = (name, body) => {
  const page = path.join(tmp, name);
  fs.writeFileSync(page, body);
  const jsonPath = path.join(tmp, name + ".json");
  const r = run(path.join(Tool, "find-stale.mjs"), [K.pm, page, "--json", jsonPath], { env: gh.env });
  assert.equal(r.code, 0, `stderr: ${r.error}`);
  return JSON.parse(fs.readFileSync(jsonPath, "utf8")).findings;
};

const STALE = "#501 open PR";

test("script, style, pre, code, fenced blocks and inline code spans are skipped; plain prose is still found, on its own line", () => {
  const f = scan("mixed.html", [
    "<!doctype html><html><body>",                       // 1
    "<script>",                                          // 2
    `const x = 1; // ${STALE}`,                          // 3
    "</script>",                                         // 4
    "<style>",                                           // 5
    `/* ${STALE} */`,                                    // 6
    "</style>",                                          // 7
    `<pre>${STALE}`,                                     // 8
    "</pre>",                                            // 9
    `<p>See <code>${STALE}</code> for the call.</p>`,    // 10
    "```js",                                             // 11
    `// ${STALE}`,                                       // 12
    "```",                                               // 13
    "~~~",                                               // 14
    `${STALE}`,                                          // 15
    "~~~",                                               // 16
    `Inline \`${STALE}\` span.`,                         // 17
    `<p>Plain prose: ${STALE}, waiting on review.</p>`,  // 18
    "</body></html>",
  ].join("\n"));
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].ref, "#501");
  assert.deepEqual(f[0].lines, [18], "line numbers are still the file's own after blanking");
});

test("a fence is closed by the same fence only, and an unclosed one runs to the end of the file", () => {
  const f = scan("fence.html", ["````", "```", `${STALE}`, "```", "````", `Prose again: ${STALE}.`, "~~~", `${STALE}`].join("\n"));
  assert.deepEqual(f.map(x => x.lines), [[6]], "the inner ``` doesn't close a four-backtick fence; the unclosed ~~~ hides the last line");
});

test("an unmatched backtick is not a code span", () => {
  const f = scan("tick.html", `<p>It's a back\`tick and ${STALE}.</p>\n`);
  assert.equal(f.length, 1);
});
