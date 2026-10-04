// Measures the age of pm/ inputs (status, lowhanging, matrix, rival, page) AND their real staleness against git — a
// file that's 1 day old but has 150 commits in between is stale (while concurrent sessions
// advance main, a file looks "today's" but lags behind in commits; internal request 25 → find-stale's generalization,
// from stale info caught by hand on the owner's page in cycles 2/3). Pattern: Enterpret "Integration Transparency" →
// proactively reports source access (5); DeepWiki's usage-signal-driven refresh priority → a different threshold
// per input (status/lowhanging are read often: a tight threshold, a rival changes rarely: a loose threshold);
// Crayon "Sparks" + severity ranking → an "order" of at most 4 steps. Also reports rival
// files whose "Latest major announcement" doesn't start with `date — text` or whose Status is empty.
// Usage: node freshness.mjs <pm> [--page <page.html>] [--json <file>] [--strict]   (--strict: exit code 1 if there's a ✗)
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { pagePath as pagePathOf } from "./page-path.mjs"; import { readSources } from "./sources-file.mjs"; import { generatedOf } from "./auto-section.mjs";

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const flag = k => { const i = argv.indexOf(k); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const jsonOut = opt("--json"), pageArg = opt("--page"), strict = flag("--strict");
const pm = argv[0] || "pm";

// ---- helpers ----
const day = ms => ms / 86400000;
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const fmt = d => d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
const fmtHour = d => d.toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const statusOf = (ageDays, threshold) => ageDays == null ? "–" : ageDays <= threshold ? "✓" : ageDays <= threshold * 2 ? "~" : "✗";

// ---- date parser: pulls a date out of free text like "Last major announcement" and a page's embedded
// "generated D MMM HH:MM" (best guess when there's no clear date in the primary source; in the spirit of
// "(not verified)" — it's a pointer, not a certainty). ----
const Months = { january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11 };
const AY_RX = Object.keys(Months).sort((a, b) => b.length - a.length).join("|");
const DATE_RX = new RegExp(
  `(?<isoY>\\d{4})-(?<isoM>\\d{1,2})-(?<isoD>\\d{1,2})` +
  `|(?<dA_d>\\d{1,2})\\s+(?<dA_ay>${AY_RX})\\s+(?<dA_y>\\d{4})(?:\\s+(?<dA_s>\\d{1,2}):(?<dA_min>\\d{2}))?` +
  `|(?<aY_ay>${AY_RX})\\s+(?<aY_y>\\d{4})` +
  `|[ÇQ](?<qN1>[1-4])\\s*['’]?\\s*(?<qY1>\\d{4})` +
  `|(?<qY2>\\d{4})\\s*[ÇQ](?<qN2>[1-4])` +
  `|(?<dA2_d>\\d{1,2})\\s+(?<dA2_ay>${AY_RX})\\b(?!\\s+\\d{4})(?:\\s+(?<dA2_s>\\d{1,2}):(?<dA2_min>\\d{2}))?` +
  `|\\b(?<onlyY>20\\d{2})\\b`, "gi");
const dateChange = g => {
  const monthOf = s => Months[s.toLowerCase()];
  if (g.isoY) return new Date(Date.UTC(+g.isoY, +g.isoM - 1, +g.isoD));
  // If a time is present ("generated 28 Sep 15:31") it's read as local time; otherwise start of day. Dropping the time would make a section generated the same day look "hours stale".
  if (g.dA_y) return g.dA_s ? new Date(+g.dA_y, monthOf(g.dA_ay), +g.dA_d, +g.dA_s, +g.dA_min) : new Date(Date.UTC(+g.dA_y, monthOf(g.dA_ay), +g.dA_d));
  if (g.aY_y) return new Date(Date.UTC(+g.aY_y, monthOf(g.aY_ay), 1));
  if (g.qY1) return new Date(Date.UTC(+g.qY1, (+g.qN1 - 1) * 3, 1));
  if (g.qY2) return new Date(Date.UTC(+g.qY2, (+g.qN2 - 1) * 3, 1));
  if (g.dA2_ay) return g.dA2_s ? new Date(new Date().getFullYear(), monthOf(g.dA2_ay), +g.dA2_d, +g.dA2_s, +g.dA2_min) : new Date(Date.UTC(new Date().getFullYear(), monthOf(g.dA2_ay), +g.dA2_d));
  if (g.onlyY) return new Date(Date.UTC(+g.onlyY, 0, 1));
  return null;
};
// DATE_RX has the "g" flag and is shared: exec advances lastIndex, and matchAll starts from that same lastIndex. Reset it on
// every call, or one file's match will make the next file's search start too late (in the synthetic example, MidRival's read date leaked this way).
const firstDate = text => { DATE_RX.lastIndex = 0; const m = DATE_RX.exec(text || ""); DATE_RX.lastIndex = 0; return m ? dateChange(m.groups) : null; };
const allMatch = text => { DATE_RX.lastIndex = 0; return [...(text || "").matchAll(DATE_RX)]; };
const allDates = text => allMatch(text).map(m => dateChange(m.groups)).filter(Boolean);
const newestDate = dates => dates.filter(d => d.getTime() <= Date.now()).sort((a, b) => b - a)[0]; // so future-dated target/ETA lines (e.g. "shipping on Sep 29") don't get counted as "newest" and mask staleness

// ---- sources.json (optional; if missing, git/access checks return "–", age checks still work) ----
let K = null; try { K = readSources(pm); } catch {}
const Threshold = { state: 2, lowHanging: 2, matrix: 14, rival: 30, page: 7, git: 20, ...(K?.freshness || {}) };
const GENERAL_THRESHOLD = 7; // for a type not in the threshold list (signal, size, diff, ... written by other branches)
const Command = { state: "peek", lowHanging: "psst", matrix: "neighbors", rival: "neighbors", page: "tea", stale: "stale-find", waves: "scoop", inventory: "inventory tool (canwe branch, internal request 26)" };

const inputs = [];
const add = o => inputs.push({ name: o.name, path: o.path ?? "", age_days: o.age_days ?? null, threshold: o.threshold ?? null, status: o.status, reason: o.reason ?? "", command: o.command ?? null });

// ---- 1. <pm>/state/*.json: generated age (shown even when the type is unknown) ----
const statusDir = path.join(pm, "state");
let files = []; try { files = fs.readdirSync(statusDir).filter(f => f.endsWith(".json")); } catch {}
const typeInfo = {}; // type -> { generated, file, ageDays, lastMain }
for (const f of files) {
  const j = read(path.join(statusDir, f));
  const type = j?.type || f.replace(/\.json$/, "");
  const generatedAt = j?.generated ? new Date(j.generated) : null;
  const ageDays = generatedAt ? day(Date.now() - generatedAt) : null;
  const threshold = Threshold[type] ?? GENERAL_THRESHOLD;
  typeInfo[type] = { generated: generatedAt, file: f, ageDays, lastMain: j?.lastMain || null };
  add({
    name: `state/${f} · ${type}`, path: path.join(statusDir, f), age_days: ageDays != null ? +ageDays.toFixed(1) : null, threshold,
    status: !j ? "✗" : !generatedAt ? "–" : statusOf(ageDays, threshold),
    reason: !j ? "JSON could not be read" : !generatedAt ? "no generated field" : `generated ${fmt(generatedAt)}, ${ageDays.toFixed(1)} days ago`,
    command: (generatedAt && ageDays > threshold) ? (Command[type] || `re-run the step that produces ${type}`) : null,
  });
}
if (!files.length) add({ name: "state/*.json", path: statusDir, status: "–", reason: "pm/state/ is empty or missing", command: "peek" });

// ---- 2. staleness against git: commit count between lastMain and K.ref (matters more than age) ----
if (K) {
  for (const [type, b] of Object.entries(typeInfo)) {
    if (!b.lastMain) continue;
    let N = null, reason;
    try { N = +execFileSync("git", ["-C", K.repo, "rev-list", "--count", `${b.lastMain}..${K.ref}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); reason = `${N} commits between ${b.lastMain}..${K.ref}`; }
    catch (e) { reason = `git rev-list failed: ${String(e.message).slice(0, 90)}`; }
    const threshold = Threshold.git, status = N == null ? "✗" : statusOf(N, threshold);
    if (N != null) typeInfo[type].gitN = N;
    add({ name: `git: ${b.file} lastMain→${K.ref}`, path: K.repo, age_days: N, threshold, status, reason, command: (N != null && N > threshold) ? (Command[type] || "peek") : null });
  }
} else add({ name: "git: lastMain→ref", path: "", status: "–", reason: "no sources.json, can't compare", command: "move-in" });

// ---- 3. matrix.json update age + the oldest 5 "Last major announcement" in rival files (closed/acquired excluded) ----
const matrixPath = K?.matrix || path.join(pm, "matrix.json");
const M = read(matrixPath);
let matrixStale = false;
if (M?.update) {
  const g = new Date(M.update), ageDays = day(Date.now() - g), threshold = Threshold.matrix;
  matrixStale = ageDays > threshold;
  add({ name: "matrix.json", path: matrixPath, age_days: +ageDays.toFixed(1), threshold, status: statusOf(ageDays, threshold), reason: `update ${M.update}`, command: matrixStale ? "neighbors" : null });
} else add({ name: "matrix.json", path: matrixPath, status: "✗", reason: M ? "no update field" : "unreadable", command: "build-matrix or neighbors" });

const rivalDir = path.join(pm, "rivals");
let rFile = []; try { rFile = fs.readdirSync(rivalDir).filter(f => f.endsWith(".md") && !f.startsWith("_")); } catch {}
// Our own freshness = the file's last check: the newest of the read dates in "## Sources"; otherwise the last git commit
// (a git date also shifts with a wording fix, hence second priority).
// A rival's "Last major announcement" is informational only: our data isn't stale just because a rival is quiet (a "quiet rival" note gets appended instead).
const gitLast = new Map();
try {
  const out = execFileSync("git", ["-C", rivalDir, "log", "--format=@%cI", "--name-only", "--", "."], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  let t = null; for (const l of out.split("\n")) { if (l.startsWith("@")) t = new Date(l.slice(1)); else if (l.trim() && t && !gitLast.has(path.basename(l.trim()))) gitLast.set(path.basename(l.trim()), t); }
} catch {}
const rivals = [];
for (const f of rFile) {
  const md = fs.readFileSync(path.join(rivalDir, f), "utf8");
  const durM = md.match(/\*\*Status:\*\*\s*([^\n]+)/);
  if (durM && /shut down|acquired/i.test(durM[1])) continue; // dead/acquired rival: excluded
  const hearM = md.match(/^-\s*\*\*Latest major announcement:\*\*\s*(.+)$/m);
  const name = (md.match(/^#\s+(.+)$/m) || [, f])[1].trim();
  const sourceSection = (md.split(/^## Sources\s*$/m)[1] || "").split(/^## /m)[0];
  // Only full dates that include a day; dates inside URLs ("…-2025-10-22") and bare years ("2026 report") don't count as a read.
  const fullDates = allMatch(sourceSection.replace(/https?:\/\/\S+/g, " ")).filter(m => m.groups.isoY || m.groups.dA_y || m.groups.dA2_ay).map(m => dateChange(m.groups)).filter(Boolean);
  const readCount = newestDate(fullDates) || null, git = gitLast.get(f) || null;
  const check = readCount || git;
  rivals.push({ name, f, date: check, checkSource: readCount ? "Sources read" : "git", announcement: hearM ? firstDate(hearM[1]) : null });
}
const dated = rivals.filter(r => r.date).sort((a, b) => a.date - b.date);
let rivalStale = false;
for (const r of dated.slice(0, 5)) {
  const ageDays = day(Date.now() - r.date), threshold = Threshold.rival;
  if (ageDays > threshold) rivalStale = true;
  const silent = r.announcement && day(Date.now() - r.announcement) > 180 ? ` · last announcement ~${fmt(r.announcement)} (quiet rival)` : r.announcement ? ` · last announcement ~${fmt(r.announcement)}` : "";
  add({ name: `rival: ${r.name}`, path: path.join(rivalDir, r.f), age_days: +ageDays.toFixed(1), threshold, status: statusOf(ageDays, threshold), reason: `last checked ${fmt(r.date)} (${r.checkSource})${silent}`, command: ageDays > threshold ? "neighbors" : null });
}
const undatedCount = rivals.length - dated.length;

// ---- 3b. announcement/status format check: "Latest major announcement" must be
// `date | text` — the line must START with a parseable date (YYYY-MM-DD, YYYY-MM, YYYY, "YYYY Qn", or the
// literal "no date" when nothing is known) followed by " — ", so a reader/script can split on it without
// re-parsing free text. "Status" must be filled (old files left it empty). Runs over EVERY rival file,
// including shut down/acquired ones (the staleness ranking above excludes them; this format check doesn't).
const ANNOUNCEMENT_LEAD_RX = /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4}\s+Q[1-4]|\d{4}|no date)\s—\s/i;
const formatIssues = [];
for (const f of rFile) {
  const md = fs.readFileSync(path.join(rivalDir, f), "utf8");
  // [ \t]* (not \s*) right after the label: \s* would cross the newline into the NEXT field when this one is
  // empty (e.g. "**Status:**\n- **Latest...") and wrongly capture that field's text as this one's value.
  const hearM = md.match(/^-\s*\*\*Latest major announcement:\*\*[ \t]*(.*)$/m);
  const statusM = md.match(/^-\s*\*\*Status:\*\*[ \t]*(.*)$/m);
  const badDate = !hearM || !ANNOUNCEMENT_LEAD_RX.test(hearM[1]);
  const badStatus = !statusM || !statusM[1].trim();
  if (badDate || badStatus) {
    const why = [badDate ? "announcement doesn't start with `date — `" : null, badStatus ? "Status missing/empty" : null].filter(Boolean).join(" · ");
    formatIssues.push({ file: f, badDate, badStatus, why });
  }
}

// ---- 4. page: the auto-section's embedded date + the newest date on the page, relative to status/lowhanging ----
const pageFound = pagePathOf(pm, K, { explicit: pageArg });
let pagePath = pageFound.exists || pageFound.configured || pageArg ? pageFound.path : null;

let automaticStale = false, pageStale = false;
const newestInput = [typeInfo.state?.generated, typeInfo.lowHanging?.generated].filter(Boolean).sort((a, b) => b - a)[0] || null;
if (pagePath && fs.existsSync(pagePath)) {
  const html = fs.readFileSync(pagePath, "utf8");
  const autoM = html.match(/<!-- pm:auto -->([\s\S]*?)<!-- \/pm:auto -->/);
  if (autoM) {
    // The block's own ISO time (data-generated, written by auto-section.mjs in any language) comes first; a block from an older
    // Nosy has none, so its text is parsed for English month names as before (a Turkish block of that age can't be dated).
    const stamped = generatedOf(html.slice(autoM.index, autoM.index + autoM[0].length)), embedded = stamped || newestDate(allDates(autoM[1]));
    if (newestInput && embedded) {
      const AUTO_THRESHOLD = 0.02; // ~28 min: rounding slack for the page's "D MMM HH:MM" minute precision, not real staleness
      const diff = day(newestInput - embedded); automaticStale = diff > AUTO_THRESHOLD;
      add({ name: "page: auto section", path: pagePath, age_days: +diff.toFixed(2), threshold: AUTO_THRESHOLD, status: automaticStale ? "✗" : "✓", reason: `section ${stamped ? "generated" : "says"} ${fmtHour(embedded)} · newest input ${fmtHour(newestInput)} (section is ${Math.round(diff * 24 * 60)} min behind the input)`, command: automaticStale ? "auto-section" : null });
    } else add({ name: "page: auto section", path: pagePath, status: "–", reason: newestInput ? "the section carries no generation time (re-run `auto-section.mjs` on the page to stamp it)" : "state/lowhanging has no generated field", command: null });
  } else add({ name: "page: auto section", path: pagePath, status: "–", reason: "no <!-- pm:auto --> marker", command: null });

  const newestOnPage = newestDate(allDates(html));
  if (newestInput && newestOnPage) {
    const ageDays = day(newestInput - newestOnPage), threshold = Threshold.page;
    pageStale = ageDays > threshold;
    add({ name: "page: newest date", path: pagePath, age_days: +ageDays.toFixed(1), threshold, status: statusOf(ageDays, threshold), reason: `newest on page ${fmt(newestOnPage)} · newest input ${fmt(newestInput)}`, command: pageStale ? "find-stale, then tea" : null });
  }
} else add({ name: "page", path: pagePath || "", status: "–", reason: pagePath ? `${pagePath} not found` : "no page path (--page, sources.json.page, or product.md)", command: null });

// ---- 5. source access: does K.repo exist, does K.ref resolve, gh session (accessibility only — doesn't repeat verify-setup's path checks) ----
let accessIssueOf = !K;
if (!K) add({ name: "sources.json", path: path.join(pm, "sources.json"), status: "✗", reason: "pm/sources.json missing", command: "move-in" });
else {
  let repoOk = false; try { execFileSync("git", ["-C", K.repo, "rev-parse", "--git-dir"], { stdio: "ignore" }); repoOk = true; } catch {}
  accessIssueOf = accessIssueOf || !repoOk;
  add({ name: "K.repo access", path: K.repo, status: repoOk ? "✓" : "✗", reason: repoOk ? "accessible" : "git repo not found", command: repoOk ? null : "fix the repo path in sources.json" });

  let refOk = false, refShort = ""; try { refShort = execFileSync("git", ["-C", K.repo, "rev-parse", "--short", K.ref], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); refOk = true; } catch {}
  accessIssueOf = accessIssueOf || !refOk;
  const lastReadOne = typeInfo.state?.ageDays != null ? `${typeInfo.state.ageDays.toFixed(1)} days ago` : "unknown";
  add({ name: "K.ref resolution", path: K.ref, status: refOk ? "✓" : "✗", reason: refOk ? `${K.ref} = ${refShort} · last read (status.json) ${lastReadOne}` : K.ref ? `${K.ref} doesn't resolve (git fetch?)` : "no `ref` in pm/sources.json (the branch Nosy reads)", command: refOk || !K.ref ? null : "git fetch" });

  let ghOk = false; try { execFileSync("gh", ["auth", "status"], { stdio: "ignore" }); ghOk = true; } catch {}
  add({ name: "gh access", path: "gh auth status", status: ghOk ? "✓" : "–", reason: ghOk ? "gh session open (read-only)" : "gh missing or not signed in", command: null });
}

// If the base outputs are missing entirely, saying "fresh" would be wrong (an empty pm/state used to say "all fresh"): absence also gets a ✗ and enters the order.
const missingBase = [["state", "peek", "status.json"], ["lowHanging", "psst", "lowhanging.json"]].filter(([type]) => !typeInfo[type]);
for (const [type, command, file] of missingBase) add({ name: `state/${file} · ${type}`, path: path.join(statusDir, file), status: "✗", reason: "missing: never generated", command });

// ---- 6. order: which output was generated from which input, is the input newer than the output — a re-run order of at most 4 steps ----
const order = [];
const addOrder = k => { if (k && !order.includes(k)) order.push(k); };
const typeStale = type => { const b = typeInfo[type]; if (!b) return false; const threshold = Threshold[type] ?? GENERAL_THRESHOLD; return (b.ageDays != null && b.ageDays > threshold) || (b.gitN != null && b.gitN > Threshold.git); };
// Priority: access > known chain (peek → psst → neighbors → auto-section → tea) > unknown/experimental types (other branches).
if (accessIssueOf) addOrder("fix sources.json / git access");
if (typeStale("state") || !typeInfo.state) addOrder("peek");
if (!typeInfo.lowHanging) addOrder("psst");
if (typeStale("lowHanging") || (typeInfo.state?.generated && typeInfo.lowHanging?.generated && typeInfo.state.generated > typeInfo.lowHanging.generated)) addOrder("psst"); // the input (status) is newer than the output (lowhanging)
if (matrixStale || rivalStale) addOrder("neighbors");
if (automaticStale) addOrder("auto-section");
if (pageStale) addOrder("tea"); // if lowhanging/status is newer than the page
for (const type of Object.keys(typeInfo)) if (!["state", "lowHanging"].includes(type) && typeStale(type)) addOrder(Command[type] || `re-run the step that produces ${type}`);
const orderLast = order.slice(0, 4);

const stale = inputs.filter(g => g.status === "✗").length;
const generated = new Date().toISOString();

// ---- output ----
let o = `# Freshness · ${pm} · generated ${generated.slice(0, 16).replace("T", " ")}\n\n`;
o += `| Input | Age | Threshold | Status | Why | Command |\n|---|---|---|---|---|---|\n`;
o += inputs.map(g => `| ${g.name} | ${g.age_days ?? "–"} | ${g.threshold ?? "–"} | ${g.status} | ${g.reason.replace(/\|/g, "/")} | ${g.command || ""} |`).join("\n") + "\n";
if (undatedCount) o += `\nCould not find a last-checked date for ${undatedCount} rival files (not in git, no read date in Sources; not counted in the order).\n`;
o += `\n## Rival file format (internal request 45)\n${formatIssues.length} of ${rFile.length} rival files need "date — text" / a filled Status:\n`;
if (formatIssues.length) {
  o += `| File | Issue |\n|---|---|\n` + formatIssues.map(g => `| ${g.file} | ${g.why} |`).join("\n") + "\n";
}
o += `\nnext up: ${orderLast.length ? orderLast.join(" → ") : "everything's fresh, nothing to do"}\n`;
process.stdout.write(o);
if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({ type: "freshness", generated, inputs, order: orderLast, stale, announcementFormat: { checked: rFile.length, issues: formatIssues } }, null, 1));
if (strict && stale > 0) process.exit(2); // exit contract: 2 = something needs attention
