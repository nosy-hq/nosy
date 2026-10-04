// matrix-preflight: will the dashboard draw this matrix? On the first run on a real product `publish` said "Published"
// for a matrix Cloud could not read (the owner's own keys and codes: `s` and `f` where Nosy says `d` and `p`), and the owner found
// out by reading the dashboard back. Cloud reads two shapes with the codes y p n u d; anything else it shows as Unknown. This is the
// same reader every other tool uses (read-matrix.mjs, which also resolves Turkish keys), run before the send:
//   - the shape must be one of the two, else the send stops (nothing would be drawn); a matrix with no rows yet is sent as it is
//     (a new product has nothing to compare), and `publish` then expects an empty matrix back, not a failure;
//   - codes are mapped with `sources.json` → `matrixCodes` ({ "s": "d", "f": "p" }), the owner's vocabulary to Nosy's;
//   - what is left outside y p n u d is counted and named; when most cells are unknown the send stops;
//   - a matrix keyed in another language, or with mapped codes, is sent as the English shape (the same rows, nothing added);
//     an untouched matrix is sent byte for byte;
//   - owner decisions pass through untouched: a line-shape row's `"declined": true` and the step shape's
//     `biz.declined` map survive every rewrite above, and the report counts them (the contract is at the top of read-matrix.mjs).
// Returns { ok, text, report } or { ok: false, problem }. The report is what `publish` prints, one line.
import { matrixRead } from "./read-matrix.mjs";

const VALID = new Set(["y", "p", "n", "u", "d"]);
const codeOf = v => (v && typeof v === "object" ? v.k : v);

// The own-product column (BlogFactory incident, 4 Oct 2026). A step-shaped matrix with rows but no `biz` (or one with no name or no codes at all) was accepted, drawn as
// "0 of 6 done, lead -4.5" and published: an unconfigured input shown as a measured score. Everything that reads a matrix asks this one question. Not for the line shape
// (its own product is the first column of `products`) and not for a matrix with no rows yet (a new product has nothing to compare). Cells missing from a valid `biz.codes`
// are fine: they read as unknown.
export function ownColumnProblem(M) {
  if (!M || typeof M !== "object" || !Array.isArray(M.steps) || !M.steps.length) return null;
  const biz = M.biz, codes = biz && typeof biz === "object" ? biz.codes : null;
  const why = biz == null ? "biz is empty" : typeof biz !== "object" || Array.isArray(biz) ? "biz isn't an object" : !String(biz.name ?? "").trim() ? "biz has no name" : !codes || typeof codes !== "object" || Array.isArray(codes) || !Object.keys(codes).length ? "biz has no codes" : null;
  if (!why) return null;
  return { rows: M.steps.length, why, reason: "own-column",
    problem: `pm/matrix.json has ${M.steps.length} rows but no usable column for your own product (${why}), so the dashboard would show the product itself with 0 done and every comparison as a real score. Nothing was sent.`,
    fix: "put it back from the newest pm/history/matrix-before-build-*.json (its `biz` key), or write pm/us.json ({\"name\": \"…\", \"codes\": {\"1\": \"y\", …}}) and rebuild the matrix, then publish again" };
}

