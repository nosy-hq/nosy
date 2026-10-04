#!/usr/bin/env node
// Recency (wave N2): what merged into the integration branch since the last run, and which open PRs are
// close to merging (approved and/or every check green). Each is tied to its decision/request/issue ref via
// refs.mjs — explicit refs only, matched in the PR's own title+body; never text similarity (internal
// request 72: text similarity never marks anything "shipped"). This is the "which decision does this PR
// serve" half of `overheard`, now a standing view instead of a one-off read (overheard.md points here).
// Usage: node recent.mjs <pm folder> [--since <date>] [--days N=7] [--branch <name>] [--json <file>]
// Incremental: with no --since/--days, the "merged since" window starts at the last recorded run in
// pm/history/runs.jsonl (diff.mjs's own file and line shape — see diff.mjs's saveRun()); this run appends
// its own line so the next run picks up where this one left off. --since/--days always override the marker
// (a deliberate wider look, e.g. after a gap).
// Output contract (coordinated with the N4/page session): besides markdown/--json, this also read-modify-
// writes a "recent" key into pm/state/shipped.json (other keys, written by N1/83/84, are left untouched):
//   "recent": { since, merged: [{n, title, merged, ref}], close: [{n, title, ref, why}] } — "ref" is the
//   FIRST explicit ref found (or null); the fuller per-PR tie list (every ref, CI detail, approval) stays
//   in this script's own --json output and markdown.
// Hook for skill/tools/shipped-links.mjs (explicit issue<->PR links; being built in a
// parallel session as of this writing). Once that file lands, its explicit issue cross-references should be
// able to widen a tie beyond what refs.mjs finds in the PR's own title/body. Until then, ties come from
// refs.mjs alone — the same rule preread.mjs already follows.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { patternsOfLoad, refRegex, groupKeyOf } from "./refs.mjs";
import { integrationBranchOf } from "./integration-branch.mjs";
import { waveMapOf } from "./waves-map.mjs";
import { localBranchesCloseToMerging } from "./local-branches.mjs";
import { advice } from "./hints.mjs";
import { readSources } from "./sources-file.mjs";

