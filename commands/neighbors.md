---
description: What the neighbors shipped; every line ends with "how much of this do we already have."
---

Use the Nosy skill (`${CLAUDE_PLUGIN_ROOT}/skill/SKILL.md`, rules: `${CLAUDE_PLUGIN_ROOT}/skill/rules.md`). Wherever the command docs say `<skill>`, it means `${CLAUDE_PLUGIN_ROOT}/skill` here.

Follow the `neighbors` steps in `${CLAUDE_PLUGIN_ROOT}/skill/commands/neighbors.md`. For dispatch, stick to this (one agent per product, no nesting):

- Don't group rivals together. Call the `nosy-neighbor` subagent SEPARATELY and SOLO for each rival product (one agent per product). If there are several products, send these calls in the same round, in parallel.
- Each `nosy-neighbor` writes/updates its own `pm/rivals/<slug>.md` file; gather the results here.
- Optionally, have the `nosy-auditor` subagent (read-only, fast) audit one or more of the updated files.
- Update `matrix.json`, write the "rivals this week" box on the page, then suggest `tea`.
