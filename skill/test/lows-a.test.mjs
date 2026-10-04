// Low-severity fixes, batch A: `weekly` says when it skipped the rival watch; `sweep-check` never says "agrees" over nothing it read;
// rival files with a .MD / .markdown extension are read, and "no rivals yet" names the subfolders and other files it passed over.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fakeProductSetup } from "./fake-product.mjs";
import { run, fakeGhSetup, temporary, clean, Tool } from "./helpers.mjs";

const NOSY = path.join(Tool, "nosy.mjs"), RECONCILE = path.join(Tool, "sweep-reconcile.mjs"), TIERS = path.join(Tool, "rival-tiers.mjs"), WATCH = path.join(Tool, "watch-rivals.mjs"), ATLAS = path.join(Tool, "atlas-matrix.mjs");
let K, gh, tmp;
before(async () => { K = await fakeProductSetup(); gh = fakeGhSetup(K.gh); tmp = temporary("nosy-lows-a-"); });
after(() => { clean(K.root); clean(gh.dir); clean(tmp); });

const pmWith = (name, files) => {
  const pm = path.join(tmp, name);
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(pm, f)), { recursive: true }); fs.writeFileSync(path.join(pm, f), text); }
  return pm;
};

// 1. weekly: the summary line always has a watch entry; a skipped watch says why.
test("weekly names the rival watch as skipped when NOSY_OFFLINE is set", () => {
  const pm = path.join(tmp, "offline"); fs.cpSync(K.pm, pm, { recursive: true }); fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  const r = run(NOSY, ["weekly", "--pm", pm, "--since", "30d"], { env: { ...gh.env, NOSY_OFFLINE: "1" } });
  assert.match(r.output, /watch: skipped \(NOSY_OFFLINE is set\)/);
});
test("weekly names the rival watch as skipped when there is no pm/rivals", () => {
  const pm = path.join(tmp, "norivals"); fs.cpSync(K.pm, pm, { recursive: true }); fs.rmSync(path.join(pm, "rivals"), { recursive: true, force: true });
  const r = run(NOSY, ["weekly", "--pm", pm, "--since", "30d"], { env: { ...gh.env } });
  assert.match(r.output, /watch: skipped \(no pm\/rivals folder\)/);
});

// 2. sweep-check: nothing readable is not agreement.
const sweepFile = rivals => JSON.stringify({ from: "2026-09-01", to: "2026-10-04", rivals });
test("sweep-check says none could be read, not 'agrees', and exits 2, when no rival was read", () => {
  const pm = pmWith("sweep-none", {
    "state/rival-sweep.json": sweepFile([{ slug: "acme", name: "Acme", pages: [{ url: "https://acme.test/changelog", ok: false }] }, { slug: "beta", name: "Beta", pages: [] }]),
    "rivals/acme.md": "# Acme\n- **Latest major announcement:** 2026-07-14 — x\n", "rivals/beta.md": "# Beta\n",
  });
  const r = run(RECONCILE, [pm]);
  assert.doesNotMatch(r.output, /agrees/i);
  assert.match(r.output, /none of the rivals could be read/i);
  assert.equal(r.code, 2);
});
test("sweep-check still says agrees (exit 0) when at least one rival was read and agrees", () => {
  const pm = pmWith("sweep-ok", {
    "state/rival-sweep.json": sweepFile([{ slug: "acme", name: "Acme", pages: [{ url: "https://acme.test/c", ok: true, kind: "release-notes", entries: [{ date: "2026-07-10", text: "v1" }] }] }]),
    "rivals/acme.md": "# Acme\n- **Latest major announcement:** 2026-07-14 — x\n",
  });
  const r = run(RECONCILE, [pm]);
  assert.match(r.output, /Every rival the sweep could read agrees/);
  assert.equal(r.code, 0);
});

// 3. rival files: case-insensitive extensions, .markdown, and skipped files named.
const rivalMd = name => `# ${name}\n\n## Sources\n- https://example.invalid/${name.toLowerCase()} (read 2026-09-28)\n`;
test("tiers reads rival files named .MD and .markdown", () => {
  const pm = pmWith("ext", { "rivals/upper.MD": rivalMd("Upper"), "rivals/long.markdown": rivalMd("Long") });
  const r = run(TIERS, ["plan", pm]);
  assert.equal(r.code, 0, r.error);
  assert.match(r.output, /upper/i); assert.match(r.output, /long/i);
});
test("tiers: 'No rivals yet' names the subfolder and the unsupported file it skipped", () => {
  const pm = pmWith("skipped", { "rivals/group/acme.md": rivalMd("Acme"), "rivals/notes.txt": "x" });
  const r = run(TIERS, ["plan", pm]);
  assert.equal(r.code, 1);
  assert.match(r.error, /No rivals yet/);
  assert.match(r.error, /group\//); assert.match(r.error, /notes\.txt/);
});
test("watch reads .MD / .markdown rival files", () => {
  const pm = pmWith("watch-ext", { "rivals/upper.MD": "# Upper\n", "rivals/long.markdown": "# Long\n" });
  const r = run(WATCH, [pm]);
  assert.match(r.output, /· 2 rivals,/);
});
test("watch with no readable rival file names what it skipped and does not exit 0 as if all clear", () => {
  const pm = pmWith("watch-skip", { "rivals/group/acme.md": rivalMd("Acme"), "rivals/notes.txt": "x" });
  const r = run(WATCH, [pm]);
  assert.match(r.output, /No rival files/); assert.match(r.output, /group\//); assert.match(r.output, /notes\.txt/);
  assert.equal(r.code, 2);
});
test("atlas-matrix reads .MD reports and names a skipped subfolder when none are readable", () => {
  const pm = pmWith("atlas", { "atlas/group/x.md": "# X\n" });
  const r = run(ATLAS, [pm]);
  assert.equal(r.code, 1);
  assert.match(r.error, /group\//);
});
