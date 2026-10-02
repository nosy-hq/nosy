// Rival research kept outside pm/rivals. A real product kept it in references/<name>/competitive-*.md, so
// doctor said "no rival files yet" and neighbors started from zero. find-sources proposes `rivalsPath` from the files' own structure
// (the rival template's headings or its matrix table), rivalsDir/rivalFiles read it, next.mjs and doctor --check count from it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { next, rivalTouched } from "../tools/next.mjs";
import { rivalsDir, rivalFiles, rivalDoc } from "../tools/sources-file.mjs";
import { check } from "../tools/health.mjs";
import { run, temporary, clean, Tool } from "./helpers.mjs";

const FS = path.join(Tool, "find-sources.mjs"), dirs = [];
after(() => dirs.forEach(clean));
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const RIVAL = name => `# ${name}\n\n- **Category:** x\n- **Latest major announcement:** 2026-09-01 — a thing · delivery: shipped\n\n## Feature matrix\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | a | y | u |\n| 2 | b | n | |\n| 3 | c | p | v |\n`;
const MATRIX_ONLY = "# Notes\n\n| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | a | y | u |\n| 2 | b | n | |\n| 3 | c | d | v |\n";

// A product with its rival research in references/<name>/competitive-<name>.md, and decoys.
function product() {
  const root = temporary("nosy-rivalspath-"); dirs.push(root);
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  put("README.md", "# Acme\nA product.\n");
  put("references/acme/competitive-acme.md", RIVAL("Acme"));
  put("references/globex/competitive-globex.md", RIVAL("Globex"));
  put("references/initech/competitive-initech.md", MATRIX_ONLY);           // the matrix table alone is structure enough
  put("references/README.md", "# References\n\nA table:\n\n| a | b |\n|--|--|\n| 1 | y |\n");  // a document, not a rival
  put("references/acme/pricing.md", "# Pricing\n\nNothing like a rival file here.\n");
  put("docs/lonely/competitive-one.md", RIVAL("One"));                        // one rival-shaped file is not a folder of them
  put("node_modules/pkg/a.md", RIVAL("A")); put("node_modules/pkg/b.md", RIVAL("B")); put("node_modules/pkg/c.md", RIVAL("C")); // skipped
  put("a/b/c/d/deep1.md", RIVAL("D1")); put("a/b/c/d/deep2.md", RIVAL("D2"));  // found at most as a/b/c (3 levels down, 2 files): loses to references (3 files)
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"], { env: ENV });
  execFileSync("git", ["-C", root, "add", "-A"], { env: ENV });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "init"], { env: ENV });
  return root;
}
const suggest = (root, pm) => { const out = path.join(path.dirname(pm), "s.json"); const r = run(FS, [root, "--pm", pm, "--json", out]); assert.equal(r.code, 0, r.error); return { r, j: JSON.parse(fs.readFileSync(out, "utf8")) }; };

test("rivalDoc: the template's own structure, never a plain document or an unfilled matrix", () => {
  assert.equal(rivalDoc(RIVAL("A")), true);
  assert.equal(rivalDoc("## Position relative to us\n- ahead\n"), true);
  assert.equal(rivalDoc(MATRIX_ONLY), true, "3 filled code cells in one column");
  assert.equal(rivalDoc("| # | Step | Code | Evidence |\n|---|---|---|---|\n| 1 | a | | |\n| 2 | b | | |\n"), false, "an empty template table");
  assert.equal(rivalDoc("# Notes\n\n| a | b |\n|--|--|\n| 1 | y |\n"), false);
  assert.equal(rivalDoc("Plain prose that mentions competitors and rivals.\n"), false);
});

