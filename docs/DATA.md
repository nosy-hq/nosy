# What Nosy reads, writes and sends

> Nosy about your product. Never your data.

That line needs a list you can check. This is the list.

It comes from reading every script, hook, agent, command file and the GitHub Action, and from running the scripts with their network, process and file activity logged. Audited on 30 Sep 2026: version 0.15.0. What the audit found about `nosy publish`, personal data, masking, printed secrets and web fonts has been fixed, and this file describes the code as fixed. If you find behavior that isn't written here, that is a bug in this file or in Nosy. Please report it.

## The short version

- **No telemetry.** No analytics, usage pings, crash reports, update checks or install IDs. Nosy has no dependencies (`package.json` lists none), so no third-party code runs inside it either.
- **Nosy sends nothing on its own.** Every network call is one you start: it reads the public rival pages you listed, reads GitHub through your own `gh`, posts to the webhook you give `nosy notify`, or (`nosy publish`, off until you configure a target and confirm) sends counts and structure, never quotes, to a Nosy Cloud you configured. `publish` and `notify` stop on a secret or personal data unless you pass `--allow-sensitive`. Every path is in the table under "What leaves your machine".
- **Nosy reads your code through git.** It reads committed files, not your disk. Files git doesn't track, such as an ignored `.env`, are not opened.
- **Nosy writes under `pm/`**, plus a few named exceptions.
- **The model call is your agent's, not Nosy's.** Whatever Nosy prints to your agent, your agent's model sees.

## What Nosy reads

| Source | What Nosy reads | Notes |
|---|---|---|
| Your code | Committed files at the branch named in `pm/sources.json` (`ref`), with `git grep`, `git ls-tree` and `git show`: routes, screens, plan gates, event names. Matching lines are printed with `file:line`. | Untracked and ignored files are not read. Every committed file is readable, but a printed line is redacted: in a file that looks like it holds secrets (`.env*`, `*.env`, `*.pem`, `*.key`, `id_rsa`, `credentials*`, `secrets.*`, `.npmrc`, `*.tfvars`…) the value after `=` or `:` is hidden and any other line is hidden whole; in any other file the values the secret detector recognises are hidden. The `file:line` stays. See "Limits". |
| Git history | Commit subjects, author display names and dates, branches, merges, `blame`. | Author emails are read only to spot bots. They are not written out. |
| Issues and PRs | Through your `gh`, if you have it and `pm/sources.json` names a repo (`issue.repo`): titles, bodies, comments, author logins, labels, changed-file lists, CI status. | `nosy facts` saves them to `pm/state/facts/github.json` (bodies and comments cut at 4,000 characters). Without `gh`, the tools say so and carry on. |
| Your own documents | Decision log, roadmap or request document, README, `package.json`, design-system files, and any path you put in `pm/sources.json`. | A path in `sources.json` can be outside the repo. The reference check also lists file names (three levels deep) under every absolute path in `sources.json`. |
| Public web pages | Scripts: the rival pages you list in `pm/rivals/*.md` (`## Sources`) or in `sources.json` (`rivals`, `watch`), plus same-origin script files of pages that need JavaScript. Your agent: rival research (`neighbors`, `move-in`) and your landing page (`frontyard`), through its own web tools. | Public pages only, plain GET, no login. |
| Files you drop in | Support, survey and interview exports in `pm/signal/` (or the folder `signal.path` names): csv, json, jsonl, md, txt. | See "Masking" below. Nosy never rewrites or copies a raw export. |
| Your agent session (hooks) | The last answer your agent gave (from the transcript file the host hands the hook) and markdown or text files the agent just wrote, only when they contain a `file:line`, `#N` or commit hash to check. | Only in a repo that has `pm/sources.json`. Nothing is stored. |
| Your Nosy install | `nosy doctor --check` reads `~/.claude/plugins/installed_plugins.json`, `~/.claude/settings.json` (only the `enabledPlugins` key is used), the skill folders (`.claude/skills/nosy`, `.agents/skills/nosy`, here and in your home folder), and runs `git --version` and `gh --version`. | Only when you run it. |

