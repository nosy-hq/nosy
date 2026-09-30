# bet "<what>"

Goal: record a product bet before the work starts, so the git record can settle it later. A bet is "we'll do X because Y; it's size S/M/L; we expect Z". N3.

1. Ask the owner, in one message, only for what's missing: **why** (one line), **estimate** (S = 1–2 days, M = about a week, L = bigger), **what it rests on** (a decision or request ref: K12, §3, #40), **expected outcome** (what should change for users). The estimate is theirs: never fill it in. You may mention `measure-size`'s history as a hint ("similar work took 4 active days"), labelled as a hint.
2. Place it: `node <skill>/tools/bet.mjs pm place "<what>" --why "<why>" --estimate S|M|L --basis code|document|intent --rests-on "<ref>" --expect "<outcome>" [--check-by YYYY-MM-DD] [--pr 12,15]`. `--pr` only when the bet is known to span several PRs (then "partial" can be scored). The script writes `pm/bets/<id>.md` (the source of truth) and rebuilds `pm/bets/bets.json`.
3. Give the owner the id and the copy line: `Bet: nb-<yyMMdd>-<slug>`. It goes in the commit message or PR body, or in the branch name (`bet/<id>`). **When you (the coding agent) write the commits or PR for this work, put `Bet: <id>` in them yourself** (rules.md).
4. A bet that rests on nothing is allowed but flagged ("rests on none ⚠"): suggest recording the decision first.
5. Other actions: `bet.mjs pm list [--status open]`, `bet.mjs pm show <id>`, `bet.mjs pm drop <id> --reason "…"` (the owner decides to drop; the reason is kept).
6. Backfill (only where explicit links already exist in git): place with `--origin backfill --date <when it was decided>`. Backfill bets are scored but kept out of calibration and of the page's tables unless the owner opts in.

Design (agreed 28 Sep between the N3 and N4 sessions): one `.md` per bet with Bet / Why / Rests on / Estimate / Basis / Expected outcome / Check by / Placed / Origin / PRs / Status; id `nb-<yyMMdd>-<slug ≤3 words>`, recognised by `refs.mjs`; no text similarity, no GitHub writes.
