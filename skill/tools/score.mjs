// score (N3): settles bets from the git shipped record, using explicit links only — the bet id in a
// commit message, a merge message (which carries the branch name, e.g. "Merge branch 'bet/nb-…'"), a PR title/body/branch,
// or one of the bet's listed PR numbers. No text similarity anywhere, no GitHub writes.
// Usage: node score.mjs <pm> [--json <file>] [--now YYYY-MM-DD] [--include-backfill]
// Per bet:
//   landed     = the first merge (first-parent commit) into the integration branch that carries the id; works on a
//                local-only repo with no remote (Nosy itself). With sources.json issue.repo and `gh`, merged PRs whose
//                title/body/branch carry the id count too (read-only).
//   partial    = the bet lists PRs (--pr) and only some of them merged.
//   reverted   = a `git revert` of the bet's work (a "This reverts commit <hash>" message, or "Revert" + the id) after it landed.
//   patched    = within 14 days of landing, a commit or PR that references the bet id or the bet's PR number.
//   possible follow-up = within 14 days, a commit touching the same files with no reference: shown "check", never a status.
//   open too long = not landed after more than 2× the estimate (calendar days): a flag, not a failure.
//   actual     = active days (distinct days with the bet's commits) → S/M/L by thresholds sizeDays.
//   expected outcome = recorded, not scored ("not checked (no usage source)").
// Calibration (estimate vs actual) is shown only with at least `minN` settled bets (thresholds.mjs, default 10;
// internal request 84); backfill bets stay out unless --include-backfill.
// Writes: each bet file's Status line and "## Score" section, pm/bets/bets.json, pm/state/score.json (read by `tea`, N4).
import { localDayOf } from "./today.mjs";
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { betsLoad, betSave, indexWrite } from "./bet.mjs";
import { thresholds } from "./thresholds.mjs";
import { integrationBranchOf, refFor } from "./integration-branch.mjs";
import { readSources } from "./sources-file.mjs";

const DAY = 864e5, SIZES = ["S", "M", "L"];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idRe = id => new RegExp(`(?<![A-Za-z0-9_-])${esc(id)}(?![A-Za-z0-9_-])`);
const ymd = d => d ? localDayOf(d) : null; // the owner's calendar day

