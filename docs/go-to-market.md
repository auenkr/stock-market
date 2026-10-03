# Ledgerline: pricing and first-customer sales plan

Research date: **2026-10-03**. The recommendations below record the original research proposal. The founder subsequently approved **Hobby free/no card, Basic ₹199/month, Personal ₹399/month, Professional ₹2,499/month**. Those prices supersede the proposal tables, example quotes and revenue scenarios below. Approved burst allowances are 10/60/300/500 requests per minute respectively; Basic has free endpoints across all companies, Personal/Professional have detailed endpoints, and only Professional permits commercial use. Monthly credits and founding promotions below remain unimplemented research ideas. See [current billing setup](polar-setup.md) and [agent access](plugin.md).

## 1. Sales recommendation

Start with **Indian developers and technically comfortable researchers who already use AI tools and repeatedly need company fundamentals**. Sell a working research integration, with hands-on setup, rather than a broad stock-market data promise.

Suggested positioning:

> Indian company financials for your AI research workflow. Connect once, compare companies, and reuse the same data in your application.

Lead with one demonstrated outcome: **compare three Indian companies using financial statements, cash flow, ratios, and shareholding, with reporting periods and missing values visible**. Measure time saved against the prospect's existing workflow. Do not claim a particular time saving until measured.

The immediate objective is **three paying customers who return the following week**, then ten retained customers. Signups and directory listings are supporting metrics.

## 2. What we can sell today

Repository evidence: `README.md`, `docs/plugin.md`, `docs/limitations.md`, `packages/db/src/plans.ts`, and `apps/mcp/README.md`.

- Structured Indian company profiles, quarterly/annual statements, cash flow, ratios, peers, shareholding and document links, subject to source coverage.
- REST API, a shared agent OpenAPI surface, and an MCP implementation using the same underlying tool contract.
- Dashboard-issued API keys and monthly subscription infrastructure.
- Current Basic plan: selected free endpoints for five companies; 10 requests/minute. Paid allowances are currently 300/minute and 500/minute.

**An API plugin manifest and local MCP implementation do not establish a published, usable ChatGPT app.** Verify deployment, authentication and the actual connection flow before making “connect in ChatGPT” a purchase promise. OpenAI's current documentation describes connected apps/plugins and account-specific availability [S3].

Important sales constraints already documented in the project:

- No real-time trading feed or historical market-price service.
- No unrestricted bulk all-market ingestion; cold source-backed requests can be slow.
- Document links are not the same as full transcript search or document-content analysis.
- Some data is partial, and some datasets are unavailable. Bank/insurance-specific financial schemas are incomplete.
- `docs/limitations.md` identifies acquiring sources that permit intended commercial distribution as remaining work. Establish the allowed supply before selling customer-facing distribution. A Professional plan label does not create upstream rights.

Begin with supported non-financial companies and a small named watchlist. Check the live service independently of local code before onboarding a prospect.

## 3. Closest ChatGPT competitor: Finmagine

**Finmagine is the strongest directly verified match in this research.** Its published guide links to a ChatGPT directory listing, describes OAuth connection, and explains that the connection inherits the user's API tier [S1, S2]. Listing approval is the provider's claim; this research did not independently install or test it.

Published API/MCP prices and limits:

| Tier | Price | Limits | Coverage and gates |
| --- | ---: | --- | --- |
| Free | $0 | 50/day; 10/hour | 25 Indian and 25 US symbols; basic research tools |
| API Pro | $49/month | 1,000/day; 200/hour | Full supported universe; financials and research tools; screener excluded |
| API Max | $149/month | 5,000/day; 1,000/hour | Pro plus screening |

Its website Premium subscription is a **different product** and does not automatically unlock API Pro. Do not compare that subscription's price directly with Ledgerline's API price [S2].

The provider advertises Indian and US coverage, screening, momentum, market breadth and AI research. Tool counts and company counts differ across its pages; use the pricing/tier guide for entitlement details, not an assumed exact count. Text extraction of the pricing page also includes excluded features; the detailed tier guide clarifies what is actually included.

**Lesson:** “Indian stocks inside ChatGPT” already exists. A defensible initial advantage is a narrower, easier-to-integrate fundamentals workflow, affordable India-focused access, transparent units/periods, and founder-assisted setup. These advantages must be demonstrated; we have not established superior accuracy, coverage or latency.

## 4. Other relevant alternatives

