# What Nosy reads, writes and sends

> Nosy about your product. Never your data.

That line needs a list you can check. This is the list.

It was checked against version 0.15.1 (30 Sep 2026): every script, hook, agent, command file and the GitHub Action read, and the scripts run with their network, process and file activity logged. Version 0.17.0 adds `nosy todo` (files under `pm/todo/`, local only, no network, nothing in the `publish` payload but a count), and version 0.16.0 added `rival-demand`, read and logged the same way: it starts `gh` and nothing else. What changed after that is listed under "New in 0.19.0", read from the code, not yet logged the same way. If Nosy does something that isn't written here, that is a bug in this file or in Nosy. Please report it.

## The short version

- **No telemetry.** No analytics, usage pings, crash reports or install IDs. The one call you didn't start yourself is a once-a-day read of a public version file so the plugin can say when a newer Nosy is out (one plain GET, nothing about you in it, `NOSY_NO_UPDATE_CHECK=1` turns it off; see the network table below). Nosy has no dependencies (`package.json` lists none), so no third-party code runs inside it either.
- **Reads.** Nosy reads your code, git history, GitHub issues and PRs including their text (titles, bodies, comments and author logins, through your own `gh`), your decision and roadmap docs, and public web pages. Bodies and comments are cut at 4,000 characters and saved in `pm/state/facts/github.json`. Support and interview exports are read only if you drop them into `pm/signal/`, with personal data masked.
- **Writes.** Nosy writes to your `pm/` folder, plus a few named files: temporary files, a first-run marker, the skill folders `nosy install` copies, a hand-built page of yours when you run `nosy page-adopt` (after a copy in `pm/.backup/`), a branch and pull request in your own repo when you run `nosy roadmap --pr --yes`, one fixed comment on each issue your merged PRs closed when you run `nosy ship-notes --yes`, an issue (or the changes to one you already have: an assignee, a label) and its project card in your own repo when you run `nosy handoff --yes`, a project board and its fields when you run `nosy handoff --setup-board --yes`, a status update on your GitHub project board when you run `nosy board-status --yes`, and files you name with a flag. The optional weekly GitHub Action commits and pushes `pm/state/` and the decision page only if you set `commit: "true"`. The full list is under "What Nosy writes".
- **Sends.** Nothing of yours leaves on its own. Nosy's network calls are reads: the public rival pages you listed (and, for rivals you configure, public counters through `nosy rival-signals`: GitHub, npm, Apple's app lookup and job-board APIs), and GitHub through your own `gh`, including a read-only lookup of the `#N` issues your agent's answer cites (`NOSY_CITE_GH=0` turns that off), and, when you run `nosy rival-demand`, the public issues and Discussions of the open-source rivals you name. `nosy notify` and `nosy publish` send something only when you run them, and `publish` is off until you configure a target and confirm (counts and structure, never quotes). `publish` and `notify` stop on a secret or personal data unless you pass `--allow-sensitive`. Every path is in the table under "What leaves your machine".
- **Nosy reads your code through git.** It reads committed files, not your disk. Files git doesn't track, such as an ignored `.env`, are not opened.
- **The model call is your agent's.** Whatever Nosy prints to your agent, your agent's model sees.

## What Nosy reads

| Source | What Nosy reads | Notes |
|---|---|---|
| Your code | Committed files at the branch named in `pm/sources.json` (`ref`), with `git grep`, `git ls-tree` and `git show`: routes, screens, plan gates, event names. Matching lines are printed with `file:line`. | Untracked and ignored files are not read. Every committed file is readable, but a printed line is redacted: in a file that looks like it holds secrets (`.env*`, `*.env`, `*.pem`, `*.key`, `id_rsa`, `credentials*`, `secrets.*`, `.npmrc`, `*.tfvars`…) the value after `=` or `:` is hidden and any other line is hidden whole; in any other file the values the secret detector recognises are hidden. The `file:line` stays. See "Limits". |
| Git history | Commit subjects, author display names and dates, branches, merges, `blame`, and `git status` of your checkout and its other worktrees (file names only: `psst` uses it to see whether an item is already being written). | Author emails are read only to spot bots. They are not written out. The contents of a file git doesn't track are not opened. |
| Issues and PRs | Through your `gh`, if you have it and `pm/sources.json` names a repo (`issue.repo`): titles, bodies, comments, author logins, labels, changed-file lists, CI status. | `nosy facts` saves them to `pm/state/facts/github.json` (bodies and comments cut at 4,000 characters). Without `gh`, the tools say so and carry on. |
| Your own documents | Decision log, roadmap or request document, README, `package.json`, design-system files, and any path you put in `pm/sources.json`. | A path in `sources.json` can be outside the repo. The reference check also lists file names (three levels deep) under every absolute path in `sources.json`. |
| Public web pages | Scripts: the rival pages you list in `pm/rivals/*.md` (`## Sources`) or in `sources.json` (`rivals`, `watch`), plus same-origin script files of pages that need JavaScript. Your agent: rival research (`neighbors`, `move-in`) and your landing page (`frontyard`), through its own web tools. | Public pages only, plain GET, no login. |
| Files you drop in | Support, survey and interview exports in `pm/signal/` (or the folder `signal.path` names): csv, json, jsonl, md, txt. | See "Masking" below. Nosy never rewrites or copies a raw export. |
| Your agent session (hooks) | The last answer your agent gave (Claude Code hands it to the hook as a hook input field; the hook opens no transcript or chat history file) and markdown or text files the agent just wrote, only when they contain a `file:line`, `#N` or commit hash to check. | Only in a repo that has `pm/sources.json`. Nothing is stored. |
| Your Cloud token | Only in a real `nosy publish` (never in `--dry-run`): the environment variable `NOSY_CLOUD_TOKEN`, else the file named by `--token-file` or `NOSY_CLOUD_TOKEN_FILE`, else `~/.config/nosy/token` (`$XDG_CONFIG_HOME/nosy/token` when that is set). | A file that other users can read is refused, and nothing is sent. The token is sent to the address you configured, as the `Authorization` header, and never printed or written anywhere. |
| Your Nosy install | `nosy doctor --check` reads `~/.claude/plugins/installed_plugins.json`, the `enabledPlugins` key of `~/.claude/settings.json`, the skill folders (`.claude/skills/nosy`, `.agents/skills/nosy`, here and in your home folder), and runs `git --version` and `gh --version`. | Only when you run it. |

