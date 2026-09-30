# Changelog

Versions match `package.json` and `.claude-plugin/plugin.json`. Dates are when the version was committed. Versions before 0.10.0 were pre-release and aren't listed.

## 0.17.0 (2026-09-30)
- New `nosy todo`: a list of what only a person can do, or said they would (an account, a payment, a submission under their name, a token, a sign-off). `add "<what>" --who <name> --why "…" --blocks "…"`, `list`, `done <id>`, `drop <id> --reason "…"`, `show <id>`. One file per item under `pm/todo/`, so a teammate's new item never conflicts with yours and every agent sees the same list. No due dates, no estimates.
- The skill tells your agent to file such a step instead of leaving it in the chat, to keep going with the rest, and never to do a listed item itself or close one on a guess. The `nosy_todo` MCP tool does the same for Cursor, Claude Desktop and other clients.
- The first line of every session says what still waits on a person (the session-start hook; off with the same switch as the opening summary). The page's first screen shows a "Waiting on people" tile and list.
- `nosy publish` carries only how many things wait on people and for how long, never a title or a name. `docs/DATA.md` lists the new files.

## 0.16.0 (2026-09-30)
- New `nosy rival-demand`: what the users of your open-source rivals ask for most. It reads the public issues and Discussions of the rival repos you name (`--repos`, `rivalRepos` in `sources.json`, or the GitHub links in `pm/rivals/*.md`) and lists titles, vote counts and links. Never bodies, never people.
- It links an ask to a row of your matrix by words, lists asks that look alike at several rivals, and lists acronyms (MCP, SSO) that come up at several. These are hints made of words: open an ask before you quote it. An open ask is not proof a rival lacks the feature.
- It leaves out bug reports, release notes, announcements and thank-you threads, and says how many. Discussion categories are shown next to each ask.
- `nosy publish` includes `pm/state/rival-demand.json` only if you ran the command: titles and links of your rivals' public issues, nothing of yours. `docs/DATA.md` lists the new GitHub reads.
- Tuned on three public runs (Chatwoot, Relaticle, Parchi): opposite wishes and bug reports no longer merge into one ask, plural forms match, and a matrix row that lists alternatives ("WhatsApp, Telegram, Line and SMS channels") matches on one of them.

## 0.15.1 (2026-09-30)
- The reference check reads the agent's last answer from the hook input; it no longer opens the transcript file.
- Without that input (an older Claude Code) the hook does nothing. It never falls back to the transcript.
- Docs (`DATA.md`, `SECURITY.md`, `INSTALL.md`) say so, and a test proves no transcript path is opened.

## 0.15.0 (2026-09-30)
- Install check: `nosy --version` prints the version. `/nosy:nosy` (`/nosy` in a skill-only install) and the first session after an install say which version is loaded, how many commands it brought, which hooks are on, and whether the folder has a `pm/`. `nosy doctor --check` checks the install itself (Node, git, gh, skill files, hooks, `pm/sources.json`) and prints a fix for each problem. Plain `nosy doctor` still fixes a `pm/` from an older Nosy.
- Clearer errors: git or gh missing, gh signed out, no network, a folder that isn't a repo, a JSON typo. Each ends in one line with the command that fixes it.
- Generated pages (`pm/page.html`, the scoreboard) escape all data and make no external requests.
- `nosy publish` is opt-in and sends counts only: no commit subjects, author names, PR or issue titles, or quotes. Nothing is sent without a target you configured and a confirmation; `--dry-run` lists what would go.
- Personal data (e-mail, phone, IBAN, card and ID numbers, names Nosy knows) now blocks `publish` and `notify` unless you pass `--allow-sensitive`. Masking covers international phone numbers and IBANs.
- Fixes from real runs on public repos: `canwe` never contradicts its own evidence lines; the inventory reads Next.js and Django routes; `setup` picks frontend folders and the integration branch; `psst` skips component stories and shows requests that already have an open PR; demand counts name their window and say "related issues".
- One-command install and the docs now name the same hosts (Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode, Kiro; other agents by copying the skill folder). The Action's messages point at the right repo.
- New docs: `docs/DATA.md` (what Nosy reads, writes and sends), `docs/EVALS.md` (how it was tested, including where it lost), `docs/EXAMPLE.md` (a real run on a public repo), `SECURITY.md`, `CONTRIBUTING.md`, issue and pull request templates.
- Node 18.17 or newer is the stated minimum everywhere, matching `package.json`. CI runs the tests on Node 18.17, 20 and 22.

## 0.14.4 (2026-09-29)
- The reference check no longer raises false alarms.

## 0.14.3 (2026-09-29)
- The reference check also covers answers written from the shell.

## 0.14.2 (2026-09-29)
- The reference check hook finds `pm/` above the written file.

## 0.14.1 (2026-09-29)
- Polish on the first-run path.

## 0.14.0 (2026-09-29)
- The first-run journey works end to end.

## 0.13.0 (2026-09-28)
- `find-sources` proposes the landing page.

## 0.12.0 (2026-09-28)
- AI note, artifact folder step, research tool setting, rival language check, code-first `canwe`.

## 0.11.1 (2026-09-28)
- Measurement lines on shipped decisions.

## 0.11.0 (2026-09-28)
- The shipped record, recency, `bet` and `score`, local branches, decision-log mode, project skill symlink.

## 0.10.0 (2026-09-28)
- Everything is English: files, folders, script names, keys, flags and docs. Old names are mapped in `docs/RENAMES.md`; `/nosy:doctor` migrates an older `pm/` folder.