Prices below were read from public provider pages on the research date. They are advertised prices, not verified purchase quotes; taxes, promotions and licensing may differ.

| Alternative | Published price | Relevance | Sales implication |
| --- | --- | --- | --- |
| Financial Datasets [S4] | $20 one-time/1,000 requests; Build $200/month/100,000; Scale $2,000/month/2 million | API designed for agents; hosted MCP; financial statements and other datasets | Borrow clear usage packaging and source traceability. Redistribution is explicitly a higher-tier feature. Do not assume its Indian coverage matches ours. |
| Alpha Vantage [S5] | Free standard allowance 25/day; premium starts $49.99/month at 75/minute | Financial-data API; official MCP referenced on premium page | API and agent access can share billing. Wider datasets do not make it a like-for-like Indian fundamentals substitute. |
| FMP [S6] | Starter $19/month, Premium $49, Ultimate $99, **billed annually** on fetched page | Fundamentals API; entry tier is US-focused, global coverage higher up | Preserve billing-period and geography distinctions. Display/redistribution requires a separate agreement. |
| Fiscal.ai MCP [S7] | No numerical MCP price established from fetched pages; sales contact and trial advertised | Financial research connected to ChatGPT, Claude and custom MCP | It markets complete research workflows and auditable source data, not protocol mechanics. |
| StockGPT [S8] | Free 5 searches/day; $7/month or $49/year | Standalone AI financial-report/transcript research for US companies; not verified as a ChatGPT plugin | Consumer AI research has inexpensive alternatives. It is not a direct API comparison. |
| Tickertape Pro [S9] | ₹399/month or ₹2,999/year | Indian investor research product, not an API/MCP entitlement | A personal buyer will compare us with familiar low-cost tools. Automation must justify an additional subscription. |

Also expect free Screener browsing, spreadsheets, copy/paste into ChatGPT and self-written scrapers to be common objections. Treat these as workflow substitutes, not evidence that buyers want another API.

## 5. Proposed launch pricing

| Plan | Proposed monthly base price | Customer | Proposed usage packaging |
| --- | ---: | --- | --- |
| Basic | ₹0 | Evaluate one real research workflow | Keep five-company evaluation scope initially; add a small monthly allowance that includes detailed statements for those companies |
| Personal | **₹499** | Individual, non-commercial research | All supported companies and connected personal datasets; initial hypothesis: 1,000 successful data requests/month, 30/minute |
| Professional | **₹2,499** | Small commercial/internal integration | Personal data scope plus permitted commercial use; initial hypothesis: 25,000 successful data requests/month, 60/minute; one onboarding session |
| Larger usage/distribution | Quote after discovery | Higher-volume or customer-facing use with different rights | Scope against verified source rights, costs and infrastructure |

These allowances are **new product hypotheses**, not current enforced limits. They require engineering and cost measurement. Current Basic does not expose paid financial-statement endpoints, so the improved evaluation experience also requires an entitlement change.

Why these prices:

- ₹499 lowers the commitment for an individual trying a supplementary AI workflow; Tickertape's ₹399/month is a useful consumer anchor, not proof of willingness to pay for Ledgerline.
- ₹2,499 is an approachable small-business entry for an India-only integration with a narrower dataset than the global competitors.
- Neither price is justified simply by undercutting competitors. The paid pilot must demonstrate time saved, avoided maintenance or repeat research value.
- Keep one subscription across REST, agent integrations and MCP. Do not add an artificial “ChatGPT fee.” A user's own AI subscription/model usage is separate.
- Show INR base price, applicable tax treatment, usage allowance and commercial scope together. Avoid annual lock-in until retention and delivery are established.

### Founding-customer offer

For the first **10 qualified Professional customers**, propose **₹1,499/month for three months**, then ₹2,499/month. State the later price before purchase. Include one setup session and a supported watchlist workflow. No lifetime deal or unlimited-volume promise.

This promotion is not configured in Polar. Personal can launch at its regular proposed ₹499 price. Use a working Basic demonstration before purchase; do not promise a paid trial that current billing does not implement.

### Unit-economics check

Measure source/cache fetch cost, parsing, Worker/database use, payment fees, support time, error rate and requests per completed research task. Count retrieval calls rather than chat messages; one prompt may invoke several tools. Define failed-request billing and retry behavior clearly before introducing monthly credits.

