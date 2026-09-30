# CLI contract: exit codes

Every Nosy script and `nosy <command>` exits with one of three codes, so CI, git hooks and other tools can act on the result without reading the text.

| Code | Means | Example |
|---|---|---|
| **0** | It ran, and nothing needs attention. | `nosy doctor` on an up-to-date `pm/`; `nosy never-check` with no rule matched |
| **2** | It ran, and found something that needs a look. | a never rule matched; a bet was reverted or is overdue; a secret or personal data in something about to be sent |
| **1** | It couldn't run. | a usage error, no `pm/sources.json`, a git or `gh` failure |

A 2 is a result, not a failure: the output says what was found. Callers that must never let a finding through (`publish`, `notify`) treat **any** non-zero code from the privacy scan as "stop", so a scan that couldn't run can't wave a file through.

## Commands that return 2

| Command / script | Returns 2 when |
|---|---|
| `nosy doctor` (`doctor.mjs`) | a `pm/` from an older Nosy still has something to fix |
| `nosy doctor --check` (`health.mjs`) | a hard failure in the install itself (✗): Node older than 18.17, git missing, a skill file missing or unreadable. Warnings (`!`) and notes (`–`) don't count; every line that isn't fine carries its fix. Local only: no network, writes nothing |
| `nosy never-check` (`never-check.mjs`) | an added line or the command matches a `preread.never` rule |
| `nosy sweep` (`rival-sweep.mjs`) | a registry page couldn't be read (login, 404, no text, no dates); the list still prints |
| `nosy find` (`facts.mjs find`) | the word appears nowhere: no tracked file, no issue or PR |
| `nosy fields` (`fields.mjs`) | a type named isn't defined at the ref (Go structs, TypeScript interfaces/object types) |
| `nosy cite-check` (`cite-check.mjs`) | a `file:line`, quote, commit or `#N` in the answer doesn't hold up |
| `nosy score` (`score.mjs`) | a bet was reverted, or is open past twice its estimate (backfill bets don't count) |
| `nosy weekly` | any step returned 2 (and none returned 1); each step is marked ✓ clean, ! look, ✗ couldn't run |
| `privacy-scan.mjs` | a secret or personal data: do not send (`publish` and `notify` go on only with `--allow-sensitive`) |
| `freshness.mjs --strict` | an input is stale (✗) |
| `audit-package.mjs` | a ✗ row (a broken path, a command missing its files) |
| `audit-prd.mjs --strict` | a blocker finding |
| `ai-note.mjs` | a name the AI invented (not in the design system) |
| `collect-signals.mjs` | an export's message column couldn't be confidently determined by shape or header — never a silent 0-signal pass |
| `explain.mjs <id>` | — (an unknown id is a usage error: 1) |

Everything else is a report (`shipped`, `peek`, `psst`, `canwe`, `page`, …): 0 when it ran, 1 when it couldn't. Its findings are in the output, for the agent and you to judge.

## In CI

The GitHub Action (`action.yml`) runs `nosy weekly` and never fails the job on its own: a 2 becomes a notice, a 1 a warning.

To make a check gate a workflow, run it directly. In a CI shell any non-zero code fails the step, so `node skill/tools/never-check.mjs pm --base origin/main` fails on a finding (2) and on a broken setup (1). To fail on a finding only and let "couldn't run" pass:

```bash
node skill/tools/never-check.mjs pm --base origin/main; test $? -ne 2
```

## psst's check step and the next decision

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `nosy receipts` / `psst-receipts.mjs` | receipts written | no `sources.json` or no `lowhanging.json` | — |
| `nosy refute pack` | packet written | no draft (`pm/state/psst-draft.json`) | — |
| `nosy refute apply` | final list written (refuted items dropped is a normal result) | no draft or no verdicts file | verdicts not usable (missing, rubber-stamped, weakened without a fix): nothing written |
| `nosy team-next` | list written (an empty list is a normal result, said in `note`) | no `sources.json` | — |
| `nosy decision` / `next-decision.mjs` | a decision, or "no next product decision yet" | — | — |
| `nosy nudge` / `nudge.mjs` | printed (silent when nothing is new) | no `sources.json` | — |