test("find-sources proposes rivalsPath: the folder holding the most rival-shaped files, with its evidence; decoys, node_modules and a lone file don't count", () => {
  const root = product(), pm = path.join(temporary("nosy-rivalspath-pm-"), "pm"); dirs.push(path.dirname(pm));
  const { r, j } = suggest(root, pm);
  // pm/ lives in another folder than the repo, so the value is relative to the folder that holds pm/.
  assert.equal(j.suggestion.rivalsPath, path.relative(path.dirname(pm), path.join(root, "references")).split(path.sep).join("/"));
  assert.match(j.suggestion.rivalsPath, /^\.\.\/.+\/references$/);
  assert.equal(j.confidence.rivalsPath, "medium");
  assert.deepEqual(j.rivalsEvidence.files, ["references/acme/competitive-acme.md", "references/globex/competitive-globex.md", "references/initech/competitive-initech.md"]);
  assert.match(r.output, /\| rivalsPath \| medium \|/);
  assert.match(r.output, /3 files with the rival template's structure/);
  // The same, with pm/ inside the repo: relative to the repo root.
  const inside = suggest(root, path.join(root, "pm")).j;
  assert.equal(inside.suggestion.rivalsPath, "references");
});

test("find-sources: nothing proposed with no such folder, or when pm/rivals already has files", () => {
  const plain = temporary("nosy-rivalspath-plain-"); dirs.push(plain);
  fs.writeFileSync(path.join(plain, "README.md"), "# x\n");
  execFileSync("git", ["-C", plain, "init", "-q", "-b", "main"], { env: ENV }); execFileSync("git", ["-C", plain, "add", "-A"], { env: ENV }); execFileSync("git", ["-C", plain, "commit", "-q", "-m", "i"], { env: ENV });
  const none = suggest(plain, path.join(plain, "pm")).j;
  assert.ok(!("rivalsPath" in none.suggestion), "key left out, not written as \"\"");
  assert.equal(none.rivalsEvidence, null);

  const root = product(), pm = path.join(root, "pm"); fs.mkdirSync(path.join(pm, "rivals"), { recursive: true });
  fs.writeFileSync(path.join(pm, "rivals", "acme.md"), RIVAL("Acme"));
  assert.ok(!("rivalsPath" in suggest(root, pm).j.suggestion), "pm/rivals is the default and already has a file");
});

test("a pm/rivals that is itself inside the repo is not proposed as 'elsewhere'", () => {
  const root = temporary("nosy-rivalspath-inpm-"); dirs.push(root);
  for (const n of ["a", "b", "c"]) { fs.mkdirSync(path.join(root, "pm", "rivals"), { recursive: true }); fs.writeFileSync(path.join(root, "pm", "rivals", `${n}.md`), RIVAL(n)); }
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"], { env: ENV }); execFileSync("git", ["-C", root, "add", "-A"], { env: ENV }); execFileSync("git", ["-C", root, "commit", "-q", "-m", "i"], { env: ENV });
  assert.ok(!("rivalsPath" in suggest(root, path.join(root, "pm")).j.suggestion));
});

test("rivalsDir: rivalsPath resolved from the folder that holds pm/ when it exists, else <pm>/rivals; rivalFiles nests and keeps only rival files", () => {
  const root = product(), pm = path.join(root, "pm");
  assert.equal(rivalsDir(pm, {}), path.join(pm, "rivals"));
  assert.equal(rivalsDir(pm, { rivalsPath: "nowhere" }), path.join(pm, "rivals"), "a path that doesn't exist falls back");
  assert.equal(rivalsDir(pm, { rivalsPath: "references" }), path.join(root, "references"));
  assert.equal(rivalsDir(pm, { rivalsPath: path.join(root, "references") }), path.join(root, "references"), "absolute works too");
  assert.deepEqual(rivalFiles(path.join(root, "references"), { nested: true }).sort(), ["acme/competitive-acme.md", "globex/competitive-globex.md", "initech/competitive-initech.md"]);
});

test("next.mjs reads the rivals from rivalsPath: no 'no rival files yet', stale ones are named by file", () => {
  const root = product(), pm = path.join(root, "pm"), NOW = Date.now(), DAY = 864e5;
  const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(pm, f)), { recursive: true }); fs.writeFileSync(path.join(pm, f), typeof body === "string" ? body : JSON.stringify(body)); };
  // Everything else is fresh, so only the rivals can make a pick (next.test.mjs's fresh(), without its rival file).
  for (const f of ["shipped", "lowhanging", "waves", "psst-final"]) put(`state/${f}.json`, { generated: new Date(NOW).toISOString(), items: [], dropped: [] });
  put("page.html", "<html></html>"); put("map.md", "# map");
  put("sources.json", { repo: root, ref: "main" });
  const neighbors = R => R.picks.find(p => p.command === "neighbors");
  assert.match(neighbors(next(pm, { now: NOW })).reason, /no rival files yet/, "without rivalsPath, pm/rivals is empty");
  put("sources.json", { repo: root, ref: "main", rivalsPath: "references" });
  assert.equal(neighbors(next(pm, { now: NOW })), undefined, "3 fresh rival files: nothing to say");
  const later = next(pm, { now: NOW + 40 * DAY });
  assert.match(neighbors(later).reason, /3 rivals not checked in 30\+ days \((competitive-\w+, competitive-\w+, competitive-\w+)\)/);
});

test("doctor --check counts the rivals from rivalsPath", async () => {
  const root = product(), pm = path.join(root, "pm"); fs.mkdirSync(pm, { recursive: true });
  const home = temporary("nosy-rivalspath-home-"); dirs.push(home);
  const line = async K => { fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: ".", ref: "main", ...K })); const R = await check({ cwd: root, pm, skill: path.join(Tool, ".."), home, env: {} }); return R.lines.find(l => /optional setup:/.test(l.what)); };
  assert.match((await line({})).what, /rivals \(none yet\) –/);
  assert.match((await line({ rivalsPath: "references" })).what, /rivals \(3 files\) ✓/);
});

