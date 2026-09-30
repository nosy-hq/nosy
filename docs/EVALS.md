# How we tested it, including where it lost

> Nosy about your product. Never your data.

These are the authors' own tests. We wrote the setup, ran it, and chose the grading rules. Nobody outside the project has checked them. Read the numbers with that in mind, and read the limits before the results.

This page covers one command, `psst` ("what cheap, valuable work could we ship this week?"). We have run other comparisons and have not written them up here. Publishing one that is written up is a selection, so weigh it that way.

## What we compared

Nosy's `psst` against the same kind of agent with no Nosy, on the same repo, asked the same question, blind.

- **Question, same words for both:** "Which at most 5 cheap and valuable pieces of work can we ship this week? For each, why it's cheap and the evidence (file:line)."
- **Nosy arm:** a Sonnet agent ran `nosy psst`, read the receipts, wrote a draft, had it checked by the `nosy-refuter` agent in a fresh context, and answered from the checked list.
- **Plain arm:** a fresh Sonnet agent with only the repo. No Nosy, no `pm/` folder.
- Neither arm could see an issue tracker, because on the backtests it would leak the future.

## Method

- **Who judged.** Model agents, not people. For each question, one Sonnet judge and one Opus judge. Each saw both answers as "A" and "B", with the order swapped between the two judges, and had the repo to check them against. The key was kept in a separate file. No human re-checked their verdicts.
- **What a "real finding" meant.** For each item the judge marked whether it holds: the claims match the code at the cited line, the work isn't already done or parked on purpose, and "cheap" isn't understated. It then named a winner. In their reasons the judges put accuracy first, then value to a user or the business. We did not save the judge prompt, so this is reconstructed from what the judges returned.
- **Blinding.** Answers went to the judges as written, not rewritten into one template, so style could have given the source away.
- **Runs.** One answer per arm per question. Three questions, six gradings.
- **Precision.** Each judge's "holds" marks over the items in that answer, summed over both judges. Nosy gave 8 items, plain 14, and each was marked twice, so the denominators are 16 and 28.
- **Repo state.** Questions 1 and 2 are a private production web app, name withheld by its owner: question 1 as of 28 Sep 2026, question 2 as of 18 Sep 2026. Question 3 is the public [Twenty](https://github.com/twentyhq/twenty) repo at commit `b92731b355` (18 Sep 2026). For the two 18 Sep points, the answering agents got clones with every later commit and ref removed. The judges got the full history and also judged the next 10 days as hindsight: did it ship, and how big was it.
- **When.** 28 and 29 Sep 2026, Nosy 0.14.x.

## Results

| Run | Date | Setup | Nosy–plain (gradings) |
|---|---|---|---|
| 1 | 28 Sep | 1 question, 1 judge | **0–1** |
| 2 | 29 Sep | same question, 3 gradings | **1–2** |
| 3 | 29 Sep | same question, 4 gradings | **2–2** |
| 4 | 29 Sep | 3 questions, 6 gradings | **5–1** |

### Where it lost

- **Run 1: plain won.** Nosy's two picks were true but changed nothing today, because only one provider sets the flag they would switch on. "About 10 lines" was low: a later real commit doing it touched 13 files (+447/−62, with a new 294-line test). Plain's picks were a field the backend already carried in one struct but never passed on, and a screen already built and waiting for the backend. `psst` had no signal for either.
- **Run 2: plain won 2 of 3.** Nosy recommended merging a branch that a later team decision had overruled. It called an item "data entry only" although the screen's own note said the fields didn't exist. It sized a cross-service change as one wire. The judges put accuracy first and marked these as wrong. The one Nosy win was the same pair of answers as a Nosy loss: with the order swapped, a different judge picked the other one.
- **Run 3: a tie, 2–2.** The three run-2 errors were gone. The remaining loss was one item built on fields whose own code comment says leaving them out was deliberate and cites a ticket. All four judges flagged it.
- **Run 4, question 2: plain won with the Opus judge** (Sonnet: Nosy, low confidence). See the next section.

### What changed, in order

1. After run 1: a signal for screens built and waiting for the backend.
2. After run 2: **receipts** (`skill/tools/psst-receipts.mjs`). For each top item a script attaches the request's own text, the decisions that name it (dated from git), whether the branch or commit it mentions is already merged or older than a decision, and which apps contain the code names. New rules for the agent: an item whose own note lists missing fields is not "data entry"; never recommend merging a branch without its receipt; a name missing from an app the change must reach means a cross-app change.
3. After run 3: a **held-on-purpose gate** (a code comment at the evidence carries a ref, or a decision names the file: not cheap work) and the **refuter** (`agents/nosy-refuter.md`), a read-only agent in a fresh context that tries to break each item before you see the list. Refuted items drop; weakened ones take its corrected size (`skill/tools/psst-refute.mjs`).

Each error from runs 2 and 3 is a named regression case in `skill/test/psst-receipts.test.mjs`.

### Run 4

| Question | Sonnet judge | Opus judge | 10 days later |
|---|---|---|---|
| 1. private app, 28 Sep | Nosy | Nosy | (current state, no hindsight) |
| 2. same app, 18 Sep | Nosy (low confidence) | **plain** | Nosy: 2 of 3 items shipped. Plain: at least 4 of 5. |
| 3. Twenty, 18 Sep | Nosy | Nosy | neither answer's items shipped |

**Precision** (items the judges marked as holding): Nosy 16 of 16, plain 18 of 28 (0.64). The refuter weakened 2 of Nosy's 8 items and dropped none. The two judges disagreed about plain's items: on question 1 one said 4 of 5 held, the other 5 of 5.

## Limits

- **Not a clean test.** Question 1 is the repo and question the fixes were built against, so Nosy's 2–0 there says little. Question 2 is the same app at an earlier date. Question 3 is a different product, but we had run Nosy on it earlier the same day, for unrelated fixes. Nothing here is a holdout.
- **Fixes came after the losses.** Everything in "What changed" was made after seeing a loss. Runs 2 to 4 are not independent of runs 1 to 3.
- **Mostly one product.** Two of three questions are one private app. You can't inspect it. Only question 3 can be re-run by anyone.
- **Small n.** Three questions, one answer per arm each. We don't know how much one answer varies from run to run. The run-2 flip shows the judging alone is noisy.
- **Judged by our setup, by models.** We wrote the judge instructions, and the judges' reasons weigh accuracy first, then user value, which favours a short checked list over a long one. The judges are Claude models, like the answerers, and the refuter was built to check the way a strict judge would. No person re-checked a verdict.
- **Fewer items help precision.** The question said "at most 5". Nosy gave 8 items over three questions, plain 14. A shorter list is easier to keep correct.
- **Not cost-matched.** The Nosy arm ran extra scripts and an extra model pass. We didn't measure tokens or time, and we haven't run it with the refuter or the gate switched off.
- **Hindsight is a proxy.** "Shipped within 10 days" mixes what the team was already doing with what was worth doing, and says nothing about whether it was cheap.
- **Files we can't publish.** The answers and grades for the private app contain its code. Those for Twenty are public-repo material; they are not in this repo yet.

## Known misses

- **The team's own next list.** On question 2, plain took all five items from a "what's next" document in the repo, and at least 4 shipped within 10 days. Nosy didn't read it as a signal. We built one afterwards (`skill/tools/team-next.mjs`) and checked it against the same data. That is not a re-test.
- **Noise on a big repo.** On Twenty the scripts' list was unusable. A vendored bundle counted as endpoints, Storybook decorators as "screens on mock data", one billing banner behind every plan item. The answering agent read the code instead. Fixed since; we have not re-run the comparison.
- **A weaker third item.** Nosy's third item on question 2 hadn't shipped by day 10.
- **First drafts overreached.** The refuter had to weaken 2 of 8 items: a size that was too small, and a fix that reached only new workspaces.
- **A field one layer carries and the next drops.** Plain's best pick in run 1. We added `nosy fields <From> <To>` for it. Not re-tested either.

## What would change our mind

We would take "psst beats plain" off the page if:

- on repos we have not fixed against, at least five questions, plain wins or ties more than half the gradings in both orders;
- plain's precision matches Nosy's when the refuter and gate are off, which would say they don't earn their extra model pass;
- judges given a coverage-first rubric consistently prefer plain's longer lists and you find that rubric fairer.

## Reproduce it, or beat it

The Twenty question can be run by anyone.

```bash
git clone https://github.com/twentyhq/twenty && cd twenty
git checkout b92731b355     # 18 Sep 2026; make sure no branch, tag or remote ref reaches a later commit
npx github:nosy-hq/nosy setup .     # proposes pm/sources.json; check its paths
npx github:nosy-hq/nosy psst        # signals and receipts: pm/state/lowhanging.json, receipts.md
# your agent writes pm/state/psst-draft.json (at most 5 items), then:
npx github:nosy-hq/nosy refute pack     # pm/state/refute-packet.md
# hand the packet to the nosy-refuter agent, save its JSON as pm/state/refute.json
npx github:nosy-hq/nosy refute apply    # pm/state/psst-final.json, pm/state/refute-log.jsonl
```

In Claude Code, `/nosy:psst` runs all of it. Pin a release tag if you want to know which code you run (`docs/INSTALL.md`). The plain arm is a fresh agent with the same checkout, the question above and no Nosy.

To judge: give both answers as A and B to a fresh agent that has the repo and its full history. Ask it to check every cited `file:line`, mark each item as holding or not, and name a winner. Repeat with the order swapped and a different model. For hindsight: `git log --since=2026-09-18 --until=2026-09-28`.

To check that each loss is guarded: `node --test skill/test/psst-receipts.test.mjs skill/test/psst-refute.test.mjs`.

To challenge a result, open an issue with a repo, a commit and a question where plain does better. We will add it here, whichever way it goes.

*Results from 28 and 29 Sep 2026. Page written 30 Sep 2026.*
