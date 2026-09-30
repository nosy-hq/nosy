# doctor

Goal: two questions, both maintenance rather than product work (don't run any other command as a side effect, and don't open files the report doesn't name).
- **Is my install healthy?** (something isn't loading, a command is missing, "did it install right?") → `node <skill>/tools/doctor.mjs --check` (or `nosy doctor --check`), below.
- **Bring a `pm/` folder written by an older Nosy up to this version** → the numbered steps.

## `--check`: is the install healthy?

`node <skill>/tools/doctor.mjs --check [pm]` (or `nosy doctor --check`). Local only: no network, writes nothing. It checks Node (18.17 or newer; the tests run on 22 and up), git (required), gh (optional), the skill's own files, the plugin manifest and its commands, copies made by `nosy install` (a stale or broken one), whether the plugin is switched off in Claude Code, `hooks/hooks.json` (valid, every script present and parseable, which hooks you switched off), and `pm/sources.json` (readable, its repo is a git repo, its `ref` resolves).
- Every line that isn't fine ends with the command or link that fixes it: **✗** a hard failure (exit 2), **!** fix it but Nosy still runs, **–** for your information (a missing `gh`, no `pm/` yet: nothing is wrong). Read the ✗ lines to the owner as they are and don't guess at other causes; run each fix only when the owner says so.
- Exit 0: healthy (say so in one line). Exit 2: at least one ✗.
- It can't tell whether *this session* loaded Nosy. That is what the top-level skill with no command is for (`/nosy:nosy` in the plugin, `/nosy` in a skill-only install): it prints "Nosy is loaded: N commands", which hooks are on, and whether `pm/` is here. No lines there means the plugin isn't loaded: `/plugin` → Installed tab, then `/plugin enable nosy` or restart the session.

## Older `pm/` folders

1. `node <skill>/tools/doctor.mjs pm` (or `nosy doctor`). Read-only. Exit 0: nothing to fix, say so in one line and stop. Exit 2: findings. Exit 1: there's no pm folder at that path.
2. The findings come in three groups; the group says what happens, not how bad it is:
   - **Can fix on its own** (old Turkish file and folder names from the English migration, `docs/RENAMES.md`; old `sources.json` keys; `sources.json` paths that point at an old name). No decision is needed. If `pm/` is a git folder with other people's uncommitted work in it, say so first; otherwise run `node <skill>/tools/doctor.mjs pm --fix` once and report what it renamed in one line.
   - **Worth knowing** (both the old and the new name exist). Tell the owner which to merge; don't merge it yourself.
   - **Needs a command** (no `sources.json` → `move-in`; a state file or matrix with old keys → re-run the command the report names). State files are rewritten by the command that owns them, never translated by hand.
3. Glossary entries (`glossary`) are the product's own words and are never renamed, even when they're Turkish.
4. Never run `--fix` on a product whose `pm/` the owner said is read-only (e.g. a test product): copy it first and fix the copy.