Illustrative 80% gross-margin operating target, excluding founder labor and tax: ₹499 leaves about ₹100/customer/month for direct delivery costs; ₹2,499 leaves about ₹500. These are budgets, not observed costs. At full proposed allowances, they imply roughly ₹0.10 and ₹0.02 direct cost/request respectively before fixed transaction costs. If costs do not fit, adjust allowance, caching or price before scaling.

Do not price around the current 300/500 requests-per-minute maxima alone: a burst ceiling does not bound monthly workload, and the project does not establish that those upstream volumes can be delivered sustainably.

## 6. Who to sell to first

Priority order:

1. **Developers building an Indian stock research assistant, watchlist tool or internal dashboard.** Qualification: an active project, named companies, repeated need for financial statements, integration pain and ability to pay. Technical onboarding is realistic for the current product.
2. **Technically comfortable individual researchers already using ChatGPT/Claude.** Qualification: weekly company comparisons, measurable manual gathering time, willingness to connect a tool. Personal plan only when their use is genuinely non-commercial.
3. **Small research businesses with an internal recurring workflow.** Professional use, with explicit scope. Expect requests for provenance, freshness and reliability; prioritize them after initial integration evidence.

Delay acquisition focused on intraday traders, historical-price backtests, all-market screeners or institutional procurement. Their core requirements are outside or ahead of the current product.

Start with one segment and one workflow for two weeks. Do not split the same small sales effort across all three.

## 7. Getting the first customer

Use founder-led recruitment and assisted installation. Paul Graham's early-stage examples emphasize manually recruiting users and helping them get set up, rather than relying on a big launch [S10]. The following quotas are operating targets, not researched conversion forecasts.

### First 48 hours

1. Produce one verified example comparing three supported non-financial Indian companies. Display financial periods, units, retrieval time, gaps and links where available. Verify selected figures against the underlying records.
2. Record a short demonstration of the real integration and save a reusable Python/TypeScript example and research prompt. If ChatGPT connection is not live, demonstrate the actually working client instead.
3. Build a list of **30 prospects**: 10 warm introductions, 10 active Indian-finance project developers, 10 researchers visibly doing repeated comparisons. Record the public evidence of fit; no invented lead identities.
4. Send **10 personalized messages** and ask for a 15-minute session using the prospect's own watchlist.

Where to find them:

- LinkedIn: developers/founders posting about Indian equity research apps, finance automation and MCP projects.
- GitHub: recent Indian fundamentals/watchlist/research projects. Use public contact channels or relevant project discussions; avoid promotional issue spam.
- Existing finance/developer WhatsApp, Discord or Telegram groups: ask the organizer for a practical demo session.
- Small creators teaching Python finance or AI-assisted Indian-stock research: offer a useful example for their audience. Start with a few relevant creators and track activated referrals, not follower counts.

### Developer message

> Hi [name] — I saw your [specific project/post]. I'm building Ledgerline for Indian company financials through REST and AI tools. How are you currently getting statements and shareholding data into [their workflow]? If that integration is painful, I can show a working example for three companies you choose and help connect it in a 15-minute session. The proposed commercial launch plan is ₹2,499/month; the first 10 customers get ₹1,499/month for three months, then the regular price. Would [time A] or [time B] work?

Use this offer only after its checkout and delivery are ready. Until then, invite a pilot discussion rather than imply the price is already purchasable.

### Discovery questions

Ask about what they already did, not whether they like the idea:

- Which companies did you research last week, and how did you gather the numbers?
- What tool or script do you use now? What breaks or takes time?
- How frequently do you repeat this? What do you already pay for?
- Which fields, periods and freshness would make the integration useful?
- Is this personal use, internal business use or customer-facing display?

Watch them complete one task. Then connect Ledgerline, repeat the same task, and compare results and time.

### Close and retain

> We got [their actual task] working with your companies. Would you like to keep this connected on [appropriate plan] at [disclosed price]? Let's schedule the first repeat run for next week.

Follow up after two days for setup problems and after seven days for repeat use. Ask for one introduction after a successful repeat task. Record permission before publishing a testimonial or customer example.

For objections, investigate the cause:

- **“I already use Screener.”** Demonstrate repeat retrieval into their tool; manual browsing may already be sufficient.
- **“ChatGPT can browse for free.”** Compare retrieval consistency, structure and repeatability on the same task; do not claim browsing is always wrong.
- **“Finmagine has more features.”** Agree on scope, then show the specific fundamentals integration. Do not invent an accuracy advantage.
- **“Too expensive.”** Ask whether the workflow is valuable and recurring. If value or repeat usage is absent, another discount is unlikely to fix it.

