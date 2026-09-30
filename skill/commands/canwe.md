# canwe <question>

> Read `pm/map.md` first if it exists (apps live / beta / retired, deliberately off, what's said outside on purpose, past audits). An owner line in it beats what the scripts infer; an app the map calls retired isn't "the product".

Goal: a one-sentence, sized, evidence-backed answer to "can we do this?" Example: `canwe "bulk export"`.

1. **Run the script:** `node <skill>/tools/canwe.mjs pm "<question>" <extra words>`. Add extra words by hand when the product's own docs/code use different terms than the question (e.g. the docs are in another language, or the code's identifiers don't match the question's wording).
   This one script gathers every piece of evidence below and writes a **"Suggested verdict"** at the end, saved to `pm/state/canwe-last.md`. Read that suggestion as a starting point, never as the answer — **you give the final verdict**, and you do it by reading the evidence yourself, not by repeating the script's wording.
   - If the verdict starts with **"Candidate — confirm:"**, the only evidence is a request-doc section picked by word overlap — not an explicit reference (§ref/K-number/#issue) and not a real route↔screen link. Verify it by hand before you say "Already exists" or "backend ready."
   - The first output line always restates the question. If a second line says `Asked about <X>; the evidence is on <Y> — confirm`, that's a hard stop: check by hand whether the evidence really answers the surface that was asked, or only a same-worded neighbor of it, before writing "Already exists"/"backend ready".
   - Never read a missing signal as a negative finding. If the script says the inventory couldn't be read or computed ("Inventory missing — run `nosy inventory`"), run that command and try again — don't answer "not now, no trace" from an inventory that was never actually checked. Same for a decision whose status "couldn't be read in this language": that means there IS a matching decision, just not one the script could confirm — read it yourself before answering, don't say "no trace of a decision."

2. **Read the code first**, before any document. The script's **"In the code (read this first)"** section lists the question's rarest terms with their file:line hits at the integration ref, application code before tests. Open every file it lists and read around the hit (the function, the type, the validation that uses it) before you read anything else.
   - If every one of the question's words turned out to be common in this repo, the script says so and searches the rarest of them anyway (instead of finding nothing) — read those hits the same way, just with a bit more skepticism per hit.
   - **No code trace** ("No code file mentions it") is itself evidence: say so, and size the work by the nearest existing thing of the same kind (a new integration ≈ the size of an existing provider directory — look at its history), not by word-matched history.
   - **A never rule** (printed on the second line) means "There's a decision: we're not doing this" — cite the rule and the code that enforces it (a disabled enum value, a rejected type, a refused parameter).
   - **A "Deliberately off?" section** means the same verdict — "There's a decision: we're not doing this" (or "deliberately not done"), never "not built yet" or "not today." Cite at least one line from that section as file:line (a comment that says it's not a provider, a disabled entry, a test that wants a 404). If none of the lines really refuse it, say so and fall back to the normal verdict.
   - **An "Access layer" section** (portal, outside users, sharing, permissions questions) means read those files and say what the authorization model actually allows: company-wide roles, team or assignment, or per-record grants — and whether an outside user can exist at all. That model is usually the real size of the work.
   - **Every claim you write must hold in the code at the integration ref**: exists, missing, "not on main", "deliberately off." A document's status line is a lead from the day it was written; if the code disagrees, the code wins and you say the document is stale.
   - **Answer the surface that was asked.** If the question names a screen (calendar) and your evidence is about a different one (records table), either find the asked one in the code or say plainly you're answering a neighbor.

   - **Issues and PRs too,** with the repo named: `gh issue view <n> --comments -R <sources.json issue.repo>`, `gh search issues "<words>" --repo <issue.repo>`. A test result or "done in TEST" often lives only in an issue comment. Before saying "there's no record of X", say you looked there.
3. **Read the rest of the evidence, and look at the product yourself too** (in this order):
   - **Backend** — "Ready in the backend" splits matches into **Strong matches** (two or more concept groups from the question, or the question's one concept, on the same audience/surface as the question) and **Weak matches — verify** (a single rare concept, or an endpoint whose admin/internal-vs-customer surface doesn't fit the question). Each line shows `matched: <words>` so you can see why it surfaced. Treat a weak match as a lead, not evidence — verify it by hand before citing it, and never build a verdict on a weak match alone. Verify a strong match too if you're unsure (`git grep`). If a match is real, cite file:line. If the same unrelated endpoint keeps coming back for this topic, stop seeing it: `node <skill>/tools/learn.mjs pm reject "<endpoint fragment>" --context "<question>" --type canwe --reason "<why it's unrelated>"`.
   - **Screen** — "On screen" shows which matching endpoints are actually called from a screen; empty means it's a `psst` candidate.
   - **Decisions and the request document** — did this section find the topic and say "we're not doing this"? If so, the answer is "there's a decision: we're not doing this."
   - **Design system** — "In the design system" shows ready-made components and patterns that fit. If everything needed is ready, this is screen-implementation work only (size shrinks); if a needed part isn't on record, add "design decision" as its own line under "Missing."

4. **Look over the fence:** the "Rivals (matrix)" section, or `pm/rivals/` and the matrix, for who's done it and how. One line is enough.

5. **Answer in this format, every time:**
   - **First line:** "We can." / "Partly." / "Not now." / "There's a decision: we're not doing this." / "Already exists."
   - **Basis:** code-based (file:line or commit shown) · doc-based (decision, request document, issue) · intent-based (weak evidence, a guess). Never say "We can" on an intent-based basis — go find evidence first.
   - **Why now:** one line (how long the backend's been ready, when a rival did it, what demand there is). Demand comes from the "Demand" section. If it says there's no demand data, say "no demand data" — not "nobody asked." Its "In interviews" part cites how many interviews raised the theme, quoting only after a privacy check.
   - **If the ledger has a previous answer:** say what it was and what's changed since (e.g. "Not now on 20 Sep → We can today: the endpoint was added on 12 Oct").
   - **Ready:** endpoint, field, or commit, each with its evidence.
   - **Missing:** bullet by bullet, each sized (S = 1–2 days, M = ~1 week, L = bigger). Check the "Size (from history)" section first — if its confidence is high/medium, use that size and say "measured from history (N similar items)"; if it's low or there's no similar work, give your own estimate marked "intent-based." A suggested owner there is a suggestion, not an assignment. If that section instead reads "Deliberately not built (decision ...)", the absence isn't an unsized gap — write "deliberately not built (decision `<ref>`)" and only size the work of reversing the decision, if asked to.
   - **When it already exists (or partly):** "Missing" becomes *where it stops*. Read the implementation itself (the job, handler, trigger or setting "Where it lives" points to), not only its label and docs, and list the limits an owner would run into, each with file:line: what input it gets, what happens on failure or downtime (retried? skipped?), what it can't be set to, and what issues ask of it (`nosy find <name>`). Second product (Twenty, 30 Sep): both answers said "the CRON trigger exists, UTC only", and the one that also read the job (a run starts with an empty payload, runs missed while the server is down aren't replayed, no one-off date trigger) won every blind grader.
   - **Wave:** where it lands on the roadmap, what it unblocks.
   - **Rival:** one sentence, if there is one.
   - Closing line *"Psst… we can do that."* only when the answer is "we can."

6. **Log the verdict** (every answer gets written to the ledger — the script counts the evidence, you give the verdict, `pm/` keeps the memory):
   `node <skill>/tools/ledger.mjs pm write "<question>" --verdict "<verdict>" --basis code|document|intent [--size S|M|L] --reason "<why now>" --evidence pm/state/canwe-last.md`
   `--verdict` takes the full phrase (`We can` / `Partial` / `Not now` / `Decided: not doing` / `Already exists`) or a short alias (`yes`/`partial`/`no`/`notDoing`/`already exists`).
   This writes `pm/canwe/<date>-<topic>.md` and `pm/canwe/ledger.json` (repo commit, files, commits, refs and endpoints from the evidence). List every past answer: `node <skill>/tools/ledger.mjs pm list`.

7. If the owner says "do it," the next command is `spill <topic>`. Nothing is written outside `pm/`.
