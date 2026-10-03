# Legaltech pack

## 1. Who it's for

Products for law firms, corporate legal departments (in-house counsel, banks), or products working directly with court/administrative processes: notice tracking, deadline/statute-of-limitations calculation, case file management, contract review, case-law research, e-discovery. The common thread: the cost of an error is high (a missed deadline = a lost right), the source has to be official/judicial, and a human (the lawyer) usually gives the final sign-off.

## 2. Rival universe

**Global**
- Harvey (harvey.ai) - enterprise legal AI, broad workspace
- Legora (legora.com) - enterprise legal AI, multi-step workflows
- Spellbook (spellbook.legal) - contract review inside Word
- Ironclad (ironclad.com) - contract lifecycle management (CLM)
- Clio (clio.com) - practice management
- Litera (litera.com) - document automation and comparison
- Relativity (relativitysoftware.com) - e-discovery
- Everlaw (everlaw.com) - e-discovery and case prep
- CoCounsel / Casetext (casetext.com, part of Thomson Reuters) - legal research AI
- Lexis+ AI (lexisnexis.com) - legal research AI
- vLex / Fastcase (vlex.com) - case-law/decision database
- DoNotPay (donotpay.com) - consumer-facing automation (different concept, included for reference)
- Onit (onit.com) - enterprise legal workflow/spend management

**Turkey**
- Onedocs (onedocs.com.tr) - practice/case management, published pricing
- Apilex (apilex.com.tr) - UYAP integration + case-law search
- Safahat AI - UYAP + notice-tracking focused
- UYAP (National Judiciary Informatics System, uyap.gov.tr) - government infrastructure, not a rival but the ground every Turkish legaltech product has to integrate with

## 3. Rows to add to the cycle matrix

