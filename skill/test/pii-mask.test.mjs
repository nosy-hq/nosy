// Masking (mask.mjs) and the privacy scan (privacy-scan.mjs) find the same personal data: e-mail, phone numbers (Turkish,
// international +/00, US, UK), IBANs of any country (registry length + mod-97), card numbers (Luhn), Turkish IDs.
// All values below are documentation examples or ranges reserved for fiction (555-01xx, Ofcom's 07700 900xxx and
// 020 7946 0xxx, the published example IBANs, the card test numbers).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, temporary, clean, Tool } from "./helpers.mjs";
import { mask } from "../tools/mask.mjs";
import { ibanValid, luhnValid, ibanSpans, phoneSpans } from "../tools/pii.mjs";

const dirs = [];
after(() => dirs.forEach(clean));

test("mask: phone numbers of several countries and forms", () => {
  for (const p of ["+1 415 555 0132", "+1 (415) 555-0132", "(415) 555-0132", "415-555-0132", "415.555.0132", "+44 7700 900123", "+44 (0)20 7946 0958", "020 7946 0958", "07700 900123", "07700900123", "00 44 7700 900123", "+49 30 901820", "+81-3-1234-5678",
    "0532 123 45 67", "+90 532 123 45 67", "0212 555 12 34"]) {
    const out = mask(`call me on ${p} tomorrow`);
    assert.equal(out, "call me on [phone] tomorrow", `${p} → ${out}`);
  }
});

test("mask: numbers that are not phones are left alone", () => {
  for (const t of ["order 1234567 shipped 2026-09-30", "total 12,345.67 USD", "version 0.14.4 released", "192.168.0.1", "ticket 555 items", "call 911", "0.5 and 1.25 and 100"]) assert.equal(mask(t), t);
});

test("mask: IBANs of any country, with or without spaces; a wrong check digit is left alone", () => {
  for (const i of ["GB82 WEST 1234 5698 7654 32", "GB82WEST12345698765432", "DE89 3704 0044 0532 0130 00", "FR76 3000 6000 0112 3456 7890 189", "NL91 ABNA 0417 1643 00", "ES91 2100 0418 4502 0005 1332", "TR33 0006 1005 1978 6457 8413 26"])
    assert.equal(mask(`pay to ${i}, thanks`), "pay to [iban], thanks", i);
  assert.equal(mask("pay to GB82 WEST 1234 5698 7654 33 please"), "pay to GB82 WEST 1234 5698 7654 33 please", "mod-97 fails: not an IBAN");
  assert.equal(mask("IBAN GB82 WEST 1234 5698 7654 32 and more words"), "IBAN [iban] and more words", "stops at the country's length");
  assert.ok(ibanValid("GB82 WEST 1234 5698 7654 32") && !ibanValid("GB82 WEST 1234 5698 7654 3"));
});

test("mask: card numbers by Luhn, e-mail, Turkish ID, key=value", () => {
  assert.equal(mask("card 4111 1111 1111 1111 exp"), "card [card] exp");
  assert.equal(mask("card 5555-5555-5555-4444"), "card [card]");
  assert.equal(mask("card 4111 1111 1111 1112"), "card 4111 1111 1111 1112", "fails Luhn");
  assert.ok(luhnValid("4111111111111111"));
  assert.equal(mask("write to jamie@mailbox.invalid"), "write to [email]");
  assert.equal(mask("url?token=abc123&x=1"), "url?token=***&x=1");
  assert.equal(mask("TC 10000000146"), "TC [national id]");
});

test("mask: the raw value never survives, several kinds in one line", () => {
  const raw = "Hi, I'm at jamie@mailbox.invalid or +44 7700 900123, card 4111 1111 1111 1111, IBAN DE89 3704 0044 0532 0130 00.";
  const out = mask(raw);
  assert.equal(out, "Hi, I'm at [email] or [phone], card [card], IBAN [iban].");
});

test("pii: spans point at the right text", () => {
  const t = "a GB82 WEST 1234 5698 7654 32 b";
  const [s] = ibanSpans(t);
  assert.equal(t.slice(s.index, s.index + s.length), "GB82 WEST 1234 5698 7654 32");
  const u = "x +1 415 555 0132 y";
  const [p] = phoneSpans(u);
  assert.equal(u.slice(p.index, p.index + p.length), "+1 415 555 0132");
});

function scan(text, args = []) {
  const d = temporary("nosy-pii-"); dirs.push(d);
  const f = path.join(d, "note.md"), j = path.join(d, "r.json");
  fs.writeFileSync(f, text);
  const r = run(path.join(Tool, "privacy-scan.mjs"), [f, "--json", j, ...args]);
  return { ...r, findings: JSON.parse(fs.readFileSync(j, "utf8")).findings };
}

test("privacy scan: an e-mail alone stops a send (exit 2), and says so", () => {
  const r = scan("Contact: jamie.fakeperson@mailbox.invalid\n");
  assert.equal(r.code, 2);
  assert.match(r.output, /1 finding stop a send/);
  assert.ok(r.findings.some(f => f.type === "E-mail"));
});

test("privacy scan: international phones, IBANs of any country and cards are found and stop a send", () => {
  for (const [line, type] of [["Phone +1 415 555 0132", "Phone"], ["Phone (415) 555-0132", "Phone"], ["Phone 07700 900123", "Phone"], ["Phone +44 20 7946 0958", "Phone"],
    ["IBAN GB82 WEST 1234 5698 7654 32", "IBAN"], ["IBAN DE89370400440532013000", "IBAN"], ["Card 4111 1111 1111 1111", "Card number"]]) {
    const r = scan(`${line}\n`);
    assert.equal(r.code, 2, line);
    assert.ok(r.findings.some(f => f.type === type), `${line}: ${JSON.stringify(r.findings)}`);
  }
});

test("privacy scan: notes about your machine (home path, private IP) are listed but do not stop a send; a clean file stays exit 0", () => {
  const r = scan("Path /Users/sampleuser/x/y.txt and 192.168.1.20\n");
  assert.equal(r.code, 0);
  assert.ok(r.findings.length >= 1);
  assert.equal(scan("Nothing personal here, order 1234567 on 2026-09-30, version 0.14.4.\n").code, 0);
});

test("privacy scan: --names finds a person's name in free text (personal, stops a send)", () => {
  const r = scan("Thanks to Quincy Testperson for the fix.\n", ["--names", "Quincy Testperson,Rae"]);
  assert.equal(r.code, 2);
  assert.ok(r.findings.some(f => /^name:/.test(f.type)));
  assert.equal(scan("Thanks to somebody.\n", ["--names", "Quincy Testperson"]).code, 0);
});
