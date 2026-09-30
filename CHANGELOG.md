# Changelog

Versions match `package.json` and `.claude-plugin/plugin.json`. Dates are when the version was committed. Versions before 0.10.0 were pre-release and aren't listed.

## 0.15.0 (2026-09-30)
- Install confirmation: `/nosy` and the first session after an install say which version is loaded, how many commands it brought, which hooks are on, and whether the folder has a `pm/` (`loaded`).
- `nosy doctor --check` checks the install itself (Node, git, gh, the skill's files, hooks, `pm/sources.json`); each problem carries its fix. Plain `nosy doctor` still fixes a `pm/` from an older Nosy.
- Clearer errors: git or gh missing, gh signed out, no network, a folder that isn't a repo or a JSON typo now end in one line with the command that fixes it (`hints`).
- Install and the GitHub Action fixes: the install target and the docs now name the same hosts (one-command install for Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode and Kiro; the skill folder can be copied into others), and the Action's own messages point at the right repo.
- New docs: `docs/DATA.md` (what Nosy reads, writes and sends), `SECURITY.md`, `CONTRIBUTING.md`, issue and pull request templates.
- Node 18.17 or newer is now the stated minimum everywhere, matching `package.json` (the scripts use recursive `readdirSync`).

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