| Row | Why it belongs in the matrix |
|---|---|
| Integration with a court/administrative system (e.g. UYAP, e-Devlet, or a foreign equivalent like PACER/CE-Filing) | The primary source of the data; without integration the product stays secondary |
| E-notice/official notice system connection (UETS, KEP in Turkey) | Where the deadline clock starts |
| Deadline calculation + legal basis (which article/precedent sets the deadline) | Showing the reasoning, not just a date, is what builds trust |
| Case-law/precedent search and citation verification | The area with the highest hallucination risk; verification is what differentiates the product |
| Contract/pleading templates and automation | Where time savings are most visible |
| Document/file vault and version control | Needed for evidentiary integrity and auditability |
| Human approval / lawyer review step (human-in-the-loop) | The point where AI output stops before going to court or the other party |
| On-prem deployment / data residency option | Frequently required in large firm and bank sales |
| Data-protection compliance (Turkey's KVKK/GDPR) and retention period | A mandatory field for any product processing client data |
| Multi-file/matter management and team permissions | Diverges as a firm grows |
| Billing/time-tracking integration | Frequently asked in B2B sales, missing in most AI-native rivals |
| Audit trail (who saw/changed which document, when) | Requested for professional liability insurance and internal audit |

## 4. Low-hanging-fruit signals

- A case-law/precedent link has an empty source URL (a field like `source_url: null/""` in the mapper): the user can't verify the source - possibly a cheap data fix.
- Deadline calculation exists but the legal basis (article/precedent) isn't shown on screen: the data is probably already in the backend, moving it to the screen is small work.
- UYAP/e-notice data is being pulled but no notification/alert fires from it: the classic "ready but unused" gap.
- Contract/pleading templates exist but the most recently used/most frequently used one isn't shown at the top: sorting by usage frequency is a cheap UX win.
- A rival's site shows a "free trial" or open pricing and ours doesn't: possibly a cheap page change that reduces sales friction.

## 5. Mandatory PRD sections

- **Legal basis:** which statute, communique, or precedent every deadline/calculation/alert relies on; with the article number.
- **Data protection impact:** how client/case data is processed in this feature, the retention period, who can access it.
- **Human approval point:** the step at which AI output cannot leave (to court, the other party, the client) without a lawyer's sign-off.
- **Hallucination/accuracy risk:** if the feature generates a decision/precedent/citation, the verification mechanism and the cost of a wrong output.
- **Out-of-scope regulatory actions:** must explicitly state which official action (e.g. signing, sending a notice) the feature does not perform.
- **Rollback/dispute flow:** how a miscalculated deadline or a wrongly matched file gets corrected once noticed.

## 6. Never list

- Presenting a deadline/due date calculation with no legal basis (article/precedent) to the user as a firm date.
- Sending an AI-generated citation or case summary out (in a pleading, an email, a client report) without human approval.
- Showing a case-law/precedent source without verification (no source URL) in a way that leads the user to believe it's real.
- Sending, or appearing to send, an official notice through a channel other than the official notice system (UETS in Turkey, e.g. an unauthorized KEP integration) - this exceeds the product's own authority and is never assumed without the owner's approval.
- Sending client/case data to a third-party AI provider while KVKK/GDPR scope is unclear.
- Allowing one firm's file/client data to leak into another's through an authorization bug (a multi-tenant isolation gap).

### Patterns (preread `--legaltech`)

Searched in the PR title, body, and file paths (case-insensitive). A match is a warning, not a verdict: it tells the owner "look at this." Format: `- name :: regex`.

- Sent out without approval :: auto[- ]?send|without (human )?(approval|review)|skip(s|ping)? (the )?(approval|confirm)
- Notice sent outside the official channel / KEP :: \bKEP\b.{0,40}send|send.{0,40}\bKEP\b
- Deadline with no basis :: deadline.{0,40}(hardcode|guess|assume)
- Citation without a source :: citation.{0,40}(without|no|unverified).{0,20}(source|url)
- Client data to a third-party AI :: (client|matter).{0,60}(openai|openrouter|third[- ]party)
- Tenant (firm) isolation :: cross[- ]tenant|(office_id|tenant_id|org_id).{0,40}(remove|drop|skip|bypass)|(remove|drop|skip|bypass).{0,40}(office_id|tenant_id|org_id)

## 7. Metrics

- Missed deadlines / miscalculated due dates (target: zero)
- Case-law/citation accuracy rate (percentage of output with a verifiable source)
- Average file/notice processing time (from notice received to task created)
- Lawyer acceptance rate (share of AI suggestions accepted unchanged) and correction frequency
- Weekly usage per active file/matter (adoption within the firm)
- Share of support tickets that are "wrong/missing data"
- Renewal rate (NDR by firm/organization) - read alongside the B2B SaaS metrics

## 8. Sources

- https://ailawyer.pro/blog/legal-tech-companies (2025-2026 legaltech companies and valuations, accessed 2026-09-28)
- https://www.lawnext.com/2026/01/the-10-legal-tech-trends-that-defined-2025.html (2025 legaltech trends, accessed 2026-09-28)
- https://harvey.ai, https://legora.com, https://spellbook.legal, https://ironclad.com, https://clio.com, https://litera.com, https://relativitysoftware.com, https://everlaw.com, https://vlex.com, https://onit.com (product sites, accessed 2026-09-28)
- https://onedocs.com.tr, https://apilex.com.tr (Turkish product sites, accessed 2026-09-28)

## 9. Expansion axes and registries

Read by `atlas` ("where next?"). Use these axis names, unchanged, in every candidate's report so `nosy atlas` lines them up. A score is 1 (bad for us) to 5 (good for us); a score counts only when its source was opened in the run (`read`). Everything below about a particular source is from one earlier research run on 3 Oct 2026 and was not re-read when this was written: "(unverified)" until a scout reads it again.

| Axis | What a 5 means | Where to look |
|---|---|---|
| Data access and licence | A primary source of decisions and statutes can be fetched by a program (open API or bulk download), and its own terms allow commercial use and AI or vector use. The terms are read on the source's own terms page; a page that couldn't be opened is graded `terms-unread`, never assumed free. | The source's API docs and terms page; the open-data portal's dataset page for the licence |
| Market | Many practitioners, mostly in small and mid-size offices, and prices that a paid tool can live at. | The bar or law society's own statistics (with the year), published prices of the tools already sold there |
| Rival density | Few or no products already cover deadlines from notices and cited research; the ones that do are named with their price and what they lack. | `neighbors`-style research per candidate; a rival's own pricing page |
| Notice and e-service channel | Court notices reach a channel a product can use: an API, a system connection, or an e-mail that carries the content. A notice e-mail that only says "new message in file X" scores low: the content sits behind a login. | The judiciary's own documentation for lawyers |
| Rule similarity | The deadline rules are close enough to the home rules that the core loop works on day one, or a rule table is published. | The procedural code or the court's published rules, with article numbers and the date read |
| Regulatory friction | Few barriers on cross-border transfer of client data, data location, rules on AI, professional-conduct rules about outsourcing or AI, and tax on selling there. Each point with its source and "as of <date>". | The regulator's own pages; a law firm bulletin is `snippet` until the primary text is read |
| Bridge | Customers, partners, an office, trade or diaspora ties already link us to the market, and the first person to ask is named. | Own customer base, public trade and bilateral data, firms with offices in both places |
| Partner and marketplace availability | A place a tool can be listed or found: a practice-management marketplace, a bar association, a law school or a community, an AI assistant's connector directory. | The marketplaces' own listing rules |
| Demand-test cost | A first honest test of demand is cheap and fast (a free calculator, a listing, a landing page, about 8 weeks) and the number that counts as a yes is written down before it starts. | The channel above; the cost of the test, not of the product |

### Registries and data sources (starting points, not findings)

- **Legal Data Hunter** status file: a public JSON list of legal-data sources by country with status and row counts. `nosy atlas seed <file> <country codes>` counts it. https://zachlaik.github.io/LegalDataHunter/status.json. Its collectors are AGPL-3.0 and the status file states no licence of its own, so don't copy its content into a product without asking its maintainers. Its counts can repeat rows across sources that read the same API; `atlas seed` flags shared hosts and adds nothing up.
- **A national open judiciary API** is the model of a good `Data access and licence` score: for example the Dutch judiciary's open data service (https://data.rechtspraak.nl, keyless; listed as CC0 on https://data.overheid.nl/dataset/uitspraken-rechtspraak-nl; its own terms page returned 403 to a program in that run, so "free to use" rested on the portal's listing, which is why `terms-unread` exists). (unverified)
- **Licence traps to check on every source (each seen once, unverified):** a computational-analysis licence with its own wording on vector databases; a dataset under a non-commercial licence (CC BY-NC) that a paid product can't use as it is; a registry whose collectors and whose data have different licences.
- **A research run's own limits (3 Oct 2026):** 200 searches per agent and a scraping tool's credits both ran out, government sites answered 403, and agents re-fetched the same pages. Expect it; the scout's fallback chain and the `unreadable` grade exist for this.

Output of `atlas` is research, not legal advice. A rule or a deadline in a candidate's report is what the source says on a date, for the owner to check with a lawyer in that place.