## 8. Thirty-day operating plan

| Period | Work | Target evidence |
| --- | --- | --- |
| Days 1–7 | Verify live delivery; demo; 30-prospect list; outreach; assisted setups | 5 discovery calls, 3 completed workflows, first paid pilot if delivery/checkout ready |
| Days 8–14 | Continue to 60 cumulative qualified contacts; repair onboarding; observe repeat use | 3 paying customers; at least 2 independently return the next week |
| Days 15–21 | Publish one permissioned case study and one useful integration tutorial; approach 3 small relevant creators | 5 paying customers and identifiable referral sources |
| Days 22–30 | Reach 100 cumulative qualified contacts; repeat best-performing message; request introductions | 10 paying customers as a stretch target, with retention and cost evidence |

A sample revenue mix of 6 Personal customers at ₹499 and 4 founding Professional customers at ₹1,499 yields **₹8,990 monthly recurring revenue** before taxes, fees, refunds and delivery costs. At the proposed normal prices, the same mix yields **₹12,990**. These are scenarios, not forecasts.

Budget hypothesis: keep cash acquisition spending under ₹5,000 in month one, mostly for demo assets and useful distribution experiments. Spend founder time on conversations and setup. Introduce paid ads only after evidence of activation, retention and an acquisition cost compatible with gross margin.

### Sales tracking

Use one sheet: name/project, source, observed pain, personal/commercial scope, last contact, next action, demo status, first successful task, repeat task, payment, price and cancellation reason.

Track:

- Qualified messages → replies → attended demos → completed workflows → paid accounts.
- Time to first completed workflow, endpoint errors and data mismatches.
- Independent week-two repeat usage and first-month renewal.
- Requests and delivery/support costs per account.

If 20 well-targeted messages generate almost no replies, revisit targeting and the opening message. If demos do not activate, fix setup and workflow fit. If users activate but do not return, investigate recurring value. If engaged repeat users decline to pay, test packaging and price directly. Small samples are directional, not statistical proof.

After the first five paid pilots, review pricing with actual behavior. Compare quotes sequentially within the same segment and scope; disclose each buyer's terms and honor them. Do not claim an optimal price based on a handful of interviews.

## 9. Pricing implementation checklist after founder decision

1. Confirm proposed prices, included usage and commercial scope; establish source supply and a supportable pilot workflow.
2. Update `packages/db/src/plans.ts`, pricing metadata, documentation table, README and relevant payment/UI assertions together.
3. Set matching Polar monthly INR prices (₹499 = 49,900 minor units; ₹2,499 = 249,900). Handle existing subscriptions explicitly and verify actual checkout totals. Editing application display prices alone does not change Polar charges.
4. Implement monthly accounting, balance visibility and exhaustion behavior before advertising request allowances. Change Basic's detailed-statement evaluation gate if adopting that proposal. Make REST/MCP share counters.
5. Configure the founding promotion with a clearly defined three-month end and disclosed normal renewal price; verify provider support and payment flow before advertising it.
6. Validate billing/webhook entitlements, documentation consistency and the actual agent connection against a deployed environment. Publish only established capabilities.

## Sources

- **S1 — Finmagine API pricing:** https://finmagine.com/developer/pricing.php
- **S2 — Finmagine tier guide and ChatGPT setup:** https://finmagine.com/blogs/guide_api_pricing_tiers.php and https://finmagine.com/blogs/guide_mcp_chatgpt.php
- **S3 — OpenAI connected apps:** https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- **S4 — Financial Datasets pricing:** https://financialdatasets.ai/pricing
- **S5 — Alpha Vantage premium:** https://www.alphavantage.co/premium/
- **S6 — FMP pricing:** https://financialmodelingprep.com/developer/docs/pricing
- **S7 — Fiscal.ai MCP and pricing:** https://fiscal.ai/products/mcp/ and https://fiscal.ai/pricing
- **S8 — StockGPT:** https://www.askstockgpt.com
- **S9 — Tickertape pricing:** https://www.tickertape.in/pricing
- **S10 — Founder-led acquisition:** Paul Graham, “Do Things that Don't Scale,” https://www.paulgraham.com/ds.html

This is a targeted primary-source comparison, not an exhaustive market census. Competitor performance, customer counts and superiority claims were not independently audited. Pricing and sales recommendations are our hypotheses; the verified evidence is the linked published offers and the current repository behavior.