Environment variables read: `NOSY_*` and `CLAUDE_PLUGIN_*` settings, and `HOME` (to expand `~` in a path). Nothing else. `gh` reads its own sign-in; Nosy never touches that token.

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
| `pm/sources.json`, `pm/matrix.json` | Setup. `setup --onTop` keeps a `.backup` copy before it overwrites an existing file; `learn suggest --apply` keeps a `.yedek` copy. |
| `pm/state/` | Every counting command's output (`status.json`, `lowhanging.json`, `signals.json`, `facts.md`, `facts/`, `shipped.json`, `receipts.*`, `canwe-last.md`, and so on). |
| `pm/history/` | Run history (`runs.jsonl`), diff snapshots, and `pm/history/watch/`: text of the public rival pages, kept on your machine only. Nosy's own repo git-ignores it; do the same in yours if you commit `pm/`. |
| `pm/page.html`, `pm/scoreboard.html` | The decision page and the scoreboard. |
| `pm/bets/`, `pm/canwe/`, `pm/design/`, `pm/learned.json` | Bets, the "can we?" answer ledger, design-check approvals, your "noise / knowingly / important" calls. |
| `pm/rivals/`, `pm/frontyard/`, `pm/prd/` | Written by your agent when you run `neighbors`, `frontyard`, `spill`. |

Outside `pm/`:

| Where | What | When |
|---|---|---|
| OS temp folder | `nosy-nudge-<hash>.json` (the last commit id the after-commit hook saw, and what it last said). Short-lived folders `nosy-publish-*`, `nosy-news-*`, `nosy-facts-obj-*`, deleted after use. | Automatic (the hook), or while a command runs. |
| Plugin data folder (`CLAUDE_PLUGIN_DATA`, else the temp folder) | `nosy-loaded.json`: version and time of the first session, so the first-run lines show once. Local only. | Once, at the first session after install. |
| Agent skill folders | `nosy install` copies `skill/` to `.claude/skills/nosy`, `.agents/skills/nosy` and similar in the project, or in your home folder with `--global`. It never touches settings or hooks. | Only when you run `nosy install`. |
| Your repo's `.git` | `overheard --diff --fetch` creates `refs/nosy/pr-N`. | Only with both flags. |
| Files you name | `--json <file>` and `--mask <file>` write where you point them. | Only when you pass them. |
| Your branch | The GitHub Action's `commit: true` commits generated `pm/` files and pushes. | Only when you set it. |
| The plugin folder itself | `dresscode suggest --publish` adds generic patterns (never product text) to `skill/data/dresscode-exceptions.json`. A maintainer command. | Only when you run it. |

Nosy never runs `git commit`, `git add` or `git push` itself, apart from that Action option. It never runs a `gh` command that creates or changes anything.

## What leaves your machine

By the plugin's own code:

