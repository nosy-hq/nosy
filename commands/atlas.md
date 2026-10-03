---
description: Where next? Research candidate markets (countries, segments, verticals, channels) on the same axes, check each a second time, and show a matrix. A suggestion, never an assignment.
---

Use the Nosy skill (`${CLAUDE_PLUGIN_ROOT}/skill/SKILL.md`, rules: `${CLAUDE_PLUGIN_ROOT}/skill/rules.md`). Wherever the command docs say `<skill>`, it means `${CLAUDE_PLUGIN_ROOT}/skill` here.

Follow the `atlas` steps in `${CLAUDE_PLUGIN_ROOT}/skill/commands/atlas.md`. For dispatch, stick to this (one agent per candidate, no nesting):

- Don't group candidates. Call the `nosy-scout` subagent SEPARATELY and SOLO for each candidate, in parallel in the same round. Each writes its own `pm/atlas/<slug>.md`.
- Say the cost before any agent starts (step 3), and never work around a block: a page behind a 403, a reCAPTCHA or a login is `unreadable`, and you say so.
- Nothing is ranked until a different `nosy-scout` has run in verify mode on that candidate. Then `nosy atlas`, and say "where next" as a suggestion with the one thing it hangs on.
