import type { Metadata } from "next";
import Link from "next/link";
import { plans, type ApiPlan } from "@stock-market/db/plans";
import { ArrowRight, ExternalLink } from "lucide-react";
import { apiReference } from "../../lib/api-reference";
import { ThemePicker } from "../../components/theme-picker";
import "./documentation.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documentation | Ledgerline",
  description: "Learn about Ledgerline's free and paid API tiers, company access, authentication, and account rate limits.",
};

export default function DocumentationPage() {
  const swagger = apiReference();
  const policy = swagger["x-access-policy"];
  return <div className="documentation-page">
    <header className="documentation-header">
      <Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link>
      <nav aria-label="Documentation pages"><Link href="/documentation" aria-current="page">Overview</Link><Link href="/docs">API reference</Link></nav>
      <ThemePicker />
    </header>
    <main>
      <section className="documentation-hero"><span className="eyebrow">Developer documentation</span><h1>Start with the essentials.</h1><p>Understand your account's access and request limits, then explore the endpoints in the API reference.</p><Link className="button" href="/docs">Open API reference <ArrowRight size={16} aria-hidden="true" /></Link></section>
      <div className="documentation-layout">
        <nav className="documentation-nav" aria-label="On this page"><span className="eyebrow">On this page</span><a href="#company-journey">Company research journey</a><a href="#tiers">Free vs paid</a><a href="#companies">Free company access</a><a href="#rate-limits">Rate limits</a><a href="#authentication">Authentication</a><a href="#api-reference">API reference</a></nav>
        <div className="documentation-content">
          <section id="company-journey"><span className="eyebrow">Endpoints by use case</span><h2>From company search to deeper research.</h2><p>Find a company, review its profile, basic finance and documents, then explore peer comparisons, financial statements, ratios and shareholding.{process.env.ENVIRONMENT === "dev" && " Supplementary endpoints are grouped under Internal."}</p><ol>{swagger["x-user-journey"].map((group) => {
            const firstPath = Object.entries(swagger.paths).find(([, entry]) => entry.get["x-use-case"] === group.id)?.[0];
            return <li key={group.id}><h3>{firstPath ? <Link href={`/docs#${new URLSearchParams({ endpoint: firstPath })}`}>{group.title}</Link> : group.title}</h3><p>{group.description}</p></li>;
          })}</ol><p>Company search returns a URL-valued <code>symbol</code>. Pass it unchanged to Company overview and Finance endpoints; this is their only query parameter. The URL selects standalone or consolidated data. Quarterly P&amp;L, annual P&amp;L, balance sheet and cash flow each have their own endpoint.</p></section>
          <section id="tiers"><span className="eyebrow">Account access</span><h2>Hobby, Basic, Personal, and Professional</h2><div className="documentation-table-wrap"><table><thead><tr><th scope="col">Feature</th>{Object.values(plans).map((plan) => <th scope="col" key={plan.name}>{plan.name}</th>)}</tr></thead><tbody>
            <tr><th scope="row">Monthly price</th>{Object.values(plans).map((plan) => <td key={plan.name}>{plan.monthlyPrice ? `₹${plan.monthlyPrice.toLocaleString("en-IN")}` : "Free · no credit card"}</td>)}</tr>
            <tr><th scope="row">Requests per minute</th>{Object.values(plans).map((plan) => <td key={plan.name}>{plan.requestsPerMinute}</td>)}</tr>
            <tr><th scope="row">Company access</th><td>Five companies listed below</td><td>All supported companies</td><td>All supported companies</td><td>All supported companies</td></tr>
            <tr><th scope="row">Endpoints</th><td>Free endpoints</td><td>Free endpoints</td><td>All endpoints</td><td>All endpoints</td></tr>
            <tr><th scope="row">Commercial use</th><td>No</td><td>No</td><td>No</td><td>Yes</td></tr>
          </tbody></table></div><p>Free endpoints include company search/listing, profiles, basic finance, and peer comparison. Basic removes Hobby's company restriction for these endpoints. Personal and Professional unlock documents, detailed statements, ratios, and shareholding. Endpoint labels Free/Paid describe dataset access: Paid endpoints require Personal or Professional, not Basic. REST, ChatGPT agent tools, and MCP use the same plan and API key. See <Link href="/pricing">pricing</Link> and the <Link href="/docs">API reference</Link>.</p><p>Data availability varies for all plans. Missing fields can be <code>null</code>; unsupported datasets return <code>501</code>.</p></section>
          <section id="companies"><span className="eyebrow">Hobby plan</span><h2>Five companies to build with</h2><p>Company profiles, basic finance, and peer comparison are available for these five companies on the Hobby plan:</p><ul className="documentation-symbols">{policy.freeCompanies.map((symbol) => <li key={symbol}><code>{symbol}</code></li>)}</ul><p>The list uses market capitalization at the October 1, 2026 close. It is a fixed access list, so daily ranking changes do not change your access.</p><p>Company search and listings can list other companies. Basic and higher plans remove the company restriction.</p><p>All company endpoints, including older APIs, use the URL-valued <code>symbol</code>. Other companies return <code>403 FREE_COMPANY_RESTRICTED</code> on Hobby. Calling a paid endpoint with a Hobby or Basic account returns <code>403 PAID_PLAN_REQUIRED</code>.</p></section>
          <section id="rate-limits"><span className="eyebrow">Request allowance</span><h2>One limit for your account</h2><div className="documentation-limits">{Object.entries(policy.requestsPerMinute).map(([plan, limit]) => <div key={plan}><span>{plans[plan as ApiPlan].name}</span><strong>{limit}<small> requests / minute</small></strong></div>)}</div><p>Your API keys share one allowance across all API instances. Creating another key does not increase the limit. Each authenticated request counts, including requests rejected by access rules.</p><p>When you reach the limit, the API returns <code>429</code>. Wait for the number of seconds in the <code>Retry-After</code> response header before retrying. The window resets one minute after its first request.</p><p>Health and OpenAPI are public and do not use your allowance. Missing, expired, or revoked keys return <code>401</code> and do not consume requests.</p></section>
          <section id="authentication"><span className="eyebrow">Your first request</span><h2>Use your API key</h2><p>Create a key in the <Link href="/dashboard/keys">dashboard</Link> and send it in the <code>X-API-Key</code> header. Keep the key on your server and out of public code. New accounts start on Hobby, free without a credit card.</p><pre><code>{'X-API-Key: <your-api-key>'}</code></pre></section>
          <section id="api-reference" className="documentation-reference"><span className="eyebrow">Explore the API</span><h2>Parameters, schemas, and live requests.</h2><p>Search endpoints, filter by Free or Paid, inspect response schemas, and try requests with your API key. Copy examples in cURL, JavaScript, or Python.</p><div className="documentation-reference-actions"><Link className="button" href="/docs">Open API reference <ExternalLink size={15} aria-hidden="true" /></Link><a className="button secondary" href="/swagger.json" download="swagger_ledgerline.json">Download OpenAPI</a></div></section>
        </div>
      </div>
    </main><footer className="documentation-footer">© {new Date().getFullYear()} Ledgerline.<Link href="/docs">API reference <ArrowRight size={14} aria-hidden="true" /></Link></footer>
  </div>;
}
