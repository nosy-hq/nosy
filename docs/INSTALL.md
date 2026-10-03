# Nosy · Install

Install, check it worked, fix it if not: the top section. The rest is reference, one heading per way to run Nosy. What Nosy reads, writes and sends: [DATA.md](DATA.md).

## a) Claude Code (terminal, desktop, VS Code, JetBrains): the default

In a Claude Code session, one command at a time:

```
/plugin marketplace add nosy-hq/nosy
/plugin install nosy@nosy
```

From the shell instead: `claude plugin marketplace add nosy-hq/nosy`, then `claude plugin install nosy@nosy`.

**Check it worked.** `claude plugin list` shows `nosy@nosy` enabled (or `/plugin` → the **Installed** tab). Typing `/` lists `/nosy:peek`, `/nosy:psst` and the rest. Then open your repo and run `/nosy:nosy`: it prints which version is loaded, then suggests what to run (in a repo with no `pm/`, `move-in` comes first).

**First run.** `move-in` sets the repo up and ends with the tour. To run the tour yourself, in a repo that is new to Nosy or one that already has a `pm/`, ask your agent for Nosy's tour (its command is named `tour`; Claude Code lists it with the other Nosy commands) or run `nosy tour` in a terminal. It starts by saying what Nosy reads, writes and never sends, shows the steps and which are already current, then asks its questions once (the map's, what the rival research costs in tokens, a send to Nosy Cloud) instead of one per step. It writes only inside `pm/`, and before it rewrites one of its own files it copies it to `pm/.backup/` (git-ignored by its own `.gitignore`).

