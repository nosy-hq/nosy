// rivals-import.mjs: rival research kept outside pm/rivals (the first run on a real product: references/<name>/competitive-*.md)
// is copied into pm/rivals so the matrix build, the watch and the tiers work on it. Copies, never moves, never overwrites.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importRivals } from "../tools/rivals-import.mjs";
import { tour } from "../tools/tour.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const RIVAL = "# Acme\n\n**Latest major announcement:** none\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | A | y | x |\n| 2 | B | n | x |\n| 3 | C | p | x |\n";
function product() {
  const root = temporary("nosy-rimport-"); dirs.push(root);
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), typeof c === "string" ? c : JSON.stringify(c)); };
  put("references/leagle/competitive-2026-09.md", RIVAL); put("references/hubox/competitive-2026-09.md", RIVAL.replace("Acme", "Hubox"));
  put("references/avasistan.md", RIVAL.replace("Acme", "Av")); put("references/notes/README.md", "# just notes\n\nnothing about rivals\n");
  put("pm/sources.json", { repo: ".", ref: "main", rivalsPath: "references" });
  return { root, pm: path.join(root, "pm") };
}

test("rival-shaped files are copied by parent folder name (or their own name), the originals stay, other documents are left", () => {
  const { root, pm } = product();
  const R = importRivals(pm);
  assert.deepEqual(R.files.map(f => `${f.from} → ${f.slug}`).sort(), ["avasistan.md → avasistan", "hubox/competitive-2026-09.md → hubox", "leagle/competitive-2026-09.md → leagle"]);
  assert.deepEqual(fs.readdirSync(path.join(pm, "rivals")).filter(f => f.endsWith(".md")).sort(), ["avasistan.md", "hubox.md", "leagle.md"]);
  assert.ok(fs.existsSync(path.join(root, "references/leagle/competitive-2026-09.md")), "copy, not move");
  assert.ok(!fs.existsSync(path.join(pm, "rivals", "README.md")));
});

test("a second run copies nothing and overwrites nothing; an owner's file with the same slug is never replaced", () => {
  const { pm } = product();
  fs.mkdirSync(path.join(pm, "rivals")); fs.writeFileSync(path.join(pm, "rivals", "leagle.md"), "# mine\n");
  const first = importRivals(pm);
  assert.equal(fs.readFileSync(path.join(pm, "rivals", "leagle.md"), "utf8"), "# mine\n");
  assert.ok(first.files.find(f => f.from.startsWith("leagle/")).slug.startsWith("leagle-"), "taken slug gets a suffix");
  const again = importRivals(pm);
  assert.ok(again.files.every(f => f.state === "already there"));
});

test("--dry-run lists and writes nothing; no folder is an error with the fix", () => {
  const { pm } = product();
  const R = importRivals(pm, { dry: true });
  assert.ok(R.files.every(f => f.state === "would copy"));
  assert.ok(!fs.existsSync(path.join(pm, "rivals")));
  const r = run(path.join(Tool, "rivals-import.mjs"), [pm, "--from", "/nowhere"]);
  assert.equal(r.code, 1);
  assert.match(r.output, /no folder at .*Name the folder with --from <folder>, or set `rivalsPath`/);
});

test("tour: a rival folder outside pm/ becomes a step before neighbors, and is done once copied", () => {
  const { pm } = product();
  let R = tour(pm);
  const s = R.steps.find(x => x.id === "rivals-import");
  assert.equal(s.state, "todo");
  assert.match(s.why, /3 rival files already in references, none in pm\/rivals yet/);
  assert.ok(R.steps.findIndex(x => x.id === "rivals-import") < R.steps.findIndex(x => x.id === "neighbors"));
  importRivals(pm);
  R = tour(pm);
  assert.equal(R.steps.find(x => x.id === "rivals-import").state, "fresh");
});

