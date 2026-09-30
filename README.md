<p align="center"><img src="docs/assets/banner.jpg" alt="Nosy was here. Nosy about your product. Never your data." width="100%"></p>

# 👀 Nosy

> Nosy about your product. Never your data.

Nosy is a product manager that lives inside your coding agent. It goes through your backend, your git history and your roadmap, checks what your rivals already shipped, and tells you what you can build next: sized, placed on the roadmap, with a receipt for every claim.

The plugin is free and MIT. Nosy Cloud (later) adds a shared record for your team; it never changes what the plugin does.

## Install

In Claude Code (terminal, desktop app, VS Code, JetBrains):

```
/plugin marketplace add nosy-hq/nosy
/plugin install nosy@nosy
```

Check it loaded: `claude plugin list` shows `nosy@nosy` as enabled. Then type `/nosy` in your repo: it looks at what's there and tells you the two or three things worth running first. Needs git and Node 18.17 or newer.

**First run.** `/nosy:move-in` runs once. It reads your README, docs, decision files, git history, and issues and PRs (through `gh`, if you have it). The counting scripts run on your machine with no model. It asks you at most three questions, plus one about your North Star number. The model work is your agent's session, plus up to 5 rival-research sub-agents (web search, cheaper model) and one refuter pass. How long that takes depends on repo size; we haven't measured it yet, so there is no number here.