export function calculate(pm, { now = Date.now(), includeBackfill = false } = {}) {
  const K = readSources(pm);
  const E = thresholds(K), minN = E.minN ?? 10, sizeDays = E.sizeDays || { S: 1, M: 3, L: 6 };
  // a bookkeeping file every commit in this repo happens to touch (pm/log.md, the same
  // shippedIgnoreDocs list shipped-links.mjs's decisionShippedBy already uses to keep a doc-only edit from
  // counting as "shipping" a decision) can't be what makes two commits "the same work" for follow-up
  // purposes either — otherwise every commit in the 14-day window matches every bet that also happens to
  // log to it, and the "possible follow-up" list stops meaning anything.
  const ignoreExt = new Set((E.shippedIgnoreDocs || []).map(e => String(e).toLowerCase().replace(/^\./, "")));
  const extOf = f => { const base = String(f).split("/").pop() || ""; const i = base.lastIndexOf("."); return i > 0 ? base.slice(i + 1).toLowerCase() : ""; };
  const git = (...a) => { try { return execFileSync("git", ["-C", K.repo || ".", ...a], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const bets = betsLoad(pm);
  const defaultRef = K.ref || "origin/main", defaultBranch = defaultRef.replace(/^origin\//, "");
  const det = integrationBranchOf({ ghRepo: K.issue?.repo, defaultBranch, explicit: K.integrationBranch });
  const INT = det.branch === defaultBranch ? defaultRef : refFor(K.repo || ".", det.branch, defaultRef);
  const base = { type: "score", generated: new Date(now).toISOString(), minN, integration: INT, integrationReason: det.reason };
  if (!bets.length) return { ...base, bets: [], calibration: null };

  // --- the integration branch's history since well before the oldest bet (work may start before the bet is written) ---
  const oldest = bets.map(b => Date.parse(b.placed)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? now;
  const since = ymd(oldest - 90 * DAY);
  const C = new Map();
  for (const rec of git("log", INT, `--since=${since}`, "--format=%H%x1f%cI%x1f%aI%x1f%P%x1f%B%x1e").split("\x1e")) {
    const [h, cdate, adate, parents, ...msg] = rec.replace(/^\n+/, "").split("\x1f"); if (!h || h.length < 40) continue;
    C.set(h, { h, date: cdate, adate, parents: (parents || "").split(" ").filter(Boolean), msg: msg.join("\x1f").trim(), files: [], filesRead: false });
  }
  // File lists are read lazily, only for landed bets' work and their 14-day window, with rename detection off: on a
  // big or partial clone (blob:none), `git log --name-only` over months lets rename detection fetch blobs from the
  // remote (Metabase: minutes for one score run).
  const filesOf = h => { const c = C.get(h); if (!c) return []; if (c.filesRead) return c.files; c.filesRead = true;
    c.files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", h).split("\n").filter(Boolean); return c.files; };
  const FP = git("rev-list", "--first-parent", INT, `--since=${since}`).split("\n").filter(Boolean), FPset = new Set(FP);
  const landingOf = h => { if (FPset.has(h)) return h; const l = git("rev-list", "--first-parent", "--ancestry-path", `${h}..${INT}`).trim().split("\n").filter(Boolean); return l.at(-1) || null; };
  const broughtIn = m => { const c = C.get(m); if (!c || c.parents.length < 2) return [m]; return git("rev-list", c.parents[1], `^${c.parents[0]}`).split("\n").filter(Boolean); };
  const prOfMerge = h => { const m = (C.get(h)?.msg || "").match(/^Merge pull request #(\d+)/m) || (C.get(h)?.msg || "").match(/\(#(\d+)\)\s*$/m); return m ? +m[1] : null; };
  const label = h => { const n = prOfMerge(h); return n ? `#${n}` : h.slice(0, 9); };

  // --- optional: merged PRs from GitHub (read-only) ---
  const ghPrs = new Map();
  if (K.issue?.repo) for (const b of bets) {
    try { const js = JSON.parse(execFileSync("gh", ["pr", "list", "-R", K.issue.repo, "--state", "merged", "--search", b.id, "--limit", "30", "--json", "number,title,body,headRefName,mergeCommit,mergedAt"], { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "ignore"] }));
      ghPrs.set(b.id, js.filter(p => idRe(b.id).test(`${p.title}\n${p.body}\n${p.headRefName}`))); } catch {}
  }

  const out = [];
  // possible-follow-up ("same files, no reference") is finished in a second pass (below), once every bet's
  // OWN landing commit is known — internal request 94: a commit that itself lands ANOTHER bet must never be
  // flagged as this bet's follow-up just because both bets happened to land the same day and share a file.
  const pendingFollowUps = []; // { r, in14, workFiles, patchSet }
  for (const b of bets) {
    const re = idRe(b.id), placedT = Date.parse(b.placed), estDays = sizeDays[b.estimate] ?? 3;
    const r = { id: b.id, bet: b.bet, estimate: b.estimate, basis: b.basis, status: b.status === "dropped" ? "dropped" : "open", placed: b.placed, landed: null, days: null, actual: null,
      revertedBy: null, patchedBy: [], possibleFollowUps: [], origin: b.origin, openTooLong: false, expected: b.expected, expectedChecked: false,
      restsOn: b.restsOn || null, landedVia: null, calendarDays: null, held14: false };
    // Explicit links: commit/merge messages carrying the id, GitHub PRs carrying it, merges of the bet's listed PRs.
    const hits = [...C.values()].filter(c => re.test(c.msg));
    const prMerged = new Map();
    for (const p of ghPrs.get(b.id) || []) if (p.mergeCommit?.oid && C.has(p.mergeCommit.oid)) { hits.push(C.get(p.mergeCommit.oid)); prMerged.set(p.number, p.mergeCommit.oid); }
    for (const n of b.prs || []) { const m = FP.find(h => prOfMerge(h) === n); if (m) { prMerged.set(n, m); if (!hits.includes(C.get(m))) hits.push(C.get(m)); } }
    const landings = [...new Set(hits.map(c => landingOf(c.h)).filter(Boolean))].map(h => C.get(h)).filter(Boolean).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (r.status !== "dropped" && landings.length) {
      const L = landings[0];
      r.landed = ymd(L.date); r.status = "landed";
      r.landedVia = [...prMerged.values()].includes(L.h) || ghPrs.get(b.id)?.some(p => p.mergeCommit?.oid === L.h) ? "pr" : L.parents.length > 1 && re.test(L.msg) ? "merge-branch" : "commit";
      // The bet's work: what the first landing brought in, plus merges of the bet's own listed PRs (a multi-PR bet).
      // A later commit that carries the id is a patch, not more work.
      const workLandings = landings.filter(l => l === L || [...prMerged.values()].includes(l.h));
      const work = new Set(); for (const l of workLandings) for (const h of broughtIn(l.h)) work.add(h);
      for (const c of hits) if (workLandings.some(l => l.h === landingOf(c.h))) work.add(c.h);
      const workC = [...work].map(h => C.get(h)).filter(Boolean), nonMerge = workC.filter(c => c.parents.length < 2);
      r.days = new Set((nonMerge.length ? nonMerge : workC).map(c => String(c.adate).slice(0, 10))).size || 1; // the day the author wrote it, in the author's own offset: two commits an hour apart are one day, not two
      r.actual = r.days <= sizeDays.S ? "S" : r.days <= sizeDays.M ? "M" : "L";
      r.calendarDays = Math.round((Date.parse(L.date) - placedT) / DAY);
      const betPrs = new Set([...prMerged.keys(), ...landings.map(l => prOfMerge(l.h)).filter(Boolean), ...(ghPrs.get(b.id) || []).map(p => p.number)]);
      const landT = Date.parse(L.date), window = [...C.values()].filter(c => !work.has(c.h) && Date.parse(c.date) > landT);
      const revertRe = /This reverts commit ([0-9a-f]{7,40})/g;
      const rev = window.find(c => [...c.msg.matchAll(revertRe)].some(m => [...work].some(h => h.startsWith(m[1]))) || (/^Revert\b/im.test(c.msg) && re.test(c.msg)));
      if (rev) { r.status = "reverted"; r.revertedBy = label(landingOf(rev.h) || rev.h); }
      const in14 = window.filter(c => Date.parse(c.date) <= landT + 14 * DAY && c !== rev && !(rev && broughtIn(landingOf(rev.h) || rev.h).includes(c.h)));
      const refsPr = c => [...betPrs].some(n => new RegExp(`(?<![\\w/])#${n}(?!\\d)`).test(c.msg) && prOfMerge(c.h) !== n);
      const patches = in14.filter(c => re.test(c.msg) || refsPr(c));
      r.patchedBy = [...new Set(patches.map(c => label(landingOf(c.h) || c.h)))];
      const workFiles = new Set(nonMerge.flatMap(c => filesOf(c.h)).filter(f => !ignoreExt.has(extOf(f)))), patchSet = new Set(patches.map(c => c.h));
      // possibleFollowUps itself is filled in after the loop (pass 2), once every bet's landing hash is known.
      pendingFollowUps.push({ r, in14, workFiles, patchSet, landingHash: L.h });
      r.held14 = r.status === "landed" && now >= landT + 14 * DAY;
      if (b.prs?.length && b.prs.some(n => !prMerged.has(n)) && r.status === "landed") r.status = "partial";
    } else if (r.status === "open") {
      r.openTooLong = Number.isFinite(placedT) && (now - placedT) / DAY > 2 * estDays;
    }
    out.push(r);
  }

  // Pass 2: finish possibleFollowUps now that every bet's OWN landing commit is
  // known. Scope: only commits after THIS bet's own landing, that touch a file THIS bet's own landing
  // commits/PRs touched, within 14 days of THIS bet's landing (all three already true of `in14`/`workFiles`
  // above) — AND excluding any commit that is itself the landing commit of ANOTHER bet (same-day bets used
  // to share this list wholesale because a same-day landing of bet X, touching a file bet Y's landing also
  // touched, was flagged as bet Y's "possible follow-up" even though it's just bet X landing, not follow-up
  // work on bet Y). The bet's own merge/landing commit is already excluded via `work`/`window` above.
  const allLandingHashes = new Set(pendingFollowUps.map(p => p.landingHash));
  for (const { r, in14, workFiles, patchSet, landingHash } of pendingFollowUps) {
    const otherLandings = new Set([...allLandingHashes].filter(h => h !== landingHash));
    r.possibleFollowUps = [...new Set(in14.filter(c => c.parents.length < 2 && !patchSet.has(c.h) && !otherLandings.has(c.h) && filesOf(c.h).some(f => workFiles.has(f))).map(c => label(landingOf(c.h) || c.h)))].filter(x => !r.patchedBy.includes(x)).slice(0, 5);
  }

  // --- calibration: only with at least minN settled, non-backfill bets ---
  const settled = out.filter(r => (r.status === "landed" || r.status === "reverted" || r.status === "partial") && r.actual && r.estimate && (includeBackfill || r.origin !== "backfill"));
  let calibration = null;
  if (settled.length >= minN) {
    const ix = s => SIZES.indexOf(s);
    calibration = { n: settled.length, onTarget: settled.filter(r => r.actual === r.estimate).length, under: settled.filter(r => ix(r.actual) > ix(r.estimate)).length, over: settled.filter(r => ix(r.actual) < ix(r.estimate)).length };
  }
  return { ...base, bets: out, calibration, settled: settled.length };
}

export function scoreSection(r) {
  if (r.status === "dropped") return "Dropped; not scored.";
  if (!r.landed) return `Not landed yet${r.openTooLong ? ` · **open too long** (more than 2× the ${r.estimate} estimate)` : ""}. Nothing on the integration branch carries \`${r.id}\`.\n- Expected outcome: not checked (no usage source).`;
  const lines = [`- Landed ${r.landed} (via ${r.landedVia === "pr" ? "a PR carrying the id" : r.landedVia === "merge-branch" ? "a merged branch named with the id" : "a commit carrying the id"}), ${r.calendarDays} calendar days after it was placed.`,
    `- Size: estimated ${r.estimate}, actual ${r.actual} (${r.days} active day${r.days === 1 ? "" : "s"}).`,
    r.status === "reverted" ? `- **Reverted** by ${r.revertedBy}.` : r.held14 ? "- Held 14 days: not reverted." : "- Less than 14 days since landing: revert/patch window still open.",
    r.status === "partial" ? "- **Partial:** not all of the bet's listed PRs merged." : null,
    r.patchedBy.length ? `- Patched within 14 days by ${r.patchedBy.join(", ")}.` : null,
    r.possibleFollowUps.length ? `- Possible follow-up, check (same files, no reference): ${r.possibleFollowUps.join(", ")}.` : null,
    "- Expected outcome: not checked (no usage source)."];
  return lines.filter(Boolean).join("\n");
}

function formatMd(R) {
  if (!R.bets.length) return `# Score\n\nNo bets yet. Place one: \`nosy bet place "<what>" --why "…" --estimate S|M|L\`.\n`;
  const by = s => R.bets.filter(r => r.status === s && r.origin !== "backfill");
  let o = `# Score · ${R.generated.slice(0, 10)} · integration branch ${R.integration} (${R.integrationReason})\n\n`;
  o += `${R.bets.length} bet(s): ${["open", "landed", "partial", "reverted", "dropped"].map(s => `${by(s).length} ${s}`).join(" · ")}${R.bets.some(r => r.origin === "backfill") ? ` · ${R.bets.filter(r => r.origin === "backfill").length} backfill (not shown in tables)` : ""}\n\n`;
  o += `| Bet | Estimate → actual | Placed | Landed | Status | Notes |\n|---|---|---|---|---|---|\n`;
  for (const r of R.bets.filter(r => r.origin !== "backfill")) {
    const notes = [r.openTooLong ? "open too long" : "", r.revertedBy ? `reverted by ${r.revertedBy}` : "", r.patchedBy.length ? `patched by ${r.patchedBy.join(", ")}` : "", r.possibleFollowUps.length ? `check ${r.possibleFollowUps.join(", ")}` : "", !r.restsOn ? "rests on nothing ⚠" : ""].filter(Boolean).join(" · ");
    o += `| ${r.id} — ${r.bet.replace(/\|/g, "/").slice(0, 50)} | ${r.estimate} → ${r.actual || "—"} | ${r.placed} | ${r.landed || "—"} | ${r.status} | ${notes || "—"} |\n`;
  }
  o += R.calibration ? `\n**Estimates:** ${R.calibration.onTarget} of ${R.calibration.n} on target, ${R.calibration.under} under-estimated, ${R.calibration.over} over-estimated.\n`
    : `\n**Estimates:** too few to say (${R.settled} settled, calibration needs ${R.minN}).\n`;
  o += `\nExpected outcomes are recorded, not scored: not checked (no usage source).\n`;
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), take = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : null; };
  const jsonOut = take("--json"), nowArg = take("--now"), incB = argv.includes("--include-backfill");
  const pm = argv.filter(a => !a.startsWith("--"))[0] || "pm";
  const R = calculate(pm, { now: nowArg ? Date.parse(nowArg) : Date.now(), includeBackfill: incB });
  // Write back: each bet's Status and Score section, the index, and state/score.json for tea (N4).
  const byId = new Map(R.bets.map(r => [r.id, r]));
  for (const b of betsLoad(pm)) { const r = byId.get(b.id); if (!r) continue; if (b.status !== "dropped") b.status = r.status; b.score = scoreSection(r); betSave(pm, b); }
  if (R.bets.length) indexWrite(pm);
  const J = jsonOut || path.join(pm, "state", "score.json"); fs.mkdirSync(path.dirname(J), { recursive: true }); fs.writeFileSync(J, JSON.stringify(R, null, 1));
  process.stdout.write(formatMd(R));
  // Exit contract (docs/CLI-CONTRACT.md): 2 when a bet needs a look (reverted, or open past twice its estimate).
  if (R.bets.some(b => b.origin !== "backfill" && (b.status === "reverted" || b.openTooLong))) process.exitCode = 2;
}