Environment variables read: `NOSY_*` and `CLAUDE_PLUGIN_*` settings, `HOME` (to expand `~` in a path), `XDG_CONFIG_HOME` (to find the Cloud token file) and, for `nosy rival-demand` without `gh`, `GH_TOKEN` or `GITHUB_TOKEN`. Nothing else. `gh` reads its own sign-in; Nosy never touches that token.

### Masking

Customer quotes are masked before Nosy prints or writes them (`skill/tools/mask.mjs`, detectors in `skill/tools/pii.mjs`):

- e-mail addresses;
- phone numbers: Turkish mobile and landline, international numbers that start with `+` or `00` (E.164, written with spaces, dots, dashes or brackets), US and Canadian numbers (with separators or brackets), UK numbers (`07…`, and area-code numbers with separators);
- IBANs of any country (the country's registered length and the mod-97 check), and Turkish-shaped IBANs even when the check digits are wrong;
- payment card numbers (13 to 19 digits that pass the Luhn check);
- Turkish national ID numbers (checksummed);
- `key=`, `token=`, `password=` values.

**Not masked:** names (a name in free text can't be found by pattern), postal addresses, other kinds of ID, and phone numbers written without a country prefix or separators outside Turkey, the US and the UK. Ordinary numbers (order numbers, prices, dates, versions) are left alone. The raw export stays untouched in `pm/signal/`. Raw responses your agent saves there from a support connector are unmasked too.

## What Nosy writes

Under `pm/` (your product folder):

| Path | What |
|---|---|
| `pm/.backup/` | The copy Nosy takes before it rewrites a file of its own (inside `pm/`, or your page for `page-adopt`). `doctor-<stamp>/` holds `sources.json` as it was, plus a `manifest.json` that lists each old name Nosy renamed (`nosy doctor --undo` moves them back). `matrix-<stamp>.json`, its `.meta.json` and a `matrix-<stamp>-rivals/` folder come from `nosy matrix-proposals apply`. `page-<stamp>.html` and `page-<stamp>.json` come from `nosy page-adopt`; its `undo` also keeps the page as it was a moment before as `undone-<stamp>.html`. The folder has its own `.gitignore` (`*`), so it never shows in `git status` or a commit. Only the matching `--undo` reads it. |
| `pm/sources.json`, `pm/matrix.json` | Setup. `setup --onTop` keeps a `.backup` copy before it overwrites an existing file; `learn suggest --apply` keeps a `.yedek` copy. |
| `pm/state/` | Every counting command's output (`status.json`, `lowhanging.json`, `signals.json`, `facts.md`, `facts/`, `shipped.json`, `receipts.*` (these name your own unpushed branches, their authors and where a draft item is already written: local only, never published), `tour.json`, `rival-tiers.json`, `matrix-proposals.*`, `canwe-last.md`, and so on). |
| `pm/history/` | Run history (`runs.jsonl`), diff snapshots, `watch-states.jsonl` (one line per rival watch: which rivals changed, for the tiers) and `pm/history/watch/`: text of the public rival pages, kept on your machine only. Git-ignore it if you commit `pm/`. |
| `pm/page.html`, `pm/scoreboard.html` | The decision page and the scoreboard. |
| `pm/bets/`, `pm/canwe/`, `pm/design/`, `pm/learned.json` | Bets, the "can we?" answer ledger, design-check approvals, your "noise / knowingly / important" calls. |
| `pm/todo/` | What only a person can do, or said they would (`nosy todo add`, or your agent through the skill or the `nosy_todo` MCP tool): one `.md` file per item with the words you or your agent gave (what, who, why, what waits on it, a link). Yours to edit or delete: commit the folder to share the list with your team, or git-ignore it to keep it yours. No copy of it goes into `pm/state/`, which the Action commits. Nothing in it is sent anywhere. |
| `pm/atlas/` | One report per candidate market (`templates/market.md`), written by your agent (`nosy-scout`) when you run `atlas`, plus `axes.md` (the axes you agreed). Public pages and public APIs only; each score says how well it is known and when it was read. |
| `pm/rivals/`, `pm/frontyard/`, `pm/prd/` | Written by your agent when you run `neighbors`, `frontyard`, `spill`. `nosy rivals-import` also copies rival files into `pm/rivals/` (and writes `pm/rivals/.imported`); `nosy matrix-proposals apply` edits the matching rows of a rival's table. |

Outside `pm/`:

| Where | What | When |
|---|---|---|
| OS temp folder | `nosy-nudge-<hash>.json` (the last commit id the after-commit hook saw, and what it last said). Short-lived folders `nosy-publish-*`, `nosy-news-*`, `nosy-facts-obj-*`, deleted after use. | Automatic (the hook), or while a command runs. |
| Plugin data folder (`CLAUDE_PLUGIN_DATA`, else the temp folder) | `nosy-loaded.json`: version and time of the first session, so the first-run lines show once. Local only. | Once, at the first session after install. |
| `.git/hooks/post-commit`, `.git/hooks/post-merge` (or your `core.hooksPath`) | `nosy git-hooks install` adds a marked block that prints the never-rule check and the after-commit nudge. A hook you already had is kept and the block added to it; `nosy git-hooks uninstall` removes only the block. The hook runs two local scripts and prints; it sends nothing. | Only when you run `nosy git-hooks install`. |
| Agent skill folders | `nosy install` copies `skill/` to `.claude/skills/nosy`, `.agents/skills/nosy` and similar in the project, or in your home folder with `--global`. It never touches settings or hooks, unless you pass `--git-hooks` (next row); `nosy uninstall` takes those blocks out again. | Only when you run `nosy install`. |
| Your repo's `.git` | `overheard --diff --fetch` creates `refs/nosy/pr-N`. | Only with both flags. |
| Your own page | `nosy page-adopt adopt --apply --yes` adds `<!-- pm:table … -->` comments around the tables it matched, after copying the page to `pm/.backup/`. `refresh` changes only those tables, `undo` puts the copy back. `auto-section.mjs <pm> <page>` (your agent runs it at the end of `peek` and `psst`) replaces what sits between `<!-- pm:auto -->` and `<!-- /pm:auto -->` and keeps no copy. | Only when you run them. The page is `--page`, or `pm/page.html`. |
| Files you name | `--json <file>` and `--mask <file>` write where you point them. | Only when you pass them. |
| Your branch | The GitHub Action's `commit: true` commits generated `pm/` files and pushes. | Only when you set it. |
| The plugin folder itself | `dresscode suggest --publish` adds generic patterns (never product text) to `skill/data/dresscode-exceptions.json`. A maintainer command. | Only when you run it. |

Nosy's scripts and commands never run `git commit`, `git add` or `git push` in your checkout. The exceptions, each only with an explicit flag: the Action option above, and `nosy roadmap --pr --yes`, which commits one change to `ROADMAP.md` and pushes one branch from a throwaway worktree, never from your checkout. It never runs a `gh` command that creates or changes anything, apart from `nosy roadmap --pr --yes` (opens or updates a pull request) and `nosy ship-notes --yes` (posts one fixed comment on an issue a merged PR closed).

## What leaves your machine

By the plugin's own code:

| Feature | Goes to | What is sent | When |
|---|---|---|---|
| `nosy watch`, `nosy sweep`, and `nosy weekly` (which includes watch when `pm/rivals/` exists) | The public rival URLs you listed | A plain GET with a `Nosy … (public pages only)` user agent. No cookies, no body, nothing from your repo. The site sees your IP address. | When you run them. `NOSY_OFFLINE=1` skips the watch step of `weekly`. |
| GitHub reads | GitHub, through your `gh` | Read-only calls: `pr list`, `pr view`, `pr diff`, `issue list`, `repo view`, `auth status`, `api` reads and GraphQL queries. What goes out is the repo name, PR and issue numbers, and search terms such as a bet id. No code. | Commands that read issues or PRs, for example `shipped`, `facts`, `psst`, `signals`, `recent`, `score`, `peek`, `weekly`. `--no-gh` on `facts`; no `gh` installed also works. |
| `nosy rival-demand` | GitHub, through your `gh`. Without `gh` it calls `api.github.com` directly, with `GH_TOKEN` or `GITHUB_TOKEN` if you set one. | Read-only issue searches and GraphQL Discussion queries on the public repos of the rivals you name (`--repos`, `rivalRepos` in `sources.json`, or the GitHub links in `pm/rivals/*.md`). What goes out is those repo names and a search phrase. No code, nothing from your repo. What comes back (titles, vote counts, links) is written to `pm/state/rival-demand.json`. | Only when you run it. |
| `nosy sweep` with `rivals.<slug>.stores.appStore` | `itunes.apple.com/lookup?id=<id>&country=<cc>` | One plain GET of Apple's public lookup API per rival that has a store id: no key, no cookie, nothing about you or your repo. | When you run `nosy sweep`, and only for a rival whose store id you set. |
| `nosy rival-signals run` | For rivals you configure under `rivals.<slug>.signals`: GitHub through your `gh` (else `api.github.com`), `api.npmjs.org`, `itunes.apple.com/lookup`, and one of `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com` or one careers page you name | A plain GET, User-Agent `nosy-rival-signals (+https://github.com/nosy-hq/nosy)`, 10 s timeout, one request per address, no cookies, nothing from your repo. A 403 or 429 stops that host for the run. Public counters only (stars, releases, commits, downloads, ratings, open roles). Never LinkedIn or any logged-in site. | Only when you run it. |
| `nosy roadmap` | GitHub through your `gh`: `gh issue list`, `gh api repos/<repo>/milestones`, `gh api graphql` for a Projects v2 board you name, `gh pr list` | Read-only. With `--pr --yes` it also pushes a branch and opens (or updates) a pull request in your own repo; it never closes one. | Only when you run it; the write only with `--yes`. |
| `nosy handoff` | GitHub through your `gh`: `gh api repos/<repo>/assignees`, `gh api repos/<repo>/commits?path=` (logins of recent authors of one file), `gh api graphql` (who can be assigned), `gh issue list --search` (exact title), `gh project field-list` / `view` (the board's fields), `gh api` on the owner's own account (user or organization); with `--area` it also reads your matrix file locally | Read-only preview. With `--yes`: `gh issue create` or `gh issue edit` (assignee, label), `gh label create`, `gh api` (assign GitHub's Copilot coding agent, only with `--agent copilot`: it is a paid feature of your Copilot plan), `gh project item-add` / `item-edit` (Status, Horizon, Signal, Asked for, Area, Rivals with it, only the fields the board has; needs the `project` scope). `--review` only reads (`gh issue view`, `gh pr view`; `nosy shipped` runs it as `--review --brief` when `pm/state/handoff.json` exists) and writes `pm/state/handoff-review.json`; it proposes a matrix change and a `ship-notes` run, and writes neither. With `--setup-board --yes`: `gh project create`, `gh project link` and `gh project field-create` for what the board is missing. The body is the item's own title and file pointer, or a file you give it; no names, no quotes, privacy scan first. Never closes, deletes or rewrites. | Only when you run it; the write only with `--yes`. What goes on a card is counts and short labels (how many places asked, how many rivals have the area), never a name or a quote. |
| `nosy board-status` | GitHub through your `gh`: what `nosy roadmap` reads (the board's cards, merged PRs), `gh release list` (releases of the window), and with `--yes` the board's id and its latest status updates | Read-only preview. With `--yes`: one `createProjectV2StatusUpdate` (needs the `project` scope): the week's shipped titles and the board's counts, ending in the marker `<!-- nosy:board-status YYYY-Www -->`. No status unless you pass `--status`; once per ISO week; an update is never edited or deleted. | Only when you run it; the write only with `--yes`. |
| `nosy ship-notes` | GitHub through your `gh`: `gh pr list --state merged`, `gh issue view`, `gh api repos/<repo>/issues/<n>` (lock state) | Read-only preview. With `--yes`: `gh issue comment <n> --body-file -`, one fixed neutral comment (no names, no quotes) ending in the marker `<!-- nosy:shipped -->`, on each issue a merged PR closed, never on a PR, never twice. | Only when you run it; the write only with `--yes`. |
| Update notice (hook) | `raw.githubusercontent.com/nosy-hq/nosy/main/.claude-plugin/plugin.json` | One plain GET of a public file, nothing in it about you or your repo. The answer is one version number. | Automatic, at most once a day, at session start (Claude Code), and when you type `/nosy` with no command (every agent). Off: `NOSY_NO_UPDATE_CHECK=1`, or "Turn off the update notice". |
| Reference check (hook) | GitHub, through your `gh` | `gh api repos/<issue.repo>/issues/<N>` for each `#N` in your agent's answer or file. | Automatic, when `sources.json` has `issue.repo`. Off: `NOSY_CITE_GH=0`, or turn the hook off. |
| `overheard --diff --fetch` | Your own git remote | `git fetch origin pull/<N>/head`. | Only with both flags. |
| `nosy notify` | The Slack or Discord webhook you give it | One text message (`{"text": …}`): commit and PR counts, up to five merged PR titles, three close-to-merge PR titles, bet names, three cheap-win titles, five announceable titles, and your page URL if `NOSY_PAGE_URL` is set. Run `nosy notify --dry-run` to see it first. | Only when you pass a webhook. |
| `nosy publish` (and the MCP tool `nosy_publish`) | The Nosy Cloud address you configured (`cloud.url` in `pm/sources.json`, `NOSY_CLOUD_URL`, or `--url`). There is no built-in address. | Counts and structure of your `pm/`, listed under "What `nosy publish` sends" below: no commit subjects, no author names, no PR titles, no issue titles, no customer quotes. With your token (`NOSY_CLOUD_TOKEN`). | Only when you run it with `--yes` (or answer yes in a terminal). `nosy publish --dry-run` prints exactly what would go (`--full` prints the files themselves) and connects to nothing. The MCP tool only does a dry run unless the call says `confirm: true`. |
| GitHub Action | Your own CI runner | Runs the weekly loop (rival GETs and `gh` reads, with the job's `GITHUB_TOKEN`). It writes the "Psst…" text into the job summary, visible to anyone who can read the run. Posts to Slack or Discord only if you pass a webhook. | Only when you add the workflow. |

`nosy publish` and `nosy notify` run the privacy scan first (`skill/tools/privacy-scan.mjs`). The scan stops the send on **secrets** (cloud keys, API keys, tokens, private keys, passwords in connection strings) and on **personal data**: e-mail addresses, phone numbers (Turkish, international, US, UK), IBANs of any country, card numbers, Turkish ID numbers, and names: the ones in `pm/private.json` plus the display names of the people who wrote your commits. Notes about your machine (a home-directory path, a private IP address, an internal host name) are listed in the scan's report but don't stop a send. To send anyway, after reading the report: `--allow-sensitive`.

Nothing under `pm/todo/` is sent: no command reads it to send it. The page shows the titles and names on your own machine; `nosy publish` carries only how many items wait on people and for how long.

The pages Nosy builds (`pm/page.html`, the scoreboard) make no network request when you open them: they use your system's fonts and load nothing from anywhere.

### What the plugin's hooks do

Installing the plugin adds four hooks (`hooks/hooks.json`, seven registrations). They run on your machine, read local files and git, and print a short note to your agent. None of them sends your code, history or documents anywhere. Each can be turned off in the plugin's settings or with an environment variable. Two of them reach the network on their own, and only for what the Network column says.

| Hook | Runs when | What it does | Network | Switch off |
|---|---|---|---|---|
| `psst-summary` | A session starts | Prints one line from `pm/state/lowhanging.json`, if it exists, and, when a newer Nosy is out, one line saying so and how to update (at most once a day). | The update notice: one plain GET, at most once a day, of `https://raw.githubusercontent.com/nosy-hq/nosy/main/.claude-plugin/plugin.json` (a public file; 2 second limit). No query string, body, cookie or identifier, and no version of yours: GitHub sees an address asking for a public file, as with `git clone`. The answer is one version number, kept with the time in `nosy-update.json` in the plugin's data folder (or your temp folder). Offline or blocked: silent. The summary itself: none. | "Turn off the opening summary", or `NOSY_NO_PSST=1` (the whole hook). Only the notice: "Turn off the update notice", or `NOSY_NO_UPDATE_CHECK=1` |
| `after-commit` | A `git commit`, `merge`, `pull`, `cherry-pick` or `gh pr merge` finishes | Says which matrix gap the change may close and the next command. Remembers the last commit it spoke about in one small file in your temp folder (`NOSY_NUDGE_DIR` moves it). | None | "Turn off the after-commit nudge", or `NOSY_NO_NUDGE=1` |
| `never-check` | A `git commit` or `gh pr create` finishes | Compares what went in with the "never" rules in `pm/sources.json` and tells the agent on a match. Never blocks or undoes anything. | None | "Turn off the never-rule check", or `NOSY_NO_NEVER_CHECK=1` |
| `cite-check` | The agent finishes an answer, or writes a Markdown or text file, in a repo that has `pm/sources.json` | Checks every `file:line`, quote, commit and `#N` in the text against your repo and asks the agent to fix the ones that don't hold up. Asks once per answer. | One read-only GitHub lookup per cited `#N`, through your `gh`, and only if `sources.json` names an `issue.repo`. It sends the issue number to GitHub and nothing else. | "Turn off the reference check", or `NOSY_NO_CITE_CHECK=1`. `NOSY_CITE_GH=0` keeps the check but skips the GitHub lookup. |

The hooks write nothing to your repo (the update notice keeps one small file, `nosy-update.json`, in the plugin's data or temp folder). Apart from `HOME`, `NOSY_PM`, `NOSY_STATE_DIR` and their own switches, they read no environment variables and no credentials. They don't change your permission settings and don't run downloaded code.

### What `nosy publish` sends

Up to these files, with your token. Each local file that holds words from your git history or issue tracker is cut down first (`skill/tools/publish-safe.mjs`), and the result is what the scan sees and what is sent:

| Key | What it carries |
|---|---|
| `pm/matrix.json` | Your matrix as written: steps, our status per step and notes, rival names, categories, statuses, evidence lines. |
| `pm/state/status.json` | `generated`, `range`, `main`, `pr` (commits on open PRs plus merges on main: not a PR count), `prCommits`, `openPrs`, `lastMain`, and `groups[]` of `{ref, n, where, last, who, topic}`, where `who` is `["N authors"]` and `topic` is `"N commits"`. The commit subjects, author names, PR list and local-branch list of the local file are not sent. |
| `pm/state/lowhanging.json` | `generated`, `ref`, `leftOut` (how many items your decisions park on purpose; those items are not sent) and `items[]` of `{score, effort, type, title, evidence, detail, ref}`. Issue items are reduced to `#N` and a date; "shipped, not tied to a plan" items lose their commit lines. Titles of items from your own notes, request document and matrix are sent as written. |
| `pm/state/psst-final.json` | Only when it is as new as the raw list: psst's list after the refuter checked it. `generated`, counts (`drafted`, `stands`, `weakened`, `refuted`) and `items[]` of `{title, size, type, verdict, evidence}`; an issue item is cut to `#N` and a date. Not sent: the files the refuter read, its notes and fixes, the titles of dropped items, the receipts. |
| `pm/state/diff.json` | `generated`, `previous`, `current`, `changes[]` of `{area, type, severity, title, detail, reason}`. A commit subject becomes "first commit seen", a PR title is dropped (`PR #N opened`), an issue title becomes `#N`, author names are dropped, a demand change carries no wording. |
| `pm/history/runs.jsonl` | One line per run: time, label, ref, last commit id, counts. |
| `pm/summary.md` | The first section only (the part the dashboard shows). Free text you or your agent wrote; the privacy scan runs on it. |
| `pm/state/watch.json` | Rival names and the public page addresses you listed, with their change state. |
| `pm/state/glance.json` (computed) | The next decision (title, size, checks), four numbers, where we stand by step, roadmap lanes, shipped as counts and references, and how many things wait on people and for how long (`pm/todo/`: no titles, no names). |
| `pm/state/rival-facts.json` (computed) | Each rival's price line from your rival files. |
| `pm/state/rival-demand.json` (computed) | Only if you ran `nosy rival-demand`: titles, vote counts and links of open issues and Discussions on your open-source rivals' own public trackers (their public data, not yours), and which rivals share an ask. |
| `pm/state/demand.json` (computed) | Counts per goal for goals matched to a matrix row or a psst item, sources by format, and counts for the rest; no quotes, no customer names, no unmatched themes. |

Nothing else in `pm/` leaves: not the decision log, not `pm/signal/`, not the rival files, not `pm/state/facts/`.

**New in 0.19.0 to 0.21.1.** Everything here is local, except the lines that name a network read or a GitHub write.
- `nosy history [30d|90d]` reads the repository's own past (git, and `gh` when `issue.repo` is set) and writes `pm/state/history.json` and `pm/state/history.md`: counts by week and area, tags, merged pull request numbers and titles, and the latest commit subjects. **It stays on this machine: `publish` does not send it.** It is a record of the time before Nosy and is not one of Nosy's own snapshots.
- `nosy rivals-week` reads `pm/state/rivals-this-week.json` (written by the research: rival, one line, source address, day, shipped or announced) and prints what the page's "Rivals this week" box shows; it writes nothing. `nosy sweep-check` reads `pm/state/rival-sweep.json` and your rival files and writes `pm/state/sweep-reconcile.json` (per rival: the date the file says, the newest swept entry). `nosy universe` reads `pm/state/rival-universe.json` and writes nothing.
- `nosy page validate` reads the page and `pm/`, runs the privacy scan and `find-stale` on the page, and writes nothing in the end (it makes one short-lived file beside the page and removes it); `--json <file>` saves its report where you say.
- `publish` also lets a name through the privacy scan when it is a public entity, as that whole name: the rivals' names in the matrix and `sources.json`, your own product's name, and `sources.json` `privacy.publicNames`. Commit authors and your branch names are still scanned for in everything that leaves, and the finding names where the name came from.
- `nosy tour` writes `pm/state/tour.json` (`started`, what you approved, what is done, notes) and nothing else, unless you pass `--json <file>`. It reads `pm/`, `sources.json` and your rival folder, and runs no step itself.
- `pm/state/receipts.json` items now carry `local` (branches that already hold the item's work: names, authors, how far they got), `edits` (uncommitted files in a worktree) and `ticketed` (an open or closed issue the item's code comment points at). It is never published.
- `nosy tiers` writes `pm/state/rival-tiers.json`. `nosy watch` and `nosy tiers` append one line per watch run to `pm/history/watch-states.jsonl` (never twice for the same run), which the tiers read to see how often a rival changed.
- `nosy matrix-proposals check` writes `pm/state/matrix-proposals.checked.json` (the agents' file, `pm/state/matrix-proposals.json`, is read). `apply` rewrites `pm/matrix.json` and the matching rows of `pm/rivals/*.md` (the evidence cell gains `[verified: date]`, read back as `verified_at`), after copying the matrix to `pm/.backup/matrix-<stamp>.json` and the rival files to `matrix-<stamp>-rivals/`. `undo` puts them back.
- `nosy roadmap` writes `pm/state/roadmap.md` and `pm/state/roadmap.json` (`{ type, generated, path, sections: { now, next, later, shipped }, hidden }`; items are `{ title, ref, url }`, shipped ones add `date`: titles, issue refs, links and dates only). With `--pr --yes` it creates a detached throwaway worktree of your repo off `origin/<integration branch>`, edits only the block between `<!-- nosy:roadmap -->` and `<!-- /nosy:roadmap -->` in `ROADMAP.md` (or `roadmap.path`), pushes the branch `nosy/roadmap-<date>` (or force-pushes the open one: one commit on the current base), opens or updates the PR through `gh`, then removes the worktree. Your checkout is never touched. It can read GitHub labels, milestones or a Projects v2 board you name (`roadmap.source`), never writing to them. The block's words come from `skill/data/lang/<code>/roadmap.json`. `sources.json` key: `roadmap` (`path`, `now`, `next`, `later`, `shipped`, `skip`, `max`, `source`, `labels`, `milestones`, `project`). The optional Action input `roadmap` does this weekly.
- `nosy rival-signals` writes `pm/state/rival-signals.json` (public counters per rival, with the change since 28 days ago and a source link), appends one line per run to `pm/history/rival-signals.jsonl`, and, for notes you add yourself, `pm/signal/rival-notes.jsonl` (each with an http(s) source link; **local only, never published, never read as customer feedback**). `sources.json` key: `rivals.<slug>.signals`.
- `nosy atlas` reads `pm/atlas/*.md` and writes `pm/state/frontier.json` (per candidate: the axes with score, grade, date, a stale flag and the basis text; the ranking; and why each unranked candidate isn't ranked). `nosy atlas seed <file>` reads one local registry file and, with `--json`, writes `pm/state/atlas-seed.json` (per-country counts). Neither opens a network connection; the agent's research and the one fetch of a registry file go through your agent's own tools and `curl`. Neither is published.
- `nosy handoff` writes `pm/state/handoff.json` (`{ done: [{ key, title, issue, url, at, area }] }`; not published) and, only with `--yes`, the issue, label, card and board described in the table above.
- `nosy ship-notes` writes `pm/state/ship-notes.json` (`{ posted: [{ issue, pr, at }] }`; not published) and, only with `--yes`, the comments described in the table above. The comment is the only thing it writes outside `pm/`.
- `nosy publish` also sends `pm/state/frontier.json` when you ran `nosy atlas`: the matrix cut down to the candidate's name (your own word, like a matrix row), your decision as one word (yes, no or undecided), the read and verified dates, the score, how many axes were graded read, whether it is ranked and why not, and per axis the score, grade, date and stale flag. Never the basis of a score (the line or URL it rests on), the report text, a warning's wording or the words you gave behind a decision. Nosy Cloud draws it as the Where next tab.
- `nosy publish` now also sends `pm/state/roadmap.json` (per line: `title` cut to 200 characters, `ref` only if `#N`, `url` only if an issue or pull request on github.com, `date` on shipped lines; the file's `path` and `hidden` counts; at most 200 lines a section) and `pm/state/rival-signals.json` (per rival `slug` and `name`; per signal `key`, `label`, `value`, `previous`, `since`, and a `source` only if https on api.github.com, github.com, api.npmjs.org, itunes.apple.com, boards-api.greenhouse.io, api.lever.co or api.ashbyhq.com, with only `id` and `country` kept from a query; unread entries as `key` plus a `why` cut to 60 characters; at most 50 rivals), when you made them. Nothing under `pm/signal/` is ever read by `publish`.
- `nosy notify` reads, when they exist, `pm/state/rival-signals.json` and `pm/state/roadmap.json` for two quiet lines (rival moves of 10% or 5 units at most three, and the roadmap counts); it adds at most five lines and nothing when nothing moved.
- `nosy rivals-import` copies rival-shaped markdown files from `rivalsPath` (or `--from`) into `pm/rivals/<slug>.md` and records where each came from in `pm/rivals/.imported`. It never moves, deletes or overwrites a rival file: a slug that already exists is left as it is.
- `nosy doctor --fix` copies what it rewrites to `pm/.backup/doctor-<stamp>/` first; `--fix --dry-run` writes nothing; `--undo` puts it back, and leaves alone a file you changed since (unless `--force`).
- `nosy page-adopt` writes `<!-- pm:table … -->` comments into your page after a copy to `pm/.backup/page-<stamp>.html`, only with `--apply --yes`. `refresh` changes only the marked tables; a row that disappeared gets `data-gone`, never deleted. It never touches the `pm:auto` block.
- The block `auto-section.mjs` writes carries `data-generated="<ISO time>"` on its wrapper (any language), so `freshness` can date it. It has no author names, no branch or commit lines, no refuter text and no dropped items; `--lang <code>` (or `language` in `sources.json`) picks the language of its fixed phrases.
- `measure-size.mjs` (the size step of `canwe`) no longer fills a partial clone. It reads name-only history, says that lines weren't counted, and counts commits and active days only on a treeless clone. Run it yourself with `--force-fetch` to read the lines; git then downloads the missing files from your remote.
- **Network.** `nosy sweep` asks Apple's public lookup for a rival that has `stores.appStore` (see the table above).
- **Network.** `nosy publish` sends `pm/state/psst-final.json` as described in the table above, and reads your token from `NOSY_CLOUD_TOKEN`, `--token-file`, `NOSY_CLOUD_TOKEN_FILE` or `~/.config/nosy/token` (refused when others can read it). Before sending it checks the matrix with the same reader every command uses, and after the send it prints what the dashboard says it drew.
- `sources.json` keys: `team` (logins whose issues are work items, not demand), `rivalsPath` (rival research kept outside `pm/rivals`), `matrixCodes` (your cell codes mapped to `y`, `p`, `n`, `u`, `d`), `rivals.<slug>.tier` (`A`, `B` or `C`), `rivals.<slug>.stores.appStore` and `.country`, `tour.tokensPerRival` (your own figure for the cost of one rival pass) and `language` (also used by the page block).
- `pm/matrix.json`: `"declined": true` on a line-shape row, or `biz.declined: { "<step>": "reason" }`, means you decided against it (the dashboard shows "Decided against", not Missing).
- `pm/state/facts/branches.json`: per-branch `paths` is capped (500 per branch, 40,000 in total, `pathsTruncated` and `pathsTotal` set when cut), and a remote ref carries `remote` and `branch`. `rivals-import` keeps each file's modification time and never overwrites, even a name that differs only in case.
- **What `publish` cuts, more strictly than before.** `glance.json` no longer carries the decision's reason text; the "Not doing" card shows a fixed reason word and never an item the refuter dropped. `history/runs.jsonl` leaves as time, label, ref, last commit and counts, nothing else of the line. From `summary.md` only the first section leaves (text before its first heading stays home; a file with no heading is cut to 40 lines). `diff.json` signal changes carry the count, never the customer. `status.json` also has `openPrsCapped` (true when the list hit 30). The privacy scan also looks for the authors of your local branches and the names of your unmerged branches. `publish` refuses plain `http://` to a host that isn't your own machine, never follows a redirect, and refuses a file over 1.5M characters or a request over 8 MB, naming which.

**Not cut down (your own words, sent as you wrote them):** matrix rows and notes, the titles of your own list and roadmap items, and the first section of `pm/summary.md`. If those name a person or a customer, the scan stops the send only for the kinds of personal data it can recognise (see above).

Not by Nosy's scripts, but by what its commands ask your agent to do. These go wherever your agent sends things:

- **The model.** Everything the scripts print to your agent, and the notes the hooks inject into the session, are read by your agent's model.
- **Web research.** `neighbors` and `move-in` use your agent's web search and fetch. Queries hold rival names, your product's category, and "alternatives to…". `sources.json` `research` can name another tool, used only if you also set `paidRequiresOwnerOk: true`.
- **`tea`.** In Claude, publishes the decision page with the Artifact tool, after the privacy scan. Other agents: the page stays a local file.
- **`psst`.** Reads support or feedback tools you attached to your agent (read-only, it asks first) and saves the raw responses in `pm/signal/`.
- **`spill`.** Opens a Linear, Jira or GitHub issue through your agent's connector, only after you say so.
- **`git fetch`.** `peek` tells your agent to run it.

The MCP server (`nosy mcp`) talks over stdio, opens no port, and the plugin doesn't register it for you. Its tools read your repo and write under `pm/` (mostly `pm/state/`). Its only outward tool is `nosy_publish`, which only lists what it would send (a dry run) unless the call says `confirm: true`.

## What Nosy never reads

- Files git doesn't track: an ignored `.env`, local key files, build output.
- Your home folder, beyond the install checks in the table above: no `~/.ssh`, `~/.aws`, `~/.npmrc`, browser data, keychain, shell history.
- Environment variables outside the list above.
- Any customer system. Nosy has no connector of its own. It reads exports you place in `pm/signal/`, and what your own agent pulls when you ask.

## Telemetry

None. No script, hook, agent, command file, Action step or dependency sends usage, errors, versions or identifiers anywhere. ("Analytics" in the code means detecting analytics events in *your* product, `scan-metrics.mjs`.) The only network calls are the rows above. Each is something you ran or configured, except two: the reference-check hook's read-only GitHub lookups, and the session-start hook's once-a-day read of the public version file (the request carries no version or identifier of yours, so GitHub learns only that some address fetched a public file; `NOSY_NO_UPDATE_CHECK=1` removes it).

## Limits

Where this file can't promise more:

- **Printed lines are redacted by pattern.** A committed secret in a file that looks like it holds secrets, or one the secret detector recognises, is hidden when `nosy find`, `canwe` or `psst` print the line. Other sensitive text in code (a name, an address, a secret in a shape the detector doesn't know) is printed as it is.
- **Masking finds formats, not names** (see "Masking").
- **`pm/` is your data, and it can hold customer words.** `pm/state/signals.json` has masked quotes, `pm/state/facts/github.json` has issue and PR text, `pm/signal/` has raw exports. If you commit `pm/`, consider ignoring those three.
- **Partial clones.** In a blobless or treeless clone, `git` itself may download missing files from your remote while Nosy reads. `facts`, `inventory` and `measure-size` guard against it (`measure-size --force-fetch` turns the guard off); other commands don't.
- **The privacy scan is pattern matching.** It catches known secret formats, the personal-data kinds listed above and the names it is given, not everything. A name it isn't given, or a customer named in your own matrix row or summary, is not found.

## How to verify yourself

**1. Read the code paths.** These list every place a script can open a connection or start a program:

```bash
grep -rnE "await fetch\(|globalThis\.fetch|node:(https?|net|tls|dns|dgram|http2)['\"]" skill/tools hooks
grep -rnoE "(execFileSync|spawnSync|spawn)\(\"[a-z]+\"" skill/tools hooks | sed -E 's/.*\("//; s/"//' | sort | uniq -c
```

The first prints seven files: `watch-rivals.mjs`, `rival-sweep.mjs`, `rival-demand.mjs`, `rival-signals.mjs`, `news.mjs`, `publish.mjs` and `update-check.mjs` (the daily version notice). Every other connection goes through `gh`. The second shows the programs Nosy starts: `git`, `gh` and `node` (itself), nothing else.

**2. Run it with the network off.** macOS:

```bash
sandbox-exec -n no-network node skill/tools/nosy.mjs weekly --short
```

It finishes and writes `pm/page.html`. Anything that needed the network reports that it couldn't reach it. Any network-namespace tool does the same on Linux.

**3. Log what it tries.** Save this as `trace.cjs`, then run any command with it:

```js
const say = (...a) => process.stderr.write("[trace] " + a.join(" ") + "\n");
const net = require("net"), dns = require("dns"), cp = require("child_process");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { say("connect", JSON.stringify(a[0])); return connect.apply(this, a); };
const lookup = dns.lookup;
dns.lookup = function (h, ...r) { say("dns", h); return lookup.call(dns, h, ...r); };
for (const f of ["spawn", "spawnSync", "execFileSync"]) { const o = cp[f]; cp[f] = function (c, a, ...r) { say(f, c, Array.isArray(a) ? a.join(" ") : ""); return o.call(cp, c, a, ...r); }; }
```

```bash
NODE_OPTIONS="--require $PWD/trace.cjs" node skill/tools/nosy.mjs help          # nothing but the banner
NODE_OPTIONS="--require $PWD/trace.cjs" node skill/tools/nosy.mjs peek 7d 2>&1 | grep -v " git "   # local git, plus gh if present
NODE_OPTIONS="--require $PWD/trace.cjs" node skill/tools/nosy.mjs publish --dry-run   # lists files, connects to nothing
```

Child `node` processes inherit `NODE_OPTIONS`, so the scripts Nosy starts are traced too. A `[trace] connect` line is a network connection; it names the host or address.

**4. See exactly what would be sent.** `nosy publish --dry-run` and `nosy notify --dry-run` print the files and the message without sending anything.

## Where to check

- Network calls: `skill/tools/watch-rivals.mjs`, `skill/tools/rival-sweep.mjs`, `skill/tools/rival-demand.mjs`, `skill/tools/news.mjs`, `skill/tools/publish.mjs`, `skill/tools/update-check.mjs` (the session-start hook's version read)
- `gh` reads: `skill/tools/rival-demand.mjs`, `skill/tools/facts.mjs`, `skill/tools/shipped-record.mjs`, `skill/tools/recent.mjs`, `skill/tools/collect-status.mjs`, `skill/tools/collect-signals.mjs`, `skill/tools/preread.mjs`, `skill/tools/cite-check.mjs`
- `git fetch`: `skill/tools/preread.mjs`, `skill/commands/peek.md`
- What `publish` sends: `skill/tools/publish.mjs` (the `Files` list), `skill/tools/publish-safe.mjs` (what is cut from each file), `skill/tools/glance.mjs`, `skill/tools/rival-facts.mjs`, `skill/tools/demand-facts.mjs`
- Privacy scan, masking, redaction: `skill/tools/privacy-scan.mjs`, `skill/tools/mask.mjs`, `skill/tools/pii.mjs`, `skill/tools/secret-rules.mjs`, `skill/tools/redact.mjs` (used by `facts.mjs find`, `canwe.mjs`, `pending-backend.mjs`)
- Hooks: `hooks/hooks.json`, `hooks/psst-summary.mjs`, `hooks/after-commit.mjs`, `hooks/never-check.mjs`, `hooks/cite-check.mjs`, `skill/tools/loaded.mjs`
- Install, doctor, MCP: `skill/tools/install.mjs`, `skill/tools/health.mjs`, `skill/tools/mcp.mjs`, `.claude-plugin/plugin.json`
- Files Nosy rewrites and the copy it takes first: `skill/tools/doctor.mjs`, `skill/tools/matrix-proposals.mjs`, `skill/tools/adopt-page.mjs`, `skill/tools/rivals-import.mjs`, `skill/tools/auto-section.mjs`
- Local-only planning and reads (no network): `skill/tools/tour.mjs`, `skill/tools/rival-tiers.mjs`, `skill/tools/local-work.mjs`, `skill/tools/matrix-preflight.mjs`
- Entry point, `NOSY_OFFLINE`, command list: `skill/tools/nosy.mjs`
- Generated pages (no requests, system fonts): `skill/tools/build-page.mjs`, `skill/tools/scoreboard.mjs`
- Demand exports: `skill/tools/collect-signals.mjs`, `skill/tools/interview-themes.mjs`, `skill/tools/demand.mjs`
- Reading through git: `skill/tools/inventory.mjs`, `skill/tools/find-sources.mjs`
- The Action: `action.yml`
- Agent-side behavior: `agents/nosy-neighbor.md`, `agents/nosy-scout.md`, `agents/nosy-refuter.md`, `agents/nosy-auditor.md`, `skill/commands/atlas.md`, `skill/commands/neighbors.md`, `skill/commands/move-in.md`, `skill/commands/frontyard.md`, `skill/commands/tea.md`, `skill/commands/psst.md`, `skill/commands/spill.md`, `skill/rules.md`
- No dependencies: `package.json`
- Maintainer command that writes into the plugin: `skill/tools/dresscode.mjs`
