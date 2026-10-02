// psst-refute.mjs: the refuter's packet and how its verdicts shape the final list.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pack, apply, formatMd } from "../tools/psst-refute.mjs";
import { temporary, clean } from "./helpers.mjs";

const dirs = [];
after(() => dirs.forEach(clean));
const W = (pm, f, o) => fs.writeFileSync(path.join(pm, "state", f), JSON.stringify(o));

function pm() {
  const root = temporary("nosy-refute-"); dirs.push(root);
  const p = path.join(root, "pm"); fs.mkdirSync(path.join(p, "state"), { recursive: true });
  W(p, "receipts.json", { ref: "5920bd3aa", items: [{ rank: 2, gate: { held: true, because: [{ at: "web/mapper.ts:2", refs: ["#385"], decisions: [] }] },
    code: [{ at: "web/mapper.ts:2", text: ["// dropped: source_label — screen decision is separate (#385)."] }], needs: [], request: [], decisions: [], history: [], reach: [] }] });
  W(p, "psst-draft.json", { items: [
    { id: 1, title: "Download links", claim: "two URLs", size: "S", evidence: ["web/next-step.tsx:44"], receipt: null },
    { id: 2, title: "Source section", claim: "one screen piece", size: "S", evidence: ["web/mapper.ts:2"], receipt: 2 },
    { id: 3, title: "Pricing", claim: "data entry", size: "XS", evidence: ["web/pricing.tsx:61"], receipt: null },
  ] });
  return p;
}

test("pack: the draft with each item's receipts, including the held gate and the code's own words", () => {
  const p = pm(), r = pack(p);
  assert.equal(r.items, 3);
  const md = fs.readFileSync(r.out, "utf8");
  assert.match(md, /## Item 2: Source section[\s\S]*⛔ Receipt says held on purpose:\*\* web\/mapper\.ts:2 \(#385\)[\s\S]*> \/\/ dropped: source_label/);
  assert.match(md, /## Item 1: Download links[\s\S]*No receipt for this item: check every claim from scratch/);
  assert.match(md, /"verdict": "stands" \| "weakened" \| "refuted"/);
});

test("apply: refuted drops, weakened takes the fix, precision is logged", () => {
  const p = pm();
  W(p, "refute.json", { items: [
    { id: 1, verdict: "stands", checked: ["web/next-step.tsx:44 renders the placeholder"], why: "ok" },
    { id: 2, verdict: "refuted", checked: ["web/mapper.ts:2 comment parks it (#385)"], why: "held on purpose" },
    { id: 3, verdict: "weakened", checked: ["plan structs lack description/features"], why: "fields missing", fix: "M: three plan fields plus data" },
  ] });
  const R = apply(p);
  assert.equal(R.ok, true);
  assert.deepEqual(R.items.map(i => [i.id, i.verdict]), [[1, "stands"], [3, "weakened"]]);
  assert.equal(R.items[1].size, "M", "internal request 152: a fix that opens with a size sets it");
  assert.deepEqual(R.dropped.map(d => d.title), ["Source section"]);
  assert.deepEqual(R.stats, { drafted: 3, stands: 1, weakened: 1, refuted: 1, precision: 0.33, fromList: 0, fromReading: 2 });
  assert.match(formatMd(R), /Nothing on the list survived checking: all 2 item\(s\) below come from reading the code/, "internal request 130");
  assert.match(formatMd(R), /1 stand, 1 corrected, 1 dropped \(precision 0\.33\)[\s\S]*Pricing\*\* \(corrected: M: three plan fields plus data\)[\s\S]*Source section: held on purpose/);
  const log = fs.readFileSync(path.join(p, "state", "refute-log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].dropped, ["Source section"]);
});

test("apply: a rubber stamp, a missing verdict or a fix-less weakened are rejected, nothing written", () => {
  const p = pm();
  W(p, "refute.json", { items: [
    { id: 1, verdict: "stands", checked: [], why: "looks fine" },
    { id: 3, verdict: "weakened", checked: ["x"], why: "y" },
  ] });
  const R = apply(p);
  assert.equal(R.ok, false);
  assert.deepEqual(R.problems, ["item 1: nothing listed under \"checked\" (a verdict has to say what it looked at)", "item 2: no verdict", "item 3: weakened without a fix"]);
  assert.ok(!fs.existsSync(path.join(p, "state", "psst-final.json")));
  assert.match(formatMd(R), /Verdicts not usable/);
});

test("apply: a refuter that numbered the items instead of copying text ids still lands on the right items", () => {
  const p = pm();
  const draft = JSON.parse(fs.readFileSync(path.join(p, "state", "psst-draft.json"), "utf8"));
  draft.items = draft.items.map((it, i) => ({ ...it, id: ["links", "source", "pricing"][i] }));
  W(p, "psst-draft.json", draft);
  assert.match(fs.readFileSync(pack(p).out, "utf8"), /Use `"id": "source"` for this item/);
  W(p, "refute.json", { items: [
    { id: 1, verdict: "stands", checked: ["a"], why: "ok" },
    { id: 2, verdict: "refuted", checked: ["b"], why: "held" },
    { id: "pricing", verdict: "stands", checked: ["c"], why: "ok" },
  ] });
  const R = apply(p);
  assert.equal(R.ok, true, JSON.stringify(R.problems));
  assert.deepEqual(R.dropped.map(d => d.id), ["source"]);
});

test("psst-refute runs as a command when the skill is reached through a symlink (the project skill link), instead of silently doing nothing", async () => {
  const fsx = await import("node:fs"), pathx = await import("node:path"), h = await import("./helpers.mjs");
  const dir = h.temporary("nosy-link-");
  try {
    const link = pathx.join(dir, "tools"); fsx.symlinkSync(h.Tool, link);
    const r = h.run(pathx.join(link, "psst-refute.mjs"), []); // no arguments: the usage line, which reads no pm/
    assert.equal(r.code, 1); assert.match(r.error, /usage: psst-refute\.mjs pack\|apply/);
  } finally { h.clean(dir); }
});