Not Claude Code? Codex, Cursor, Gemini CLI, Copilot, MCP, CI: see [Other agents](#other-agents).

## What you get

*Illustration: product and numbers are made up.*

```
$ /nosy:canwe "bulk export"

Plain agent:  It reads the code as it is today and tells you what it finds.
              It doesn't know 23 customers asked, or that a rival shipped
              theirs on Tuesday, or where it fits your roadmap.

Nosy:         We can. POST /exports/bulk exists. No button.
              Missing: button, progress toast, 1 filter
              Size ~1 day · wave 2 · asked 23×
              Last asked 7 Sep: then "no endpoint yet".
```

Nosy isn't smarter than your agent. What it has is the record, the demand and the memory. A real run, on a public repo, is [further down](#on-a-real-repo).

**1 skill · 17 commands · 79 scripts · 4 hooks · 16 named rules** (`nosy explain` lists the rules, and says which a script checks and which are instructions). The counting is plain, dependency-free Node: it runs in your terminal, in CI or as an MCP server, with no model and no API key. Your agent adds the judgment on top. Everything Nosy remembers lives in a `pm/` folder in your repo.

## Other agents

<details>
<summary>Codex, Cursor, Gemini CLI, Copilot, OpenCode, Kiro, any MCP client, CI, terminal</summary>

Nosy is one skill folder (`skill/`, the open Agent Skills format) plus small dependency-free Node scripts. Same core everywhere. The first row is the default; the rest are for when you're not in Claude Code.

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

Codex CLI, Cursor and Gemini CLI can also run Nosy through the host-agnostic `AGENTS.md` at the repo root (plus a thin adapter for Cursor and Gemini CLI). Linear and Jira: `spill` writes the draft; if your agent has a Linear or Atlassian connector, Nosy offers to open the issue, only after you say so.

Details for every path: `docs/INSTALL.md`.

</details>

## Three directions, in order

1. **Inside.** Your backend, your git history, your roadmap. What shipped, what's half-built, what nobody wired up to a screen.
2. **Over the fence.** What the neighbours (competitors) shipped, only as a reason to act, never the whole story. Nosy builds the feature matrix itself: every rival against the same 25 steps, a public source in every cell, and "announced" kept apart from "shipped". Every line ends with "here's how much of that we already have."
3. **Ahead.** "We can do this." Nosy works out what you can do now by matching what actually shipped (git, backend) against what's still asked for (requests, issues, decisions, the gaps rivals exposed). Sized, placed in a wave on the roadmap, spec'd for your agents to build.

## While you build

Nosy doesn't wait for the weekly run. After each commit or merge it whispers what that change means for the product: *"This looks like it closes **bulk export**, which Acme and Globex already have. Mark it done; it goes in this week's landing roundup. Next product decision: SSO."* Silent when there's nothing new. Your landing page gets a weekly roundup, not a change per commit (every page change is a deploy): *"This week you shipped SSO, bulk export and audit filters. Put them on the page in one change?"*

And if a commit or PR adds something you put on your never list ("we don't send by fax", "no fake data"), your agent is told which rule and which line, before anything is pushed. It never blocks you; the rule is yours to change. Each of the four hooks has an off switch (`docs/INSTALL.md`, section f).

## If it broke

- **Something looks wrong or old:** run `/nosy:doctor`. It finds old file names and settings keys in your `pm/` folder and renames them (`--fix`), and tells you what to regenerate. Terminal: `nosy doctor`.
- **The install itself broke:** open your agent in this repo and say: *"Read AGENTS.md and docs/INSTALL.md, install Nosy for me."*
- **Uninstall (Claude Code):** `/plugin uninstall nosy@nosy`, then `/plugin marketplace remove nosy`. The commands and hooks go with it. To just pause it: `/plugin disable nosy`.
- **Uninstall (other agents):** `npx github:nosy-hq/nosy uninstall` removes only the skill folders `nosy install` wrote (each has a marker file). A `nosy` folder you made yourself is never touched.
- **What stays:** your `pm/` folder. It's yours; delete it by hand if you want it gone.

## What Nosy reads, what leaves your machine

- **Reads:** your code, git history, issue and PR metadata, your decision and roadmap docs, and public pages (rival sites, your own landing page).
- **Writes:** your `pm/` folder, plus a few named exceptions (temporary files, the skill folders `nosy install` writes, files you name with a flag), all listed in [`docs/DATA.md`](docs/DATA.md).
- **Sends:** Nosy sends nothing on its own. Every network call is one you start: it reads the public rival pages you listed, reads GitHub through your own `gh`, posts to the webhook you give `nosy notify`, or (`nosy publish`, off until you configure a target and confirm) sends counts and structure, never quotes, to a Nosy Cloud you configured. `publish` and `notify` stop on a secret or personal data unless you pass `--allow-sensitive`. The model call is your agent's own.

The exact list: [`docs/DATA.md`](docs/DATA.md).

## What Nosy is not, and when to skip it

| Skip Nosy if… | Why |
|---|---|
| You want a **code reviewer** | No comments on style, bugs or code quality. Ever. |
| You want a **competitor tracker** | Rivals are one input, checked second, after your own product. Nosy reads their public pages; it isn't an alert service. |
| The project has **no git history** | `peek`, `shipped` and `psst` read git. Without it there's little to count. (CI needs a full checkout: `fetch-depth: 0`.) |
| There's **no roadmap, no decision log, few issues** | Nosy can still count code and git, but it has nothing to compare them with. Rates built on fewer than 10 rows are withheld ("too few to say"), not shown low. |
| It's a **tiny or brand-new repo** | Thin history gives thin counts. Give it a few weeks of commits first. |
| You only have **claude.ai chat** | No git or repo access there, so the scripts don't run. Only `neighbors` and `spill` are useful (`docs/INSTALL.md`, section e). |
| You want it to **decide or act for you** | It suggests. It never edits your page, pushes, opens a PR or an issue, or sends a message unless you ask for that exact thing. |
| You want **customer data or analytics** | It never reads customer data, secrets or keys. It sees analytics event names, not events. Demand comes only from exports you drop into `pm/signal/`. |

## Commands

| Command | What it does |
|---|---|
| `/nosy:doctor` | Upgrading from an older Nosy? Finds old file names and settings keys in your `pm/` folder and renames them (`--fix`); tells you which files to regenerate. |
| `/nosy:map` | One page of what your product is made of: which apps are live, beta-only or retired, which screen is which code, what's deliberately off, where your site says more than the code does. Drafted from the code, confirmed by you; every command reads it first. |
| `/nosy:move-in` | Learns your product, rules and roadmap — your decision log can be one file or a folder of ADRs — then takes the first look: where you are, the matrix against rivals, cheap wins, the roadmap, your next product decision. Run once. |
| `/nosy:shipped` | The record: what reached your integration branch, when, and which decision or request each change was for, linked only where a PR, commit or issue says so. Plus what merged since last time and what's about to. |
| `/nosy:peek` | What shipped, what didn't, what has no screen. |
| `/nosy:psst` | What you could ship today, worked out by matching what shipped against what's still asked for — and when customers asked (support, interviews, surveys, issues), how often: "asked for + ready" goes first. Backend's ready, nobody built the button. Also: features you shipped that sit in no paid plan, and key steps (signup, activation, revenue) that fire no analytics event. |
| `/nosy:canwe <question>` | "Can we do X?" — answered with a size and how often customers asked for it (support, issues, and how many interviews raised it), and remembered: ask again next week and see what changed. |
| `/nosy:neighbors` | What rivals shipped — shipped, not just announced — and how much of it you already have. Builds the feature matrix for you: one row per step, one column per rival, a source in every cell; no spreadsheet to keep up. |
| `/nosy:overheard [hours]` | Which open PRs/issues serve which decision. Not code review. |
| `/nosy:spill <topic>` | A PRD your agents can build from. Stays local. |
| `/nosy:scoop` | The roadmap, in waves. |
| `/nosy:tea` | One shareable decision page. |
| `/nosy:dresscode` | Your design system, checked in 20 areas with a receipt for each. Tests whether an AI follows it or guesses. The 3–5 gaps that matter for what's next on your roadmap. Learns from your corrections. |
| `/nosy:frontyard` | Is your landing page behind? What you shipped that the page doesn't mention, what the page promises that the code doesn't have, and your pricing page against the plan gates in your code. Suggests, never edits. |
| `/nosy:stakeout` | The whole weekly loop: shipped → psst (checked by the refuter) → neighbors → scoop → score → frontyard (when due) → what changed → tea. Checks first whether its own inputs are stale, ends with what changed since last week. |

Not sure where to start? Type `/nosy` alone: it looks at your `pm/` folder and git and suggests the 2–3 commands worth running now, each with the reason.

Optional: `/nosy:bet` records a bet (what, why, your size estimate) and `/nosy:score` settles it against the record later: landed when, estimate vs actual, reverted or patched.

### In the terminal, no agent

The counting runs without a model (`npx github:nosy-hq/nosy <command>` or `node skill/tools/nosy.mjs <command>`); the judgement stays with your agent.

| Command | What it counts |
|---|---|
| `nosy doctor [--fix]` | An older `pm/` folder: what's out of date, and the renames (exit 2 while anything's left). |
| `nosy setup [repo]` | Proposes `pm/sources.json` for your repo (the script half of `move-in`). |
| `nosy` | What to run now: 2–3 suggestions with reasons, then every command. |
| `nosy shipped [7d]` | The record: what reached the integration branch, by decision or request, plus recent merges. |
| `nosy peek [7d]` | What shipped, from git. |
| `nosy inventory` | Every endpoint and whether a screen calls it (Go, Express, Fastify, Koa, Hono, FastAPI, Flask, Django, Rails). |
| `nosy gates` | Which recently shipped features sit behind a plan gate, and which don't. |
| `nosy metrics` | Whether signup, activation, revenue, referral and churn fire an analytics event — names only, never event data. |
| `nosy signals` | Demand from the exports you drop in `pm/signal/` (support, interviews, surveys, Intercom/Zendesk/Slack/Gong) and GitHub issues, matched to your own work; personal data masked. |
| `nosy interviews` | Interview and call notes in `pm/signal/interviews/` become themes: how many interviews raised each, masked quotes with file:line, matched to your matrix, roadmap or request doc — or flagged as a candidate. |
| `nosy psst` | The ranked list: all of the above plus stale requests, open issues, the team's own next notes and screens waiting on the backend; writes receipts for the top items. |
| `nosy refute pack` · `nosy refute apply` | psst's check: pack the draft for the refuter agent, apply its verdicts (dropped, corrected, kept). |
| `nosy decision` · `nosy nudge` | The one next product decision · what the last commit means for the product. |
| `nosy facts` · `nosy find <word>` · `nosy cite-check <answer.md>` · `nosy never-check` | The hard facts once · every place a word appears · every citation in an answer checked · the owner's never rules against a change. |
| `nosy frontyard [--page page.html]` | Shipped features vs. your landing page (in the repo, or a copy your agent fetched). |
| `nosy canwe "<question>"` | The evidence skeleton for "can we do X?". |
| `nosy notes [7d] [--for customer\|team\|manager]` | Release notes you can announce, per audience. |
| `nosy bet place "<what>"` · `nosy score` | Optional: record a bet, settle it from git. |
| `nosy page` · `nosy weekly` · `nosy notify` · `nosy mcp` | Decision page · the weekly loop · Slack/Discord "Psst…" · MCP server. |

## On a real repo

`metabase/metabase`, last 90 days, public issues and PRs only (28 Sep 2026):

- **190** feature requests opened. **4** shipped with a PR that links them, plus 1 partly.
- The headline shipped count is **withheld**: some Metabase work is linked only in issue comments. Until those are counted, the number would undercount, so Nosy doesn't show one.
- **At least 576** open requests have no decision yet: no assignee, no milestone, no decision label, older than two weeks. 267 of them sit with one team.

## Status

Early version, open source (MIT). Built for ourselves first: Nosy researches its own competitors with its own commands before anyone else uses it. Not yet published anywhere; no stability promise.
