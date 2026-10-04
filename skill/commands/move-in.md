# move-in

Goal: get to know the product, open the `pm/` folder, and hand the owner a first product picture in the same session: where we are, the matrix against rivals, cheap wins, the roadmap, the next decision (step 8). Setup is done once; `product.md` can be hand-edited afterward too.

**Re-run:** if `pm/` already exists, don't start over — read what's there and ask only about what's stale or missing; never overwrite a fact the owner already confirmed without a reason to. If `pm/` looks like it's from an older Nosy (Turkish file names like `kaynaklar.json`, old `sources.json` keys), run `nosy doctor` first (`skill/commands/doctor.md`) and continue from there.

**Completion gate:** `move-in` isn't done at "a folder exists." It's done when `pm/product.md` exists with the facts the owner actually confirmed (not just written and left unread), and `node <skill>/tools/verify-setup.mjs pm` shows no ✗ (a "–" only means an optional key isn't set) (step 5). Say plainly if either isn't true yet instead of reporting done.

1. Before asking anything, work out what you can from the repo: README, package/module name, `docs/`, decision files, the issue tracker (`gh repo view`), `find-sources.mjs`'s own passes (step 5 runs it properly; a quick look now is enough to know what's missing). From this, infer the product and its market, propose rivals from evidence if you found any (otherwise leave it to `neighbors`'s first run), propose a page scope rule if the landing page states one (otherwise mark it "(open)"), and list 2–3 North Star candidates from analytics event names already in the code (search the code for its tracking calls yourself: `scan-metrics.mjs` needs `pm/sources.json`, which step 5 writes, so it can't help yet).
   Then ask the owner, once, with AskUserQuestion, in one round:
   - **At most 3 questions, only for what the repo genuinely can't answer** — typically the product/market (if the repo doesn't say who it's for) and where the decision documents live (if none of the usual names exist: DECISIONS.md, BACKEND-NEEDS.md, PLAN.md, a roadmap issue). The third slot is free for the landing page location (step 2) when it can't be found, or another real unknown. Never ask about rivals or the page scope rule — propose them from evidence ("I found X, Y — right?") or mark them "(open)".
   - **Plus, always, the North Star question** (the owner's own call — this one stays a question, not an inference, and doesn't count against the 3-question limit): which single number best shows the value delivered to the customer (e.g. "documents reviewed per week")? Offer the 2–3 candidates from above plus "not now". Write the answer to `sources.json` → `metrics.northStar: { name, pattern }` (`pattern` = the event name that feeds it, or leave it out if no event exists yet); "not now" writes nothing and `psst` asks again later.
   - **Plus, only when `sources.json` has no `research` key yet, the research-tool question** (so the first tour never stops mid-way to ask it): "Rival research: the agent's built-in web search (free, default), or a search integration you've set up (name it; it spends that tool's credits)?" Default and recommended: built-in. Write the answer to `sources.json` → `research` in step 5 (`{ "tool": "web" }`, or `{ "tool": "<name>", "fallback": "web", "paidRequiresOwnerOk": true }`). A paid tool is never picked because it's installed. Doesn't count against the 3-question limit.
   - **Rivals, when the repo names none:** before this question round, find candidates yourself with the agent's built-in web search (never a paid tool here): the product's category and its "alternatives to" / "vs" pages, plus any product the README, docs or code name as a comparison or an import source. Offer up to 4 in one multi-select question ("Which of these are your rivals? Add any I missed."), each with a one-line reason and its source. Four is the size of one question, not of the market: write every candidate you found, picked or not, to `pm/state/rival-universe.json` (`neighbors.md`, "The market is not the first four"), start from any landscape study or `references/` folder the repo already holds, and tell the owner how many more there are ("4 picked, 7 more known; want the next batch?"). This is proposing from evidence, not an open question, and it doesn't count against the limit. Picked ones become `pm/rivals/<slug>.md` stubs; if none are picked or there's no web search, leave rivals "(open)" and `neighbors` proposes again on its first run.
   - **Team logins, when the product has an issue repo**: issues the team opens for itself are work items, not customers asking, and `collect-signals` can only leave them out of demand if it knows who the team is. Propose the GitHub logins that authored merged PRs (`gh pr list -R <issue repo> --state merged --limit 100 --json author`, distinct `author.login`, bots left out) in one multi-select ("Which of these are on your team? Add any I missed."), with each login's merged-PR count as the reason. Write the confirmed list to `sources.json` → `team` (an array of logins; case doesn't matter) in step 5. It is a proposal from evidence, not an open question, and doesn't count against the limit. No issue repo, or nobody confirmed: write nothing, and every issue author counts as a customer, as before.
   - **Rival research kept elsewhere, when `find-sources` proposes `rivalsPath`**: it proposes a folder (at most 3 levels below the repo root) that holds 2 or more markdown files shaped like Nosy's rival files (a `references/<name>/competitive-*.md` layout, say), with the file list as evidence. Show it in this round ("I found rival research in `references/` (3 files: …): are these your rivals?"). It is a proposal from evidence, not an open question, and doesn't count against the limit. Confirmed: run `nosy rivals-import --dry-run`, then `nosy rivals-import`: it copies those files into `pm/rivals/<slug>.md` (the originals stay) so every command works on them; then write `rivalsPath` to `sources.json` in step 5 (a folder, relative to the folder that holds `pm/`; `find-sources` writes it that way), and `next`, `doctor --check` and the rival count read that folder instead of saying "no rival files yet". Declined or not proposed: write nothing and rivals stay in `pm/rivals/`. Files already in `pm/rivals/` win: nothing is proposed then.
   **No AskUserQuestion** (Codex, Cursor and other agents without it): put the same questions in one numbered chat message, with your proposed answers and the multi-select options written out as a list, and wait for the reply. Same limits; don't go on to step 2 on guesses.
   Everything not asked is a stated inference the owner can correct in one pass — never a silent guess.
