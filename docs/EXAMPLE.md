# A real run: Nosy on chatwoot/chatwoot

This is what Nosy's counting scripts printed on a public repo on 30 September 2026. No model wrote any of it. Nothing was edited except that whole lines were removed, each gap marked `[… N lines removed]` (N counts non-blank lines). Lines that name people (commit and issue authors) were removed too. The `$` lines are the commands, not output.

We picked [Chatwoot](https://github.com/chatwoot/chatwoot) (MIT, open tracker, most commits tied to a PR number) so anyone can check every line against the public repo. This is not a review of Chatwoot, and its maintainers have not seen it.

## What it ran against

- **Repo:** chatwoot/chatwoot, branch `develop`, commit `03702d176d6a9c94f421ffa10f472464f8ec198c` (29 Sep 2026), a shallow clone (`--depth 400`).
- **Nosy:** 0.15.0, run on 30 Sep 2026.
- **Issues and PRs** were read live with read-only `gh` calls, so those lines change when you rerun. The code, git and inventory lines depend only on the clone.
- The only thing written to the clone was an untracked `pm/` folder.

## The commands

```
git clone --depth 400 https://github.com/chatwoot/chatwoot.git && cd chatwoot
node <nosy>/skill/tools/nosy.mjs setup .
# one edit in pm/sources.json: inventory.frontend  []  ->  ["app/javascript"]
node <nosy>/skill/tools/nosy.mjs peek 30d
node <nosy>/skill/tools/nosy.mjs shipped 30d
node <nosy>/skill/tools/nosy.mjs inventory
node <nosy>/skill/tools/nosy.mjs psst
node <nosy>/skill/tools/nosy.mjs canwe "retry failed webhooks"
```

`setup` found the API spec (`swagger/swagger.json`) but left the frontend folder empty, so a person named it; without that edit all 156 endpoints land under "no screen", marked "should be checked". Every other line of `pm/sources.json` is as `setup` wrote it.

Two commands need an agent to finish, and it was not run: `canwe` prints an evidence skeleton plus a guess, and the verdict is the agent's; `psst` prints an unchecked draft, and its refuter step (a model) was skipped.

## peek and shipped: what landed

```
$ nosy peek 30d
# Delivery · --since 2026-08-31 00:00 origin/develop

- **End ref:** origin/develop — default branch
[… 1 line removed]
- **Latest main commit:** 03702d17
[… 398 lines removed]
- **Dependency updates:** 2 commits ()

## Without a reference (60)

other 3 · fix 29 · style 1 · feat 17 · refactor 3 · chore 4 · test 1 · docs 1 · ci 1
[… 25 lines removed]
```

```
$ nosy shipped 30d
── Decisions that shipped (explicit links: issue ↔ PR) ──
Integration branch: origin/develop (default branch)
decisions: 8 issues (1 labeled/milestoned, 7 linked to a merged PR only); 101 other issues not counted as decisions.
Last 30 days: 8 decisions. too few to say (n=7). Median too few to say (n=7) to main. Reverted within 14d: too few to say (n=7). Patched after: too few to say (n=7).
  mapped 7/8 (closes 6, mentions 1, timeline 0, commit-grep 0) · patched 0
written: pm/state/shipped.json
[… 431 lines removed]
── recent: merged since the last run, and close to merging ──
[… 2 lines removed]
## Merged since the last run (38)
[… 40 lines removed]
## Close to merging (3)
[… 5 lines removed]
```

## inventory: which endpoints have a screen

```
$ nosy inventory
# Backend inventory · origin/develop

156 endpoints, 0 definitely no-screen, 70 should be checked.
[… 76 lines removed]
## Used

86 endpoints are used on screen.
```

## psst: cheap work, unchecked

```
$ nosy psst
# Low-hanging fruit · 2026-09-30 · origin/develop
[… 1 line removed]
| # | Score | Effort | Type | Work | Asked for | Evidence |
|---|---|---|---|---|---|---|
[… 18 lines removed]
| 19 | 1.5 | M | Screen on mock data | story/ComposeNewConversationForm.story.vue | 2× · 1 cust. | app/javascript/dashboard/components-next/NewConversation/components/story/ComposeNewConversationForm.story.vue:3 |
[… 6 lines removed]
| 26 | 1.5 | M | Screen on mock data | story/CustomAttributes.story.vue | 1× · 1 cust. · new | app/javascript/dashboard/components-next/CustomAttributes/story/CustomAttributes.story.vue:2 |
[… 16 lines removed]
| 43 | 1 | S | Shipped, not tied to any plan | tiktok · 1 features in the last 90 days | — | 646b4737 feat(tiktok): add inbox access request (#15637) |
| 44 | 1 | S | Shipped, not tied to any plan | slack · 1 features in the last 90 days | — | 50aff719 feat(slack): add alerts only mode for the Slack integration (#15605) |
| 45 | 1 | S | Shipped, not tied to any plan | automation · 1 features in the last 90 days | — | 406eb8f6 feat(automation): allow send email transcript action to target the contact's email (#15373) |
[… 36 lines removed]
**14. #15920 Retry account and API-inbox webhooks on timeouts and 5xx, like agent-bot webhooks**
- Demand: asked 15 times by 11 customers since 2026-07-28 · rising (10 in the last 30 days, 3 before)
[… 1 line removed]
**15. #16063 Webhooks: expose message status in message_created / message_updated payloads**
- Demand: asked 8 times by 7 customers since 2026-07-22 · rising (6 in the last 30 days, 1 before)
[… 2 lines removed]
Unchecked draft: 0 held on purpose (not cheap work), 0 from the team's own notes. To check it: `nosy refute pack` → the nosy-refuter agent → `nosy refute apply` (psst.md step 3); then `nosy decision` for the one next product decision.
```

## canwe: "can we retry failed webhooks?"

```
$ nosy canwe "retry failed webhooks"
[… 1 line removed]
# canwe: retry failed webhooks
[… 2 lines removed]
## In the code (read this first)
[… 1 line removed]
### "retry" · 141 code file(s), 304 doc(s) at origin/develop
[… 2 lines removed]
- app/jobs/agent_bots/webhook_job.rb:3  retry_on Webhooks::Trigger::RetryableError, wait: 3.seconds, attempts: 3 do |job, error|
- app/jobs/agent_bots/webhook_job.rb:12  rescue Webhooks::Trigger::RetryableError => e
[… 2 lines removed]
- lib/webhooks/trigger.rb:3  RETRYABLE_AGENT_BOT_STATUSES = [429, 500].freeze
- lib/webhooks/trigger.rb:5  class RetryableError < StandardError
[… 39 lines removed]
## Ready in the backend

### Weak matches — verify
[… 1 line removed]
- GET `/api/v1/accounts/{account_id}/webhooks` — swagger/swagger.json:1 (no screen) — matched: webhooks
- POST `/api/v1/accounts/{account_id}/webhooks` — swagger/swagger.json:1 (no screen) — matched: webhooks
- PATCH `/api/v1/accounts/{account_id}/webhooks/{webhook_id}` — swagger/swagger.json:1 (no screen) — matched: webhooks
- DELETE `/api/v1/accounts/{account_id}/webhooks/{webhook_id}` — swagger/swagger.json:1 (no screen) — matched: webhooks

## On screen

None of the matching endpoints are used on screen (or there's no matching endpoint).
[… 18 lines removed]
## Size (from history)

**S** · active-day median 1 (p25-p75: 1-1) · confidence: medium · keyword coverage 77%

The active-day median of 8 similar item(s) is 1 (p25-p75: 1-1 days), commit median 1, file median 8.5. · medium similarity: coverage 77%
[… 5 lines removed]
## Demand

- **#15920 Retry account and API-inbox webhooks on timeouts and 5xx, like agent-bot webhooks** (#15920): asked 15 times by 11 customers since 2026-07-28 · rising (10 in the last 30 days, 3 before)
- **#16063 Webhooks: expose message status in message_created / message_updated payloads** (#16063): asked 8 times by 7 customers since 2026-07-22 · rising (6 in the last 30 days, 1 before)
- **#15914 Webhooks: include who performed the change (performed_by) in conversation and messa** (#15914): asked 3 times by 3 customers since 2026-07-22 · new (2 in the last 30 days, 0 before)
- **#15835 [Feature Request / Reliability] Isolate Captain chat response jobs to high-priority** (#15835): asked 2 times by 1 customer since 2026-09-16 · new (2 in the last 30 days, 0 before)

## Suggested verdict (script's guess)

**Not now: no trace in the backend** — 4 endpoint(s) only share a single generic term with the question — see "Weak matches" below and verify by hand before trusting it. Customers asked for it: asked 15 times by 11 customers since 2026-07-28 · rising (10 in the last 30 days, 3 before).

The agent gives the final verdict; this is only an evidence skeleton.
```

The first file to open is `app/jobs/agent_bots/webhook_job.rb`: it retries failed webhook calls (3 attempts) for one kind of webhook, agent bots. The plain `app/jobs/webhook_job.rb` has no retry, and an open Chatwoot request (#15920) asks for the same on account and inbox webhooks. That is the shape Nosy is meant to surface: something exists for one case, and a request asks for the rest.

## How to read it

Every line is something a script counted or matched in files, git history and public issues. Open the `file:line` lines first. The size is the median of similar past changes in git, and the demand line counts related issues among the newest 200: both are estimates. The verdict line is a guess the agent is meant to overrule. This run does not show that the change would take about a day, that 15 people asked for one thing, or that Chatwoot lacks a screen or a feature. It shows only what the scripts printed that day.

## Where this run was wrong

Listed so you can see them too.

- **The verdict guess contradicted the code lines above it.** It said "Not now: no trace in the backend" because it only counted four `webhooks` endpoints from the API spec. The agent is supposed to read the code section first and overrule it. **Fixed since:** when the code section lists lines for the question, the guess now says "Partly there: exists in X; missing: Y" and names them.
- **"no screen" was wrong for webhooks.** Chatwoot's dashboard has a client for them (`app/javascript/dashboard/api/webhooks.js`) that builds the URL from a shared base class, and the screen matcher does not read that. The same thing happened when we asked about canned responses and automation rules, which both have settings screens; 70 endpoints ended up as "should be checked". **Fixed since:** resource names given to a base API class, and frontend files or folders named for the endpoint, now count; with such a base class the report says "no screen found (frontend calls built dynamically aren't seen)".
- **"asked 15 times by 11 customers" is a cluster, not one request.** It groups related webhook issues among the newest 200. Issue #15920 itself had no comments and no reactions when we looked. The count also moved between two runs on the same day (16 and 12 in an earlier run, 15 and 11 here). We did not chase why; the window is the newest 200 issues, so it shifts as issues arrive. **Fixed since:** a cluster now reads "N related issues, M people", and the window is printed next to the count.
- **The size came from loosely similar changes.** The three similar items it listed (removed above, they name people) were all WhatsApp changes, not webhooks. The output calls the confidence "medium".
- **`psst` listed component stories as screens on mock data.** The `*.story.vue` files are Histoire previews for developers, not screens. It also ranked open requests that already have an open PR (for example #16065, with #16087 open) as cheap work; the refuter step exists to catch that and was not run. **Fixed since:** stories and specs are no longer screens, and an issue with an open PR is labelled "a PR is already open (#N)" and scores 0.
