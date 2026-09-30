# Fintech pack

## 1. Who it's for

Products that digitize payments, banking, credit, investing, insurance, or crypto asset flows - built around the movement of money, KYC/AML, and a regulatory license. The audience can be a consumer (a consumer wallet, an investing app) or a business (payment infrastructure, card issuing, accounting/finance SaaS); the common thread is that money or financial data passes through the product, and it falls directly under a regulator's authority (in Turkey: BRSA, CMB, MASAK, CBRT; in the EU: the EBA/national central banks).

## 2. Rival universe

**Global**
- Stripe (stripe.com) - payment infrastructure, card issuing, Stripe Treasury
- Adyen (adyen.com) - enterprise payment platform
- Plaid (plaid.com) - open banking / account linking
- Marqeta (marqeta.com) - card issuing infrastructure (issuer processor)
- Wise (wise.com) - cross-border transfers
- Revolut (revolut.com) - digital bank / super app
- Ramp (ramp.com) - corporate card + spend management
- Brex (brex.com) - corporate card + treasury
- Chime (chime.com) - challenger bank (US)
- N26 (n26.com) - challenger bank (EU)
- Checkout.com (checkout.com) - payment infrastructure
- Alloy (alloy.com) - identity/KYC decision engine

**Turkey**
- Papara (papara.com) - e-money/wallet
- Param (param.com.tr) - e-money, ParamPOS, ParamKart
- iyzico (iyzico.com) - payment institution / virtual POS
- Paycell (paycell.com.tr) - Turkcell techfin, e-money
- Ininal (ininal.com) - prepaid card
- PayTR (paytr.com) - virtual POS
- Sipay (sipay.com.tr) - payment institution
- BKM Express (bkmexpress.com.tr) - interbank shared wallet (BKM)
- Colendi (colendi.com) - BNPL / credit scoring
- Moka (moka.com) - virtual POS / marketplace payments

## 3. Rows to add to the cycle matrix

| Row | Why it belongs in the matrix |
|---|---|
| KYC/AML flow (identity verification, sanctions/PEP screening) | The mandatory first step of every money-movement product; rival UX diverges here |
| Open banking / account linking (Open Banking in Turkey, PSD2 in the EU) | Data access is the basis of competition; who's linked to which bank makes a difference |
| Card issuing / virtual cards (issuing) | Distinguishes a product that can issue its own cards from one that only collects payments |
| BRSA/CMB/MASAK compliance (Turkey) or the local equivalent | The license type directly limits what the product can do |
| Fraud/anomaly detection | An invisible layer that drives loss rate and trust perception |
| Reconciliation / statement generation | The real reason finance teams use B2B fintech |
| International transfers / multi-currency | Critical for expansion plans, often missing among Turkish players |
| Audit trail and immutable records | The first thing requested in a regulatory review |
| PCI-DSS scope / card data storage model | Determines the architecture: who stores the PAN, who tokenizes |
| Notification/alert engine (transaction, limit, fraud alert) | A measurable difference in user trust and retention |
| API/developer experience (sandbox, webhooks, SDK) | What speeds up the purchase decision in B2B fintech |
| Crypto/asset support (if applicable) | A question asked in rival comparisons even when out of scope |

## 4. Low-hanging-fruit signals

- No webhook retry logic, or it isn't logged: adding a one-line idempotency key cuts a large support load - searchable in the repo with `webhook` + `retry`.
- A KYC rejection reason isn't shown to the user (it just says "rejected"): clarifying the message lowers support volume, a small code change.
- Reconciliation reports can't be exported as CSV/Excel: finance teams are rewriting this by hand - adding export from existing data is cheap.
- A rival's pricing page says "sandbox free" and ours is closed: a cheap gate that speeds up developer signup.
- Transaction status (pending/settled/failed) exists in the API but isn't shown on screen: a classic "ready but not on screen" BACKEND-NEEDS gap.

## 5. Mandatory PRD sections

- **Regulatory basis:** which BRSA/CMB/MASAK communique, or which regulation abroad (PSD2, an EU member state license), requires or enables this feature; with the article number.
- **Audit trail:** which event, with which fields, retained for how long; who can access it.
- **Fraud/abuse scenarios:** at least 3 concrete abuse cases and the countermeasure.
- **Data segregation / PCI scope:** where card/account data sits within this feature's scope, who tokenizes it.
- **Refund / dispute flow (chargeback):** mandatory if the feature moves money.
- **Limit and threshold logic:** daily/monthly transaction limits, how a MASAK threshold notification is triggered if it is.

## 6. Never list

- Storing the card PAN (the full card number) in plain text or in logs - a PCI-DSS violation.
- Allowing money movement before KYC verification is complete.
- Showing the MASAK suspicious-transaction reporting threshold as "optional" in the UI, or making the reporting flow skippable.
- Explaining a rejection reason to a user in speculative language without a regulatory basis (a legal risk).
- Showing sandbox and production keys on the same screen in an indistinguishable way.
- Making the audit trail deletable or editable by the user.

### Patterns (preread `--fintech`)

Searched in the PR title, body, and file paths (case-insensitive). A match is a warning, not a verdict: it tells the owner "look at this." Format: `- name :: regex`.

- Card number in plain text :: \bPAN\b.{0,40}(log|plain|store)|card_number.{0,30}(log|print)
- Money movement without KYC :: (skip|bypass).{0,30}\bKYC\b|\bKYC\b.{0,30}(optional|skip)
- MASAK notification skippable :: \bMASAK\b.{0,40}(optional|skip|disable)
- Sandbox/prod key mix-up :: (sandbox|test).{0,30}(prod|live).{0,20}key|live[_-]?key.{0,30}same
- Deletable audit trail :: audit[_ -]?(log|trail).{0,40}(delete|edit|update)

## 7. Metrics

- Transaction success rate (authorization/success rate) and rejection reason breakdown
- KYC completion rate and average time to complete
- Fraud rate (relative to transaction volume) and false positive rate
- Chargeback/dispute rate
- Monthly transaction volume (TPV/GMV) and take rate
- Revenue per customer (ARPU) and NDR (in B2B fintech)
- Share of support tickets that are payment/transaction issues

## 8. Sources

- https://www.bddk.org.tr/mevzuat (BRSA regulation list, accessed 2026-09-28)
- https://n24.com.tr/turkiyede-fintech-odakli-dijital-odeme-stratejisi-2025-sonrasi-netlesiyor/ (draft on post-2025 open banking/license flexibility, unverified - secondary source, accessed 2026-09-28)
- https://tr.wikipedia.org/wiki/T%C3%BCrkiye'deki_%C3%B6deme_ve_elektronik_para_kurulu%C5%9Flar%C4%B1_listesi (list of payment/e-money institutions in Turkey, accessed 2026-09-28)
- https://stripe.com, https://adyen.com, https://plaid.com, https://marqeta.com, https://wise.com, https://revolut.com, https://ramp.com, https://brex.com (product sites, accessed 2026-09-28)
- https://papara.com, https://param.com.tr, https://iyzico.com, https://paycell.com.tr, https://paytr.com, https://bkmexpress.com.tr, https://colendi.com (product sites, accessed 2026-09-28)