2. Work the rest out from the repo yourself: main branch, remote name, team members (`git shortlog -sn --since=30.days`), the issue tracker (`gh repo view`), and the **landing page**: a marketing page in the repo (`apps/web/app/page.tsx`, `src/pages/index.astro`, `index.html`…), or `README.md` when the product is a tool or library. Write it to `sources.json` → `frontyard.path`; if it's a live site outside the repo, `frontyard.url`. Only if you can't tell, use the third question slot from step 1 (the limit stays 3, North Star aside). With a page set, `next.mjs` and the after-commit nudge suggest `frontyard` once features pile up.
3. Write `pm/product.md` in the shape of `templates/product.md`. Mark every fact the owner didn't confirm with "(inferred: <evidence>)" right next to it (e.g. "For whom: SMB legal teams (inferred: README.md line 3)"), and leave a real unknown as "(open)" — never invent a customer, a number, or a rival. Open rival files from `templates/rival.md`, same marking rule.
4. Set up `pm/matrix.json`: rows are the product's features (in the owner's own words), columns are the product plus its rivals. Mark inferred rows or rival columns the same way ("(inferred: ...)" / "(open)"). The shape the scripts read (codes: y yes · p partial · n no · u not found · d announced):
   ```json
   { "steps": [{ "no": 1, "name": "Pipelines" }, { "no": 2, "name": "Email sync (inferred: README)" }],
     "biz": { "name": "<your product>", "codes": { "1": "y", "2": "p" } },
     "products": [] }
   ```
   Rivals are added later: `neighbors` fills each `pm/rivals/<slug>.md` (`templates/rival.md`, with these same rows) and `node <skill>/tools/build-matrix.mjs pm` merges them in. It keeps your rows and backs up the old file; with no rival table filled yet it leaves the matrix alone.
