// Shared threshold helper: the "widespread" ceiling, wave capacity (day/size),
// measure-size's coverage/consistency thresholds and collect-signals's idf threshold used to be hardcoded
// in the scripts; no product could tune them for its own market. sources.json's OPTIONAL `threshold`
// object is merged here with the default - if a key is missing, or only partially given, behavior stays
// exactly the same as before.
// Used by: lowhanging, build-waves, measure-size, collect-signals, shipped-links (via shipped-record and
// the coming score/shipped commands), build-page. verify-setup warns about an
// unknown `threshold` field.
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSources } from "./sources-file.mjs";

export const Default = {
  common: 3, // lowhanging/build-waves: the absolute ceiling for the "widespread among rivals" count
  sizeDays: { S: 1, M: 3, L: 6 }, // build-waves: default day count from the size letter, if size.json is missing
  sizeCoverageLow: 0.34, // measure-size: below this coverage, confidence drops to "low"
  sizeCoverageHigh: 0.8, // measure-size: minimum coverage needed for "high" confidence
  sizeConsistency: 0.8, // measure-size: share of the top 5 similar items in the most common area; below this, confidence caps at medium
  signalThreshold: 16, // collect-signals: idf-weighted match score threshold
  waveSimilarity: 0.6, // build-waves: title-similarity threshold used when there's no ref
  minN: 10, // shipped-links: minimum row count before a rate/count is shown instead of "too few to say"
  dresscodeMaxCandidates: 3, // dresscode: after this many rejected candidates on the same check, stop proposing new ones and mark it ✗
  shippedIgnoreDocs: ["md", "mdx", "txt"], // shipped-links.mjs's decisionShippedBy (N1): a commit whose only touched files are the decisions log or another doc with one of these extensions (ROADMAP.md, docs/PLAN.md, ...) never counts as "shipped" on its own
  pageMaxKB: 300, // build-page: warn (not block) when the built page.html is over this many KB, listing the biggest blocks
  logTailKB: 30, // build-page (the log is folded under the first screen now): byte budget for how much of the tail of log.md gets inlined into the "Cycle log" section; older entries stay in the file, just aren't on the page
  capacityWindowDay: 30, // build-waves: how far back to look for "who's active" when suggesting team capacity
  capacityMinCommits: 3, // build-waves: below this many commits in the window (and only one active day), an author counts as a drive-by, not a team member
};

// `source`: a pm folder path, an already-read sources.json (K) object, or null/undefined (the same
// pattern as refs.mjs's patternsOfLoad). If `threshold` is missing/partial, missing fields come from DEFAULT.
export function thresholds(source) {
  let K = null;
  if (source && typeof source === "object") K = source;
  else if (source) { try { K = readSources(source); } catch {} }
  const E = (K && typeof K.threshold === "object" && K.threshold) ? K.threshold : {};
  return {
    ...Default,
    ...E,
    sizeDays: { ...Default.sizeDays, ...(E.sizeDays && typeof E.sizeDays === "object" ? E.sizeDays : {}) },
  };
}

// Library, not a CLI: a misdirected `node thresholds.mjs ...` would otherwise print
// nothing and exit 0. Callers are found at runtime by scanning skill/tools/*.mjs for an import of this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const self = "thresholds.mjs";
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const callers = fs.readdirSync(dir).filter(f => f.endsWith(".mjs") && f !== self)
    .filter(f => { try { return new RegExp(`["']\\./${self}["']`).test(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return false; } }).sort();
  console.error(`${self} is a library used by ${callers.join(", ") || "no other tool"}; did you mean \`nosy psst\` or \`node skill/tools/lowhanging.mjs\`?`);
  process.exit(1);
}
