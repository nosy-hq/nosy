// Contract tests for skill/tools/privacy-scan.mjs: fake secrets are assembled from PARTS at runtime, INSIDE
// THE TEST (so no fixed secret string sits in the repo) — AWS key, GitHub token, email, Turkish national ID
// (valid per the checksum algorithm), IBAN (mod-97 valid), local home directory path. Exit code 2 on a high
// finding; a clean file (commit hash, UUID, example.com, Co-Authored-By) gives 0 findings and exit code 0;
// --mask leaves no raw value behind.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { run, temporary, clean, Tool } from "./helpers.mjs";

// Turkish sample word for the TR-domain sample email below (see skill/data/lang/tr/privacy-scan.test.json).
const trWords = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "lang", "tr", "privacy-scan.test.json"), "utf8"));

const copies = [];
after(() => { for (const k of copies) clean(k); });
function directory() { const d = temporary("nosy-privacy-"); copies.push(d); return d; }

// ---- assembled from parts (same pattern as generate.mjs): no full pattern ever sits as one fixed string in the file ----
const rndAlnum = (n, letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") =>
  Array.from({ length: n }, () => letters[crypto.randomInt(letters.length)]).join("");
const rndDigits = n => Array.from({ length: n }, () => crypto.randomInt(10)).join("");

function tcknGenerate() {
  const d = [1 + crypto.randomInt(9), ...Array.from({ length: 8 }, () => crypto.randomInt(10))];
  const single = d[0] + d[2] + d[4] + d[6] + d[8], pair = d[1] + d[3] + d[5] + d[7];
  const d10 = (((single * 7 - pair) % 10) + 10) % 10, d11 = (single + pair + d10) % 10;
  return [...d, d10, d11].join("");
}
function ibanGenerate() {
  const bban = rndDigits(22);
  const remaining97 = s => { let k = 0n; for (const ch of s) k = (k * 10n + BigInt(ch)) % 97n; return k; };
  const check = (98n - remaining97(bban + "2927" + "00")).toString().padStart(2, "0");
  return "TR" + check + bban;
}
const AWS_KEY = ["AKIA", rndAlnum(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")].join("");
const GITHUB_TOKEN = ["ghp", "_", rndAlnum(40)].join("");
// Turkish sample data on purpose: proves the Turkish-detection feature (TR mail domain) still works.
const Email = ["user", crypto.randomInt(9999)].join("") + "@" + ["examples", trWords.companyWord].join("-") + ".com.tr";
const TCKN = tcknGenerate();
const IBAN = ibanGenerate();

test("high finding (AWS key + GitHub token): exit code 2, type/finding fields correct", () => {
  const d = directory();
  const file = path.join(d, "leak.md");
  fs.writeFileSync(file, `# Notes\n\nAWS: ${AWS_KEY}\nGitHub token: ${GITHUB_TOKEN}\n`);
  const jsonPath = path.join(d, "result.json");
  const r = run(path.join(Tool, "privacy-scan.mjs"), [file, "--json", jsonPath]);
  assert.equal(r.code, 2, `exit code should be 2 when there's a high finding: ${r.output}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.type, "privacy");
  assert.ok(j.numbers["high"] >= 2, `expected at least 2 high findings: ${JSON.stringify(j.numbers)}`);
  assert.ok(j.findings.some(b => b.type === "AWS access key"));
  assert.ok(j.findings.some(b => b.type === "GitHub token"));
});

test("personal data (email, Turkish national ID, IBAN, local home directory path) is caught at medium severity, and stops a send", () => {
  const d = directory();
  const file = path.join(d, "record.md");
  // Turkish sample data on purpose: proves the TCKN/IBAN detectors (Turkish-language support features) still work.
  fs.writeFileSync(file, `Contact: ${Email}\nTCKN: ${TCKN}\nIBAN: ${IBAN}\nPath: /Users/sampleuser/project/file.txt\n`);
  const jsonPath = path.join(d, "result.json");
  const r = run(path.join(Tool, "privacy-scan.mjs"), [file, "--json", jsonPath]);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.ok(j.findings.some(b => b.type === "E-mail"));
  assert.ok(j.findings.some(b => b.type === "Turkish national ID (TCKN)"));
  assert.ok(j.findings.some(b => b.type === "IBAN"));
  assert.ok(j.findings.some(b => b.type === "Local home directory path"));
  assert.equal(r.code, 2, "personal data stops a send even without a high-severity secret: exit code 2");
});

test("a clean file (commit hash, UUID, example.com, Co-Authored-By) gives 0 findings and exit code 0", () => {
  const d = directory();
  const file = path.join(d, "clean.md");
  fs.writeFileSync(file, [
    "# Changelog",
    "",
    "Commit: 9f8a7c6d5e4b3a2190817263544536271809abc",
    "UUID: 3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "Contact: destek@example.com",
    "",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "",
  ].join("\n"));
  const jsonPath = path.join(d, "result.json");
  const r = run(path.join(Tool, "privacy-scan.mjs"), [file, "--json", jsonPath]);
  assert.equal(r.code, 0, `exit code should be 0 on a clean file: ${r.output}`);
  const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(j.findings.length, 0, `expected no findings: ${JSON.stringify(j.findings)}`);
});

test("--mask: the output has no raw value left in it", () => {
  const d = directory();
  const file = path.join(d, "leak2.md");
  fs.writeFileSync(file, `AWS: ${AWS_KEY}\nEmail: ${Email}\nTCKN: ${TCKN}\n`);
  const maskedPath = path.join(d, "leak2.masked.md");
  const r = run(path.join(Tool, "privacy-scan.mjs"), [file, "--mask", maskedPath]);
  assert.ok(fs.existsSync(maskedPath), "--mask should write the output file");
  const masked = fs.readFileSync(maskedPath, "utf8");
  assert.ok(!masked.includes(AWS_KEY), "the masked output must not contain the raw AWS key");
  assert.ok(!masked.includes(Email), "the masked output must not contain the raw email");
  assert.ok(!masked.includes(TCKN), "the masked output must not contain the raw Turkish national ID");
  assert.match(masked, /\[hidden:/, "the masked output should have a [hidden:...] marker");
});
