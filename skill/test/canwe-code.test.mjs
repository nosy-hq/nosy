// canwe.mjs after blind test v2 (kill criterion 2): question fillers are dropped, the question's rarest terms
// are searched in the code at the integration ref ("In the code (read this first)"), and the product's never
// rules come first. A tiny throwaway repo; no network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, temporary, clean, Tool } from "./helpers.mjs";

let root, pm;
const CANWE = path.join(Tool, "canwe.mjs");
const put = (f, s) => { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

before(() => {
  root = temporary("nosy-canwe-code-");
  // "shipment" is everywhere (the product's own vocabulary); "barcode" lives in one source file and one test;
  // "drone" only in a doc; "hologram" nowhere.
  for (let i = 0; i < 30; i++) put(`src/area${i}/shipment.js`, `// shipment handling ${i}\nexport const shipment${i} = {};\n`);
  put("src/scan/barcode.js", "// Barcode scanning is off until the carrier API ships.\nexport const BARCODE_ENABLED = false;\n");
  put("src/scan/barcode.test.js", "// barcode stays disabled\n");
  put("docs/plan.md", "Drone delivery is on the plan for next year.\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", root, ...a], { env, stdio: "ignore" });
  pm = path.join(root, "pm");
  fs.mkdirSync(path.join(pm, "state"), { recursive: true });
  fs.writeFileSync(path.join(pm, "sources.json"), JSON.stringify({ repo: root, ref: "main", preread: { never: [{ name: "drone delivery", pattern: "\\bdrones?\\b" }] } }));
  fs.writeFileSync(path.join(pm, "state", "inventory.json"), JSON.stringify({ backend_missing: false, endpoints: [] }));
});
after(() => clean(root));