**If it broke.** `npx github:nosy-hq/nosy doctor --check` checks Node, git, gh, the skill files, the hooks and `pm/sources.json`. It reads local files only, writes nothing, and prints the fix next to every failing line. It exits 2 on a hard failure. Plain `nosy doctor` is a different job: it finds old file names and keys in a `pm/` written by an older Nosy. `nosy doctor --fix` lists what it will change (only Nosy's own files inside `pm/`), copies what it rewrites to `pm/.backup/` and prints the undo line; `--fix --dry-run` only lists, and `nosy doctor --undo` puts it all back.

**Update.** Claude Code does not update a plugin from a GitHub marketplace for you, so you stay on the version you installed until you ask. In a session:

```
/plugin marketplace update nosy
/plugin update nosy@nosy
```

Then start a **new session** (the running one keeps the old files), and `/nosy:nosy` prints the version now loaded. Your `pm/` folder is not touched. If `update` isn't recognised in your Claude Code, `/plugin uninstall nosy@nosy` and `/plugin install nosy@nosy` do the same. From the shell: `claude plugin marketplace update nosy`, then `claude plugin update nosy@nosy`. A plugin you added from a folder on your machine (`/plugin marketplace add <path-to-nosy>`) is a copy of that folder as it was when you installed it: `git pull` in the folder first, then the two commands above. To have Claude Code refresh the marketplace on its own, turn on auto-update for `nosy` in `/plugin` → **Marketplaces**. A skill copied by `nosy install` (Codex, Cursor, Gemini CLI and the rest, section g) is updated with `npx github:nosy-hq/nosy update`, in each project where you ran it (plain `nosy update` re-copies from the Nosy you already have, so it would change nothing).

**Told when a newer one is out.** Claude Code: at session start the plugin asks GitHub, at most once a day, which version is the newest (one GET of the public file `.claude-plugin/plugin.json` in `nosy-hq/nosy`; nothing about you or your repo goes with it) and says one line when yours is older, at most once a day. Other agents have no hooks, so there the same line comes from the top-level skill: type `/nosy` (Codex: `$nosy`) with no command and it sits under the "Nosy X is loaded" lines whenever your copy is behind; the same once-a-day read, and `NOSY_NO_UPDATE_CHECK=1` turns it off there too. The plugin you have before this notice existed can't say it: update once by hand. Off: `NOSY_NO_UPDATE_CHECK=1` or "Turn off the update notice" in `/plugin configure nosy@nosy` (section f). What it sends, exactly: [DATA.md](DATA.md).

**Uninstall.** `/plugin uninstall nosy@nosy`, then `/plugin marketplace remove nosy`. Your `pm/` folder stays; delete it by hand if you want it gone.

**Requirements.** git and Node 18.17 or newer. The scripts use only Node's own modules, the global `fetch` and `readdirSync(…, { recursive })`; the last one sets the 18.17 floor. CI runs the tests on Node 18.17, 20 and 22. `gh` is optional: it adds issues and PRs to `peek`, `overheard` and `neighbors --gh`.

**From a local clone** (to try changes), give the clone's path instead of the repo name:

```
/plugin marketplace add <path-to-nosy>
/plugin install nosy@nosy
```

Other ways: [b) disable](#b-disable-or-remove) · [c) cloud sessions](#c-claude-code-on-the-web-and-cloud-sessions) · [d) scheduled runs](#d-scheduled-weekly-runs) · [e) claude.ai chat](#e-claudeai-chat-zip-upload) · [f) hooks](#f-turning-off-the-hooks) · [g) other agents](#g-other-coding-agents) · [h) terminal](#h-terminal-no-agent) · [i) MCP](#i-mcp-server) · [j) GitHub Action](#j-github-action-weekly) · [k) Slack and Discord](#k-slack-and-discord) · [l) Linear, Jira, GitHub issues](#l-linear-jira-github-issues) · [m) Share with your team](#m-share-with-your-team-optional)

## b) Disable or remove

- Turn off for now: `/plugin disable nosy`; back on: `/plugin enable nosy`.
- Remove: `/plugin uninstall nosy@nosy`, then `/plugin marketplace remove nosy` for a clean slate.

## c) Claude Code on the web and cloud sessions

A cloud session (claude.ai/code, routines, the mobile app, `claude --cloud`) does not load plugins installed on your machine, according to Claude Code's plugin docs. There, `/nosy:<command>`, the four hooks and the three agents (`nosy-neighbor`, `nosy-auditor`, `nosy-refuter`) do not exist. Nosy still works through the skill's fallbacks (`skill/SKILL.md`, "Works in every agent"): the agent researches rivals and runs the refuter pass itself.

A skill committed to the repo at `.claude/skills/nosy/` does load there, and the command becomes `/nosy peek`, `/nosy psst` (a space, not a colon; bare `/nosy` works there too, because it is a skill, not a plugin). The simplest way to get it is `nosy install` ([g](#g-other-coding-agents)); commit the folder it creates.

## d) Scheduled weekly runs

Nosy creates no schedule for you. The [GitHub Action](#j-github-action-weekly) runs the counting only. For the full loop (rivals, PRD, roadmap), schedule an agent session yourself:

- **Local, in the Claude desktop app (recommended).** A scheduled task runs on your machine, so the plugin, your repo and your connectors are there. Make the prompt self-contained: `cd <repo>` → `freshness` → `nosy weekly --pm pm --since 7d` (`--short` for shipped → score → page) → `diff save` and `diff` → one `log.md` entry → commit only the `pm/` files it changed, by path → a short summary to you. Click **Run now** once so the tool approvals it needs (git, WebFetch) are saved.
- **Claude Code routine (cloud).** No plugin there (see c), so the prompt goes through the project skill: *"Use the Nosy skill: run peek → psst → neighbors → scoop → tea in order, and end with an entry in log.md (including tool gaps)."*

## e) claude.ai chat (zip upload)

1. `node packaging/claude-ai-zip.mjs` writes `dist/nosy-skill.zip` (a `nosy/` folder at the zip root; `skill/` is only copied).
2. In claude.ai, upload it under Skills in Settings.
3. claude.ai chat has no git or repo access, so the `skill/tools/*.mjs` scripts do not run there. Still useful: `neighbors` (web search only), `spill` (paste the evidence into chat), and `scoop` with pasted status, weakly. Not useful: `peek`, `psst`, `overheard`, which read git history or `gh`.

## f) Turning off the hooks

Each of the four hooks has a plugin option (`/plugin configure nosy@nosy`) and an environment variable. In Claude Code, the environment variable wins. The update notice is part of the opening-summary hook and has a switch of its own: "Turn off the update notice" or `NOSY_NO_UPDATE_CHECK=1`. Turning off the opening summary (`NOSY_NO_PSST=1`) turns it off too.

| Hook | What it does | Option | Env var |
|---|---|---|---|
| Opening summary | One "Psst…" line at session start. | "Turn off the opening summary" | `NOSY_NO_PSST=1` |
| After-commit nudge | After `git commit`, `merge` or `pull` (and a `gh pr merge` once it reaches your checkout): which matrix gap the commit may close, the next product decision, the next command. Silent when nothing is new. | "Turn off the after-commit nudge" | `NOSY_NO_NUDGE=1` |
| Never-rule check | After `git commit` or `gh pr create`: matches the added lines, and the command itself, against `preread.never` in `pm/sources.json`. On a match it tells the agent which rule and where, before anything is pushed. It never blocks or undoes. | "Turn off the never-rule check" | `NOSY_NO_NEVER_CHECK=1` |
| Reference check | When the agent finishes an answer (Claude Code hands the hook that answer as an input field; no transcript or chat history file is read), or writes a markdown file, in a repo with `pm/sources.json`: checks every `file:line`, quote, commit and `#N` against the repo and GitHub. If one doesn't hold up, the agent is sent back once to fix or drop it. | "Turn off the reference check" | `NOSY_NO_CITE_CHECK=1` (whole hook), `NOSY_CITE_GH=0` (keep local checks, skip GitHub) |

After one `git commit`, two hooks may speak, in this order: the never-rule check (only on a match), then the nudge.

Two hooks reach the network on their own. The reference check: for each `#N` it runs a read-only `gh api repos/<issue.repo>/issues/<N>` through your own `gh`, when `pm/sources.json` names `issue.repo`. Without Claude Code: `nosy cite-check <answer.md> --gh`. And the update notice (above): one GET a day of a public version file. Both have switches.

**The never-rule check without Claude Code.** `nosy never-check` reads the staged changes (`--last-commit`, `--base <ref>` for a branch, `--worktree`) and exits 2 on a match. As a plain git hook it works in any agent, or none: `nosy git-hooks install` writes it (with the nudge) for you, or put `node <path-to-nosy>/skill/tools/never-check.mjs pm` in `.git/hooks/pre-commit`. A git hook that exits non-zero does stop the commit; that is your choice to make. The plugin hook never does.

To turn off all of it: `/plugin disable nosy`.

## g) Other coding agents

One command covers Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode and Kiro. Windsurf, Roo and Junie work by copying the skill folder (`npx skills add nosy-hq/nosy`, or by hand into the agent's skills folder). The core is agent-independent: `skill/tools/*.mjs` is dependency-free Node, and only the packaging differs.

From your project's folder:

```
npx github:nosy-hq/nosy install              # or, from a clone: node <path-to-nosy>/skill/tools/nosy.mjs install
```

It looks for the agents the project uses (a `.claude/`, `.cursor/`, `.gemini/`, `.opencode/` or `.kiro/` folder, `AGENTS.md` or `.codex/` for Codex, `.github/copilot-instructions.md` for Copilot) and copies the skill into each one's skills folder: `.claude/skills/nosy`, `.agents/skills/nosy`, `.cursor/skills/nosy` and so on. If it finds none, it installs for Claude Code and the shared `.agents/` folder. It copies rather than links (the npx cache is temporary, and a cloud session reads what is committed), leaves out `skill/test/`, and writes a marker file (`.nosy-install.json`) into each copy. Then type `/nosy` (Codex: `$nosy`), or ask "Nosy, psst".

`npx github:…` runs a repo's code on your machine. Pin a release tag to say which code (replace with the latest release tag); without `#<tag>` you get the default branch as it is right now:

```
npx github:nosy-hq/nosy#v0.20.0 install
```

- `--providers claude,codex,cursor,gemini,copilot,opencode,kiro` chooses; `--dry-run` shows first; `--global` uses your user folder (Claude Code `~/.claude/skills`, Codex `~/.agents/skills`).
- **What you don't get outside Claude Code, and what stands in for it.** Only Claude Code's plugin has hooks. In the other agents: the after-commit nudge and the never-rule check come from `nosy git-hooks install`, run once in the repo: `nosy install --git-hooks` does it together with the install (and `nosy uninstall` removes it again); it writes plain git hooks (`post-commit` and `post-merge`; a hook you already have is kept and ours is added to it, a hook that isn't a shell script is left alone), and what they print comes back in the result of `git commit` and `git pull`, whichever agent ran it, or a person. They only print, never fail a commit, send nothing, and run only where `pm/sources.json` exists. `nosy git-hooks status` shows them, `nosy git-hooks uninstall` removes only our block, `NOSY_NO_GIT_HOOKS=1` silences one run. The opening summary and the "newer Nosy is out" line are what `/nosy` (Codex: `$nosy`) with no command prints; the reference check is `nosy cite-check <answer.md> --gh`; the three sub-agents are spec files the skill tells your agent to follow itself (`agents/`).
- `nosy update` refreshes every copy it made; `nosy uninstall` removes them. Both touch only folders with the marker, so a `nosy` folder you made yourself is never overwritten or removed.
- It changes no settings file and adds no hooks; the Claude Code plugin ([a](#a-claude-code-terminal-desktop-vs-code-jetbrains-the-default)) adds `/nosy:<command>` and the hooks. It refuses to run inside Nosy's own repo. Exit 0 done or nothing to do, 1 couldn't run ([CLI-CONTRACT.md](CLI-CONTRACT.md)).
- Without an Artifact tool, `tea` writes `pm/status-page.html`; without sub-agents, `neighbors` researches rivals in sequence; without a session-start hook, "Psst…" is said in the first message.

`AGENTS.md` at the repo root is the agent-neutral entry point: the command table and rule summary, with each command linking to `skill/commands/<name>.md`. To work on Nosy itself with another agent, Codex reads `AGENTS.md` from the repo root, Cursor reads `.cursor/rules/nosy.mdc` (which points to `AGENTS.md`) and Gemini CLI reads `AGENTS.md` through `.gemini/settings.json`. Any other agent: have it read `AGENTS.md` and apply one of the commands. `node skill/tools/audit-package.mjs` checks the local links in `AGENTS.md` and the adapters, and that its command list matches `skill/SKILL.md`.

## h) Terminal, no agent

The counting needs no model, so this works with no agent and in CI. Most commands have a terminal twin (some under another name, and five are agent only): the table is in [CLI-CONTRACT.md](CLI-CONTRACT.md). `--pm <folder>` or `NOSY_PM` picks the pm folder (default `./pm`).

```
npx github:nosy-hq/nosy help        # or: node skill/tools/nosy.mjs help
nosy setup .                        # proposes pm/sources.json (once)
nosy tour                           # what Nosy reads, writes and sends; the steps; one list of questions
nosy shipped 7d                     # what landed, for which decision, + merged recently / close to merging
nosy bet place "bulk export" --why "30 customers asked" --estimate S   # prints Bet: nb-… for the PR
nosy score                          # settles every bet from git
nosy weekly                         # shipped → score → page  (--all: + inventory, psst, rival watch)
nosy notify --dry-run               # prints this week's Psst… message
```

## i) MCP server

Exposes Nosy's counting as tools to any MCP client (Claude Desktop, Cursor, Zed, VS Code): `nosy_psst`, `nosy_canwe`, `nosy_peek`, `nosy_inventory`, `nosy_evidence`, `nosy_ledger`. They read your repo and write under `pm/` (mostly `pm/state/`). `nosy_publish` is the one outward tool: it only lists what it would send unless the call says `confirm: true`; then it sends counts and structure, never quotes, to the Nosy Cloud you configured.

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

The client doesn't know which folder to start the server in, so `NOSY_PM` must be an absolute path, and so must `repo` in `sources.json`.

## j) GitHub Action (weekly)

No model key. The Action runs the counting (`nosy weekly`), writes a summary to the job page and optionally posts to Slack or Discord. Only with `commit: "true"` does it commit `pm/state/` and `pm/page.html` and push. `pm/state/` can hold issue and PR text (`pm/state/facts/github.json`, see [DATA.md](DATA.md)), so the example workflow leaves `commit` off. Copy `docs/examples/nosy-weekly.yml` to `.github/workflows/nosy.yml` in the product's repo.

1. Once, locally, run `nosy setup .` and commit `pm/sources.json`. In CI the `repo` path is rewritten to the working folder; that change is not committed.
2. Checkout needs `fetch-depth: 0` (`peek` reads git history).
3. For a durable decision page: set `commit: "true"` (read the note above first), turn on GitHub Pages, and pass the address as `page-url` so the message links it.

The full agent loop (rivals, PRD, roadmap) does not run in the Action; see [d](#d-scheduled-weekly-runs).

## k) Slack and Discord

Send only; Nosy never reads chat. Create an incoming webhook in your channel settings and keep it as a secret:

```
nosy notify --slack "$NOSY_SLACK_WEBHOOK" --discord "$NOSY_DISCORD_WEBHOOK"
```

The message has this week's commit and PR counts, the top 3 things that could ship today, and an "Announceable (for marketing)" section built from git. The privacy scan runs first; on a secret or personal data the message does not go out (`--allow-sensitive` overrides it, after you have read what it found). `nosy notify --dry-run` shows the message and says whether a real send would stop.

## l) Linear, Jira, GitHub issues

Nosy has no connector of its own. `spill` writes its draft to `pm/prd/`; if your agent has a Linear, Atlassian or GitHub connector, it shows the draft and asks before opening anything.

## m) Share with your team (optional)

`nosy publish` sends counts and structure of `pm/` (never quotes) to a Nosy Cloud dashboard, so your team can open it. It does nothing until you configure a target and say yes. What goes, key by key: [DATA.md](DATA.md).

1. Set the address once: `cloud.url` in `pm/sources.json`, or `NOSY_CLOUD_URL`, or `--url <address>`.
2. Make a token on the dashboard (**Connect your agent**, then **Make a token**). Save it in a text file that only you can read, so it never sits in a command line, your shell history or a chat: `~/.config/nosy/token` (`$XDG_CONFIG_HOME/nosy/token` if you set that), then `chmod 600` on it. A file that other users can read is refused and nothing is sent.
3. `nosy publish --dry-run` lists the files that would go and connects to nothing (`--full` prints them).
4. `nosy publish --yes` sends them. It looks for the token in `NOSY_CLOUD_TOKEN`, then `--token-file <path>`, then `NOSY_CLOUD_TOKEN_FILE`, then the default file above.

After the send it prints what the dashboard says it read, for example the matrix as areas by rivals. If the dashboard drew no matrix, it says so and exits 1: the files arrived, but the page is not what you meant to publish. A secret or personal data in the files stops the send (`--allow-sensitive` overrides it, after you have read what it found).