export function preflightMatrix(text, { codes = {} } = {}) {
  let M;
  try { M = JSON.parse(String(text).replace(/^﻿/, "")); }
  catch (e) { // where the parser stopped, not the text around it (the message quotes a piece of the file)
    const at = String(e.message).match(/position \d+(?: \(line \d+ column \d+\))?/)?.[0];
    return { ok: false, problem: `pm/matrix.json isn't valid JSON${at ? ` (${at})` : ""}. Fix that spot, then publish again.` }; }
  const own = ownColumnProblem(M);
  if (own) return { ok: false, reason: own.reason, rows: own.rows, why: own.why, problem: `${own.problem} To fix: ${own.fix}.`, fix: own.fix };
  let raw;
  try { raw = matrixRead(M); }
  catch { return { ok: false, problem: "pm/matrix.json has a row or a product that is not an object (a null, a number, a string where a row should be), so the dashboard could not draw it. `nosy doctor --check` shows what it found." }; }
  if (!raw) return { ok: false, problem: "pm/matrix.json has neither `lines` with `products` (the line shape) nor `steps` with `biz` (the step shape), so the dashboard would draw nothing. `nosy doctor --check` shows what it found." };

  // Count every cell once: what the file says, what it becomes, what is still unknown.
  const mapped = new Map(), unknown = new Map(); let cells = 0, unknownCells = 0;
  for (const l of raw.lines) for (const v of Object.values(l.codes || {})) {
    const k = codeOf(v); if (k === undefined || k === null) continue;
    cells++;
    const to = Object.prototype.hasOwnProperty.call(codes, k) && !VALID.has(k) ? codes[k] : k;
    if (to !== k) mapped.set(`${k}→${to}`, (mapped.get(`${k}→${to}`) || 0) + 1);
    if (!VALID.has(to)) { unknown.set(String(k), (unknown.get(String(k)) || 0) + 1); unknownCells++; }
  }
  const mapV = v => { const k = codeOf(v); return Object.prototype.hasOwnProperty.call(codes, k) && !VALID.has(k) ? codes[k] : k; };
  // Two products with one name share one column of codes (the line shape keys cells by name) and one link on the dashboard: said, not blocked.
  const seen = new Set(), duplicateNames = [...new Set(raw.products.filter(n => { const k = String(n ?? ""); if (!k) return false; const dup = seen.has(k); seen.add(k); return dup; }))];
  const ownCode = l => { const k = codeOf((l.codes || {})[raw.biz]); return Object.prototype.hasOwnProperty.call(codes, k) && !VALID.has(k) ? codes[k] : k; };
  const aliased = raw.format === "line" && !(Array.isArray(M.lines) && Array.isArray(M.products)); // keys read through the Turkish alias
  const needsRewrite = aliased || mapped.size > 0;
  const report = { format: raw.format, areas: raw.lines.length, rivals: Math.max(0, raw.products.length - 1), cells, mapped: [...mapped].map(([k, n]) => ({ map: k, n })),
    unknown: [...unknown].map(([code, n]) => ({ code, n })), rewritten: needsRewrite, keysTranslated: aliased,
    declined: raw.lines.filter(l => l.declined && ownCode(l) !== "y").length, // a row we have fully built is not decided against (the dashboard ignores the flag then)
    ...(duplicateNames.length ? { duplicateNames } : {}) };

  if (cells && unknownCells / cells > 0.5) {
    const names = report.unknown.slice(0, 4).map(u => `\`${u.code}\` (${u.n})`).join(", ");
    return { ok: false, problem: `${unknownCells} of ${cells} cells in pm/matrix.json use codes the dashboard doesn't know (${names}); it would show them all as Unknown. Map them in pm/sources.json, e.g. "matrixCodes": { "${report.unknown[0].code}": "d" } (y done, p partial, n missing, u unknown, d announced), then publish again.`, report };
  }
  if (!needsRewrite) return { ok: true, text, report };

  let out;
  if (raw.format === "line") {
    out = { ...(M.update ? { update: M.update } : {}), products: raw.products,
      lines: raw.lines.map(l => ({ ...(l.group ? { group: l.group } : {}), feature: l.feature, ...(l.not ? { not: l.not } : {}),
        codes: Object.fromEntries(Object.entries(l.codes || {}).map(([p, v]) => [p, mapV(v)])), ...(l.decision ? { decision: l.decision } : {}), ...(l.declined ? { declined: true } : {}) })) };
  } else {
    out = JSON.parse(JSON.stringify(M));
    const remap = c => { if (!c) return c; for (const [no, v] of Object.entries(c)) { if (v && typeof v === "object") v.k = mapV(v); else c[no] = mapV(v); } return c; };
    remap(out.biz?.codes); for (const p of out.products || []) remap(p.codes);
  }
  return { ok: true, text: JSON.stringify(out, null, 1), report };
}

// One line for `publish`'s list.
export function describe(r) {
  const bits = [r.areas ? `${r.areas} areas × ${r.rivals} rival${r.rivals === 1 ? "" : "s"}` : "no rows yet (an empty matrix: nothing to compare)"];
  if (r.mapped.length) bits.push(`codes mapped: ${r.mapped.map(m => `${m.map} (${m.n})`).join(", ")}`);
  if (r.keysTranslated) bits.push("keys read in another language, sent as the English shape");
  if (r.declined) bits.push(`${r.declined} decided against (shown as "Decided against", not Missing)`);
  if (r.duplicateNames?.length) bits.push(`more than one product is called ${r.duplicateNames.slice(0, 3).map(n => `"${n}"`).join(", ")}: they share one column of codes and one link on the dashboard, so give each its own name`);
  if (r.unknown.length) bits.push(`still unknown to the dashboard: ${r.unknown.map(u => `${u.code} (${u.n})`).join(", ")}, shown as Unknown`);
  return bits.join("; ");
}
