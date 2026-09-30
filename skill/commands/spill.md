# spill <topic>

0. First, `node <skill>/tools/gather-evidence.mjs pm "<topic>" <extra words>`: decisions, request items, rival paragraphs, matrix rows, and the last 30 days' commits, in one package. Ranking weights rare words more (a word that shows up everywhere, e.g. "notification," counts for less), matches from the start of the word and against a rough stem. If `sources.json` has a `glossary` (e.g. `{"stage":["etapa"]}`), keywords expand both ways; a matched translation shows a † mark next to the heading. For a term that's not in the glossary, still add an extra word by hand. No storytelling: a PRD is a contract (endpoint, screen, acceptance criteria). Write it in two minutes.
   - kill criterion 1: word/title similarity checked against real history was only 9% correct as a "shipped" signal — pm/log.md, "kill criterion 1, second run": the pack opens with a **"Candidates — confirm"** line. Every block in it (Decisions, Request doc, Rivals, Matrix, Commits) is picked by word/title overlap, not an explicit reference — read a block's wording ("ships this sprint," "exists") as a lead to verify, never as a settled fact that something has shipped, exists, or is already in main. Only an explicit §ref/K-number/#issue link, or a real route↔screen link from the inventory, earns that in the PRD.
1. Gather evidence: `pm/decisions.md`, the relevant rival files, the last `peek`, the item in the request document, demand signal if there is one.
2. Write it in the shape of `templates/prd.md`: problem, who it's for, how rivals do it, scope / out of scope, backend ↔ screen split, measurement, open questions.
2b. Design system section: if `pm/state/design.json` exists (if not, run `dresscode` first), write which pattern and which ready components the screen will be built from, the part that's not on record ("question for the designer"), and the empty/loading/error state copy using the content guide's formula. Don't invent a component name that isn't on record; flag it as missing.
3. Follow the team's own conventions (e.g. request-document numbering, PR size). Don't let a new item number collide with an existing one.
4. Save as `pm/prd/<date>-<topic>.md`. Turning it into an issue or a PR needs the owner's explicit approval.
5. Audit it: `node <skill>/tools/audit-prd.mjs pm/prd/<date>-<topic>.md --pm pm [--package <pack>]`. It audits the decision document, not code:
   - template sections and an empty "out of scope";
   - unsourced claims and solution language in the Problem section;
   - unmeasurable acceptance criteria;
   - a K-number not in the decisions doc, and scope that conflicts with a "we're not doing this" decision;
   - the pack's never list.
   If there's a "blocker," fix it or tell the owner why you left it.
6. Before converting it for something external (an issue, a PR body): `node <skill>/tools/privacy-scan.mjs pm/prd/<date>-<topic>.md --pm pm`; if there's a high-severity finding, take it out of the text.
7. **Linear / Jira / GitHub issue** (after step 6): Nosy has no connection of its own; if the agent has a Linear, Atlassian (Jira), or GitHub connector (MCP), use it. Show the draft first (title, body, target project/team); don't create it until the owner says "open it." If there's no connector, hand over the draft in copyable form. Write the opened issue's address at the top of the PRD file.
