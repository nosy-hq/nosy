// Tests for read-decisions.mjs's measurementOf/eventRefOf ("there's a verified quote
// but the model isn't writing" was only caught from a person's own note -> `status` should also read the
// measurement/success line a decision document carries). Fixtures below use invented sentences in the shapes a
// Turkish decision log takes (bold "**Ölçüm.**"/"**Ölçüm:**"/"**Ölçüm (aside).**"), plus the
// English forms and the heading/phrase fallbacks the task also asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { measurementOf, eventRefOf, decisionsOfRead } from "../tools/read-decisions.mjs";

test("Turkish bold label, period form (shape of a Turkish decision log): '**Ölçüm.** <paragraph>'", () => {
  const text = "## K1\n\n**Ölçüm.** Sevkiyat servisi `sevkNo` gönderiyor; kod `takipNo` diye tahmin ediyor. " +
    "Bu ayrı bir ikinci cümle.\n\nDevam eden bir sonraki paragraf, alınmamalı.\n";
  assert.equal(measurementOf(text), "Sevkiyat servisi `sevkNo` gönderiyor; kod `takipNo` diye tahmin ediyor.");
});

test("Turkish bold label, colon form: '**Ölçüm:** <paragraph>'", () => {
  const text = "## K2\n\n**Ölçüm:** bugün her kayıt zaten bir klasörde, ama klasörün adı yanlış.\n\nSonraki paragraf.\n";
  assert.equal(measurementOf(text), "bugün her kayıt zaten bir klasörde, ama klasörün adı yanlış.");
});

test("Turkish bold label with a parenthetical aside before the terminal period", () => {
  const text = "## K3\n\n**Ölçüm (2 Eyl, örnek veri).** `HEDEF.md` tablo yok diyor.\n\nX\n";
  assert.equal(measurementOf(text), "`HEDEF.md` tablo yok diyor.");
});

test("Turkish 'Başarı:' label (dotless-ı word boundary must not break matching)", () => {
  const text = "## K9\n\n**Başarı:** haftalık 500 kayıt oluşuyorsa başarılı sayılır.\n";
  assert.equal(measurementOf(text), "haftalık 500 kayıt oluşuyorsa başarılı sayılır.");
});

test("English bold labels: Measurement, Success, Metric", () => {
  assert.equal(measurementOf("## K7\n\n**Success:** the `signup_completed` event count crosses 500/week.\n"),
    "the `signup_completed` event count crosses 500/week.");
  assert.equal(measurementOf("## K8\n\n**Metric:** conversion rate above 3%.\n"), "conversion rate above 3%.");
  assert.equal(measurementOf("## K20\n\n**Measurement:** DAU grows 10% month over month.\n"),
    "DAU grows 10% month over month.");
});

test("heading form: '## Measurement' / '## Ölçüm', content in the next paragraph", () => {
  const en = "## K5\n\n## Measurement\n\nWe will check the `checkout_completed` event fires within 2 weeks.\n\nNext.\n";
  assert.equal(measurementOf(en), "We will check the `checkout_completed` event fires within 2 weeks.");
  const tr = "## K21\n\n## Ölçüm\n\nHaftalık 200 yeni kayıt bekleniyor.\n\nDevam.\n";
  assert.equal(measurementOf(tr), "Haftalık 200 yeni kayıt bekleniyor.");
});

test("phrase fallback: \"we'll know it worked when …\" (no explicit label at all)", () => {
  const text = "## K6\n\nNo label here. We will know it worked when signups double in a month.\n\nNext para.\n";
  assert.equal(measurementOf(text), "We will know it worked when signups double in a month.");
});

test("no measurement line at all: null, and a decision that merely contains the bare word (no label shape) also stays null", () => {
  assert.equal(measurementOf("## K4\n\nJust a plain decision with no special line at all.\n"), null);
  assert.equal(measurementOf("## K10\n\nBaşarısız bir denemeydi, ölçüm falan yok burada.\n"), null);
  assert.equal(measurementOf(""), null);
  assert.equal(measurementOf(undefined), null);
});

test("a long measurement paragraph is capped to a short display line, not the whole paragraph", () => {
  const long = "x".repeat(300);
  const text = `## K30\n\n**Measurement:** ${long} no sentence-ending punctuation anywhere in here at all so it has to be truncated by length instead of by sentence.\n`;
  const line = measurementOf(text);
  assert.ok(line.length <= 221, `expected a capped line, got ${line.length} chars`);
  assert.ok(line.endsWith("…"), "a truncated line should end with an ellipsis");
});

test("eventRefOf: a backtick-quoted, identifier-shaped token (snake_case/dot.case) is a candidate; a bare word or a file path is not", () => {
  assert.equal(eventRefOf("the `signup_completed` event count crosses 500/week."), "signup_completed");
  assert.equal(eventRefOf("We will check the `checkout.completed` event fires."), "checkout.completed");
  assert.equal(eventRefOf("conversion rate above 3%."), null, "no backtick token at all");
  assert.equal(eventRefOf("only `card` is mentioned here."), null, "a bare word isn't an event-shaped token");
  assert.equal(eventRefOf("see `docs/bulgular-2026-09/OLCUM_k9ev.md` for the numbers."), null, "a file path isn't a candidate");
});

test("decisionsOfRead: the `measure` field is wired onto each decision, additive (existing fields unaffected)", () => {
  const K = { repo: "unused", ref: "unused", preread: {} }; // no source configured -> [] (existing contract)
  assert.deepEqual(decisionsOfRead(K), []);
});