// ---- review of 2 Oct: names with spaces and accents, a name that differs only in case, the copy keeps its age, never overwrites ----
test("file and folder names with spaces, accents and capitals are copied under a plain slug, and nothing is overwritten", () => {
  const root = temporary("nosy-rimport-names-"); dirs.push(root);
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); };
  put("references/Çelik Hukuk Bürosu/rakip analizi 2026.md", RIVAL); put("references/Müller & Söhne/competitive.md", RIVAL.replace("Acme", "M"));
  put("references/Ünal ıspanak.md", RIVAL.replace("Acme", "U")); put("references/東京/competitive.md", RIVAL.replace("Acme", "T")); put("references/日本/competitive.md", RIVAL.replace("Acme", "J"));
  put("pm/sources.json", JSON.stringify({ repo: ".", ref: "main", rivalsPath: "references" }));
  const pm = path.join(root, "pm"), R = importRivals(pm);
  assert.deepEqual(R.files.map(f => f.slug).sort(), ["celik-hukuk-burosu", "muller-sohne", "rival", "rival-2", "unal-ispanak"]);
  assert.equal(R.files.length, 5, "the two names with no Latin letter don't collide: rival, rival-2");
  assert.deepEqual(fs.readdirSync(path.join(pm, "rivals")).filter(f => f.endsWith(".md")).length, 5);
  assert.ok(fs.existsSync(path.join(root, "references/Çelik Hukuk Bürosu/rakip analizi 2026.md")), "the original stays");
  assert.equal(importRivals(pm).files.every(f => f.state === "already there"), true, "a second run knows its own copies, spaces and all");
});

test("a pm/rivals file that differs only in case is taken: the copy gets a suffix instead of replacing it (macOS and Windows keep one file for both names)", () => {
  const { pm } = product();
  fs.mkdirSync(path.join(pm, "rivals")); fs.writeFileSync(path.join(pm, "rivals", "Leagle.md"), "# mine, capitalised\n");
  const R = importRivals(pm);
  assert.equal(R.files.find(f => f.from.startsWith("leagle/")).slug, "leagle-2");
  assert.equal(fs.readFileSync(path.join(pm, "rivals", "Leagle.md"), "utf8"), "# mine, capitalised\n");
});

test("the same bytes already under that name (copied by hand, log lost) are 'already there', not a second rival", () => {
  const { pm } = product();
  fs.mkdirSync(path.join(pm, "rivals")); fs.copyFileSync(path.join(path.dirname(pm), "references/leagle/competitive-2026-09.md"), path.join(pm, "rivals", "leagle.md"));
  const R = importRivals(pm);
  assert.equal(R.files.find(f => f.from.startsWith("leagle/")).state, "already there");
  assert.equal(fs.existsSync(path.join(pm, "rivals", "leagle-2.md")), false);
});

test("a copy keeps the original's modification time: research done last spring doesn't read as fresh today", () => {
  const { root, pm } = product();
  const old = new Date("2026-03-01T10:00:00Z"); fs.utimesSync(path.join(root, "references/leagle/competitive-2026-09.md"), old, old);
  importRivals(pm);
  assert.equal(Math.round(fs.statSync(path.join(pm, "rivals", "leagle.md")).mtimeMs / 1000), Math.round(old.getTime() / 1000));
});

test("a rivalsPath of '.' skips node_modules and big files without reading them, and doesn't follow a link back up", () => {
  const root = temporary("nosy-rimport-skip-"); dirs.push(root);
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); };
  put("node_modules/pkg/competitive.md", RIVAL); put("vendor/x/competitive.md", RIVAL); put("docs/acme/competitive.md", RIVAL); put("big/huge.md", RIVAL + "x".repeat(2 << 20));
  try { fs.symlinkSync(root, path.join(root, "docs", "loop")); } catch {}
  put("pm/sources.json", JSON.stringify({ repo: ".", ref: "main", rivalsPath: "." }));
  const R = importRivals(path.join(root, "pm"));
  assert.deepEqual(R.files.map(f => f.from), ["docs/acme/competitive.md"]);
});
