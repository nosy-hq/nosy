# B2B SaaS pack

## 1. Who it's for

Software products sold by subscription to businesses (from a small team to an enterprise). Not specific to a vertical like fintech/mobile/legaltech - a horizontal layer that can sit on top of any of them (sales model, growth metrics, integration expectations). The audience is usually a "champion" (the person advocating for the product internally) plus a purchase approver (an exec, IT, security).

## 2. Rival universe

This varies by product category, so instead of a fixed list, this section gives the categories that make up the recurring rival classes in B2B SaaS; real rival names go into the main vertical pack (fintech/legaltech/etc.) or the `pm/rivals/` folder.

**Recurring B2B SaaS infrastructure/tool categories (for benchmarking and "what should we integrate with")**
- CRM: Salesforce (salesforce.com), HubSpot (hubspot.com)
- Project/work management: Linear (linear.app), Asana (asana.com), Monday (monday.com)
- Billing/subscriptions: Stripe Billing (stripe.com), Chargebee (chargebee.com)
- Identity/SSO: Okta (okta.com), Auth0 (auth0.com)
- Support: Zendesk (zendesk.com), Intercom (intercom.com)
- Product analytics: Amplitude (amplitude.com), Mixpanel (mixpanel.com)
- Documents/signature: DocuSign (docusign.com)
- Data warehouse/integration: Fivetran (fivetran.com), Segment (segment.com)

## 3. Rows to add to the cycle matrix

| Row | Why it belongs in the matrix |
|---|---|
| SSO/SAML and SCIM support | Usually a requirement in mid-to-large enterprise sales; missing it stalls the deal |
| Role-based access control (RBAC) | Expected for trust and security on multi-user accounts |
| API/webhook and general integration depth | Shows how open the product is to the ecosystem |
| Usage-based/seat-based pricing model | Determines sales velocity and expansion potential |
| Self-serve onboarding vs. sales-assisted onboarding | Shows whether the product is product-led growth (PLG) or sales-led |
| Security certification such as SOC 2 / ISO 27001 | The first thing an enterprise buyer asks about; missing it ends the sales cycle |
| Multi-tenant data isolation / dedicated environment option | Large customers often ask for a "separate instance" |
| Admin audit log | On security teams' pre-purchase checklist |
| Free trial/freemium tier | Important for demand testing and viral growth; a clear point of difference vs. rivals |
| Enterprise SLA and support tier | Shows up on the pricing page and is decisive in contract negotiation |
| Data export / no vendor lock-in | Increasingly asked about by purchasing committees |
| Marketplace/plugin ecosystem | Concrete evidence of a platform claim |

## 4. Low-hanging-fruit signals

- API docs exist but there's no sample code/Postman collection: a cheap addition that speeds up developer adoption.
- Webhooks exist but few event types/no logging: adding a new event to an existing event bus is usually small work.
- The pricing page shows nothing but "enterprise - contact us" while rivals show open pricing: a source of sales friction, possibly a cheap page change.
- A user invite/onboarding flow exists but admins can't see "who hasn't accepted their invite": a simple list can be added from existing data.
- Most support ticket volume traces back to one recurring question (e.g. "how do I set up SSO"): can be closed cheaply with docs or an in-product hint.

## 5. Mandatory PRD sections

- **Buyer vs. user distinction:** who makes the purchase decision (the economic buyer), who uses it day to day (the end user); write them up separately if they differ.
- **Expansion/upsell impact:** which plan this feature is gated by, how it affects NDR.
- **Security/compliance impact:** does it fall under SOC 2 scope, does it change the data processing inventory.
- **Self-serve vs. sales-assisted:** will the user discover and use this feature without needing the sales team.
- **Measurement plan:** which event gets tracked, which metric (see section 7) it feeds.
- **Rival positioning:** how rivals price/position this, where we land.

## 6. Never list

- Leaving enterprise customer data open to all users without plan/tier separation (an isolation gap).
- Selling an "enterprise plan" without SSO/SCIM and trying to skip the security review.
- Rolling out a pricing change to existing customers without advance notice, in breach of contract terms.
- Sharing usage data (analytics events) with a third party while user consent/contract scope is unclear.
- Presenting a beta/experimental feature as if it were covered by the enterprise SLA.
- Deliberately making data export hard to lock customers in - a trust and brand risk.

### Patterns (preread `--b2b-saas`)

Searched in the PR title, body, and file paths (case-insensitive). A match is a warning, not a verdict: it tells the owner "look at this." Format: `- name :: regex`.

- Tenant isolation :: cross[- ]tenant|(tenant_id|org_id|workspace_id).{0,40}(remove|drop|skip|bypass)|(remove|drop|skip|bypass).{0,40}(tenant_id|org_id|workspace_id)
- Analytics data to a third party :: (analytics|telemetry|segment|mixpanel).{0,40}(third[- ]party|share)
- Beta feature treated as SLA-covered :: \b(beta|experimental)\b.{0,40}\bSLA\b
- Export restricted :: export.{0,30}(remove|disable|restrict)

## 7. Metrics

- Net Dollar Retention (NDR/NRR) - median ~82%, top quartile ~97% (2025-2026 benchmarks)
- CAC payback period - top group 12-15 months, median ~20 months, above 24 months is a warning signal
- Annual Recurring Revenue (ARR) growth rate
- Logo/customer churn rate - tracked separately by segment
- Rule of 40 (growth rate + profit margin) - target 40+ at $50M+ ARR
- Product adoption/activation rate (signup to active use)
- Resolution time per support ticket (enterprise SLA compliance)

## 8. Sources

- https://www.re-cap.com/benchmarking-tool (2025 SaaS benchmarks, accessed 2026-09-28)
- https://beancount.io/blog/2026/05/10/saas-metrics-founders-must-track-2026-ltv-cac-nrr-churn-cac-payback-benchmarks-guide (NRR/CAC/Rule of 40 definitions and 2026 benchmarks, accessed 2026-09-28)
- https://www.benchmarkit.ai/2025benchmarks (2025 SaaS performance metrics, accessed 2026-09-28)
- https://saascalchub.com/guides/2026-saas-industry-benchmarks (2026 SaaS industry benchmarks - growth, CAC, NDR, Rule of 40, accessed 2026-09-28)
- https://salesforce.com, https://hubspot.com, https://linear.app, https://okta.com, https://auth0.com, https://zendesk.com, https://amplitude.com, https://docusign.com, https://fivetran.com, https://segment.com (category reference products, accessed 2026-09-28)
