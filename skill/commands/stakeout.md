# stakeout

The weekly cycle, inside to outside: `freshness` → `shipped` (the record, `peek`'s core, + `recent`) → `psst` → `neighbors` (only the rivals `watch-rivals` saw change, plus the ones not researched in 30+ days) → `scoop` → `score` (only if `pm/bets/` exists) → `frontyard` (only when a landing page is set and the roundup is due, see `frontyard.md`) → `diff` → `tea`, then one entry in `log.md`:
- date, the commit range read, how many announcements the rival scan found, the page version
- **tool gap:** where the tool fell short this cycle (what you did by hand, what repeated, what was hard). Nothing is sent anywhere; the owner can report it upstream.

1. Start-up: `node <skill>/tools/freshness.mjs pm`. Which inputs are stale, how many commits have piled up since the last read, which commands need to re-run and in what order; if there's a ✗, follow the order it names.
2. `shipped` (see `shipped.md`: the record via `collect-status`, plus `recent`: merged since the last run and open PRs close to merging, each tied to its decision/request) → `psst` (with receipts and the refuter, `psst.md` step 3; including the owner's filter; demand is collected by default when `pm/signal/` has files or the product has an issue repo, and ranks "asked for + ready" first) → `neighbors` → `scoop` (`measure-size --bulk` and `build-waves`) → `score` if `pm/bets/` exists (`node <skill>/tools/score.mjs pm`; see `score.md`). Then `frontyard`, only when the weekly landing roundup is due (`next.mjs` says so; see `frontyard.md`).
3. What's changed since the last run:
   - `node <skill>/tools/diff.mjs pm save --label stakeout`: a snapshot of `pm/state` and the matrix goes to `pm/history/`, the run log to `pm/history/runs.jsonl`; if the content is unchanged, no new snapshot is opened.
   - `node <skill>/tools/diff.mjs pm --json pm/state/diff.json`: what's new, what got resolved, which rival shipped something we don't have, how many weeks each item has been waiting.
   - Comes in priority order; low-priority items are hidden (`--all` shows them). The first 3–5 items go into chat and onto the page.
4. `tea`: run `privacy-scan` before publishing (see `tea` step 4).
5. Once a month: `node <skill>/tools/learn.mjs pm suggest` (pattern suggestions from repeated mutes, ask the owner) and `node <skill>/tools/diff.mjs pm save --clean 26` (keeps the last 26 snapshots).

A scheduled run is set up at the owner's request (a scheduled task); don't set it up on your own. Instructions: `docs/INSTALL.md`.
