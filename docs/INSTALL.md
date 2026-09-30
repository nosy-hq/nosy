# Nosy · Install

Short and exact. For detailed brand/voice, see `pm/name/brand-kit.html`; for what the commands do, `skill/SKILL.md`.

## a) Claude Code (terminal, desktop, VS Code, JetBrains): the default path

In a Claude Code session:

```
/plugin marketplace add nosy-hq/nosy
/plugin install nosy@nosy
```

From the shell instead: `claude plugin marketplace add nosy-hq/nosy` and `claude plugin install nosy@nosy`.

**Verify:** `claude plugin list`, or in a session `/plugin` → the **Installed** tab. You want `nosy@nosy`, status "enabled". Typing `/` shows `/nosy:peek`, `/nosy:psst` … in the command list. Then open your repo and type `/nosy`.

**Uninstall:** `/plugin uninstall nosy@nosy`, then `/plugin marketplace remove nosy`. The commands, agents and hooks go with the plugin. Your `pm/` folder stays; it's yours, delete it by hand if you want it gone. More in (b).

**Requirements:** git, and Node 18.17 or newer. The scripts use only Node's own modules (`fs`, `path`, `child_process`, …), the global `fetch` and `readdirSync(…, { recursive })`; the last one is what sets 18.17 as the floor. Nosy is developed and run on Node 22. Node 18 and 20 have not been run against the full test suite yet, so treat 18.17 as "should work", not "tested". `gh` is optional: it adds issues and PRs to `peek`, `overheard`, `neighbors --gh`.

Installing from a local clone (to try changes, or before the repo is public): the same two commands, with the clone's path where the repo name was:

```
/plugin marketplace add <path-to-nosy>
/plugin install nosy@nosy
```

**The actual invocation name is `/nosy:<command>`** (`/nosy:peek`, `/nosy:psst`, `/nosy:canwe`, `/nosy:move-in`, and the rest of the 17). Claude Code namespaces every plugin component under the plugin name; there's no such thing as a bare `/peek` command. The "just `/peek`" examples in the brand kit are marketing simplification — the real command comes with a colon.

## b) Uninstall / disable

- Temporary disable (commands, agents, hook temporarily disappear): `/plugin disable nosy`, to turn back on `/plugin enable nosy`.
- Full removal: `/plugin uninstall nosy@nosy`. If it was installed at project scope (for everyone), Claude Code asks whether to "disable just for me" or "remove for everyone."
- Removing the marketplace too (to try a clean slate): `/plugin marketplace remove nosy`.

## c) Claude Code on the web / cloud sessions

**Important correction:** A cloud session (claude.ai/code, routines, the mobile app, `claude --cloud`) does NOT load the plugin you installed on your own machine — and it works the same way even if your repo's `.claude/settings.json` shows the plugin as on. Official docs: *"A cloud session ... doesn't load the plugins you installed on your own machine or the ones your repository's `.claude/settings.json` turns on."* (code.claude.com/docs/en/plugins/install). So in the cloud, plugin commands like `/nosy:peek`, the `hooks/hooks.json` opening summary, and `agents/nosy-neighbor.md` / `agents/nosy-auditor.md` / `agents/nosy-refuter.md` (and the other hooks: the after-commit nudge, never-check, cite-check) do NOT exist. Nosy still works there through the skill's fallbacks (SKILL.md, "Works in every agent"): the agent researches rivals itself and runs the refuter pass itself.