// ---- review of 2 Oct: the same answer whether pm is given relative or absolute, a link back up the tree, next.mjs and file names with accents ----
import { rivalsPathAbs } from "../tools/sources-file.mjs";
test("rivalsPath means the same folder whether pm is relative or absolute, from any working folder", () => {
  const root = fs.realpathSync(product()), K = { rivalsPath: "references" }, pm = path.join(root, "pm"); // real path: chdir resolves /var → /private/var
  fs.mkdirSync(pm, { recursive: true });
  const want = path.join(root, "references");
  assert.equal(rivalsPathAbs(pm, K), want); assert.equal(rivalsDir(pm, K), want);
  const here = process.cwd();
  try { process.chdir(root); assert.equal(rivalsPathAbs("pm", K), want, "relative pm from the product's folder"); assert.equal(rivalsDir("pm", K), want); process.chdir(path.join(root, "references")); assert.equal(rivalsPathAbs("../pm", K), want, "relative pm from inside the rival folder"); } finally { process.chdir(here); }
  assert.equal(rivalsPathAbs(pm, { rivalsPath: want }), want, "an absolute rivalsPath is taken as written");
  assert.equal(rivalsPathAbs(pm, {}), null); assert.equal(rivalsPathAbs(pm, { rivalsPath: "  " }), null); assert.equal(rivalsPathAbs(pm, { rivalsPath: 5 }), null);
  assert.equal(rivalsDir(pm, { rivalsPath: "nowhere" }), path.join(pm, "rivals"), "a folder that doesn't exist falls back to pm/rivals");
});

test("rivalFiles(nested) lists '/'-joined paths, skips node_modules and a link back up, and stays out of '_' templates", () => {
  const root = temporary("nosy-rivalfiles-"); dirs.push(root);
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  put("a/b/competitive-x.md", RIVAL("X")); put("node_modules/p/competitive.md", RIVAL("N")); put("a/_template.md", RIVAL("T")); put("é ü/competitive.md", RIVAL("U"));
  try { fs.symlinkSync(root, path.join(root, "a", "back")); } catch {}
  assert.deepEqual(rivalFiles(root, { nested: true }), ["a/b/competitive-x.md", "é ü/competitive.md"]);
  assert.deepEqual(rivalFiles(path.join(root, "nowhere"), { nested: true }), []);
});

test("next.mjs reads the age of a rival file whose name has accents and spaces from git, not from the quoted name git prints", () => {
  const root = temporary("nosy-next-accents-"); dirs.push(root);
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  put("pm/sources.json", JSON.stringify({ repo: ".", ref: "main", rivalsPath: "references" })); put("references/Çelik Hukuk/rakip analizi.md", RIVAL("Celik"));
  const g = (...a) => execFileSync("git", ["-C", root, ...a], { env: { ...ENV, GIT_AUTHOR_DATE: "2026-05-01T10:00:00Z", GIT_COMMITTER_DATE: "2026-05-01T10:00:00Z" }, stdio: "ignore" });
  g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-qm", "old research");
  const fresh = new Date(); fs.utimesSync(path.join(root, "references/Çelik Hukuk/rakip analizi.md"), fresh, fresh); // the file on disk is new, its last commit is old
  const touched = rivalTouched(path.join(root, "references"), { nested: true });
  assert.deepEqual(Object.keys(touched), ["Çelik Hukuk/rakip analizi.md"]);
  assert.equal(new Date(touched["Çelik Hukuk/rakip analizi.md"]).toISOString().slice(0, 10), "2026-05-01", "the commit's date, not the file's fresh modification time");
});

// ---- a relative `matrix` is read from the repo when Nosy runs from a subfolder (pm/ is found by walking up) ----
import { readSources } from "../tools/sources-file.mjs";
test("readSources: a relative `matrix` that isn't there from this folder but is in the repo is made absolute; one that resolves today is left as written; the as-written value stays out of what is saved back", () => {
  const root = fs.realpathSync(temporary("nosy-matrixpath-")); dirs.push(root);
  const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); };
  put("pm/sources.json", JSON.stringify({ repo: ".", ref: "main", matrix: "pm/matrix.json" })); put("pm/matrix.json", "{}"); put("apps/web/x.txt", "x");
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  const pm = path.join(root, "pm");
  assert.equal(readSources(pm, { cwd: root }).matrix, "pm/matrix.json", "from the repo root: unchanged, as it always was");
  const K = readSources(pm, { cwd: path.join(root, "apps", "web") });
  assert.equal(K.matrix, path.join(root, "pm", "matrix.json")); assert.equal(K.matrixAsWritten, "pm/matrix.json");
  assert.equal(Object.keys(K).includes("matrixAsWritten"), false, "not part of what gets written back");
  assert.equal(readSources(pm, { raw: true }).matrix, "pm/matrix.json");
  put("pm/sources.json", JSON.stringify({ repo: ".", ref: "main", matrix: "pm/nowhere.json" }));
  assert.equal(readSources(pm, { cwd: path.join(root, "apps", "web") }).matrix, "pm/nowhere.json", "nothing there either: left as written, the readers say 'no matrix'");
  put("pm/sources.json", JSON.stringify({ repo: ".", ref: "main", matrix: path.join(root, "pm", "matrix.json") }));
  assert.equal(readSources(pm, { cwd: path.join(root, "apps", "web") }).matrix, path.join(root, "pm", "matrix.json"), "absolute: as written");
});
