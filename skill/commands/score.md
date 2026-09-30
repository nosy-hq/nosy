# score

Goal: settle every bet from the git shipped record, using explicit links only. The weekly `stakeout` runs it. N3.

1. `node <skill>/tools/score.mjs pm` (or `nosy score`). It reads `pm/bets/*.md` and the integration branch (detected: `integration-branch.mjs`; works on a local repo with no remote) and writes each bet's **Status** and a **## Score** section, `pm/bets/bets.json`, and `pm/state/score.json` (read by `tea`, N4).
2. What it decides, from explicit links only (the bet id in a commit message, a merge message / branch name, a PR title/body/branch via `gh` when `sources.json` `issue.repo` is set, or one of the bet's listed PRs):
   - **landed**: the first merge into the integration branch carrying the id; **size actual** from active days (S/M/L by `thresholds` `sizeDays`) against the estimate.
   - **reverted**: a `git revert` of the bet's work after it landed.
   - **patched**: within 14 days of landing, a commit or PR that references the bet id or the bet's PR number.
   - **possible follow-up, check**: within 14 days, a commit touching the same files with no reference. Never a status.
   - **partial**: only some of the bet's listed PRs merged. **open too long**: not landed after more than 2× the estimate (a flag, not a failure).
   - **expected outcome**: recorded, not scored ("not checked (no usage source)").
3. Calibration (estimate vs actual: on target / under / over) appears only with at least `minN` settled bets (`thresholds` `minN`); below that say "too few to say". Backfill bets stay out unless `--include-backfill`.
4. Tell the owner in 3–5 lines: what landed this week and how the estimate held, anything reverted or patched, what's open too long, and any bet that rests on nothing. Don't grade the expected outcome; ask whether they want to check it by hand.
5. A bet with no link in git isn't "not done": it may be unlinked. Ask before calling it missing, and remind the agent/team to write `Bet: <id>` in commits and PR bodies.
