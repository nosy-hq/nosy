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
  assert.deepEqual(fs.readdirSync(pm).sort(), ["decisions.md", "matrix.json", "product.md", "sources.json", "state"]);
  assert.ok(fs.existsSync(path.join(pm, "state", "status.json")));
  const K = JSON.parse(fs.readFileSync(path.join(pm, "sources.json"), "utf8"));
  assert.deepEqual(K.request, { path: "docs/NEEDS.md", state: "x", screen_missing: "no screen", last_day: 7 });
  assert.equal(K.matrix, `${pm}/matrix.json`);
  assert.deepEqual(K.preread, { decisions: "KARARLAR.md", never: [{ name: "KEP", pattern: "KEP" }] }, "values are never renamed, only keys");
  assert.deepEqual(K.glossary, { karar: ["decision"], aşama: ["stage"] }, "glossary entries are the product's words");
  assert.doesNotMatch(r.output, /Can fix on its own/);
  assert.match(r.output, /Needs a command/);
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
