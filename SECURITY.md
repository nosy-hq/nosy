# Security

## Report a vulnerability

Use a private advisory: <https://github.com/nosy-hq/nosy/security/advisories/new>

Please don't open a public issue for a vulnerability. Include what you ran, what happened, and what you expected. We'll answer within a week and tell you when a fix ships.

## What Nosy does on your machine

Nosy is a plugin and a skill for your coding agent: plain Node scripts in `skill/tools/` with no npm dependencies, and no server component in this repo. The full list is in [`docs/DATA.md`](docs/DATA.md).

- **Reads.** Nosy reads your code, git history, GitHub issues and PRs including their text (titles, bodies, comments and author logins, through your own `gh`), your decision and roadmap docs, and public web pages.
- **Writes.** Nosy writes to your `pm/` folder, plus a few named files: temporary files, a first-run marker, the skill folders `nosy install` copies, a hand-built page of yours when you run `nosy page-adopt` (after a copy in `pm/.backup/`), a branch and pull request in your own repo when you run `nosy roadmap --pr --yes`, one fixed comment on each issue your merged PRs closed when you run `nosy ship-notes --yes`, an issue (or the changes to one you already have: an assignee, a label) and its project card in your own repo when you run `nosy handoff --yes`, a project board and its fields when you run `nosy handoff --setup-board --yes`, a status update on your GitHub project board when you run `nosy board-status --yes`, and files you name with a flag. The optional weekly GitHub Action commits and pushes `pm/state/` and the decision page only if you set `commit: "true"`.
- **Sends.** Nothing of yours leaves on its own. Nosy's network calls are reads: the public rival pages you listed (and, for rivals you configure, public counters through `nosy rival-signals`: GitHub, npm, Apple's app lookup and job-board APIs), and GitHub through your own `gh`, including a read-only lookup of the `#N` issues your agent's answer cites (`NOSY_CITE_GH=0` turns that off), and, when you run `nosy rival-demand`, the public issues and Discussions of the open-source rivals you name. `nosy notify` and `nosy publish` send something only when you run them, and `publish` is off until you configure a target and confirm (counts and structure, never quotes). Both stop on a secret or personal data unless you pass `--allow-sensitive`.
- **Hooks.** Four small Node hooks in `hooks/`: session summary, after-commit note, never-rule check, reference check. They read local files and run `git`; the reference check also runs the read-only `gh api` lookup above, and the session summary asks GitHub once a day for the public file `.claude-plugin/plugin.json` to say when a newer Nosy is out (a plain GET, nothing sent about you; `NOSY_NO_UPDATE_CHECK=1` turns it off). They never stop or undo a shell command. Two can hand the agent a note after the fact, and the reference check can send the agent back once to fix or drop a reference; that is text for the agent, not a block on your shell. The reference check gets the agent's last answer from Claude Code as a hook input field. It reads no transcript or chat history file. Each has an off switch ([docs/INSTALL.md](docs/INSTALL.md#f-turning-off-the-hooks)).
- **Your agent's tools.** Nosy asks the agent to use its own connectors (GitHub, Linear, Slack…) only after you say yes. Those run under your agent's permissions, not Nosy's.

Customer quotes are masked before Nosy prints or writes them, a secret in a line of your code is hidden when Nosy prints it, and a secret or personal data stops a send. What each covers, and what it doesn't, is in [`docs/DATA.md`](docs/DATA.md).

## Pin a release

`npx github:nosy-hq/nosy` runs whatever is on the default branch. Pin a release tag instead, for example `npx github:nosy-hq/nosy#v0.21.1 install`, and read the release notes before you move to a newer one. Do the same for a marketplace install in a shared or CI setup.

## Supported versions

The latest release. Older versions get fixes only if the problem is serious.

## Nosy Cloud

The plugin is free and MIT. Nosy Cloud (cloud.nosy.sh) is live and free for now: a shared record for your team. It never changes what the plugin does. What `nosy publish` sends to a Cloud you configured is listed in [`docs/DATA.md`](docs/DATA.md).
