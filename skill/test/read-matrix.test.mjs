// Contract tests for tools/read-matrix.mjs (matrisRead, exported): reduces both shapes to the same form
// (format, biz, products, lines[].codes); a rival with statusType "acquired" ends up in the 'oh' set.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fakeProductSetup } from "./fake-product.mjs";
import { clean } from "./helpers.mjs";
import { matrixRead } from "../tools/read-matrix.mjs";

let K;
before(async () => { K = await fakeProductSetup(); });
after(() => clean(K.root));

test("line shape (OLD/Acme Books): format line, biz is the first product, products is an array, lines[].codes", () => {
  const M = matrixRead(path.join(K.pm, "matrix.json"));
  assert.ok(M, "could not read the matrix");
  assert.equal(M.format, "line");
  assert.equal(M.biz, "Cargo");
  assert.deepEqual(M.products, ["Cargo", "DispatchPro", "Yolcu360", "RotaPlus"]);
  assert.ok(M.lines.length > 0);
  const line = M.lines.find(s => /Bulk export/.test(s.feature));
  assert.ok(line, "bulk export line not found");
  assert.equal(line.codes.Cargo, "b");
  assert.equal(M.oh.size, 0, "the line shape's 'oh' set is always empty (only the step shape carries statusType)");
});

test("step shape (Nosy/build-matrix): reduces to the same shape; a rival with statusType 'acquired' is in the 'oh' set", () => {
  const M = matrixRead({
    steps: [{ no: "1", name: "Shipment list" }, { no: "2", name: "Bulk export" }],
    biz: { name: "Cargo", codes: { 1: "y", 2: { k: "p", evidence: "partial" } }, notes: { 2: "API exists, no screen" } },
    products: [
      { name: "DispatchPro", codes: { 1: "y", 2: "y" } },
      { name: "OldRival", codes: { 1: "n", 2: "n" }, statusType: "acquired" },
    ],
  });
  assert.ok(M, "could not read the step shape");
  assert.equal(M.format, "step");
  assert.equal(M.biz, "Cargo");
  assert.deepEqual(M.products, ["Cargo", "DispatchPro", "OldRival"]);
  assert.ok(M.oh.has("OldRival"), "a rival with statusType 'acquired' should be in the 'oh' set");
  assert.ok(!M.oh.has("DispatchPro"));
  const line2 = M.lines.find(s => s.no === "2");
  assert.equal(line2.codes.Cargo, "p", "the object-shaped code ({k,evidence}) should resolve");
  assert.equal(line2.codes.DispatchPro, "y");
  assert.equal(line2.not, "API exists, no screen");
});

test("line shape, Turkish keys (a Turkish-keyed pm/matris.json shape: urunler/satirlar/ozellik/kodlar): still recognized as the line format", () => {
  const M = matrixRead({
    urunler: ["Acme Books", "RivalOne", "RivalTwo"],
    satirlar: [
      { grup: "Yapay zekâ", ozellik: "Kaynaklı AI sohbet", not: "kısmen", kodlar: { "Acme Books": "y", RivalOne: "y", RivalTwo: "p" } },
      { ozellik: "Toplu dışa aktarma", kodlar: { "Acme Books": "b", RivalOne: "y", RivalTwo: "n" } },
    ],
  });
  assert.ok(M, "could not read the Turkish-keyed line shape");
  assert.equal(M.format, "line");
  assert.equal(M.biz, "Acme Books");
  assert.deepEqual(M.products, ["Acme Books", "RivalOne", "RivalTwo"]);
  assert.equal(M.lines.length, 2);
  const line = M.lines.find(s => /dışa aktarma/.test(s.feature));
  assert.ok(line, "'Toplu dışa aktarma' line not found");
  assert.equal(line.codes["Acme Books"], "b");
  assert.equal(M.oh.size, 0);
});
