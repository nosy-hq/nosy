# <Product> · map

<!-- nosy:map 1 -->
The one page every command reads before answering: what the product is made of, what's live, and what only the owner knows. Each line says where it comes from: **(owner, <date>)** when the owner confirmed it, **(inferred: <file:line or commit>)** when it was read from the code or docs, **(open)** when nobody knows yet. An owner line beats an inferred one; when the code contradicts an owner line, say so and ask, don't overwrite it.

## Apps and where they run
| App / folder | What it is | Status | Source |
|---|---|---|---|
| <apps/web> | <customer web app> | <live · beta only · retired (since when) · in development> | <(owner, date) · (inferred: README.md:12)> |

Environments: <production, beta, staging…: what's in beta but not yet in production>

## Screens ↔ code
| Screen (the owner's name) | Code | Backend area | Source |
|---|---|---|---|
| <İş Kutusu / Inbox> | <apps/web/src/pages/inbox> | <internal/inbox> | <…> |

## Deliberately off
- <feature>: <why> · enforced in <file:line> · <(owner, date) · (inferred: decision K12)>

## What we say outside vs what's inside
- <claim on the site, or in sales> → <what the product actually does> · <(owner, date): e.g. "said this way on purpose">

## Past audits and baselines
- <date>: <what was measured, the numbers> · <where> · <(owner, date)>

## Words ↔ code names
| The owner's word | Code names |
|---|---|
| <okundu bilgisi> | <seen, read_at> |

## Open questions for the owner
- <what the draft couldn't settle, one line each>
