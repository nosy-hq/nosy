// Shared reference-pattern helper: configurable reference capture per product.
// A previous product's specific K/section/#/OWNER patterns were missing references like WP-306, ADR-0009,
// JIRA-12 in a different product. Uses sources.json's `refs` (an array of regex strings) if present,
// otherwise DEFAULT.
// Used by: collect-status.mjs, preread.mjs, find-stale.mjs.
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSources } from "./sources-file.mjs";

// OWNER refs like "OWNER 48" without a section sign should also be caught, so the
// section mark is now optional. The last, general pattern (UPPERCASE+number, hyphenated) is for products
// that don't use the K/section/#/OWNER convention.
export const Default = [
  "(?:OWNER|roadmap)\\s*§?\\s*[\\d.]+",
  "#\\d+",
  "§\\d+[a-z]?",
  "\\bK\\d{2,3}(?:\\s*m\\.\\s*\\d+(?:[-–,]\\s*(?:m\\.)?\\d+)*)?",
  "\\b[A-Z][A-Z0-9]{1,9}-\\d+\\b",
  "\\bnb-\\d{6}-[a-z0-9]+(?:-[a-z0-9]+){0,3}\\b", // bet ids (N3): bet.mjs's nb-<yyMMdd>-<slug>
];

// Aliases: one ref written two ways must group as one. sources.json `refAliases`:
// [["iç talep (\\d+)", "internal request $1"], ...] (regex, replacement; case-insensitive). Loaded by
// patternsOfLoad, which every caller runs before groupKeyOf, so callers need no change.
let aliases = [];
const aliasesOf = K => (K && Array.isArray(K.refAliases) ? K.refAliases : []).flatMap(([from, to]) => { try { return [[new RegExp(`^(?:${from})$`, "i"), to]]; } catch { return []; } });

// `source`: a pm folder path, an already-read sources.json (K) object, or null/undefined.
// Falls back silently to DEFAULT if `refs` is missing/empty (verify-setup.mjs validates the setting; this
// doesn't print an error).
export function patternsOfLoad(source) {
  let K = null;
  if (source && typeof source === "object") K = source;
  else if (source) { try { K = readSources(source); } catch {} }
  aliases = aliasesOf(K);
  return (K && Array.isArray(K.refs) && K.refs.length) ? K.refs : Default;
}

// Combines the patterns into a single global regex (tried in order; the first match at a position wins).
export function refRegex(patterns = Default) {
  return new RegExp(patterns.join("|"), "g");
}

// Normalizes the group key: "K180 m.5" -> "K180" (grouping is by K-number). Leaves other patterns untouched.
export function groupKeyOf(ref) {
  let r = String(ref).replace(/\s+/g, " ").trim();
  for (const [re, to] of aliases) if (re.test(r)) { r = r.replace(re, to); break; }
  return r.replace(/^(K\d+).*/, "$1");
}

// Library, not a CLI: a misdirected `node refs.mjs ...` would otherwise print nothing
// and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "refs.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy peek\` or \`node skill/tools/collect-status.mjs\`?`);
  process.exit(1);
}
