# frontyard

> Read `pm/map.md` first if it exists (apps live / beta / retired, deliberately off, what's said outside on purpose, past audits). An owner line in it beats what the scripts infer; an app the map calls retired isn't "the product".

Goal: compare shipped features against the landing page — "you built this, let's add it to the page." Nosy doesn't change the page; it suggests, and describes the change with `spill` if asked.

**A weekly roundup, not a stream**. Every page change is a deploy and a chance to break something, so the page moves in one batch: "This week we shipped X, Y, Z. Put them on the page in one change?" `next.mjs` and `stakeout` suggest it once `frontyard.every` days (default 7) have passed since the last check and at least `frontyard.min` features (default 2) shipped since; the owner can set `every` to 3 for a fast-moving product. When the owner runs it by hand, run it: the rule is about Nosy's suggestions, not the owner.

1. Where's the page? `pm/sources.json` → `frontyard`:
   - If the page is in the repo, `frontyard.path` (e.g. `apps/web/app/page.tsx`, or `README.md` if the product is a tool); its text and last-change time are read from git. If it's not set, ask the owner once, the same way `move-in` does.
   - If it's not in the repo, `frontyard.url`: fetch the page with your web tool, save it to `pm/state/frontyard-page.html`, pass it with `--page` in step 2. The script itself never goes to the network — only a public page is ever read.
   - Optional `frontyard.also`: other repos of the same product (a hosted app next to the plugin, an API next to the web app), `[{ "repo": "../other", "ref": "main", "surface": [{ "glob": "src/views/*.ts" }] }]`. Their commits count as shipped features, so the roundup covers the whole product, not just the repo the page lives with. Point `ref` at what actually runs in production, so the page never promises unreleased work.
   - Optional `frontyard.surface`: things whose name should appear on the page (command docs `{ "glob": "commands/*.md" }`, CLI subcommands `{ "file": "...", "pattern": "..." }`, page routes). `frontyard.price`: the pricing page (if it's in the repo).
2. `node <skill>/tools/frontyard.mjs pm [--page pm/state/frontyard-page.html] [--day 60] --json pm/state/frontyard.json`. If a pricing page was given, `plan-gates.mjs` must have run first (`pm/state/plan-gates.json`). The script counts:
   - **Name not on the page:** commands/subcommands/pages from the surface list.
   - **Shipped, not on the page:** the last N days' user-visible commits (touching the surface, a screen file, or `feat:`), by field; is the field's name or its distinguishing words on the page. ⏱ = shipped after the page's last change.
   - **Name's on the page, but changed since:** is the copy still current?
   - **On the page, no trace in the code:** none of the bullet/table row's distinguishing words appear in the code (docs excluded) — the page may be ahead of the product, worth a look. "Coming soon/beta/waitlist" phrasing on the page is listed separately.
   - **Pricing page ↔ code gates:** gated in code but not on the pricing page; mentioned on the pricing page but no gate in the code.
   - **Rival footing (if `sources.json` has a `matris` key):** matrix steps we've shipped (y) split into two lists — *your edge isn't on the page* (present in at most 10% of active rivals) and *table stakes, not on the page* (present in at least 25%; customers look for it when comparing). A rival file's "Featured on the landing page" bullets show which rivals spotlight that step, and move it up. Thresholds: `frontyard.rival: { distinguish, desk }`.
   - Internal-only work (scripts, infra) is mentioned in a single line; the page isn't expected to cover it.
3. Interpret and suggest. The script counts, you give the verdict:
   - Filter out false matches (the page may be in one language, the commit in another; `sources.json`'s `glossary` expands this). Being named is one thing, being explained is another: call out a feature whose name is on the page but whose new capability isn't described.
   - Open with the roundup, in the owner's language: "Since <last check>: shipped A, B, C. Worth the page: A and C (B is a small tweak). One change?" Only what a customer would notice makes the list: new capabilities, a rival gap closed, a pricing or plan change. Fixes, polish and internal work stay off it.
   - For each suggestion: short copy to add to the page (in the page's own language and voice), which section (features, commands, pricing, FAQ), evidence (commit, file:line). At most 5 suggestions, starting from the most visible value. All of them go into **one** change (one PR / one deploy), never one per feature.
   - If the owner says "not now," that's the answer for this round: the saved `frontyard.json` resets the clock, and the next roundup comes in `every` days with whatever shipped since.
   - Don't give a verdict on "on the page, not in the code" — ask: is it on the roadmap (`pm/waves.md`), with a rival, or should it come off the page?
4. Save to `pm/frontyard/<date>.md`. If the owner wants it: describe the change with `spill`, or suggest a patch if the page is in the repo — never change or publish the file yourself without the owner's approval.
5. Suggest the next command: usually `tea` (a "frontyard" box on the page) or `spill <page change>`.

Note: `sources.json`'s override key for a custom matrix location is still literally `matris` in `frontyard.mjs` (not yet renamed to `matrix`) — use `matris` if you need to set it.