5. Let the script propose `pm/sources.json` first: `node <skill>/tools/find-sources.mjs <repo> --pm pm --write`. It only reads the repo and proposes each key with confidence and evidence: repo, ref, the decisions path and how many headings it found, the request document with its title/status patterns, `refs` from commits, `glossary` candidates, `inventory` paths (`inventory.mjs`'s own estimate), a guessed domain pack, and the last 30 days' team. If the file already exists, it doesn't overwrite — it shows the diff key by key (`--onTop` backs it up to `.yedek` first). Fix the low-confidence ones with the owner (especially `glossary`, `request.last_day`, `issue.our`, and `inventory.frontend` if there's more than one frontend); the owner fills in `preread.never` (a list of `{ "name": "…", "pattern": "<regex>" }`, e.g. `{ "name": "No tracking scripts", "pattern": "\\b(mixpanel|hotjar)\\b" }`; `never-check` and `overheard` match it against added lines). Language: read the decisions doc and check what language it's actually written in; if it isn't English or Turkish, set `sources.json` → `language` (BCP-47, e.g. `"de"`) and fill in the product's OWN words/phrases — every one of these stays a flat array of strings, like `glossary` itself, merged with (not replacing) Nosy's built-in English+Turkish lists (never a nested object: `glossary` is read as a plain word list by several other tools too):
   - `glossary.notDoing`/`glossary.measurement` — "we're not doing this" and "Measurement:"/"Success:" phrases (`read-decisions.mjs`).
   - `glossary.design` — the product's own section-name words for its design docs (`dresscode`/`read-design.mjs`), one array entry per word as `"<field>:<word>"` (field one of `goals`/`nonGoals`/`principles`/`scope`/`included`/`excluded`/`deferred`); a bare word with no `field:` prefix still counts toward "is this doc's language recognized at all", just not toward one specific field.
   - `glossary.prd` — the product's own words for `audit-prd`'s quality checks, same `"<check>:<word>"` shape (check one of `strong`/`vague`/`solution`/`size`/`against`).
   - `glossary.metrics` — the product's own route/event-naming words for `scan-metrics.mjs`'s AARRR step detection, same `"<field>:<word>"` shape (field one of `signup`/`activation`/`revenue`/`referral`/`churn`); each word is matched against both the event name and the route/file path for that step.
   - `glossary.billing` — the product's own billing/plan folder or file-name words for `plan-gates.mjs`, same shape (field is always `billing`); the billing SDK import itself (stripe, paddle, iyzico, …) and the gate-call shape (`hasFeature(...)`, `isPro`, …) stay recognized without this — only a billing/plan FOLDER or FILE named in another language needs it.
   - `glossary.signals` — the product's own support/survey export column-header words for `collect-signals.mjs`, same `"<field>:<word>"` shape (field one of `text`/`date`/`source`/`email`/`customer`); mostly a tie-break — `collect-signals.mjs` already infers text/date/email/id columns from the VALUE shape first, so a support export reads correctly even before this is filled in.
   - `glossary.refusal` — the product's own "this is refused/disabled/out of scope" words for `canwe.mjs`'s "Deliberately off?" code search, a flat list like `glossary.notDoing` (no field prefix — one purpose only).
   - `glossary.access` — the product's own "portal/access/sharing" words for `canwe.mjs`'s "Access layer" section, same flat shape.
   - `glossary.landing` — the product's own "coming soon"/waitlist/beta words for `frontyard.mjs`'s landing-page promise check, same flat shape.

   A German example:

```json
"language": "de",
"glossary": {
  "notDoing": ["machen wir vorerst nicht", "nicht geplant", "abgelehnt"],
  "measurement": ["Erfolg", "Kennzahl", "Messung"],
  "design": ["goals:Ziele", "principles:Prinzipien", "scope:Geltungsbereich", "included:Enthalten"],
  "prd": ["vague:einfach", "vague:schnell", "solution:hinzufügen", "solution:Schaltfläche"],
  "metrics": ["signup:Registrierung", "activation:Aktivierung", "revenue:Abrechnung", "referral:Empfehlung", "churn:Kündigung"],
  "billing": ["billing:Abrechnung"],
  "signals": ["text:Nachricht", "date:Datum", "customer:Kunde", "source:Kanal", "email:E-Mail"],
  "refusal": ["nicht unterstützt", "abgelehnt", "bewusst ausgeklammert"],
  "access": ["Zugang", "Freigabe", "extern"],
  "landing": ["demnächst verfügbar", "bald verfügbar", "Warteliste"]
}
```

