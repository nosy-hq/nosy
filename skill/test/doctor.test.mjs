// doctor.mjs: an older Nosy's pm/ (Turkish names, old sources.json keys) is found, renamed with --fix, and the
// rest routed to the command that owns it. Temp folders only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { examine, keyOf } from "../tools/doctor.mjs";

const DOCTOR = path.join(Tool, "doctor.mjs"), dirs = [];
after(() => dirs.forEach(clean));
function oldPm() {
  const root = temporary("nosy-doctor-"); dirs.push(root);
  const pm = path.join(root, "pm"), w = (f, s) => { const p = path.join(pm, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s)); };
  w("kaynaklar.json", { repo: "..", ref: "main", istek: { yol: "docs/NEEDS.md", statu: "x", ekran_yok: "no screen", son_gun: 7 }, matris: `${pm}/matris.json`,
    onokuma: { kararlar: "KARARLAR.md", asla: [{ ad: "KEP", desen: "KEP" }] }, sozluk: { karar: ["decision"], aşama: ["stage"] } });
  w("urun.md", "# Cargo\n");
  w("kararlar.md", "- a decision\n");
  w("matris.json", { satirlar: [] });
  w("durum/durum.json", { tur: "durum", uretildi: "2026-09-01" });
  return pm;
}

test("keys: the migration's exact pairs win over the word table; compound keys go word by word; unknown stays", () => {
  assert.equal(keyOf("statu"), "state");
  assert.equal(keyOf("onokuma"), "preread");
  assert.equal(keyOf("ekran_yok"), "screen_missing");
  assert.equal(keyOf("repo"), "repo");
  assert.equal(keyOf("zzqx"), "zzqx");
});