The one thing that does auto-load in the cloud (and in routines) is a **project skill** committed to the repo: `.claude/skills/<name>/SKILL.md`. Since `skill/SKILL.md` is already written with `name: nosy` and "Usage: `/nosy <move-in|peek|psst|...>`", if you also make the skill visible this way, the command in the cloud becomes `/nosy peek`, `/nosy psst` ... (a space-separated subcommand; different from the plugin's `/nosy:peek` form, no colon).

If you want to turn this on (NOT DONE in this task, description only — to follow the "generate files only" rule and not touch `skill/`): without moving `skill/`, create a symlink at the root and commit it:

```
ln -s ../../skill .claude/skills/nosy
git add .claude/skills/nosy
```

That way the same `skill/` content is read both locally and in the cloud, with no duplicate copy. **Known limit:** whether the cloud sandbox follows a symlinked skill folder could not be verified in this task (no `claude` CLI or cloud session access was available in this environment) — you'll need to try it in a real cloud session.

## d0) Scheduled weekly run in the Claude desktop app (local, recommended)

The desktop app's **Scheduled** tasks run on your machine, so the installed plugin, your repo and your connectors are all there (no cloud limits from c). Nosy's own repo uses this: every Monday 09:00, the task `nosy-weekly-stakeout` runs.
1. Ask Claude in the desktop app: "schedule Nosy's weekly cycle for <repo> every Monday at 9" (or Sidebar → Scheduled → New).
2. The prompt should be self-contained: `cd <repo>` → `freshness` → `nosy weekly --pm pm --since 7d` (inventory → shipped → psst → score if bets → rival watch → page; `--short` for shipped → score → page) → `diff save` + `diff` → one `log.md` entry → commit only the `pm/` files it changed, by explicit path → a short summary back to you.
3. Click **Run now** once while you're at the computer, so the tool approvals it needs (git, WebFetch) are saved for later runs.
It runs while the app is open; a run missed while the app was closed runs at the next launch.

## d) Scheduled routine for the weekly `stakeout` (description only — not created)

Anthropic's "Routines" feature: set up from claude.ai/code/routines, or with `/schedule` in the CLI; it connects to a repo and you pick a trigger (Scheduled: hourly/daily/weekly, or a GitHub webhook). For Nosy:

1. claude.ai/code/routines → **New routine** → repo: `nosy` (after it's merged to main).
2. Trigger: **Scheduled → Weekly**, pick a day/time (local time, converted automatically).
3. The prompt needs to account for the cloud limit from item (c) — there are no plugin commands, so either go through the project skill (`/nosy stakeout`) or use a plain instruction: *"Use the Nosy skill: run peek → psst → neighbors → scoop → tea in order, and end with an entry in log.md (including tool gaps)."*
4. Save.

Per the rules for this task, it did NOT create a scheduled task or cloud routine; the above is description only.

## e) Uploading a zip to claude.ai (chat)

1. `node packaging/claude-ai-zip.mjs` → produces `dist/nosy-skill.zip` (a `nosy/` folder at the zip root; `skill/` is untouched, only copied).
2. claude.ai → **Settings → Customize → Skills → Upload skill** → pick the zip.
3. claude.ai has no git, and its Node runtime isn't like Claude Code's: the `tools/*.mjs` scripts do NOT run there.
   - **Still useful:** `neighbors` (web search only), `spill` (if you paste the evidence into chat), partially `scoop` (with pasted status, weak).
   - **Not useful:** `peek`, `psst`, `overheard` — all three read git history and/or `gh` (issues/PRs); claude.ai has no repo access.

## f) Turning off the hook

- To silence just the opening summary and keep the commands/agents: in a session, `/plugin configure nosy@nosy` → check **"Turn off the opening summary."** Equivalent env var: `NOSY_NO_PSST=1`.
- After one `git commit`, two hooks may speak, in this order: the never-rule check (only when a rule matches) and the after-commit nudge.
- The after-commit nudge (after `git commit`/`merge`/`pull`; a `gh pr merge` speaks once the merge reaches your checkout: which matrix gap the commit may close, the next product decision, the next command; silent when there's nothing new): `/plugin configure nosy@nosy` → **"Turn off the after-commit nudge."** Env var: `NOSY_NO_NUDGE=1`.
- The never-rule check (after `git commit` or `gh pr create`: the added lines are matched against `pm/sources.json` `preread.never`, and the git/gh command itself too; on a match the agent is told which rule and where, so it can tell you before anything is pushed; it never blocks or undoes): `/plugin configure nosy@nosy` → **"Turn off the never-rule check."** Env var: `NOSY_NO_NEVER_CHECK=1`.
- The reference check (when the agent finishes an answer, or writes a markdown file (with Write/Edit or from the shell), in a repo with `pm/sources.json`: every `file:line`, quote, commit and `#N` in it is checked against the repo and GitHub; if one doesn't hold up the agent is sent back once to fix or drop it): `/plugin configure nosy@nosy` → **"Turn off the reference check."** Env vars: `NOSY_NO_CITE_CHECK=1`; `NOSY_CITE_GH=0` skips the GitHub part. Without Claude Code: `nosy cite-check <answer.md> --gh`.
- **The same check without Claude Code:** `nosy never-check` reads the staged changes (`--last-commit`, `--base <ref>` for a branch, `--worktree`) and exits 2 on a match. As a plain git hook it works in any agent, or none: put `node <path-to-nosy>/skill/tools/never-check.mjs pm` in `.git/hooks/pre-commit`. A git hook that exits non-zero does stop the commit; that's your choice to make, the plugin hook never does.
- To disable the whole plugin, use `/plugin disable nosy` from item (b).

## g) Other coding agents

The owner's decision from Sep 28: "technically this should work in other plugins too." The `skill/tools/*.mjs` scripts are already dependency-free, agent-independent Node; the only real gap was packaging. The root **`AGENTS.md`** is the host-agnostic entry point: the product description, the command table (each row links to `skill/commands/<name>.md`) and the rule summary live there, from a single source. The one requirement across every path: **Node 18.17 or newer + git** (see (a); optionally `gh`, for commands that read PRs/issues — `overheard`, `peek`, `neighbors --gh`). To double-check the scripts work: `node skill/tools/audit-package.mjs` (checks the local links in AGENTS.md and the adapters, and that the command list matches SKILL.md).

- **Codex CLI** — verified ([developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md), read 2026-09-28): Codex automatically reads `AGENTS.md` in every folder from where it's run up through the git root; a single file at the repo root is enough, no separate setup step. This repo already has a root `AGENTS.md` — no extra file needed. If you want, you can also wire `skill/SKILL.md` into Codex's own skill mechanism: add the path to SKILL.md and `enabled = true` to `~/.codex/config.toml`, then restart Codex ([developers.openai.com/codex/skills](https://developers.openai.com/codex/skills), read 2026-09-28; the command is invoked with a mention like `$nosy`) — this step is optional and was not set up in this task (it's a user config file, no file was added to the repo).
- **Cursor** — verified ([cursor.com/docs/context/rules](https://cursor.com/docs/context/rules), read 2026-09-28): project rules live under `.cursor/rules/*.mdc`, with YAML frontmatter (`description`, `alwaysApply`). This repo has `.cursor/rules/nosy.mdc` (`alwaysApply: false`, kicks in only on Nosy-related requests); it doesn't repeat content, it points to `AGENTS.md` and `skill/commands/*.md`. No extra setup — Cursor reads this file on its own once the repo is cloned.
- **Gemini CLI** — verified ([geminicli.com/docs/cli/gemini-md](https://geminicli.com/docs/cli/gemini-md/), [geminicli.com/docs/reference/configuration](https://geminicli.com/docs/reference/configuration/), read 2026-09-28): at the project root, the `context.fileName` field in `.gemini/settings.json` determines which file (default `GEMINI.md`) is read as context. This repo's `.gemini/settings.json` is set to `{"context":{"fileName":["AGENTS.md","GEMINI.md"]}}`, so Gemini CLI reads the root `AGENTS.md` directly. No extra setup.
- **General (any agent that reads `AGENTS.md`)** — a separate file format for other tools wasn't researched (unverified); if yours has its own `--read`/convention file, point it at the root `AGENTS.md`. For an agent with no special integration, the simplest path: at the start of the session, have the agent read `AGENTS.md` and say "apply one of the commands in here."

This section doesn't change sections (a)-(f); it only adds to them.

## h0) One command for the agents Nosy knows: `nosy install`

One-command install: Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode, Kiro. Works by copying the skill folder (section h below, or by hand into the agent's skills folder): Windsurf, Roo, Junie.

From your project's folder:

```
npx github:nosy-hq/nosy install              # or, from a clone: node <path-to-nosy>/skill/tools/nosy.mjs install
```

It looks for the agents the project uses (a `.claude/`, `.cursor/`, `.gemini/`, `.opencode/` or `.kiro/` folder, `AGENTS.md` or `.codex/` for Codex, `.github/copilot-instructions.md` for Copilot) and copies the skill to each one's skills folder: `.claude/skills/nosy`, `.agents/skills/nosy`, `.cursor/skills/nosy`, … With none found, it installs for Claude Code and the shared `.agents/` folder. It copies rather than links (the npx cache is temporary; a cloud session reads what's committed), leaves out `skill/test/`, and writes a marker file (`.nosy-install.json`) into each copy.

Pin a release, not the moving branch. `npx github:…` fetches a repo and runs its code on your machine, so say which code:

```
npx github:nosy-hq/nosy#v0.15.0 install       # a tag; replace with the latest release tag
```

Without `#<tag>` you get the default branch as it is right now.

- `--providers claude,codex,cursor,gemini,copilot,opencode,kiro` to choose; `--dry-run` to see first; `--global` for the user folder (Claude Code `~/.claude/skills`, Codex `~/.agents/skills`).
- `nosy update` refreshes every copy it made. `nosy uninstall` removes them. Both touch only folders with the marker: a `nosy` folder you put there yourself is never overwritten or removed.
- It changes no settings file and adds no hooks. In Claude Code the plugin (section a) adds `/nosy:<command>` commands and the hooks. It refuses to run inside Nosy's own repo, whose `skill/` is the source.
- Exit: 0 done or nothing to do, 1 couldn't run (`docs/CLI-CONTRACT.md`).

## h) The standard installer for other agents: `npx skills add`

Nosy's core is the `skill/` folder, in the open Agent Skills format. The standard installer finds it and drops it into every agent's folder (tried locally on Sep 28: found 1 skill, installed into `.agents/skills/nosy` and 50+ agent folders):

```
npx skills add nosy-hq/nosy            # once the repo is on GitHub
npx skills add <path-to-nosy>          # from local
npx skills add <path-to-nosy> -a '*' --copy -y   # into every agent, without asking
```

Codex, Cursor, Gemini CLI, Copilot and OpenCode all read the shared `.agents/skills/` folder. Invocation: `/nosy psst` or a plain sentence like "Nosy, psst".

The fallback for the three Claude-specific things is written in `skill/SKILL.md`: without an Artifact, the page becomes `pm/status-page.html`; without a sub-agent, `neighbors` researches rivals in sequence; without a session-start hook, "Psst…" is said in the first message.

## i) Model-free command line: `nosy`

The counting needs no model (counting in the script, judgment in the agent). Works with no agent too, and in CI:

```
npx github:nosy-hq/nosy help        # or: node skill/tools/nosy.mjs help
nosy setup .                        # proposes pm/sources.json (once)
nosy shipped 7d                     # the record: what landed, for which decision, + merged recently / close to merging
nosy bet place "bulk export" --why "30 customers asked" --estimate S   # prints Bet: nb-… for the PR
nosy score                          # settles every bet from git
nosy weekly                         # shipped → score → page  (--all: + inventory, psst, rival watch)
nosy notify --dry-run               # prints this week's Psst… message
```

`--pm <folder>` or `NOSY_PM` picks the pm folder (default `./pm`).

## j) MCP server

Exposes Nosy's counting as tools to any MCP-capable client (Claude Desktop, Cursor, Zed, VS Code, ChatGPT desktop): `nosy_psst`, `nosy_canwe`, `nosy_peek`, `nosy_inventory`, `nosy_evidence`, `nosy_ledger`. They read your repo and write under `pm/` (mostly `pm/state/`). `nosy_publish` is the one outward tool: it only lists what it would send unless the call says `confirm: true`, and then sends counts and structure, never quotes, to the Nosy Cloud you configured. `publish` and `notify` stop on a secret or personal data unless you pass `--allow-sensitive`.

```json
{
  "mcpServers": {
    "nosy": {
      "command": "node",
      "args": ["/path/to/nosy/skill/tools/nosy.mjs", "mcp"],
      "env": { "NOSY_PM": "/absolute/path/to/your-repo/pm" }
    }
  }
}
```

Since the client doesn't know which folder to start the server in, `NOSY_PM` must be an absolute path (as must `repo` in `sources.json`).

## k) GitHub Action (weekly, free)

No model key needed: the Action only runs the counting (`nosy weekly`), writes a summary to the job page, optionally posts to Slack/Discord, and commits `pm/state/` + `pm/page.html`. Example workflow: `docs/examples/nosy-weekly.yml` → `.github/workflows/nosy.yml` in the product's repo.

1. Once, locally, run `nosy setup .` and commit `pm/sources.json`. (In CI the `repo` path is automatically rewritten to the working folder; that change isn't committed.)
2. `fetch-depth: 0` is required at checkout (peek reads git history).
3. If you want a durable decision page: set `commit: "true"` and turn on GitHub Pages in the repo settings; give the page address via `page-url` and the message will include a link.

The full agent loop (rivals, PRD, roadmap) doesn't run in the Action; for that, use the routine from (d) or an agent session.

## l) Slack and Discord

Only sends, never reads chat (wave 4a). Get an "incoming webhook" address from your channel settings and keep it as a secret:

```
nosy notify --slack "$NOSY_SLACK_WEBHOOK" --discord "$NOSY_DISCORD_WEBHOOK"
```

Message: how many commits/PRs this week, the top 3 things that could ship today, an "Announceable (for marketing)" section (from git, `write-notes --audience customer`). Before sending, `privacy-scan` runs; if it sees a secret or personal data, the message doesn't go out (`--allow-sensitive` overrides it, after you have read what it found). `nosy notify --dry-run` shows the message and says if a real send would stop.

## m) Linear, Jira, GitHub issues

Nosy has no connector of its own. `spill` writes its draft to `pm/prd/`; if the agent has a Linear, Atlassian or GitHub connector, it shows the draft and asks "shall I open it?" — it never opens one without approval.