const argv = process.argv.slice(2);
const al = flagName => { const i = argv.indexOf(flagName); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const jsonOut = al("--json"), sinceArg = al("--since"), daysArg = al("--days"), branchArg = al("--branch");
const [pm = "pm"] = argv.filter(a => !a.startsWith("--"));
// A window that isn't one is said, not guessed: `--since banana` became an invalid date and the whole answer was wrong without a word.
if (sinceArg !== undefined && !(/^\d{4}-\d{2}-\d{2}/.test(sinceArg) && !Number.isNaN(Date.parse(sinceArg)))) { console.error(`Psst… --since "${sinceArg}" isn't a date: use a day count like 7d or a date like 2026-10-01.`); process.exit(1); }
if (daysArg !== undefined && !(/^\d+$/.test(daysArg) && +daysArg >= 1)) { console.error(`Psst… --days "${daysArg}" isn't a number of days: use a whole number like 30.`); process.exit(1); }

const K = readSources(pm);
const R = K.issue?.repo;
// No remote / no gh / offline: no issue.repo used to be fatal here ("recent needs a
// GitHub repo to read PRs from"), so a local-only clone could never get a "close to merging" answer. Now
// it's one of the ways into the same no-remote fallback as a failed gh call below: local branches stand
// in for PRs, and this stops being an error. noRemote is only set once BOTH gh reads below have failed (or
// there's no issue.repo at all) - one of the two failing on its own (a transient, call-specific problem)
// still gets the old quiet, single-call fallback (an empty list), not the full local-branch switch.
let mergedFailed = !R, approvableFailed = !R, mergedErr = null, approvableErr = null;
const gh = a => JSON.parse(execFileSync("gh", a, { encoding: "utf8", maxBuffer: 64 << 20 }));

const defaultBranch = (K.ref || "origin/main").replace(/^origin\//, "");
const branchDet = branchArg ? { branch: branchArg, reason: "--branch" }
  : integrationBranchOf({ ghRepo: R, defaultBranch, explicit: K.integrationBranch });
const branch = branchDet.branch;

// --- the "since" window: --since/--days win; otherwise the last recorded run in pm/history/runs.jsonl ---
const historyDir = path.join(pm, "history"), runsPath = path.join(historyDir, "runs.jsonl");
const lastRun = (() => {
  if (!fs.existsSync(runsPath)) return null;
  const lines = fs.readFileSync(runsPath, "utf8").trim().split("\n").filter(Boolean);
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
})();
const days = daysArg ? +daysArg : 7;
const sinceIso = sinceArg ? (/^\d{4}-\d{2}-\d{2}/.test(sinceArg) ? `${sinceArg}T00:00:00Z` : sinceArg)
  : lastRun?.zaman ? lastRun.zaman
  : new Date(Date.now() - days * 864e5).toISOString();
const sinceMs = Date.parse(sinceIso);
const sinceReason = sinceArg ? "--since" : lastRun?.zaman ? `last recorded run (${lastRun.zaman})` : `default window (${days}d)`;

const refRe = refRegex(patternsOfLoad(K));
const tieOf = text => [...new Set((text || "").match(refRe) || [])].map(groupKeyOf);

// --- merged into the integration branch since the window opened ---
let merged = [];
if (R) {
  try {
    const search = `merged:>=${sinceIso.slice(0, 10)} base:${branch}`;
    const raw = gh(["pr", "list", "-R", R, "--state", "merged", "--search", search, "--limit", "100",
      "--json", "number,title,author,mergedAt,body,baseRefName"]);
    merged = raw.filter(p => p.baseRefName === branch && Date.parse(p.mergedAt) >= sinceMs)
      .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
  } catch (e) { mergedFailed = true; mergedErr = String(e.message).slice(0, 150); }
}
// Dependency-bump PRs (chore(deps): ..., collect-status.mjs's own convention) are split out before tying:
// their body is often the dependency's own changelog, which lists dozens of THAT project's issue/PR numbers
// (e.g. "#21271 #21316 …") - matching those against refs.mjs would produce confident-looking but wrong ties
// (never a false "shipped against decision X").
const isDeps = p => /^chore\(deps\)/i.test(p.title || "");
const depsMerged = merged.filter(isDeps);
merged = merged.filter(p => !isDeps(p));

// --- close to merging: open, not a draft, approved and/or every check green ---
let approvable = [];
if (R) {
  try {
    const raw = gh(["pr", "list", "-R", R, "--state", "open", "--limit", "50",
      "--json", "number,title,author,updatedAt,isDraft,reviewDecision,statusCheckRollup,mergeable,body"]);
    const ciOf = p => { const rollup = p.statusCheckRollup || [];
      if (!rollup.length) return "missing";
      if (rollup.some(c => c.conclusion === "FAILURE")) return "red";
      if (rollup.some(c => !c.conclusion && c.status !== "COMPLETED")) return "running";
      return "green"; };
    approvable = raw.filter(p => !p.isDraft).map(p => ({ ...p, ci: ciOf(p), approved: p.reviewDecision === "APPROVED" }))
      .filter(p => p.approved || p.ci === "green")
      // approved+green first, then approved-only, then green-only; ties by most recently updated.
      .sort((a, b) => (b.approved && b.ci === "green") - (a.approved && a.ci === "green")
        || (b.approved - a.approved) || (Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  } catch (e) { approvableFailed = true; approvableErr = String(e.message).slice(0, 150); }
}
// No remote / no gh / offline: local branches not yet in the integration branch
// stand in for "close to merging" (local-branches.mjs; same fallback collect-status.mjs's peek uses) -
// only once BOTH reads above have failed (see the comment by mergedFailed/approvableFailed). Only a
// single-call, transient failure still gets the old per-call note (quiet, but not silent); a real
// no-remote/offline run prints just the one line below instead of two raw gh error messages.
const noRemote = mergedFailed && approvableFailed;
if (!noRemote) {
  if (mergedErr) console.error(`Psst… couldn't read merged PRs: ${mergedErr}\n${advice(mergedErr) || "Check that gh is signed in (`gh auth status`) and `issue.repo` in pm/sources.json is right."}`);
  if (approvableErr) console.error(`Psst… couldn't read open PRs: ${approvableErr}\n${advice(approvableErr) || "Check that gh is signed in (`gh auth status`) and `issue.repo` in pm/sources.json is right."}`);
}
const localBranches = noRemote
  ? localBranchesCloseToMerging({ repo: K.repo || ".", integrationBranch: branch, refSource: K })
  : [];
// Which decision/request a ref serves: pm/waves.md's N-sections, waves-map.mjs.
// waveInfo.found stays false (no "(wave)" annotation at all) when there's no waves file to read.
const waveInfo = waveMapOf(pm);

const tieCell = t => t.length ? t.map(r => waveInfo.found ? `${r} (${waveInfo.map.get(r) || "—"})` : r).join(" ") : "no tie";
const trimmed = (s, n) => String(s).slice(0, n).replace(/\|/g, "/");

let o = `# Recent · ${branch} (${branchDet.reason})\n\nMerged-since window: ${sinceReason}.\n\n`;
if (noRemote) o += `(no remote: PRs not read; local branches used)\n\n`;
o += `## Merged since the last run (${merged.length}${depsMerged.length ? ` + ${depsMerged.length} dependency updates` : ""})\n\n| PR | Title | Tie | Author | Merged |\n|---|---|---|---|---|\n`;
o += (merged.map(p => `| #${p.number} | ${trimmed(p.title, 70)} | ${tieCell(tieOf(p.title + " " + (p.body || "")))} | ${p.author?.login || "?"} | ${p.mergedAt.slice(0, 10)} |`).join("\n") || "—") + "\n\n";
if (depsMerged.length) o += `Dependency updates (tie left out; see the header comment): ${depsMerged.map(p => "#" + p.number).join(" ")}\n\n`;
if (noRemote) {
  o += `## Close to merging (local branches) (${localBranches.length})\n\n| Branch | Ahead | Last | Author | Refs |\n|---|---|---|---|---|\n`;
  o += (localBranches.map(b => `| ${b.branch} | ${b.ahead} | ${b.last.slice(0, 10)} | ${b.author} | ${b.refs.join(" ") || "—"} |`).join("\n") || "—") + "\n";
} else {
  o += `## Close to merging (${approvable.length})\n\n| PR | Title | Tie | Author | Approved | CI | Updated |\n|---|---|---|---|---|---|---|\n`;
  o += (approvable.map(p => `| #${p.number} | ${trimmed(p.title, 70)} | ${tieCell(tieOf(p.title + " " + (p.body || "")))} | ${p.author?.login || "?"} | ${p.approved ? "yes" : "—"} | ${p.ci} | ${p.updatedAt.slice(0, 10)} |`).join("\n") || "—") + "\n";
}
process.stdout.write(o);

if (jsonOut) fs.writeFileSync((fs.mkdirSync(path.dirname(jsonOut), { recursive: true }), jsonOut), JSON.stringify({
  type: "recent", generated: new Date().toISOString(), branch, branchReason: branchDet.reason, since: sinceIso, sinceReason,
  noRemote,
  merged: merged.map(p => ({ n: p.number, t: p.title, a: p.author?.login, mergedAt: p.mergedAt, tie: tieOf(p.title + " " + (p.body || "")), ...(waveInfo.found ? { wave: waveInfo.map.get(tieOf(p.title + " " + (p.body || ""))[0]) || "—" } : {}) })),
  dependency: depsMerged.length,
  closeToMerging: approvable.map(p => ({ n: p.number, t: p.title, a: p.author?.login, approved: p.approved, ci: p.ci, updatedAt: p.updatedAt, tie: tieOf(p.title + " " + (p.body || "")), ...(waveInfo.found ? { wave: waveInfo.map.get(tieOf(p.title + " " + (p.body || ""))[0]) || "—" } : {}) })),
  localBranches: localBranches.map(b => ({ branch: b.branch, ahead: b.ahead, last: b.last, author: b.author, subject: b.subject, refs: b.refs })),
}, null, 1));

// Merges a "recent" key into pm/state/shipped.json (read-modify-write; other keys, written by another
// branch (N1/83/84), are left as-is — coordinated shape, see the header comment).
const shippedPath = path.join(pm, "state", "shipped.json");
let shippedDoc = {};
try { shippedDoc = JSON.parse(fs.readFileSync(shippedPath, "utf8")); } catch {}
shippedDoc.recent = {
  since: sinceIso.slice(0, 10),
  merged: merged.map(p => ({ n: p.number, title: p.title, merged: p.mergedAt.slice(0, 10), ref: tieOf(p.title + " " + (p.body || ""))[0] || null })),
  close: approvable.map(p => ({ n: p.number, title: p.title, ref: tieOf(p.title + " " + (p.body || ""))[0] || null,
    why: [p.approved ? "approved" : null, p.ci === "green" ? "checks green" : null].filter(Boolean).join(", ") || "—" })),
};
fs.mkdirSync(path.join(pm, "state"), { recursive: true });
fs.writeFileSync(shippedPath, JSON.stringify(shippedDoc, null, 1));

// Records this run so the next one is incremental (diff.mjs's runs.jsonl shape: zaman/label/ref/lastMain/folder/numbers).
fs.mkdirSync(historyDir, { recursive: true });
fs.appendFileSync(runsPath, JSON.stringify({
  zaman: new Date().toISOString(), label: "recent", ref: K.ref || null, lastMain: null, folder: null,
  numbers: { merged: merged.length, closeToMerging: approvable.length },
}) + "\n");
