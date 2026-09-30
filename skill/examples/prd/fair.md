# PRD: Surface the most-used template first

- **Date / author:** September 28, 2026 · Nosy (draft, awaiting owner approval)
- **Linked item:** §502

## Problem

The template list is sorted only by creation date; most customers search the bottom of the list for
the same three templates every time. Template usage counts are kept in the `template_usage` counter
(apps/backend/template.go:52), but that data never feeds into the ordering — the list is still sorted
by date alone.

## How rivals do it

The legaltech pack lists this separately as a low-hanging-fruit signal: "if the recently-used/most-used
template isn't surfaced first, sorting by usage frequency is a cheap UX win" (skill/packs/legaltech.md:52).

## Scope

- In: pin the 3 most recently used templates to the top of the template list.
- Out: changing the template creation/edit flow.

## Backend ↔ screen

| Piece | Owned by | Status |
|---|---|---|
| `template_usage` counter table | backend (apps/backend/template.go:52) | ready |
| Template list sort logic | frontend | |

## Measurement

The goal is a noticeably shorter template-selection time; user feedback will be tracked for the first
2 weeks, and the flow is expected to feel faster and easier.

## Open questions

1. Are the 3 most-used templates computed globally, or per user?
