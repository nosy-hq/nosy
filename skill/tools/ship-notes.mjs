#!/usr/bin/env node
// ship-notes: closes the loop with the people who asked. After something ships, each issue a merged PR closes gets ONE comment
// saying so. Shown to the owner first; posted only with --yes. The comment is the only thing Nosy writes outside pm/.
// Usage: node ship-notes.mjs <pm folder> [--since <tag|YYYY-MM-DD>] [--days N=14] [--yes] [--json <file>]
// What shipped: PRs merged into the integration branch since the release before the latest tag (git describe on the branch), else in the last
//   N days; --since (a tag or a date) and --days override. The issues a PR closes are GitHub's own `closingIssuesReferences`: nothing
//   is read out of words, titles or bodies (same rule as everywhere: explicit links only).
// An issue is told only when ALL of these hold: its author is not the PR's author, not a bot and not in sources.json `team`; it is not
//   locked; no earlier comment carries the marker below and pm/state/ship-notes.json doesn't list it (so a second run proposes nothing).
//   It never comments on a PR, never closes or labels anything, never edits an earlier comment, never names anyone or quotes anything.
// The text is fixed per language (skill/data/lang/<code>/ship-notes.json; sources.json `language`; an unknown language is English and
//   says so once on stderr), then the marker on its own line.
// Reads: gh pr list (merged), gh issue view (author, comments), gh api repos/<repo>/issues/<n> (locked: `gh issue view` has no such field).
// Writes: gh issue comment <n> --body-file - (the body goes on stdin, never in argv), one at a time, stopping at the first failure;
//   pm/state/ship-notes.json { posted: [{ issue, pr, at }] } after each one that went out.
import fs from "node:fs"; import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readSources, teamLogins, isTeamLogin } from "./sources-file.mjs";
import { integrationBranchOf } from "./integration-branch.mjs";
import { advice } from "./hints.mjs";

export const MARKER = "<!-- nosy:shipped -->";
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

// The phrase file of a language code ("tr", "tr-TR"; null or "en" is English). An unknown code is English and says so once.
const phraseFile = code => readJson(fileURLToPath(new URL(`../data/lang/${code}/ship-notes.json`, import.meta.url)));
const warned = new Set();
export function phrases(lang) {
  const code = String(lang || "en").trim().toLowerCase().split(/[-_]/)[0];
  const P = /^[a-z]{2,3}$/.test(code) ? phraseFile(code) : null;
  if (P) return P;
  if (!warned.has(code)) { warned.add(code); console.error(`ship-notes: no phrases for language "${lang}" yet (skill/data/lang/${code}/ship-notes.json); using English`); }
  return phraseFile("en");
}
// The whole comment body: the fixed sentence (with the release tag when the PR is in one), a blank line, the marker.
export function commentBody(pr, tag, lang) {
  const P = phrases(lang);
  return `${fill(tag ? P.shippedIn : P.shipped, { pr, tag })}\n\n${MARKER}\n`;
}
const sentenceOf = body => body.split("\n")[0];

