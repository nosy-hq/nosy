# PRD: Deadline calculation warning

- **Date / author:** September 28, 2026 · Nosy (draft, awaiting owner approval)
- **Linked item:** §501, K501

## Problem

Back-office users only notice a wrong deadline calculation on a file by opening it and checking by
hand, one file at a time. In the last 30 days, 9 of the 14 support tickets were a "wrong deadline"
complaint (pm/state/2026-09-01.md:4). On support ticket #221, a user reported that a missed appeal
deadline caused a financial loss. The backend's `deadline_calc` function runs on every file save and
writes the result to the database (apps/backend/deadline.go:118), but when the computed value and its
legal basis (statute/precedent) disagree, no warning is produced at all.

## How rivals do it

Apilex shows the deadline data pulled from UYAP alongside its statute reference
(pm/rivals/apilex-similar-note.md). The legaltech pack lists "deadline calculation + legal basis" as a
mandatory loop-matrix row, because "showing the rationale, not just the date, is what builds trust"
(skill/packs/legaltech.md:36).

## Scope

- In: when a mismatch is detected between the computed deadline and its basis statute, a red warning
  mark appears on the file's status indicator; sourced from the `deadline_check` flag.
- Out: changing the deadline calculation algorithm itself; sending an official notice, or making it
  look like one was sent (K501: we don't send outside the official channel).

## Backend ↔ screen

| Piece | Owned by | Status |
|---|---|---|
| `deadline_calc` function | backend (apps/backend/deadline.go:118) | ready |
| `deadline_check` mismatch flag | backend (apps/backend/deadline.go:140) | ready, not on screen |
| Warning mark on the file view | frontend | to do |

## Measurement

- "Wrong deadline" complaints in the support channel: drop below 5/month within 2 weeks (baseline:
  14/month, pm/state/2026-09-01.md:4).
- Fix rate on files that show the warning: 90% within the first 7 days.
- Counter-evidence: if the mark fires too often (a false positive), users may lose trust and dismiss
  it; the false-positive rate will be tracked separately in week one, and the design will be revisited
  if it exceeds 20%.
- Size: O (a week) — an appetite-style budget, not a firm estimate.

## Open questions

1. When the warning mark is dismissed, is that preference remembered per file, or per user?
2. Does the mismatch come from an update to the legal basis or a data-entry error — should the two be shown differently?
