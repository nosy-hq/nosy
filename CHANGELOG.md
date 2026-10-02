# Changelog

Versions match `package.json` and `.claude-plugin/plugin.json`. Dates are when the version was committed. Versions before 0.10.0 were pre-release and aren't listed.

## 0.19.0 (2026-10-02)
- `psst` no longer lists work that is already written on your own branches. `nosy facts` already knew every unmerged branch and the files merging it would change; the receipts now join each draft item to those branches (a file in common, or the item's reference in the branch's commit subjects) and to uncommitted edits in any worktree, and say "already written on `<branch>`, local only / pushed, no PR / in PR #n". The refuter reads that block and the diff behind it. `nosy psst` refreshes the branch list when it is more than 12 hours old. Branch names, authors and subjects stay in `pm/state/receipts.json`, which is never published. On a first run, 3 of 5 draft items had been done on unpushed branches.
- `nosy doctor --fix` lists what it will change and says whose files they are (Nosy's own inside `pm/`; never your repo, product code or notes), copies what it rewrites to `pm/.backup/doctor-<stamp>/` (git-ignored by its own `.gitignore`), and ends with the undo line. New: `--fix --dry-run` (the list only) and `--undo` (a file you changed since is left alone unless `--force`).
- `nosy publish` checks the matrix before sending, with the same reader as every other command: an unknown shape stops the send; a matrix keyed in another language is sent as the English shape; your own cell codes can be mapped in `sources.json` (`"matrixCodes": { "s": "d", "f": "p" }`, read by every command that reads the matrix); a matrix that is mostly codes the dashboard doesn't know stops the send and says how to map them. After the send it prints what the dashboard says it drew (Cloud now answers with `reads`), and when it drew no matrix it says so and exits 1 instead of leaving "Published" to stand alone. A Cloud that predates this says it can't tell.
- `nosy doctor --check` also reads, as warnings and notes (never a failure): whether the matrix can be read, and how many cell codes are unknown; the page's old marker; and which optional parts exist. It finds `pm/` by walking up from the current folder.
- New `nosy tour` (`/nosy:tour`): the first look in one go, for a repo that is new to Nosy or already has a `pm/`. It says first what Nosy reads, writes and sends, plans the walk from what `pm/` already holds (✓ current, → to run), runs nothing itself, and gathers every question (the map's, the token cost of rival research, a send to Cloud) into one list, so the owner is asked once instead of once per step. `tour approve` and `tour done` record progress; a tour that stops resumes. `move-in` ends with it, and `next` suggests it for a set-up repo that has barely looked.
- Rival research costs less and proves more. `nosy tiers`: tier A (deep), B (watch only), C (reference) per rival in `sources.json`, the cost before any agent starts, only changed or stale tier-A rivals researched, a suggestion (never a block) to move more than 10 to Cloud's watch, and "promote to A?" for a watch-only rival that keeps changing. `nosy matrix-proposals check|apply|undo`: proposed matrix cells carry an evidence grade and whether the page was opened; only cells with a primary source, or two independent secondary ones, are applied; no evidence never lowers a code, it only leaves `verified_at` old; the same URL backing two rows warns; `apply` also writes the cell into the rival table and `undo` restores both. `nosy sweep` reads the App Store's public lookup for rivals with `stores.appStore` (a version's notes are never attached to another version) and stops reading a site after a 429. The rival agent's rules say: a page date is not a release date, open every page you cite, a demo-gated product's own page is at most partial.
- `measure-size` no longer fills a partial clone: it reads name-only history, says lines weren't counted, and `--force-fetch` (run `measure-size.mjs` yourself, `canwe` doesn't pass it) restores the old behaviour.
- `nosy page-adopt adopt|refresh|undo`: keeps a hand-built page current. It matches your tables to Nosy's data by their values, marks them (after a backup, with your yes), later rewrites only the marked tables, never deletes a row, and lists cells that still call a merged PR open. `auto-section --lang` (and `language` in `sources.json`) writes the block in another language (Turkish ships); the block no longer carries author names, the refuter's corrections, the dropped items or held-item detail. The block carries its generation time as an ISO stamp (`data-generated` on its wrapper), so `freshness` dates it in any language; a block written by an older Nosy has no stamp and is still dated from its English text, a Turkish one of that age says it carries no time until it is regenerated.
- Smaller fixes: a `#N` in a code comment that is an open issue is "ticketed", not "held"; `team` in `sources.json` keeps your own team's issues out of demand; `find-stale` skips code blocks and scripts; `nosy` finds `pm/` by walking up; `rivalsPath` and `find-sources` find rival research kept outside `pm/rivals`, and `nosy rivals-import` copies it into `pm/rivals` (the originals stay) so every command works on it; the Cloud key can live in `~/.config/nosy/token` instead of a command line; `status.json` says what its PR number counts (`openPrs`, `prCommits`); `publish` sends the checked psst list and leaves out items parked on purpose; a row marked `declined` shows as "Decided against", not Missing; the map template has "Versions in flight".
- Privacy sweep of `publish`: a planted-marker test now checks every file Nosy could send. Found and fixed: a customer name in a signal change, the refuter's fix text (with branch names) in the first screen's decision, the dropped list in the "Not doing" lane, issue and commit text in the checked list, private keys in the run history, text before the summary's first heading. The scan also knows your local branch authors and branch names. `publish` refuses plain `http://` to another host, never follows a redirect, and names a file that is too large. A dry run says where the token would come from, never its value.
- `collect-status` no longer turns every PR into "could not read" when one PR's author was deleted.
- Review pass over the new tools: `nosy tour skip` and a tour that expires after 2 days; a failed `doctor --fix` can still be undone; `rival-tiers plan` is read-only; a stale proposal is held, not applied over a changed matrix; `rivals-import` never overwrites (even on a case-insensitive disk) and keeps file times; accented file names and a remote not called `origin` are read correctly; `nosy check` validates the new `sources.json` keys; `lowhanging` leaves out your team's issues too; `doctor` and `next` say "can't be read" for an invalid `sources.json`, not "missing".

## 0.18.0 (2026-10-01)
- Told when a newer Nosy is out. A plugin installed from GitHub is not updated for you, so people stayed on the version they installed. The session-start hook now asks GitHub, at most once a day, for the public file `.claude-plugin/plugin.json` and says one line, at most once a day, when yours is older, with the two commands that update it. The request is a plain GET with nothing of yours in it; offline or blocked, it is silent. Agents without hooks (Codex, Cursor, Gemini CLI, …) get the same line from the top-level skill: `/nosy` with no command says it under the "Nosy X is loaded" lines whenever the copy is behind (`npx github:nosy-hq/nosy update` updates it). Off: `NOSY_NO_UPDATE_CHECK=1` or the plugin option "Turn off the update notice". It is the first hook that reaches the network without something you ran or configured besides the reference check's `gh` lookups, so `docs/DATA.md`, `SECURITY.md` and the README say so.
- New `nosy git-hooks install`: the after-commit nudge and the never-rule check as plain git hooks (`post-commit`, `post-merge`), for Codex, Cursor, Gemini CLI, Copilot, OpenCode and Kiro, which have no hooks of their own (only Claude Code's plugin did). Their output comes back in the result of `git commit` and `git pull`, whichever agent runs it. It keeps a hook you already have, refuses one that isn't a shell script, never fails a commit, sends nothing, and only speaks where `pm/sources.json` exists. `status` and `uninstall` (removes only our block) too. `nosy install --git-hooks` does it in the same step (never implied: the install alone touches no hook), calling the skill copy it just wrote; `nosy uninstall` removes those blocks again.
- Messages that gave Claude-only advice to every agent now name the agent-neutral way as well: the "Hooks: none" line of `/nosy`, `doctor --check`, the `nosy install` footer for non-Claude agents, and the token hint of `nosy publish` ("Connect your agent", as Nosy Cloud calls it).
- `docs/INSTALL.md` has an Update section for the plugin (marketplace update, plugin update, a new session; folder installs; auto-update; skill copies with `nosy update`). A plugin installed before this version can't show the notice: update it once by hand.

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