const loginKey = x => String(x ?? "").trim().replace(/^@/, "").toLowerCase();
const isBot = a => !!a && (a.is_bot === true || /\[bot\]$|^app\//i.test(String(a.login ?? "")));

function main() {
  const argv = process.argv.slice(2);
  const al = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const flag = f => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const sinceArg = al("--since"), daysArg = al("--days"), jsonOut = al("--json"), yes = flag("--yes");
  const [pm = "pm"] = argv.filter(a => !a.startsWith("--"));
  const stop = msg => { console.error(`Psst… ${msg}`); process.exit(1); };

  let K; try { K = readSources(pm); } catch { stop(`couldn't read ${path.join(pm, "sources.json")}. Run \`nosy setup\` first.`); }
  const R = K.issue?.repo;
  if (!R) stop("ship-notes needs the GitHub repo that holds the issues: set `issue.repo` (owner/name) in pm/sources.json.");
  if (daysArg !== undefined && !(+daysArg > 0)) stop(`--days wants a number of days, got "${daysArg}".`);
  const repo = K.repo || ".";
  const gh = a => execFileSync("gh", a, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  const ghFail = (what, e) => { const t = `${e.stderr || ""}${e.message || ""}`; stop(`couldn't read ${what}: ${t.trim().split("\n")[0].slice(0, 150)}\n${advice(t) || "Check that gh is signed in (`gh auth status`) and `issue.repo` in pm/sources.json is right."} Nothing was posted.`); };
  const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

  // --- the window: --since, else --days, else the release tag before the latest one (so the newest release's PRs count), else 14 days ---
  const defaultBranch = (K.ref || "origin/main").replace(/^origin\//, "");
  const branch = integrationBranchOf({ ghRepo: R, defaultBranch, explicit: K.integrationBranch }).branch;
  let sinceIso, why, latestTag = "";
  if (sinceArg) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) { sinceIso = `${sinceArg}T00:00:00Z`; why = sinceArg; }
    else {
      const d = git("log", "-1", "--format=%cI", `${sinceArg}^{commit}`);
      if (!d) stop(`--since ${sinceArg}: not a date (YYYY-MM-DD) and not a tag or ref in ${repo}.`);
      sinceIso = d; why = `${sinceArg} (${d.slice(0, 10)})`;
    }
  } else if (daysArg !== undefined) { sinceIso = new Date(Date.now() - +daysArg * 864e5).toISOString(); why = `the last ${+daysArg} days`; }
  else {
    latestTag = git("describe", "--tags", "--abbrev=0", `origin/${branch}`) || git("describe", "--tags", "--abbrev=0", branch);
    // The window starts at the release BEFORE the latest, so the PRs of the release just tagged are in it: right after tagging is when the people
    // who asked want to hear. A second run is safe (the marker comment says who was told); with only one tag it starts a fortnight before it.
    const prevTag = latestTag && (git("describe", "--tags", "--abbrev=0", `${latestTag}^`) || ""), anchor = prevTag || latestTag;
    const d = anchor && git("log", "-1", "--format=%cI", `${anchor}^{commit}`);
    if (d && prevTag) { sinceIso = d; why = `the release before the latest, ${prevTag} (${d.slice(0, 10)}), so ${latestTag}'s PRs are included`; }
    else if (d) { sinceIso = new Date(Date.parse(d) - 14 * 864e5).toISOString(); why = `two weeks before the only release tag, ${latestTag} (${d.slice(0, 10)})`; }
    else { sinceIso = new Date(Date.now() - 14 * 864e5).toISOString(); why = "the last 14 days (no release tag found)"; }
  }
  const sinceMs = Date.parse(sinceIso);

  // --- merged PRs, and the issues each one closes (GitHub's own list) ---
  const CAP = 100;
  let prs;
  try {
    // One day earlier than the window: the search takes a UTC date, the precise cut is made below.
    const day = new Date(sinceMs - 864e5).toISOString().slice(0, 10);
    prs = JSON.parse(gh(["pr", "list", "-R", R, "--state", "merged", "--search", `merged:>=${day} base:${branch}`, "--limit", String(CAP),
      "--json", "number,title,mergedAt,author,closingIssuesReferences,mergeCommit"]));
  } catch (e) { ghFail("merged PRs", e); }
  const merged = prs.filter(p => Date.parse(p.mergedAt) >= sinceMs);
  const prNumbers = new Set(prs.map(p => p.number));
  const [owner, name] = R.split("/").map(x => x.toLowerCase());
  const asked = new Map(); // issue number -> the latest merged PR that closes it
  for (const p of merged) for (const ref of p.closingIssuesReferences || []) {
    const rr = ref.repository; // another repo's issue is not ours to comment on
    if (rr && (String(rr.name).toLowerCase() !== name || String(rr.owner?.login ?? owner).toLowerCase() !== owner)) continue;
    if (!ref.number || prNumbers.has(ref.number)) continue; // never a PR
    const have = asked.get(ref.number);
    if (!have || Date.parse(p.mergedAt) > Date.parse(have.mergedAt)) asked.set(ref.number, p);
  }

  // --- which of those issues get a comment ---
  const stateFile = path.join(pm, "state", "ship-notes.json");
  const state = readJson(stateFile) || {};
  const told = new Set((state.posted || []).map(x => x.issue));
  const team = teamLogins(K), lang = K.language;
  const skipped = {}, skip = why => { skipped[why] = (skipped[why] || 0) + 1; };
  const tagOf = oid => (oid && git("tag", "--contains", oid, "--sort=creatordate").split("\n").find(Boolean)) || "";
  const proposals = [];
  for (const n of [...asked.keys()].sort((a, b) => a - b)) {
    const p = asked.get(n);
    if (told.has(n)) { skip("already told"); continue; }
    let issue;
    try { issue = JSON.parse(gh(["issue", "view", String(n), "-R", R, "--json", "number,title,author,state,comments,url"])); }
    catch (e) { ghFail(`issue #${n}`, e); }
    const who = issue.author?.login;
    if (!who) { skip("author unknown"); continue; }
    if (isBot(issue.author)) { skip("opened by a bot"); continue; }
    if (loginKey(who) === loginKey(p.author?.login)) { skip("opened by the PR's own author"); continue; }
    if (isTeamLogin(team, who)) { skip("opened by the team"); continue; }
    if ((issue.comments || []).some(c => String(c.body ?? "").includes(MARKER))) { skip("already told"); continue; }
    let locked;
    try { locked = gh(["api", `repos/${R}/issues/${n}`, "--jq", ".locked"]).trim(); } catch { locked = ""; }
    if (locked === "true") { skip("locked"); continue; }
    if (locked !== "false") { skip("lock state unreadable"); continue; } // never guess
    const tag = tagOf(p.mergeCommit?.oid);
    proposals.push({ issue: n, issueTitle: issue.title, asker: who, pr: p.number, prTitle: p.title, tag: tag || null, body: commentBody(p.number, tag, lang) });
  }

  // --- the preview (always) ---
  const cut = (s, k) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, k);
    let o = `# Ship notes · ${R}\n\nMerged since ${why} on ${branch}: ${merged.length} PR${merged.length === 1 ? "" : "s"}, ${asked.size} issue${asked.size === 1 ? "" : "s"} closed by them.\n`;
  if (prs.length >= CAP) o += `(${CAP} merged PRs is the most that is read: narrow it with --since or --days.)\n`;
  o += "\n";
  if (proposals.length) {
    o += `| Issue | Asked by | Shipped in | Comment |\n|---|---|---|---|\n`;
    for (const x of proposals) o += `| #${x.issue} ${cut(x.issueTitle, 50)} | ${cut(x.asker, 40)} | #${x.pr} ${cut(x.prTitle, 40)} | ${sentenceOf(x.body)} |\n`;
    o += "\n";
  }
  const left = Object.entries(skipped).map(([k, v]) => `${v} ${k}`).join(", ");
  if (left) o += `Left alone: ${left}.\n\n`;
  if (!proposals.length) o += `Nobody to tell: ${asked.size ? "each issue they closed was left alone (see above)" : "no merged PR in the window closes an issue"}.\n`;
  const N = proposals.length;
  if (!yes) o += N ? `Nothing was posted. \`nosy ship-notes --yes\` posts ${N === 1 ? "this 1 comment" : `these ${N} comments`}.\n` : "Nothing was posted.\n";
  process.stdout.write(o);

  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify({ type: "shipNotes", generated: new Date().toISOString(), repo: R, branch, since: sinceIso, window: why, prsRead: merged.length, issuesClosed: asked.size,
      proposals: proposals.map(x => ({ issue: x.issue, askedBy: x.asker, pr: x.pr, tag: x.tag, comment: x.body })), skipped }, null, 1) + "\n");
  }
  if (!yes || !N) return;

  // --- --yes: post, one at a time, stop on the first failure ---
  let sent = 0;
  for (const x of proposals) {
    const r = spawnSync("gh", ["issue", "comment", String(x.issue), "-R", R, "--body-file", "-"], { input: x.body, encoding: "utf8" });
    if (r.status !== 0) {
      const t = `${r.stderr || ""}${r.error?.message || ""}`;
      console.error(`Psst… couldn't comment on #${x.issue}: ${t.trim().split("\n")[0].slice(0, 150)}\n${advice(t) || "Check that gh is signed in with a token that can comment on this repo."}\n${sent} of ${N} comment${N === 1 ? "" : "s"} went out; nothing further was tried. Run it again to try the rest (the issues already told are skipped).`);
      process.exitCode = 1; return;
    }
    sent++;
    state.posted = [...(state.posted || []), { issue: x.issue, pr: x.pr, at: new Date().toISOString() }];
    fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state, null, 1) + "\n");
    console.log(`Posted on #${x.issue} (${sent} of ${N}).`);
  }
  console.log(`${sent} comment${sent === 1 ? "" : "s"} posted. Nothing else was written outside pm/.`);
}

// A library for its phrases and comment text; a script when run on its own.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