const codeSection = o => (o.match(/## In the code \(read this first\)\n\n([\s\S]*?)\n## /) || [])[1] || "";
const verdictOf = o => (o.match(/## Suggested verdict[^\n]*\n\n\*\*(.*?)\*\*/) || [])[1];

test("fillers are dropped: 'can we', 'for', 'our' never become topic words", () => {
  const r = run(CANWE, [pm, "Can we add barcode scanning for our shipments?"]);
  assert.equal(r.code, 0, r.error);
  const topic = r.output.match(/topic words: ([^·\n]*)/)[1];
  for (const w of ["can", "we", "add", "for", "our"]) assert.doesNotMatch(topic, new RegExp(`\\b${w}\\b`), `${w} should be dropped`);
  assert.match(topic, /barcode/);
});

test("the rarest term anchors the code search: its lines are listed, source before tests; common words are named, not used", () => {
  const r = run(CANWE, [pm, "Can we add barcode scanning for shipments?"]);
  const code = codeSection(r.output);
  assert.match(code, /### "barcode" · 2 code file\(s\)/);
  assert.match(code, /src\/scan\/barcode\.js:2 +export const BARCODE_ENABLED = false;/);
  assert.ok(code.indexOf("src/scan/barcode.js:") < code.indexOf("src/scan/barcode.test.js:"), "application code before tests");
  assert.match(code, /Too common here to anchor on: "shipment[^"]*" \(3\d files\)/);
});

test("an anchor with no code trace is said plainly and drives the verdict", () => {
  const r = run(CANWE, [pm, "Can we show a hologram preview?"]);
  assert.match(codeSection(r.output), /### "hologram" · 0 code file\(s\), 0 doc\(s\)[\s\S]*No code file mentions it\./);
  assert.equal(verdictOf(r.output), "Not now: no trace in the code");
});

test("a never rule is on the second line and answers first", () => {
  const r = run(CANWE, [pm, "Can we offer drone delivery?"]);
  assert.match(r.output.split("\n")[1], /^Never rule: drone delivery \(sources\.json preread\.never\)$/);
  assert.equal(verdictOf(r.output), "There's a decision: not doing this");
  assert.match(codeSection(r.output), /No code file mentions it \(only docs: docs\/plan\.md\)/);
});

test("Turkish: particles and the 'can we' ending are dropped, the verb stem stays", () => {
  const r = run(CANWE, [pm, "KEP ile tebligat gönderebilir miyiz?"]);
  const topic = r.output.match(/topic words: ([^·\n]*)/)[1].trim();
  assert.equal(topic, "kep, tebligat, gönder");
});

// the code that refuses a thing, and the authorization layer for access questions.
test("deliberately off: refusal lines next to the anchor are listed (negated ones dropped) and drive the verdict", () => {
  const dir = temporary("nosy-canwe-off-");
  try {
    const w = (f, s) => { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
    w("src/providers.go", "// Two providers.\n// Fax is not a provider here: nothing sends through it.\nvar providers = []string{\"mail\", \"sms\"}\n");
    w("src/parse.go", "// a fax header must not be rejected as html\nfunc parse() {}\n");
    w("src/providers_test.go", "func TestFaxRefused(t *testing.T) {\n\tif code != 404 { t.Fatalf(\"provider=fax answered %d, want 404\", code) }\n}\n");
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", dir, ...a], { env, stdio: "ignore" });
    const p = path.join(dir, "pm"); fs.mkdirSync(path.join(p, "state"), { recursive: true });
    fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: dir, ref: "main" }));
    fs.writeFileSync(path.join(p, "state", "inventory.json"), JSON.stringify({ backend_missing: false, endpoints: [] }));
    const r = run(CANWE, [p, "Can we send by fax?"]);
    const off = (r.output.match(/### Deliberately off\? \(code that refuses it\)\n\n([\s\S]*?)\n\n_/) || [])[1] || "";
    assert.match(off, /^- src\/providers\.go:2 +\/\/ Fax is not a provider here/m, "the plainest refusal comes first");
    assert.match(off, /src\/providers_test\.go:2 .*want 404/);
    assert.doesNotMatch(off, /must not be rejected/, "a negated refusal isn't a refusal");
    assert.equal(verdictOf(r.output), "There's a decision: not doing this");
    assert.match(r.output, /refuses it: src\/providers\.go:2/);
  } finally { clean(dir); }
});

test("access layer: an outside-access question lists the authorization files with their first comment", () => {
  put("src/access/access.go", "// Package access owns one question: which rows may this person see.\npackage access\n");
  put("src/authz/roles.go", "// Four company-wide roles.\npackage authz\n");
  execFileSync("git", ["-C", root, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "access"], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const r = run(CANWE, [pm, "Can we open a portal for external clients?"]);
  const access = (r.output.match(/### Access layer\n\n([\s\S]*?)\n\n_/) || [])[1] || "";
  assert.match(access, /src\/access\/access\.go +Package access owns one question: which rows may this person see\./);
  assert.match(access, /src\/authz\/roles\.go +Four company-wide roles\./);
  const plain = run(CANWE, [pm, "Can we add barcode scanning?"]);
  assert.doesNotMatch(plain.output, /### Access layer/, "only access questions get it");
});

// Kargo, blind test on Twenty's CSV export: a fake "Kargo" product where EVERY topic
// word is common in the repo (>25 files, the floor commonLimit never drops below). The old code dropped every
// anchor and said "no rare term to anchor on" — indistinguishable from "not found" even though the real
// implementation file was right there. The fix falls back to the rarest N words anyway, and ranks files that
// match MORE THAN ONE of those common anchors together above files that only share a single one.
test("all topic words common — the rarest fallback still anchors, and a file matching two anchors together outranks the noise", () => {
  const dir = temporary("nosy-canwe-fallback-");
  try {
    const w = (f, s) => { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
    // "pallet" alone in 30 files, "manifest" alone in 30 different files — both comfortably over the 25-file
    // floor, so neither ever clears the normal (rare) anchor threshold on its own.
    for (let i = 0; i < 30; i++) w(`src/palletonly/p${i}.js`, `// pallet count ${i}\nexport const pallet${i} = {};\n`);
    for (let i = 0; i < 30; i++) w(`src/manifestonly/m${i}.js`, `// manifest entry ${i}\nexport const manifest${i} = {};\n`);
    // The one real feature: the only file mentioning BOTH words together.
    w("src/features/exportManifest.js", "// Combines pallet counts into a single manifest export.\nexport function buildPalletManifest() {}\n");
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", dir, ...a], { env, stdio: "ignore" });
    const p = path.join(dir, "pm"); fs.mkdirSync(path.join(p, "state"), { recursive: true });
    fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: dir, ref: "main" }));
    fs.writeFileSync(path.join(p, "state", "inventory.json"), JSON.stringify({ backend_missing: false, endpoints: [] }));
    const r = run(CANWE, [p, "pallet manifest"]);
    assert.equal(r.code, 0, r.error);
    assert.match(r.output, /All words are common in this repo; searched the rarest:/, "says plainly this is a fallback, not silence");
    const code = codeSection(r.output);
    assert.match(code, /src\/features\/exportManifest\.js/, "the file matching BOTH common anchors together must surface, not just any generic single-word match");
  } finally { clean(dir); }
});

// pm/state/inventory.json was never generated (move-in's old tour never ran `inventory`).
// canwe.mjs must run inventory itself on the fly and use the result — never silently answer "no trace in the
// backend" just because the cached file was missing.
test("inventory.json missing — canwe computes it on the fly and finds the endpoint, not \"no trace\"", () => {
  const dir = temporary("nosy-canwe-noinv-");
  try {
    const w = (f, s) => { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
    w("backend/routes.js", "app.get('/api/shipments/export', exportShipments);\n");
    w("frontend/App.js", "fetch('/api/shipments/export');\n");
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", dir, ...a], { env, stdio: "ignore" });
    const p = path.join(dir, "pm"); fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: dir, ref: "main", inventory: { backend: ["backend"], frontend: ["frontend"] } }));
    // deliberately no pm/state/inventory.json — the whole point of this test
    assert.ok(!fs.existsSync(path.join(p, "state", "inventory.json")));
    // Two concept groups ("shipments", "export") both land on the endpoint's own path — a STRONG match
    // (matchingEndpoints() needs >=2 concept groups when the question has that many), not just a weak,
    // single-rare-concept one — so this isolates the inventory-missing question from the separate
    // strong-vs-weak match design already covered by canwe.test.mjs.
    const r = run(CANWE, [p, "Can we bulk export shipments?"]);
    assert.equal(r.code, 0, r.error);
    assert.match(r.output, /computed on the fly/, "says the number wasn't cached, instead of just going quiet");
    assert.match(r.output, /\/api\/shipments\/export/, "the freshly computed inventory's endpoint is used");
    const verdict = (r.output.match(/## Suggested verdict[^\n]*\n\n\*\*(.*?)\*\*/) || [])[1];
    assert.notEqual(verdict, "Not now: no trace in the backend", "a missing cache must never read the same as a checked-and-empty backend");
  } finally { clean(dir); }
});

test("a refusal far from the term on the same line is listed but doesn't make the guess 'not doing this'", () => {
  const dir = temporary("nosy-canwe-far-");
  try {
    const w = (f, s) => { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
    w("src/scan.go", "// the upload scanner handles contract documents; a file whose virus signature matches is rejected before storage\nfunc scan() {}\n");
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    for (const a of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-q", "-m", "init"]]) execFileSync("git", ["-C", dir, ...a], { env, stdio: "ignore" });
    const p = path.join(dir, "pm"); fs.mkdirSync(path.join(p, "state"), { recursive: true });
    fs.writeFileSync(path.join(p, "sources.json"), JSON.stringify({ repo: dir, ref: "main" }));
    fs.writeFileSync(path.join(p, "state", "inventory.json"), JSON.stringify({ backend_missing: false, endpoints: [] }));
    const r = run(CANWE, [p, "Can we add contract risk scoring?"]);
    assert.notEqual(verdictOf(r.output), "There's a decision: not doing this");
  } finally { clean(dir); }
});
