// Shared matrix reader: pm/matrix.json lives in two shapes and each consumer used
// to read only one; on Nosy's own matrix, lowhanging's "widespread among rivals" signal never fired, and on
// a product without the line shape, build-waves didn't "recognize" the matrix.
//   line shape (hand-written, from a page like an older matrix page): { products:["Acme Books","RivalOne",...], lines:[{ group?, feature, not, codes:{name:code}, decision? }] }
//   step shape (build-matrix.mjs, Nosy's own): { steps:[{no,name}], biz:{name, codes:{no:code}, notes:{no:text}},
//                                                products:[{name, codes:{no:{k,evidence}}, statusType?}] }
// Reduces both to one shape: { format, biz, products:[name...], oh:Set, lines:[{ no?, group?, feature, not, codes:{name:code}, decision?, declined, declinedWhy }] }.
// Owner decisions: "we deliberately do not do this" is not a gap and must not read as Missing. The contract, with
// no word lists (nothing is guessed from the text of a note): the OWNER'S side only, never a rival's cell.
//   line shape: a row may carry `"declined": true`; the reason is the row's `decision` (else its `not`).
//   step shape: `biz.declined: { "<step no>": "reason" }` (the value `true` also counts, with no reason).
// Each line then has `declined` (boolean, false unless one of those) and `declinedWhy` (the reason, "" when none). Nothing else changes: the
// code of the owner's cell stays what the file says. matrix-preflight.mjs passes the flag through untouched; Nosy Cloud's readMatrix
// (src/data.ts) shows such an area as "Decided against" and keeps it out of the Missing counts and the behind lists, the same contract.
// A declined step the owner has fully built (code y) is not declined: the readers on the Cloud side ignore the flag then.
// `biz` is always products[0]. Acquired or closed rivals are in the `oh` set: they shouldn't count toward
// the "widespread among rivals" tally.
// Used by: lowhanging, gather-evidence, verify-setup, collect-signals, build-waves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This regex also has to recognize a Turkish-language rival status (a hand-written line-shape matrix can
// come from a Turkish-language source page) - the Turkish alternatives live in
// skill/data/lang/tr/read-matrix.json and are loaded at runtime; this is a language feature of the
// product Nosy analyzes, not Nosy's own language.
const TR = JSON.parse(fs.readFileSync(new URL("../data/lang/tr/read-matrix.json", import.meta.url), "utf8"));
const Oh = new RegExp([...TR.acquiredOrClosedWords, "acquired", "closed", "shut\\s*down", "discontinued"].join("|"), "i");
// A hand-written line-shape matrix can itself be keyed in Turkish (e.g. a pm/matris.json:
// urunler/satirlar/ozellik/kodlar instead of products/lines/feature/codes) - this is a language feature of
// the product Nosy reads, not Nosy's own language, same reasoning as the TR status words above. `LK` maps
// the shared shape's key names to their Turkish alias so both spellings resolve to the same reader.
const LK = TR.lineShapeKeys || {};
const pick = (obj, key) => (obj[key] !== undefined ? obj[key] : (LK[key] ? obj[LK[key]] : undefined));

// `codes` (sources.json → matrixCodes) maps the owner's own cell codes to Nosy's: { "s": "d", "f": "p" }.
// A code Nosy already has (y p n u d) is never remapped.
const OWN = new Set(["y", "p", "n", "u", "d"]);
export function matrixRead(source, { codes } = {}) {
  const mapCode = v => (codes && v !== undefined && v !== null && !OWN.has(v) && Object.prototype.hasOwnProperty.call(codes, v) ? codes[v] : v);
  const mapCodes = o => (codes ? Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, mapCode(v)])) : o || {});
  let M = source;
  if (typeof source === "string") { try { M = JSON.parse(fs.readFileSync(source, "utf8")); } catch { return null; } }
  if (!M || typeof M !== "object") return null;
  const rawLines = pick(M, "lines");
  if (Array.isArray(rawLines)) {
    const products = (pick(M, "products") || []).map(u => typeof u === "string" ? u : u.name);
    return { format: "line", biz: products[0], products, oh: new Set(),
      lines: rawLines.map(r => { const declined = pick(r, "declined") === true, decision = pick(r, "decision");
        return { group: pick(r, "group"), feature: pick(r, "feature"), not: pick(r, "not") || "", codes: mapCodes(pick(r, "codes")), decision, declined, declinedWhy: declined ? String(decision || pick(r, "not") || "") : "" }; }) };
  }
  if (Array.isArray(M.steps)) {
    const code = v => mapCode(v && typeof v === "object" ? v.k : v);
    const biz = M.biz?.name || "us", rival = M.products || [];
    const oh = new Set(rival.filter(u => Oh.test(u.statusType || String(u.status || "").split(/[\s(]/)[0] || "")).map(u => u.name));
    return { format: "step", biz, products: [biz, ...rival.map(u => u.name)], oh,
      lines: M.steps.map(a => { const d = M.biz?.declined?.[a.no], declined = d === true || (typeof d === "string" && d.trim() !== "");
        return { no: a.no, feature: a.name, not: M.biz?.notes?.[a.no] || "",
          codes: Object.fromEntries([[biz, code(M.biz?.codes?.[a.no]) ?? "u"], ...rival.map(u => [u.name, code(u.codes?.[a.no]) ?? "u"])]), declined, declinedWhy: declined && typeof d === "string" ? d : "" }; }) };
  }
  return null;
}

// Library, not a CLI: a misdirected `node read-matrix.mjs ...` would otherwise print
// nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "read-matrix.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy psst\` or \`node skill/tools/lowhanging.mjs\`?`);
  process.exit(1);
}
