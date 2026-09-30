// refs.mjs: sources.json `refAliases` makes one ref written two ways group as one (
// commits before the English migration say "iç talep N", later ones "internal request N").
import test from "node:test"; import assert from "node:assert/strict";
import { patternsOfLoad, refRegex, groupKeyOf } from "../tools/refs.mjs";

test("refAliases: Turkish and English forms group under one key; K-numbers still collapse", () => {
  const K = { refs: ["(?:internal request|[iİ]ç talep) \\d+", "\\bK\\d{2,3}(?:\\s*m\\.\\s*\\d+)?"], refAliases: [["[iİ]ç talep (\\d+)", "internal request $1"]] };
  const re = refRegex(patternsOfLoad(K));
  const keys = ["fix (iç talep 45)", "done: internal request 45", "İç talep 45 again", "K180 m.5 note"].flatMap(s => (s.match(re) || []).map(groupKeyOf));
  assert.deepEqual([...new Set(keys)], ["internal request 45", "K180"]);
});

test("refAliases: missing or broken aliases leave refs unchanged", () => {
  patternsOfLoad({ refAliases: [["(unclosed", "x"]] });
  assert.equal(groupKeyOf("iç talep 7"), "iç talep 7");
  patternsOfLoad({});
  assert.equal(groupKeyOf("#12"), "#12");
});