| Feature | Goes to | What is sent | When |
|---|---|---|---|
| `nosy watch`, `nosy sweep`, and `nosy weekly` (which includes watch when `pm/rivals/` exists) | The public rival URLs you listed | A plain GET with a `Nosy … (public pages only)` user agent. No cookies, no body, nothing from your repo. The site sees your IP address. | When you run them. `NOSY_OFFLINE=1` skips the watch step of `weekly`. |
| GitHub reads | GitHub, through your `gh` | Read-only calls: `pr list`, `pr view`, `pr diff`, `issue list`, `repo view`, `auth status`, `api` reads and GraphQL queries. What goes out is the repo name, PR and issue numbers, and search terms such as a bet id. No code. | Commands that read issues or PRs, for example `shipped`, `facts`, `psst`, `signals`, `recent`, `score`, `peek`, `weekly`. `--no-gh` on `facts`; no `gh` installed also works. |
| Reference check (hook) | GitHub, through your `gh` | `gh api repos/<issue.repo>/issues/<N>` for each `#N` in your agent's answer or file. | Automatic, when `sources.json` has `issue.repo`. Off: `NOSY_CITE_GH=0`, or turn the hook off. |
| `overheard --diff --fetch` | Your own git remote | `git fetch origin pull/<N>/head`. | Only with both flags. |
| `nosy notify` | The Slack or Discord webhook you give it | One text message (`{"text": …}`): commit and PR counts, up to five merged PR titles, three close-to-merge PR titles, bet names, three cheap-win titles, five announceable titles, and your page URL if `NOSY_PAGE_URL` is set. Run `nosy notify --dry-run` to see it first. | Only when you pass a webhook. |
| `nosy publish` (and the MCP tool `nosy_publish`) | The Nosy Cloud address you configured (`cloud.url` in `pm/sources.json`, `NOSY_CLOUD_URL`, or `--url`). There is no built-in address. | Counts and structure of your `pm/`, listed under "What `nosy publish` sends" below: no commit subjects, no author names, no PR titles, no issue titles, no customer quotes. With your token (`NOSY_CLOUD_TOKEN`). | Only when you run it with `--yes` (or answer yes in a terminal). `nosy publish --dry-run` prints exactly what would go (`--full` prints the files themselves) and connects to nothing. The MCP tool only does a dry run unless the call says `confirm: true`. |
| GitHub Action | Your own CI runner | Runs the weekly loop (rival GETs and `gh` reads, with the job's `GITHUB_TOKEN`). It writes the "Psst…" text into the job summary, visible to anyone who can read the run. Posts to Slack or Discord only if you pass a webhook. | Only when you add the workflow. |

`nosy publish` and `nosy notify` run the privacy scan first (`skill/tools/privacy-scan.mjs`). The scan stops the send on **secrets** (cloud keys, API keys, tokens, private keys, passwords in connection strings) and on **personal data**: e-mail addresses, phone numbers (Turkish, international, US, UK), IBANs of any country, card numbers, Turkish ID numbers, and names: the ones in `pm/private.json` plus the display names of the people who wrote your commits. Notes about your machine (a home-directory path, a private IP address, an internal host name) are listed in the scan's report but don't stop a send. To send anyway, after reading the report: `--allow-sensitive`.

The pages Nosy builds (`pm/page.html`, the scoreboard) make no network request when you open them: they use your system's fonts and load nothing from anywhere.

### What `nosy publish` sends

Up to these files, with your token. Each local file that holds words from your git history or issue tracker is cut down first (`skill/tools/publish-safe.mjs`), and the result is what the scan sees and what is sent:

| Key | What it carries |
|---|---|
| `pm/matrix.json` | Your matrix as written: steps, our status per step and notes, rival names, categories, statuses, evidence lines. |
| `pm/state/status.json` | `generated`, `range`, `main`, `pr`, `lastMain`, and `groups[]` of `{ref, n, where, last, who, topic}`, where `who` is `["N authors"]` and `topic` is `"N commits"`. The commit subjects, author names, PR list and local-branch list of the local file are not sent. |
| `pm/state/lowhanging.json` | `generated`, `ref`, `items[]` of `{score, effort, type, title, evidence, detail, ref}`. Issue items are reduced to `#N` and a date; "shipped, not tied to a plan" items lose their commit lines. Titles of items from your own notes, request document and matrix are sent as written. |
| `pm/state/diff.json` | `generated`, `previous`, `current`, `changes[]` of `{area, type, severity, title, detail, reason}`. A commit subject becomes "first commit seen", a PR title is dropped (`PR #N opened`), an issue title becomes `#N`, author names are dropped, a demand change carries no wording. |
| `pm/history/runs.jsonl` | One line per run: time, label, ref, last commit id, counts. |
| `pm/summary.md` | The first section only (the part the dashboard shows). Free text you or your agent wrote; the privacy scan runs on it. |
| `pm/state/watch.json` | Rival names and the public page addresses you listed, with their change state. |
| `pm/state/glance.json` (computed) | The next decision (title, size, checks), four numbers, where we stand by step, roadmap lanes, and shipped as counts and references. |
| `pm/state/rival-facts.json` (computed) | Each rival's price line from your rival files. |
| `pm/state/demand.json` (computed) | Counts per goal for goals matched to a matrix row or a psst item, sources by format, and counts for the rest; no quotes, no customer names, no unmatched themes. |

Nothing else in `pm/` leaves: not the decision log, not `pm/signal/`, not the rival files, not `pm/state/facts/`.

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

None. No script, hook, agent, command file, Action step or dependency sends usage, errors, versions or identifiers anywhere. The word "analytics" in the code is about detecting analytics events in *your* product (`scan-metrics.mjs`). The only network calls are the rows above, and each one is something you ran or configured.

## Limits

Where this file can't promise more yet:

- **Printed lines are redacted by pattern.** A committed secret in a file that looks like it holds secrets, or one the secret detector recognises, is hidden when `nosy find`, `canwe` or `psst` print the line. Other sensitive text in code (a name, an address, a secret in a shape the detector doesn't know) is printed as it is.
- **Masking finds formats, not names** (see "Masking").
- **`pm/` is your data, and it can hold customer words.** `pm/state/signals.json` has masked quotes, `pm/state/facts/github.json` has issue and PR text, `pm/signal/` has raw exports. If you commit `pm/`, consider ignoring those three.
- **Partial clones.** In a blobless or treeless clone, `git` itself may download missing files from your remote while Nosy reads. `facts` and `inventory` guard against it; other commands don't.
- **The privacy scan is pattern matching.** It catches known secret formats, the personal-data kinds listed above and the names it is given, not everything. A name it isn't given, or a customer named in your own matrix row or summary, is not found.

## How to verify yourself

**1. Read the code paths.** These list every place a script can open a connection or start a program:

```bash
grep -rnE "await fetch\(|node:(https?|net|tls|dns|dgram|http2)['\"]" skill/tools hooks
grep -rnoE "(execFileSync|spawnSync|spawn)\(\"[a-z]+\"" skill/tools hooks | sed -E 's/.*\("//; s/"//' | sort | uniq -c
```

The first prints four lines: `watch-rivals.mjs`, `rival-sweep.mjs`, `news.mjs`, `publish.mjs`. The second shows the programs Nosy starts: `git`, `gh` and `node` (itself), nothing else.

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

- Network calls: `skill/tools/watch-rivals.mjs`, `skill/tools/rival-sweep.mjs`, `skill/tools/news.mjs`, `skill/tools/publish.mjs`
- `gh` reads: `skill/tools/facts.mjs`, `skill/tools/shipped-record.mjs`, `skill/tools/recent.mjs`, `skill/tools/collect-status.mjs`, `skill/tools/collect-signals.mjs`, `skill/tools/preread.mjs`, `skill/tools/cite-check.mjs`
- `git fetch`: `skill/tools/preread.mjs`, `skill/commands/peek.md`
- What `publish` sends: `skill/tools/publish.mjs` (the `Files` list), `skill/tools/publish-safe.mjs` (what is cut from each file), `skill/tools/glance.mjs`, `skill/tools/rival-facts.mjs`, `skill/tools/demand-facts.mjs`
- Privacy scan, masking, redaction: `skill/tools/privacy-scan.mjs`, `skill/tools/mask.mjs`, `skill/tools/pii.mjs`, `skill/tools/secret-rules.mjs`, `skill/tools/redact.mjs` (used by `facts.mjs find`, `canwe.mjs`, `pending-backend.mjs`)
- Hooks: `hooks/hooks.json`, `hooks/psst-summary.mjs`, `hooks/after-commit.mjs`, `hooks/never-check.mjs`, `hooks/cite-check.mjs`, `skill/tools/loaded.mjs`
- Install, doctor, MCP: `skill/tools/install.mjs`, `skill/tools/health.mjs`, `skill/tools/mcp.mjs`, `.claude-plugin/plugin.json`
- Entry point, `NOSY_OFFLINE`, command list: `skill/tools/nosy.mjs`
- Generated pages (no requests, system fonts): `skill/tools/build-page.mjs`, `skill/tools/scoreboard.mjs`
- Demand exports: `skill/tools/collect-signals.mjs`, `skill/tools/interview-themes.mjs`, `skill/tools/demand.mjs`
- Reading through git: `skill/tools/inventory.mjs`, `skill/tools/find-sources.mjs`
- The Action: `action.yml`
- Agent-side behavior: `agents/nosy-neighbor.md`, `agents/nosy-refuter.md`, `agents/nosy-auditor.md`, `skill/commands/neighbors.md`, `skill/commands/move-in.md`, `skill/commands/frontyard.md`, `skill/commands/tea.md`, `skill/commands/psst.md`, `skill/commands/spill.md`, `skill/rules.md`
- No dependencies: `package.json`
- Maintainer command that writes into the plugin: `skill/tools/dresscode.mjs`
