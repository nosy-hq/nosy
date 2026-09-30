# peek

> `shipped` runs this command's core (`collect-status`) plus explicit links and `recent`; `peek` stays for the gap view (ready but not on screen) and release notes.

Goal: what the team actually delivered since the last `peek`, what this makes possible, what's still missing.

1. Starting point: the "last commit read" line in the newest file under `pm/state/`. If there isn't one, the last 7 days.
2. `git fetch`, then `node <skill>/tools/collect-status.mjs <repo> <last commit or date> --pm pm`: groups commits by reference (with `--pm`, it uses the `refs` patterns from `sources.json`; otherwise it falls back to K-decision, §-item, #-issue, OWNER-§, and the general UPPERCASE-number pattern), collapses dependency bumps into a single line. It also reads open PRs' commits (with their full title; GitHub's "…"-truncated titles are stitched back together; the "Last" column shows the real latest time even when main and PR commits are mixed). With no explicit end-ref, it detects the integration branch itself (some projects merge day-to-day work to a branch other than the default one, e.g. `next`/`preview`, and only promote it at release time): the branch with the most merged PRs in the last 90 days, via `sources.json`'s `ref` and `issue.repo`; falls back to `ref` when `gh`/the network is unavailable, or when an explicit `integrationBranch` string is set in `sources.json` (that setting always wins). The output's "End ref" line says which branch was used and why. Add `--json pm/state/status.json`: the page's auto-section reads this. Write the output to `pm/state/<date>-delivery.md`; you do the interpreting.
3. Merged and open PRs: `gh pr list --state all --search "updated:>=<date>"`; CI status for the open ones (`gh pr checks`).
4. Issues: opened, closed, latest comments (`gh issue list --state all`, `gh issue view N --comments`).
5. The diff in decision and request documents (paths from `product.md`): new decisions (K-numbers etc.), items whose status changed in the request document. Read statuses from the file, don't guess.
6. Match and produce three lists:
   - **Delivered:** what, who, commit/PR.
   - **Ready but unused:** the backend offers it, no screen reads it (e.g. a `dropped:` line in a mapper, "Frontend does not read" in a request item).
   - **Doc contradicts code:** items whose status is stale.
7. Verify it yourself: for every endpoint/field you claim, check the file or the commit. If you're not sure, "(unverified)."
8. Write `pm/state/<date>.md`: the range read (first..last commit), the three lists, open questions. Then update the product's column in `matrix.json`, mark changed rows `moved`.
9. Refresh the page's "Today" section with `node <skill>/tools/auto-section.mjs pm <page.html>`, then run `tea`.
10. If an outward-facing summary is needed: `node <skill>/tools/write-notes.mjs pm <the starting point from step 1> --audience team [--pr]`. If it's going to customers, use `--audience customer`: internal references, commit hashes, and names drop out; an item with no copy is flagged "(copy needed)" — the script doesn't invent marketing lines. `--audience manager` opens with a single number. It's a draft: sending it out needs the owner's approval and, first, `privacy-scan`.
11. For "what merged since I last looked, and what's about to" as a standing view (not a one-off range read): `node <skill>/tools/recent.mjs pm` (`nosy recent`). Incremental on its own — the window starts at the last recorded run in `pm/history/runs.jsonl`, not this step's date.