Structural signals (the "## K&lt;no&gt;" heading pattern, an ADR "Status:" line, a strikethrough heading, table/heading structure) already read fine in any language without this; free-text "not doing this"/measurement prose, design-doc section names, and PRD-quality wording don't, until they're filled in — `canwe`/`read-decisions.mjs` would otherwise say a decision's status "couldn't be read in this language" instead of the wrong-but-confident "no trace of a decision" they used to say; `dresscode` would otherwise mark a design system's areas "✗ missing" instead of "? unknown" for a language it doesn't recognize (never a false claim that a fully-documented system is undocumented); `audit-prd` would otherwise silently skip its vague-word/solution-smuggling/counter-evidence checks instead of saying "not available in &lt;lang&gt;". `verify-setup.mjs`'s "decisions language" row shows how many decisions it could actually read; run it again after filling the glossary. If there are customer or personal names that must never appear on the published page, write them to `pm/private.json` (`{"names": [...]}`; `privacy-scan.mjs` reads it). Keys (repo, ref, the request document and its patterns, the decisions path, the matrix, the issue repo; optionally `refs` — the product's own reference patterns, falling back to the general UPPERCASE-number pattern if there are none —, `glossary` — a two-way term match, read by `gather-evidence.mjs` —, `inventory` — backend/frontend paths; `research` — the rival-research source tool, `{ tool: "web" | "firecrawl" | "<mcp tool name>", fallback: "web", paidRequiresOwnerOk: true }`, read by `neighbors`/`nosy-neighbor`; not set → free WebSearch/WebFetch, no config needed); `preread.decisions` can be a single file, a directory (e.g. `docs/adr/`, one file per decision), or a glob (`docs/decisions/*.md`) — `tools/read-decisions.mjs` reads all of them; if needed, `preread.decision_title` (optional, a regex) changes the heading pattern. Then run `node <skill>/tools/verify-setup.mjs pm`. Don't guess the path: fix every line that comes back ✗; if the repo has exactly one candidate, `--fix` writes it. `move-in` isn't done until everything is ✓.
5b. **The team's working notes**: `find-sources` proposes `next.path`, the markdown files the team edits most that cite the code (e.g. a "next up" or status doc). Confirm it with the owner in the step 1 round only if there are several candidates and the choice matters; otherwise state it as an inference. None found is fine: `psst` just skips signal 10.
   **No decisions doc, roadmap in the tracker** (many open-source products: decisions live in PR/issue threads, the roadmap is a GitHub Project board). Don't invent a path: leave `preread.decisions` out (find-sources does), and say where decisions actually live in `pm/map.md` ("decided in PR discussions; label `<x>` if they use one"). A GitHub Project roadmap is read, not copied: `gh project list --owner <org>` finds it, `gh project item-list <number> --owner <org> --format json --limit 200` reads its items and statuses (read-only; needs the `read:project` scope, say so if gh can't). Write the board to the map ("roadmap: GitHub Project <org>/<number>, read with gh") so `scoop` and `canwe` read the owner's own plan before building one.
6. Link convention (the record depends on it): confirm the **integration branch** (`integration-branch.mjs` detects the one PRs actually merge into; write `integrationBranch` in `sources.json` only if the owner says otherwise), the **decision source** (decision log, ADR folder or issues), and how work gets linked: `Closes #N` / `#N` in PR bodies, decision or request refs in commits (`sources.json` `refs`), and `Bet: <id>` from `bet`. Say plainly that unlinked work will show as "unlinked" in `shipped`, never guessed.
7. **Map:** offer `map` right after setup (`commands/map.md`): the one page of live/beta/retired apps, screens ↔ code and the owner's words that every later answer reads first. It asks the owner at most 4 questions.
7b. First line in `log.md`: date, "setup," what's left missing.
8. **First tour — don't stop at setup**. The owner moved Nosy in to get an answer, not a folder. This is `tour` (`commands/tour.md`, `nosy tour`): run it now. It says what Nosy reads, writes and sends before anything runs, ask the questions it lists once in one message (at most 4 at a time: the asking tool's limit), then run its → steps in the order it shows, without asking between steps. Say one line first ("Set up. Now the first look: inside, then rivals, then what's next."). Where this list and the tour's plan differ, the plan wins. The usual walk: `doctor` (an older `pm/` only) → `map` → `facts` → `inventory` (psst's "endpoint exists, no screen" signal and `canwe`'s backend matching both read `pm/state/inventory.json`, and both skip it silently when it was never made, so it runs here once, even with no `inventory` key in `sources.json`; `inventory.mjs` estimates reasonable paths on its own) → `shipped` → `psst` → `neighbors` (only if the owner said yes to its token cost; with no rival files it proposes and researches the top 3, labelled "proposed, not confirmed"; it fills the rival columns of `pm/matrix.json` through `nosy matrix-proposals`) → `scoop` → `frontyard` (only if a page is set) → `tea`. If the session is running long, stop after `neighbors` and say which steps are left; `nosy tour` resumes, and `/nosy:stakeout` finishes the loop.
   Then give the **first report** in chat, in the owner's language, product words first, receipts underneath (never a commit or decision list up top):
   1. **Where we are**, by product area: done · in progress · missing (and which rival has it).
   2. **The matrix in one screen**: where we lead, the table stakes we lack (most rivals have it), what only we have. Link the page.
   3. **Low-hanging fruit**: the top 3–5 from `psst`, each sized, each with its evidence.
   4. **Roadmap**: the `scoop` waves (Now / Next / Later), one line each.
   5. **Your next product decision**: exactly one, and why now: the one `node <skill>/tools/next-decision.mjs pm` gives, so the after-commit nudge and `/nosy:nosy` (`/nosy` as a skill) repeat the same answer later. If it says "not checked yet", say so.
   6. **Landing page**: what shipped but isn't on it (if `frontyard` ran).
   End with how Nosy stays with them while they build: after each commit or merge it says which matrix gap the commit may close and what the next decision is (the after-commit hook; put `Matrix: <row>` in a commit to make the link explicit), and `/nosy:canwe "<scenario>"` answers "is the product close to this, what's missing?" at any time.

