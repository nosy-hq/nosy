# Security

## Report a vulnerability

Use a private advisory: <https://github.com/nosy-hq/nosy/security/advisories/new>

Please don't open a public issue for a vulnerability. Include what you ran, what happened, and what you expected. We'll answer within a week and tell you when a fix ships.

## What Nosy runs on your machine

Nosy is a plugin and a skill for your coding agent. There is no server component in this repo and nothing to install beyond Node.

- **Scripts.** Plain Node scripts in `skill/tools/`, with no npm dependencies. They read your repo (git history, docs, decision files) and write under `pm/`, plus the few named exceptions in [`docs/DATA.md`](docs/DATA.md). Most of them never touch the network.
- **Hooks.** Four small Node hooks in `hooks/` (session summary, after-commit note, never-rule check, reference check). They read local files and run `git`. They never stop or undo a command, and each has an off switch in the plugin settings. Two of them can hand the agent a note after the fact ("this line doesn't check out"); that is text for the agent, not a block on your shell.
- **Network.** Nosy sends nothing on its own. Every network call is one you start: it reads the public rival pages you listed, reads GitHub through your own `gh`, posts to the webhook you give `nosy notify`, or (`nosy publish`, off until you configure a target and confirm) sends counts and structure, never quotes, to a Nosy Cloud you configured. `publish` and `notify` stop on a secret or personal data unless you pass `--allow-sensitive`. The full list is in [`docs/DATA.md`](docs/DATA.md).
- **Your agent's tools.** Nosy asks the agent to use its own connectors (GitHub, Linear, Slack…) only after you say yes. Those run under your agent's permissions, not Nosy's.

Nosy is built to be nosy about your product, not your data: customer quotes are masked before Nosy prints or writes them, a secret in a line of your code is hidden when Nosy prints it, and a secret or personal data stops a send. What each of those covers, and what it doesn't, is in [`docs/DATA.md`](docs/DATA.md).

## Pin a release

`npx github:nosy-hq/nosy` runs whatever is on the default branch. Pin a release tag instead, for example `npx github:nosy-hq/nosy#v0.15.0 install`, and read the release notes before you move to a newer one. The same goes for installing the plugin from a marketplace: prefer a tagged version in a shared or CI setup.

## Supported versions

The latest release. Older versions get fixes only if the problem is serious.
