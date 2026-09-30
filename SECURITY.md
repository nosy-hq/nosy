# Security

## Report a vulnerability

Use a private advisory: <https://github.com/nosy-hq/nosy/security/advisories/new>

Please don't open a public issue for a vulnerability. Include what you ran, what happened, and what you expected. We'll answer within a week and tell you when a fix ships.

## What Nosy runs on your machine

Nosy is a plugin and a skill for your coding agent. There is no server component in this repo and nothing to install beyond Node.

- **Scripts.** Plain Node scripts in `skill/tools/`, with no npm dependencies. Nosy reads your code, git history, GitHub issues and PRs including their text (titles, bodies, comments and author logins, through your own `gh`), your decision and roadmap docs, and public web pages. Nosy writes to your `pm/` folder, plus a few named files: temporary files, a first-run marker, the skill folders `nosy install` copies and files you name with a flag. The optional weekly GitHub Action commits and pushes `pm/state/` and the decision page only if you set `commit: "true"`. Most of them never touch the network. The full list is in [`docs/DATA.md`](docs/DATA.md).
- **Hooks.** Four small Node hooks in `hooks/` (session summary, after-commit note, never-rule check, reference check). They read local files and run `git`; the reference check also runs a read-only `gh api` lookup for each `#N` an answer cites. They never stop or undo a shell command, and each has an off switch in the plugin settings (`NOSY_NO_PSST=1`, `NOSY_NO_NUDGE=1`, `NOSY_NO_NEVER_CHECK=1`, `NOSY_NO_CITE_CHECK=1`). Two of them can hand the agent a note after the fact ("this line doesn't check out"), and the reference check can send the agent back once to fix or drop a reference; that is text for the agent, not a block on your shell.
- **Network.** Nothing of yours leaves on its own. Nosy's network calls are reads: the public rival pages you listed, and GitHub through your own `gh`, including, after each agent answer, a read-only lookup of the `#N` issues the answer cites (turn that off with `NOSY_CITE_GH=0`, or turn the whole reference-check hook off with `NOSY_NO_CITE_CHECK=1`). `nosy notify` and `nosy publish` send something only when you run them, and `publish` is off until you configure a target and confirm (counts and structure, never quotes). `publish` and `notify` stop on a secret or personal data unless you pass `--allow-sensitive`. The full list is in [`docs/DATA.md`](docs/DATA.md).
- **Your agent's tools.** Nosy asks the agent to use its own connectors (GitHub, Linear, Slack…) only after you say yes. Those run under your agent's permissions, not Nosy's.

Nosy is built to be nosy about your product, not your data: customer quotes are masked before Nosy prints or writes them, a secret in a line of your code is hidden when Nosy prints it, and a secret or personal data stops a send. What each of those covers, and what it doesn't, is in [`docs/DATA.md`](docs/DATA.md).

## Pin a release

`npx github:nosy-hq/nosy` runs whatever is on the default branch. Pin a release tag instead, for example `npx github:nosy-hq/nosy#v0.15.0 install`, and read the release notes before you move to a newer one. The same goes for installing the plugin from a marketplace: prefer a tagged version in a shared or CI setup.

## Supported versions

The latest release. Older versions get fixes only if the problem is serious.

## Nosy Cloud

The plugin is free and MIT. Nosy Cloud (cloud.nosy.sh) is live and free for now: a shared record for your team. It never changes what the plugin does. What `nosy publish` sends to a Cloud you configured is listed in [`docs/DATA.md`](docs/DATA.md).