test("read-only: old names, old keys and old paths are 'auto'; old state files are routed to their command", () => {
  const pm = oldPm();
  const before = fs.readdirSync(pm).sort();
  const r = run(DOCTOR, [pm]);
  assert.equal(r.code, 2, r.error);
  assert.deepEqual(fs.readdirSync(pm).sort(), before, "nothing written without --fix");
  assert.match(r.output, /kaynaklar\.json has its old name: rename to sources\.json/);
  assert.match(r.output, /durum has its old name: rename to state/);
  assert.match(r.output, /kaynaklar\.json: \d+ old keys: rename \(/);
  assert.match(r.output, /matris points at an old name: .*matris\.json → .*matrix\.json/);
  assert.match(r.output, /Needs a command[\s\S]*durum\/durum\.json was written by an older Nosy[\s\S]*re-run shipped/);
});

test("--fix renames files, folders, keys and paths; the glossary's own words stay; state files still need their command", () => {
  const pm = oldPm();
  const r = run(DOCTOR, [pm, "--fix"]);
  assert.equal(r.code, 2, "old state and matrix contents are left for their commands");
  assert.deepEqual(fs.readdirSync(pm).sort(), [".backup", "decisions.md", "matrix.json", "product.md", "sources.json", "state"], ".backup holds the copy (internal request 197)");
  assert.ok(fs.existsSync(path.join(pm, "state", "status.json")));
  const K = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  assert.deepEqual(K.request, { path: "docs/NEEDS.md", state: "x", screen_missing: "no screen", last_day: 7 });
  assert.equal(K.matrix, `${pm}/matrix.json`);
  assert.deepEqual(K.preread, { decisions: "KARARLAR.md", never: [{ name: "KEP", pattern: "KEP" }] }, "values are never renamed, only keys");
  assert.deepEqual(K.glossary, { karar: ["decision"], aşama: ["stage"] }, "glossary entries are the product's words");
  assert.doesNotMatch(r.output, /Can fix on its own/);
  assert.match(r.output, /Needs a command/);
});

test("--fix says what it changes, whose files they are, where the copy is and how to undo", () => {
  const pm = oldPm();
  const r = run(DOCTOR, [pm, "--fix"]);
  assert.match(r.output, /Changing \d+ things \(only inside .*\):\n(  - .+\n)+/, "the list comes before the work");
  assert.match(r.output, /These are Nosy's own files inside pm\/ .*Your repo, your product code and the text of your notes are not touched\./);
  assert.match(r.output, /Backed up first: .*\.backup\/doctor-\d{8}-\d{6}\. To put it all back: `nosy doctor --undo`\./);
  const dirs2 = fs.readdirSync(path.join(pm, ".backup")).filter(d => d.startsWith("doctor-"));
  assert.equal(dirs2.length, 1);
  assert.equal(fs.readFileSync(path.join(pm, ".backup", ".gitignore"), "utf8"), "*\n", "a backup never shows up in git status");
  // The pre-fix sources.json is in the copy, byte for byte.
  assert.match(fs.readFileSync(path.join(pm, ".backup", dirs2[0], "kaynaklar.json"), "utf8"), /"istek"/);
  // The backup folder is not itself read as an old name on the next run.
  assert.ok(!examine(pm).findings.some(f => String(f.path || "").includes(".backup")));
});

test("--fix --dry-run lists the changes and writes nothing, not even a backup", () => {
  const pm = oldPm();
  const before = fs.readdirSync(pm).sort(), src = fs.readFileSync(path.join(pm, "kaynaklar.json"), "utf8");
  const r = run(DOCTOR, [pm, "--fix", "--dry-run"]);
  assert.match(r.output, /Would change \d+ things/);
  assert.match(r.output, /Nothing was changed\./);
  assert.deepEqual(fs.readdirSync(pm).sort(), before);
  assert.equal(fs.readFileSync(path.join(pm, "kaynaklar.json"), "utf8"), src);
});

test("--undo puts the renames and the old sources.json back; a file changed since is left alone unless --force", () => {
  const pm = oldPm();
  const before = fs.readdirSync(pm).sort(), src = fs.readFileSync(path.join(pm, "kaynaklar.json"), "utf8");
  run(DOCTOR, [pm, "--fix"]);
  const u = run(DOCTOR, [pm, "--undo"]);
  assert.equal(u.code, 0, u.output + u.error);
  assert.deepEqual(fs.readdirSync(pm).filter(f => f !== ".backup").sort(), before);
  assert.equal(fs.readFileSync(path.join(pm, "kaynaklar.json"), "utf8"), src, "the old file is back exactly");
  assert.equal(run(DOCTOR, [pm, "--undo"]).code, 1, "nothing left to undo");
  // Changed since the fix: refused, then forced.
  run(DOCTOR, [pm, "--fix"]);
  fs.appendFileSync(path.join(pm, "sources.json"), "\n");
  const refused = run(DOCTOR, [pm, "--undo"]);
  assert.equal(refused.code, 2);
  assert.match(refused.output, /kaynaklar\.json: changed since the fix \(use --force/, "named as the old file it would restore");
  assert.ok(fs.existsSync(path.join(pm, "kaynaklar.json")) === true);
  const forced = run(DOCTOR, [pm, "--undo", "--force"]);
  assert.equal(forced.code, 0, "the renames were already back and are not an error; the forced file is restored");
  assert.equal(fs.readFileSync(path.join(pm, "kaynaklar.json"), "utf8"), src, "forced: the old copy is back");
});

test("both names present: a mention, never an overwrite; a current pm/ has nothing to fix", () => {
  const pm = oldPm();
  fs.writeFileSync(path.join(pm, "product.md"), "# new\n");
  run(DOCTOR, [pm, "--fix"]);
  assert.equal(fs.readFileSync(path.join(pm, "product.md"), "utf8"), "# new\n");
  assert.ok(fs.existsSync(path.join(pm, "urun.md")));
  assert.ok(examine(pm).findings.some(f => f.id === "both-names" && f.path === "urun.md"));
  const clean2 = temporary("nosy-doctor-ok-"); dirs.push(clean2);
  fs.writeFileSync(path.join(clean2, "sources.json"), JSON.stringify({ repo: ".", ref: "main" }));
  fs.writeFileSync(path.join(clean2, "product.md"), "# ok\n");
  const ok = run(DOCTOR, [clean2]);
  assert.equal(ok.code, 0);
  assert.match(ok.output, /Nothing to fix/);
  assert.equal(run(DOCTOR, [path.join(clean2, "nope")]).code, 1);
});

test("renames.json agrees with docs/RENAMES.md's pm/ table", () => {
  const R = JSON.parse(fs.readFileSync(path.join(Tool, "..", "data", "lang", "tr", "renames.json"), "utf8"));
  const md = fs.readFileSync(path.join(Tool, "..", "..", "docs", "RENAMES.md"), "utf8");
  const sec = md.slice(md.indexOf("### Product folder (`pm/`) and state files"), md.indexOf("## Words"));
  for (const m of sec.matchAll(/^\| `([^`/]+)` \| `([^`/]+)` \|$/gm)) assert.equal(R.files[m[1]], m[2], `${m[1]} in renames.json`);
});

test("next.mjs sends an older pm/ to doctor, not move-in", async () => {
  const { next } = await import("../tools/next.mjs");
  const R = next(oldPm());
  assert.deepEqual(R.picks.map(p => p.command), ["doctor"]);
});

// ---- review of 2 Oct: a pm/ inside a git repo comes back byte for byte, a fix that stops halfway stays undoable, a damaged backup says so ----
import { execFileSync } from "node:child_process";
import { fix, undo as doctorUndo } from "../tools/doctor.mjs";
const gitIn = (cwd, ...a) => execFileSync("git", ["-C", cwd, "-c", "user.email=a@b.test", "-c", "user.name=t", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("--fix then --undo on a pm/ that lives in a git repo: git status is clean again and every file is byte for byte the same", () => {
  const root = temporary("nosy-doctor-git-"); dirs.push(root);
  const pm = path.join(root, "pm"), w = (f, s) => { const p = path.join(pm, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  gitIn(root, "init", "-q", "-b", "main");
  w("kaynaklar.json", '{"repo":".","ref":"main","kararlar":{"dosya":"pm/kararlar.md"},"matris":"pm/matris.json",\r\n"sozluk":{"karar":["decision"]}}'); // no final newline, a CRLF inside, as an editor on Windows leaves it
  w("urun.md", "# Ürün\r\ncafé ☕\r\n"); w("kararlar.md", "- a decision\n"); w("matris.json", '{"urunler":[]}'); w("durum/matris.json", '{"x":1}'); w("rakipler/a.md", "# r\n");
  gitIn(root, "add", "-A"); gitIn(root, "commit", "-qm", "init");
  const bytes = () => Object.fromEntries(["kaynaklar.json", "urun.md", "kararlar.md", "matris.json", "durum/matris.json", "rakipler/a.md"].map(f => [f, fs.readFileSync(path.join(pm, f)).toString("hex")]));
  const before = bytes();
  const f = run(DOCTOR, [pm, "--fix"]); assert.equal(f.code, 0, f.output + f.error);
  assert.ok(fs.existsSync(path.join(pm, "sources.json")) && !fs.existsSync(path.join(pm, "kaynaklar.json")));
  assert.match(gitIn(root, "status", "--short"), /sources\.json|decisions\.md/, "the fix changed the working tree");
  assert.equal(fs.readFileSync(path.join(pm, ".backup", ".gitignore"), "utf8"), "*\n");
  assert.doesNotMatch(gitIn(root, "status", "--short"), /\.backup/, "the backup never shows up in git status");
  const u = run(DOCTOR, [pm, "--undo"]); assert.equal(u.code, 0, u.output + u.error);
  assert.equal(gitIn(root, "status", "--short").replace(/^\?\? pm\/\.backup\/\n?/m, "").trim(), "", "git sees nothing changed");
  assert.deepEqual(bytes(), before, "byte for byte");
  assert.deepEqual(fs.readdirSync(pm).filter(n => n !== ".backup").sort(), ["durum", "kararlar.md", "kaynaklar.json", "matris.json", "rakipler", "urun.md"]);
});

test("a fix that fails halfway still writes its manifest, so what it already did can be undone", { skip: process.getuid && process.getuid() === 0 ? "root can rename anywhere" : false }, () => {
  const pm = oldPm();
  const dir = path.join(pm, "durum"); fs.chmodSync(dir, 0o555); // the file inside can be read but not renamed
  try {
    assert.throws(() => fix(pm, examine(pm)), /EACCES|EPERM/);
  } finally { fs.chmodSync(dir, 0o755); }
  const backups = fs.readdirSync(path.join(pm, ".backup")).filter(d => d.startsWith("doctor-"));
  assert.equal(backups.length, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(pm, ".backup", backups[0], "manifest.json"), "utf8"));
  assert.ok(manifest.steps.some(s => s.kind === "rewrite"), "the sources.json rewrite that already happened is in it");
  const u = doctorUndo(pm);
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.ok(fs.existsSync(path.join(pm, "kaynaklar.json")) || fs.existsSync(path.join(pm, "sources.json")));
});

test("a damaged manifest in the backup folder is said in a sentence, never a stack trace; an older good one is still found", () => {
  const pm = oldPm();
  run(DOCTOR, [pm, "--fix"]);
  const root = path.join(pm, ".backup"), good = fs.readdirSync(root).find(d => d.startsWith("doctor-"));
  fs.mkdirSync(path.join(root, "doctor-29990101-000000")); fs.writeFileSync(path.join(root, "doctor-29990101-000000", "manifest.json"), "{ cut off");
  const u = run(DOCTOR, [pm, "--undo"]);
  assert.equal(u.code, 0, u.output + u.error); assert.match(u.output, new RegExp(`Put back from .*${good}`), "the newest readable manifest is the one undone");
  fs.writeFileSync(path.join(root, good, "manifest.json"), "{ also cut");
  const r = run(DOCTOR, [pm, "--undo"]);
  assert.equal(r.code, 1); assert.match(r.error, /has a manifest that can't be read/); assert.doesNotMatch(r.error, /SyntaxError|at JSON\.parse/);
});
