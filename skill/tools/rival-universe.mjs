// The market universe: every rival-shaped product found, not just the ones researched (BlogFactory field test). Onboarding offered four candidates at a time, the owner
// picked all four, and the dashboard then showed "4 rivals" as if the market held four, while the repository's own landscape study named eight and a fresh public search found five
// more. "At most four at a time" is a batch size for the owner's attention; it is not the size of the market. This file is the market: researched or not.
//   pm/state/rival-universe.json
//   { "searches": [ { "date": "YYYY-MM-DD", "query": "<what was searched>", "added": <how many credible new candidates it turned up> } ],
//     "candidates": [ { "name", "url", "class": "direct" | "feature" | "adjacent", "status": "compared" | "known" | "excluded" | "unverified", "reason": "<one line, required for excluded and unverified>" } ] }
//   class      direct: sells to the same buyer for the same job · feature: overlaps strongly on some steps · adjacent: a substitute or a neighbour, not a rival
//   status     compared: has a rival file and a column · known: found and classified, not researched yet · excluded: looked at and ruled out, with the reason · unverified: could not be confirmed
// Stopping rule: keep searching, in batches of at most four for the owner to confirm, until two searches in a row add no credible candidate, or the owner says stop. `check` says whether that
// has happened. Coverage is what the dashboard should say: "4 compared / 11 known / 3 excluded, last searched 4 Oct".
// Usage: node rival-universe.mjs <pm> [--json]    Exit: 0 the stopping rule is met · 2 not yet (search again, or ask the owner to stop) · 1 no file
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

export const FILE = "rival-universe.json";
const CLASSES = new Set(["direct", "feature", "adjacent"]), STATUSES = new Set(["compared", "known", "excluded", "unverified"]);

export function load(pm) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(pm, "state", FILE), "utf8").replace(/^﻿/, "")); } catch (e) { return fs.existsSync(path.join(pm, "state", FILE)) ? { error: `${FILE} isn't valid JSON (${String(e.message).split("\n")[0]})` } : null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `${FILE} isn't a JSON object` };
  const problems = [], candidates = [];
  for (const [i, c] of (Array.isArray(raw.candidates) ? raw.candidates : []).entries()) {
    const name = String(c?.name ?? "").trim(), cls = String(c?.class ?? ""), status = String(c?.status ?? ""), reason = String(c?.reason ?? "").trim();
    if (!name) { problems.push(`candidate ${i + 1}: no name`); continue; }
    if (!CLASSES.has(cls)) problems.push(`${name}: class must be direct, feature or adjacent`);
    if (!STATUSES.has(status)) problems.push(`${name}: status must be compared, known, excluded or unverified`);
    if ((status === "excluded" || status === "unverified") && !reason) problems.push(`${name}: ${status} needs a one-line reason`);
    candidates.push({ name, url: c?.url ? String(c.url) : null, class: CLASSES.has(cls) ? cls : "adjacent", status: STATUSES.has(status) ? status : "unverified", reason });
  }
  const searches = (Array.isArray(raw.searches) ? raw.searches : []).map(s => ({ date: String(s?.date ?? ""), query: String(s?.query ?? ""), added: Number.isFinite(+s?.added) ? +s.added : null })).filter(s => s.date);
  searches.sort((a, b) => a.date.localeCompare(b.date));
  const tail = searches.slice(-2), met = tail.length === 2 && tail.every(s => s.added === 0), stopped = raw.ownerStopped === true;
  const count = st => candidates.filter(c => c.status === st).length;
  return { searches, candidates, problems, ownerStopped: stopped, stoppingRuleMet: met || stopped,
    coverage: { compared: count("compared"), known: count("known"), excluded: count("excluded"), unverified: count("unverified"), total: candidates.length, lastSearched: searches.length ? searches[searches.length - 1].date : null, searches: searches.length },
    byClass: { direct: candidates.filter(c => c.class === "direct").length, feature: candidates.filter(c => c.class === "feature").length, adjacent: candidates.filter(c => c.class === "adjacent").length } };
}

export function render(U) {
  if (!U) return "No rival universe yet: the discovery step writes pm/state/rival-universe.json (every candidate found, researched or not, with the searches that found them).";
  if (U.error) return U.error;
  const c = U.coverage, L = [`Market coverage: ${c.compared} compared · ${c.known} known, not researched · ${c.excluded} excluded · ${c.unverified} unverified (${c.total} found by ${c.searches} search${c.searches === 1 ? "" : "es"}${c.lastSearched ? `, last ${c.lastSearched}` : ""}).`,
    `By kind: ${U.byClass.direct} direct · ${U.byClass.feature} feature · ${U.byClass.adjacent} adjacent.`];
  L.push(U.stoppingRuleMet ? (U.ownerStopped ? "The owner said stop: the search is closed." : "The last two searches added nothing credible: the search can stop.") : "Not done: the stopping rule needs two searches in a row that add no credible candidate (or the owner saying stop). Search again, in batches of at most four for the owner to confirm.");
  for (const p of U.problems) L.push(`✗ ${p}`);
  return L.join("\n");
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), asJson = argv.includes("--json"), pm = argv.find(a => !a.startsWith("--")) || "pm", U = load(pm);
  console.log(asJson ? JSON.stringify(U, null, 1) : render(U));
  process.exitCode = !U || U.error ? 1 : U.problems.length || !U.stoppingRuleMet ? 2 : 0;
}
