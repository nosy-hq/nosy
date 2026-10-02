# CLI contract: exit codes

Every Nosy script and `nosy <command>` exits with one of three codes, so CI, git hooks and other tools can act on the result without reading the text.

| Code | Means | Example |
|---|---|---|
| **0** | It ran, and nothing needs attention. | `nosy doctor` on an up-to-date `pm/`; `nosy never-check` with no rule matched |
| **2** | It ran, and found something that needs a look. | a never rule matched; a bet was reverted or is overdue; a secret or personal data in something about to be sent |
| **1** | It couldn't run. | a usage error, no `pm/sources.json`, a git or `gh` failure |

A 2 is a result, not a failure: the output says what was found. `publish` and `notify` treat **any** non-zero code from the privacy scan as "stop", so a scan that couldn't run can't wave a file through.

## Which commands run from the terminal

Most of the 18 agent commands have a terminal twin that runs with no model: `npx github:nosy-hq/nosy <terminal command>` (or `nosy <terminal command>` once installed). The terminal part is the counting; the agent adds the judgment. Five have no twin and need the agent.

| Command (in your agent) | Terminal command |
|---|---|
| `doctor` | `nosy doctor` (`--check` for the install) |
| `peek` | `nosy peek` |
| `shipped` | `nosy shipped` |
| `psst` | `nosy psst` |
| `canwe` | `nosy canwe "<question>"` |
| `frontyard` | `nosy frontyard` |
| `bet` | `nosy bet place "<what>" --why "…" --estimate S` |
| `score` | `nosy score` |
| `move-in` | `nosy setup` (proposes `pm/sources.json`; the rest of move-in is the agent) |
| `tour` | `nosy tour` (the plan: what Nosy reads, writes and sends, the steps with their state, one list of questions. It runs no step itself; the agent does. `nosy tour approve <id>…`, `nosy tour skip <id>…` and `nosy tour done <id>` record progress in `pm/state/tour.json`) |
| `neighbors` | `nosy watch` (which rivals' public pages changed; the research is the agent). Also `nosy tiers` (which rivals get a deep pass, which are only watched, and the token estimate), `nosy matrix-proposals` (sorts the cells the neighbor agents propose by evidence, `apply` writes the ones that earned it) and `nosy rivals-import` (copies rival research kept outside `pm/rivals` in) |
| none | `nosy rival-demand` (what the users of your open-source rivals ask for most, from their public issues and Discussions; no slash command) |
| none | `nosy todo` (what only a person can do, or said they would: `add`, `list`, `done`, `drop`, `show`; the agent files items through the skill or the `nosy_todo` MCP tool; no slash command) |
| `tea` | `nosy page` (`nosy page-adopt` for a hand-built page) |
| `stakeout` | `nosy weekly` |
| `overheard` | none: agent only |
| `dresscode` | none: agent only |
| `scoop` | none: agent only |
| `spill` | none: agent only |
| `map` | none: agent only |

`nosy help` lists every terminal command, including the helpers that have no agent command of their own (`facts`, `find`, `cite-check`, `never-check`, `inventory`, `notify`, `publish`, `mcp`, …).

## Commands that return 2

| Command / script | Returns 2 when |
|---|---|
| `nosy doctor` (`doctor.mjs`) | a `pm/` from an older Nosy still has something to fix (also after `--fix`, if something is left that needs a command) |
| `nosy doctor --check` (`health.mjs`) | a hard failure in the install itself (✗): Node older than 18.17, git missing, a skill file missing or unreadable. Warnings (`!`) and notes (`–`) don't count. Local only: no network, writes nothing |
| `nosy never-check` (`never-check.mjs`) | an added line or the command matches a `preread.never` rule |
| `nosy sweep` (`rival-sweep.mjs`) | a registry page couldn't be read (login, 404, no text, no dates, a 429); the list still prints. A failed store lookup does not count |
| `nosy doctor --undo` | a file changed since the fix, so it was left alone (nothing to undo is a 1) |
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
| `collect-signals.mjs` | an export's message column couldn't be determined from its shape or header (never a silent zero-signal pass) |

## Commands that only return 0 or 1

These never return 2. Their findings are in the output; a 1 means the command stopped before it could do its job, and says why.

| Command | Returns 1 when |
|---|---|
| `nosy tour` | `approve` or `done` without an id, or on a `pm/` folder that doesn't exist. Plain `nosy tour` in a repo with no `pm/sources.json` is a 0: it says to run `move-in` |
| `nosy tiers` | there are no rival files in `pm/rivals` and no `rivals` in `sources.json` |
| `nosy matrix-proposals` | `check` and `apply` have no `pm/state/matrix-proposals.json` or no matrix; `undo` has no backup in `pm/.backup/` |
| `nosy page-adopt` | `pm/sources.json` is missing; there is no page (`--page`, else `pm/page.html`); `adopt --apply` without `--yes`; `refresh` on a page with no marked table; `undo` with no backup, or with a page changed by hand since the backup (add `--force` to restore anyway) |
| `nosy rivals-import` | the folder to copy from (`--from`, or `rivalsPath` in `sources.json`) doesn't exist. A folder with no rival files is a 0: it says so |
| `nosy publish` | no target, no token, a refused token file, a privacy finding, a refusal by Cloud, a send that arrived but whose matrix the dashboard did not draw, or (also in a dry run) a bad address or an oversize file |
| `nosy doctor --undo` | there is no backup under `pm/.backup/`, or no `pm/` folder |

Everything else is a report (`shipped`, `peek`, `psst`, `canwe`, `page`, …): 0 when it ran, 1 when it couldn't. Its findings are in the output, for the agent and you to judge.

## In CI

The GitHub Action (`action.yml`) runs `nosy weekly` and never fails the job on its own: a 2 becomes a notice, a 1 a warning.

To make a check gate a workflow, run it directly. In a CI shell any non-zero code fails the step, so `node skill/tools/never-check.mjs pm --base origin/main` fails on a finding (2) and on a broken setup (1). To fail on a finding only and let "couldn't run" pass:

```bash
node skill/tools/never-check.mjs pm --base origin/main; test $? -ne 2
```

## Around `psst`'s check step

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `nosy receipts` / `psst-receipts.mjs` | receipts written | no `sources.json` or no `lowhanging.json` | — |
| `nosy refute pack` | packet written | no draft (`pm/state/psst-draft.json`) | — |
| `nosy refute apply` | final list written (refuted items dropped is a normal result) | no draft or no verdicts file | verdicts not usable (missing, rubber-stamped, weakened without a fix): nothing written |
| `nosy team-next` | list written (an empty list is a normal result, said in `note`) | no `sources.json` | — |
| `nosy decision` / `next-decision.mjs` | a decision, or "no next product decision yet" | — | — |
| `nosy nudge` / `nudge.mjs` | printed (silent when nothing is new) | no `sources.json` | — |

