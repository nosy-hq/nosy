# Packs

A "pack" is domain knowledge layered on top of `nosy`'s general rules - like Ponytail's lite/full/ultra modes, but chosen by vertical instead of mode. A pack makes the agent act like someone who already knows the domain: who the rivals are, which matrix rows are missing, which PRD section is mandatory, which mistake is never made, which metric gets tracked.

## How to load it

`/nosy:<command> --<pack>` in the Claude Code plugin (`/nosy <command> --<pack>` in a skill-only install), for example: `/nosy:neighbors --fintech`, `/nosy:spill --mobile <topic>`, `/nosy:scoop --legaltech`, `/nosy:stakeout --b2b-saas`.

If no pack flag is given, the agent works with the general rules. If a product spans more than one pack (e.g. a mobile fintech app), both flags can be given at once; overlapping rows are de-duplicated, and overlapping "never" rules all apply.

A pack can be set permanently in `product.md`: add a `- **Pack:** fintech` line and the agent reads that pack on every command without needing the flag.

## Which command reads which section

| Command | Section(s) it reads from the pack |
|---|---|
| `move-in` | Who it's for - to check domain assumptions in the first conversation with the owner |
| `neighbors` | Rival universe - for the candidate list and search queries; category names when filling out `templates/rival.md` |
| `stakeout`/`peek`/`scoop` (matrix step) | Rows to add to the cycle matrix - when proposing rows for `matrix.json` |
| `peek`, `psst` (if present) | Low-hanging-fruit signals - for "ready but not on screen" and cheap-win scans |
| `spill` | Mandatory PRD sections - the draft's skeleton; Never list - to flag out-of-scope/risky items |
| `peek`, `neighbors`, `scoop` (on every PR/plan review) | Never list - checks the team's delivery or the proposed plan against this list, and flags any violation as a warning |
| `tea` | Metrics - to show which number matters in the "Where we stand" and "Head to head" sections |
| `move-in`, `neighbors` | Sources - starting links to show the owner ("should I start from these?") |
| `atlas` | Expansion axes and registries (section 9, optional) - the axis names every candidate market is scored on, and where the data and market facts start |

## File format

Every pack file carries the same eight headings, in the same order, and may add a ninth (optional, read only by `atlas`):

1. **Who it's for** - one paragraph, target audience and product type.
2. **Rival universe** - categories + 8-15 real example products by region, each with its site address. A separate subheading for the Turkey market when relevant.
3. **Rows to add to the cycle matrix** - 8-12 rows, in `matrix.json`'s row shape (`name`, `why`).
4. **Low-hanging-fruit signals** - checkable in the repo or in public data, concrete.
5. **Mandatory PRD sections** - domain-specific headings that the `spill` command must add to the draft.
6. **Never list** - things the agent must flag if it sees them in a PR or a plan.
7. **Metrics** - 5-8 metrics that PMs in this domain actually track.
8. **Sources** - URLs used for verification.
9. **Expansion axes and registries** (optional) - the axes a candidate market is scored on, with what a 5 means and where to look, and the registries and data sources to start from, each with what is known about its licence and how it was found. Filled so far for `legaltech` only; a pack without it leaves `atlas` to agree the axes with the owner.

The general rules (`rules.md`) always apply; a pack doesn't override them, it adds to them. Every claim in a pack follows the same evidence rule: if it isn't in a primary source, it's "(unverified)".
