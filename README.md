<p align="center"><img src="docs/assets/banner.jpg" alt="Nosy was here. Nosy about your product. Never your data." width="100%"></p>

# 👀 Nosy

> Nosy about your product. Never your data.

Nosy is a product manager that lives inside your coding agent. It goes through your backend, git history and roadmap, checks what your rivals shipped, and tells you what to build next: sized, placed on the roadmap, with a receipt for every claim.

The plugin is free and MIT. Nosy Cloud (cloud.nosy.sh) is live and free for now: a shared record for your team. It never changes what the plugin does. [See a sample report](https://cloud.nosy.sh/demo) (made-up data).

## Install

In Claude Code:

```
/plugin marketplace add nosy-hq/nosy
/plugin install nosy@nosy
```

Send the two commands one at a time. `claude plugin list` should show `nosy@nosy` enabled. Then type `/nosy` in your repo. Needs git and Node 18.17 or newer.

`/nosy:move-in` runs once and reads your README, docs, decision files, git history and issues and PRs (through `gh`, if you have it). The counting runs on your machine with no model. Time and tokens depend on the size of your repo; we haven't measured a typical number yet.

Not Claude Code? See [Other agents](#other-agents).

## A real run

On [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot), 30 Sep 2026, lines trimmed:

```
$ nosy canwe "retry failed webhooks"

In the code:
app/jobs/agent_bots/webhook_job.rb:3
  retry_on Webhooks::Trigger::RetryableError, wait: 3.seconds, attempts: 3
lib/webhooks/trigger.rb:3
  RETRYABLE_AGENT_BOT_STATUSES = [429, 500].freeze

Size from history: S · confidence: medium
```

Retries already exist for one kind of webhook (agent bots). Nosy hands your agent these lines to check first; the verdict is your agent's. This shows Nosy's output only, with no plain-Claude comparison. The full run and what it got wrong: [docs/EXAMPLE.md](docs/EXAMPLE.md). How we tested it, including where it lost: [docs/EVALS.md](docs/EVALS.md).

**1 skill · 17 commands · 80 scripts · 4 hooks · 16 named rules** (`nosy explain` lists the rules, and says which a script checks and which are instructions). The counting is plain, dependency-free Node: it runs in your terminal, in CI or as an MCP server, with no model and no API key. Your agent adds the judgment on top. Everything Nosy remembers lives in a `pm/` folder in your repo.

## Other agents

<details>
<summary>Codex, Cursor, Gemini CLI, Copilot, OpenCode, Kiro, any MCP client, CI, terminal</summary>

Nosy is one skill folder (`skill/`, the open Agent Skills format) plus small dependency-free Node scripts. The first row is the default.

| Where | How |
|---|---|
| **Claude Code** (default) | `/plugin marketplace add nosy-hq/nosy` then `/plugin install nosy@nosy` |
| **Any coding agent, one command** | In your project: `npx github:nosy-hq/nosy install`. One-command install: Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode, Kiro. It finds the ones your project uses and puts the skill in each one's folder. `nosy update` / `nosy uninstall` touch only what it wrote. Then type `/nosy` (Codex: `$nosy`). |
| **Windsurf, Roo, Junie…** | Works by copying the skill folder: `npx skills add nosy-hq/nosy` (or copy `skill/` into the agent's skills folder by hand), then ask "Nosy, psst" or `/nosy psst` |
| **Any MCP client** (Claude Desktop, Cursor, Zed, VS Code…) | `npx github:nosy-hq/nosy mcp` as a stdio server |
| **GitHub Actions** (weekly, no model key) | `uses: nosy-hq/nosy@main`, see `docs/examples/nosy-weekly.yml` |
| **Slack / Discord** | the Action (or `nosy notify`) posts the weekly "Psst…" to a webhook |
| **Terminal, no agent** | `npx github:nosy-hq/nosy weekly` |

`npx github:…` runs code straight from a repo. Pin a release tag to know which code you run: `npx github:nosy-hq/nosy#v0.15.0 install` (`docs/INSTALL.md`).

Details for every path: `docs/INSTALL.md`.

</details>

## Three directions, in order

1. **Inside.** Your backend, git history and roadmap. What shipped, what's half-built, what has no screen.
2. **Over the fence.** What rivals shipped, only as a reason to act. A public source in every cell; "announced" kept apart from "shipped".
3. **Ahead.** "We can do this." Sized, placed in a wave, spec'd for your agents.

## Commands

| Command | What it does |
|---|---|
| `/nosy` | Suggests the 2–3 commands worth running now. |
| `/nosy:move-in` | Learns your product, rules and roadmap. Run once. |
| `/nosy:shipped` | What reached your integration branch, and which decision each change was for. |
| `/nosy:peek` | What shipped, what didn’t, what has no screen. |
| `/nosy:psst` | What you could ship today. Asked for + ready goes first. |
| `/nosy:canwe <question>` | “Can we do X?” Answered with a size; remembered next week. |
| `/nosy:neighbors` | What rivals shipped, and how much of it you already have. |
| `/nosy:overheard [hours]` | Which open PRs and issues serve which decision. |
| `/nosy:spill <topic>` | A spec your agents can build from. Stays local. |
| `/nosy:scoop` | The roadmap, in waves. |
| `/nosy:tea` | One shareable decision page. |
| `/nosy:map` | What your product is made of: apps, screens, what’s off. |
| `/nosy:dresscode` | Your design system, checked in 20 areas, with a receipt for each. |
| `/nosy:frontyard` | Is your landing page behind the product, or ahead of it? |
| `/nosy:stakeout` | The whole weekly loop, ending with what changed. |
| `/nosy:bet · /nosy:score` | Optional: record a bet, settle it against git later. |
| `/nosy:doctor` | Upgrading from an older Nosy: renames old files and keys (`--fix`). |

Every command also runs from the terminal with no model: `npx github:nosy-hq/nosy <command>` (the list: [docs/CLI-CONTRACT.md](docs/CLI-CONTRACT.md)).

## If it broke

- **Install looks broken:** `npx github:nosy-hq/nosy doctor --check` checks Node, git, gh, the skill files and hooks, and prints the fix next to each failing line. Local, no network, writes nothing.
- **Something looks old:** `/nosy:doctor` renames old file names and keys in a `pm/` written by an older Nosy.
- **Still stuck:** open your agent in this repo and say: *"Read AGENTS.md and docs/INSTALL.md, install Nosy for me."*
- **Uninstall:** `/plugin uninstall nosy@nosy` (other agents: `npx github:nosy-hq/nosy uninstall`). Your `pm/` folder stays; it's yours.

## What Nosy reads, what leaves your machine

- **Reads.** Nosy reads your code, git history, GitHub issues and PRs including their text (titles, bodies, comments and author logins, through your own `gh`), your decision and roadmap docs, and public web pages. Bodies and comments are cut at 4,000 characters and saved in `pm/state/facts/github.json`. Support and interview exports are read only if you drop them into `pm/signal/`, with personal data masked.
- **Writes.** Nosy writes to your `pm/` folder, plus a few named files: temporary files, a first-run marker, the skill folders `nosy install` copies and files you name with a flag. The optional weekly GitHub Action commits and pushes `pm/state/` and the decision page only if you set `commit: "true"`. Every path is listed in [`docs/DATA.md`](docs/DATA.md).
- **Sends.** Nothing of yours leaves on its own. Nosy's network calls are reads: the public rival pages you listed, and GitHub through your own `gh`, including, after each agent answer, a read-only lookup of the `#N` issues the answer cites (turn that off with `NOSY_CITE_GH=0`, or turn the whole reference-check hook off with `NOSY_NO_CITE_CHECK=1`). `nosy notify` and `nosy publish` send something only when you run them, and `publish` is off until you configure a target and confirm (counts and structure, never quotes). `publish` and `notify` stop on a secret or personal data unless you pass `--allow-sensitive`. The model call is your agent's own.
- **No telemetry.** No analytics, usage pings, crash reports or update checks.

The exact list: [`docs/DATA.md`](docs/DATA.md).

## When to skip it

| Skip Nosy if… | Why |
|---|---|
| You want a **code reviewer** | No comments on style, bugs or code quality. Ever. |
| You want a **competitor tracker** | Rivals are one input, checked second. It isn't an alert service. |
| The project has **no git history**, or is brand new | Little to count. Rates on fewer than 10 rows are withheld, not shown low. |
| You only have **claude.ai chat** | No repo access there, so the scripts don't run (`docs/INSTALL.md`, section e). |
| You want it to **decide or act for you** | It suggests. It never edits your page, pushes, or opens issues unless you ask. |

## Status

Early version, open source (MIT). No stability promise yet. Questions and bugs: [issues](https://github.com/nosy-hq/nosy/issues).