### Design system

`dresscode` finds the design system on its own from anchor files (DESIGN.md, design-tokens.json, docs/design-system/, `ui/registry.ts`, `components/ui/`). If the guess is wrong, or the system lives in a folder downloaded from an Artifact, write to `sources.json`:

```json
"design": { "root": "apps/web" }
```

or `"design": { "folder": "<top of the downloaded project/ folder>" }`. Once it's set up, run `node <skill>/tools/dresscode.mjs pm` once; `canwe` and `spill` read `pm/state/design.json`.

### Inventory

The backend inventory (endpoint ↔ screen) is a separate step; `verify-setup.mjs` doesn't check the endpoint↔screen
match itself (it can be skipped), but it DOES check `inventory.frontend`'s own coverage (see
below). Add an optional `inventory` key to `sources.json` (if it's missing, `inventory.mjs` tries reasonable names
from the repo root — `apps/*api*`/`apps/backend`/`server`/`backend` and `apps/web`/`apps/*frontend*`/`web`/`src` —
and marks them "estimated"):

```json
"inventory": {
  "backend": ["apps/backend"],
  "frontend": ["apps/web/src"],
  "openapi": "apps/backend/contract/openapi.yaml",
  "excluded": ["**/*_test.go", "**/*.test.*", "**/tests/**"]
}
```

`openapi` is optional (if there's a contract file, write its path; otherwise `inventory.mjs` scans with
framework heuristics — Go, Node, Python, Rails). The `excluded` glob list is used, on top of test files, to drop
product-specific noise (e.g. a smoke-test binary). Directories with no product surface —
`cmd/smoke-*`, `cmd/*-worker`, `scripts/`, `tools/`, `internal/testutil`, `mock`/`mocks` —
are marked `product_excluded` by default (not counted as no-screen, like infrastructure, but counted separately); to give a
different list, write `"product_excluded": [...]` (an empty array turns the default off entirely). Once it's set up, run:

`node <skill>/tools/inventory.mjs pm --json pm/state/inventory.json`

The output feeds `psst`'s 6th signal ("endpoint exists, no screen for it") and `canwe`'s backend matching.

**Multiple frontends:** a monorepo can have more than one frontend app (an admin panel next
to the customer-facing one, a browser extension, a marketing site) — list every real product screen in
`inventory.frontend`, not just the first one found. The name-only guess above (`apps/*frontend*`) only catches an
app whose own folder name says "frontend"; it's now UNIONED with a SHAPE guess (a `package.json` with a frontend
framework dependency — react/vue/next/nuxt/svelte/angular/solid/preact — or a `pages`/`app`/`routes`-shaped
subfolder, scanned under `apps/`, `packages/`, `clients/`), so an app named e.g. `apps/dashboard` or
`apps/admin-app` is found even without "frontend" in the guess pattern itself. `verify-setup.mjs` compares
this same shape guess against `inventory.frontend` and warns ("~", not a hard failure) when the repo has more
frontend-shaped apps than are listed — worth a look, not necessarily a bug (an internal tool or a demo app can be
left out on purpose).
