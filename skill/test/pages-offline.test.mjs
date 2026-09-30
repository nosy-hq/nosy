// The pages Nosy builds make no network request when opened: no web fonts, no external stylesheet or script, no images
// from elsewhere. (Links you click, such as a rival's address, are links, not requests.)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { page } from "../tools/scoreboard.mjs";

const dirs = [];
after(() => dirs.forEach(clean));

// What a browser fetches on load: stylesheets, scripts, images, fonts, prefetch/preconnect hints, CSS url()/@import.
function requests(html) {
  const out = [];
  for (const m of html.matchAll(/<(link|script|img|iframe|source|video|audio)\b[^>]*>/gi)) if (/\b(?:href|src)\s*=\s*["']?(?:https?:)?\/\//i.test(m[0])) out.push(m[0].slice(0, 120));
  for (const m of html.matchAll(/url\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi)) out.push(m[0]);
  for (const m of html.matchAll(/@import\s+(?:url\()?["']?(?:https?:)?\/\/[^;]*/gi)) out.push(m[0]);
  return out;
}

test("the decision page (build-page.mjs) loads nothing from the network, and uses a system font stack", async () => {
  const K = await fakeProductSetup(); dirs.push(K.root);
  assert.equal(run(path.join(Tool, "build-matrix.mjs"), [K.pm]).code, 0);
  const out = temporary("nosy-offline-page-"); dirs.push(out);
  const file = path.join(out, "page.html");
  const r = run(path.join(Tool, "build-page.mjs"), [K.pm, file]);
  assert.equal(r.code, 0, r.error);
  const html = fs.readFileSync(file, "utf8");
  assert.deepEqual(requests(html), []);
  assert.doesNotMatch(html, /googleapis|gstatic|preconnect|Anton|IBM Plex/);
  assert.match(html, /--body:system-ui/);
});

test("the scoreboard loads nothing from the network either", () => {
  const root = temporary("nosy-offline-score-"); dirs.push(root);
  const pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "state", "shipped.json"), JSON.stringify({ repo: "acme/app", branch: "main", window: { from: "2026-07-01", to: "2026-09-28" }, generated: "2026-09-28T10:00:00Z", linkTypes: ["closes"], shipped: [], counts: { requests: 1, open: 1, closedNoLink: 0 } }));
  const html = page(pm, { minN: 5 });
  assert.deepEqual(requests(html), []);
  assert.doesNotMatch(html, /googleapis|gstatic|preconnect|Anton|IBM Plex/);
});
