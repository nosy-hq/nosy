// Maps a decision/request ref to the wave that names it, by parsing pm/waves.md's N-sections (the
// "Direction" bullets, e.g. `- **N1 · The record is right** · size M · internal requests 72, 73, 74,
// 83, 84.`). refs.mjs's own ref patterns already catch a lone "internal request 75" (N3, N4 write it
// singular), but the plural list form N1 actually writes ("internal requests 72, 73, 74, 83, 84") isn't
// matched by that pattern (it requires the singular noun) - expanded separately here. Any other ref the
// line carries (a K-decision, a §-item...) is picked up too, generically, through the same refs.mjs
// pattern set - so if a wave later names a decision instead of a request, no change is needed here.
// Generic: the waves file path comes from sources.json's `roadmap.path` (the same key
// interview-themes.mjs already reads for the same file), falling back to pm/waves.md; a missing file
// returns `found: false` so a caller can leave the column out entirely rather than fill it with "-".
// Used by: collect-status.mjs (peek's by-reference table), recent.mjs (the tie column).
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs";
import { readSources } from "./sources-file.mjs";

// source: a pm folder path, an already-read sources.json (K) object, or null/undefined (same convention
// refs.mjs's patternsOfLoad uses).
// Returns { found, path, map }. map: ref -> wave id ("N1", "N2", ...); the first wave to name a ref wins.
export function waveMapOf(source) {
  let K = null, pm = null;
  if (source && typeof source === "object") K = source;
  else if (source) { pm = source; try { K = readSources(pm); } catch {} }
  const wavesPath = K?.roadmap?.path || (pm ? path.join(pm, "waves.md") : null);
  const map = new Map();
  if (!wavesPath || !fs.existsSync(wavesPath)) return { found: false, path: wavesPath, map };
  const text = fs.readFileSync(wavesPath, "utf8");
  const refRe = refRegex(patternsOfLoad(K || pm));
  const lineRe = /^- \*\*(N\d+)\b[^\n]*$/gm;
  let m;
  while ((m = lineRe.exec(text))) {
    const wave = m[1], line = m[0];
    const refs = new Set((line.match(refRe) || []).map(groupKeyOf));
    // Plural list form ("internal requests 72, 73, 74[, and 84]."): expand every number in the list.
    const listRe = /internal requests?\s+([\d, ]*\d(?:\s+and\s+\d+)?)/gi;
    let lm;
    while ((lm = listRe.exec(line))) for (const n of lm[1].match(/\d+/g) || []) refs.add(`internal request ${n}`);
    for (const ref of refs) if (!map.has(ref)) map.set(ref, wave);
  }
  return { found: true, path: wavesPath, map };
}

// Library, not a CLI: a misdirected `node waves-map.mjs ...` would otherwise print
// nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "waves-map.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy peek\` or \`node skill/tools/collect-status.mjs\`?`);
  process.exit(1);
}
