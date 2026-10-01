import type { Metadata } from "next";
import Link from "next/link";
import { ThemePicker } from "../components/theme-picker";
import "./landing.css";

const title = "Indian Stock Market Data API for Developers | Ledgerline";
const description = "Turn Indian stock market data into your next product. Get company fundamentals, financial statements, shareholding data and corporate actions with Ledgerline's REST API.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", siteName: "Ledgerline", locale: "en_IN" },
  twitter: { card: "summary_large_image", title, description },
};

const datasets = [
  { number: "01", title: "Company fundamentals", text: "Give every stock a richer story. Explore company profiles, financial statements, ratios and business segments.", endpoint: "/api/v1/financials/{symbol}", tag: "Research & screening" },
  { number: "02", title: "Ownership & shareholding", text: "Bring ownership into your analysis with shareholding patterns, ownership summaries and available history.", endpoint: "/api/v1/shareholdings/pattern/{symbol}", tag: "Portfolio intelligence" },
  { number: "03", title: "Corporate actions & events", text: "Add context to company changes with dividends, splits, bonus issues and corporate announcements.", endpoint: "/api/v1/dividend/{symbol}", tag: "Company monitoring" },
];
const faqs = [
  { question: "What is the Ledgerline stock market API?", answer: "Ledgerline is a REST API for Indian equity data. It gives developers documented endpoints for company fundamentals, financial statements, ownership and corporate events, so they can build financial apps and research workflows." },
  { question: "How do I start using the API?", answer: "Create an account, generate an API key in your dashboard, and send it in the X-API-Key header. Use the interactive documentation to choose an endpoint, try a request and copy an example for your application." },
  { question: "Can I use it with Python or JavaScript?", answer: "Yes. The API uses HTTP requests and JSON responses, so it works with Python, JavaScript and other languages that support HTTP. The documentation includes cURL, Node.js and Python request examples." },
  { question: "How complete is the data?", answer: "Coverage varies by endpoint and source. Some responses are partial and missing values are returned as null. Endpoints without a connected source return HTTP 501. The API reference shows coverage notes and response schemas so you can evaluate each dataset before integrating." },
  { question: "Is this a real-time trading or historical price API?", answer: "Ledgerline currently focuses on company research and financial data. It does not promise a real-time trading feed, and market-price histories are outside the current scope. Check the API reference for the exact data available from each endpoint." },
];

export default function Home() {
  return <main className="product-page">
    <nav className="product-nav" aria-label="Main navigation"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link><div className="product-nav-links"><a href="#datasets">Data</a><Link href="/docs">Documentation</Link><a href="#faq">FAQ</a></div><div className="product-nav-actions"><ThemePicker /><Link className="signin-link" href="/signin">Sign in</Link><Link className="button secondary" href="/signup">Get an API key ↗</Link></div></nav>
    <section className="product-hero">
      <div><span className="product-eyebrow"><span /> Indian market data. Developer-first.</span><h1>Your next financial product.<br /><em>Powered by one API.</em></h1><p className="product-lead">Indian stock market data, ready to build with. Bring company fundamentals, ownership and corporate events into your app through a straightforward REST API.</p><div className="product-actions"><Link className="button secondary" href="/signup">Get your API key →</Link><Link className="button outline" href="/docs">Explore the API</Link></div><p className="product-hero-note">JSON responses. Documented schemas. More time for your product.</p></div>
      <div className="product-code" aria-label="API integration example"><div className="product-code-top"><span><i /><i /><i /></span><span>your-next-product.ts</span><span>REST / JSON</span></div><pre><code><span className="syntax-comment">// From a company symbol to financial data.</span>{"\n"}<span className="syntax-purple">const</span>{" response = "}<span className="syntax-purple">await</span>{" fetch(\n  "}<span className="syntax-green">{"`${API_BASE_URL}/api/v1/financials/TCS`"}</span>{",\n  { headers: { "}<span className="syntax-green">{"\"X-API-Key\""}</span>{": API_KEY } }\n);\n\n"}<span className="syntax-purple">const</span>{" financials = "}<span className="syntax-purple">await</span>{" response.json();\n"}<span className="syntax-comment">// Build something worth investing in.</span></code></pre><div className="product-code-bottom"><span>GET <code>/api/v1/financials/&#123;symbol&#125;</code></span><Link href="/docs#endpoint=%2Fapi%2Fv1%2Ffinancials%2F%7Bsymbol%7D">Try it live ↗</Link></div></div>
    </section>
    <section className="product-proof" aria-label="Built for integration"><div><strong>One integration</strong><span>Multiple financial datasets</span></div><div><strong>Standard REST + JSON</strong><span>Use the tools you already know</span></div><div><strong>Visible data coverage</strong><span>Know what each endpoint delivers</span></div></section>
    <section className="product-section" id="datasets"><div className="product-section-heading"><div><span className="eyebrow">THE DATA BEHIND YOUR PRODUCT</span><h2>Less data plumbing.<br />More product building.</h2></div><p>Start with the datasets your users need. Explore parameters, response shapes and source coverage before you write your integration.</p></div><div className="dataset-grid">{datasets.map((dataset) => <article className="dataset-card" key={dataset.number}><span className="dataset-number">{dataset.number} /</span><span className="dataset-tag">{dataset.tag}</span><h3>{dataset.title}</h3><p>{dataset.text}</p><Link href={`/docs#${new URLSearchParams({ endpoint: dataset.endpoint })}`}>Explore endpoints <span>↗</span></Link></article>)}</div><p className="coverage-footnote">Built with transparent coverage: availability varies by source, missing values stay <code>null</code>, and endpoint limitations are documented.</p></section>
    <section className="product-section integration-section"><div><span className="eyebrow">FROM IDEA TO FIRST REQUEST</span><h2>A short path<br />to your first integration.</h2><p>For stock screeners, research dashboards, portfolio tools and financial workflows. Start with an endpoint, then make it your own.</p><Link className="inline-link" href="/docs">Open the developer playground →</Link></div><ol className="integration-steps"><li><span>01</span><div><h3>Create your API key</h3><p>Sign up and manage your keys from one dashboard.</p></div></li><li><span>02</span><div><h3>Make your first request</h3><p>Choose a dataset, add your key and test it in the interactive API reference.</p></div></li><li><span>03</span><div><h3>Build it into your product</h3><p>Copy a cURL, JavaScript or Python example. Inspect schemas and handle responses with confidence.</p></div></li></ol></section>
    <section className="product-section faq-section" id="faq"><div><span className="eyebrow">GOOD QUESTIONS. CLEAR ANSWERS.</span><h2>Before you build.</h2><p>Everything starts with understanding the data.</p></div><div className="faq-list">{faqs.map((faq) => <details key={faq.question}><summary>{faq.question}<span>+</span></summary><p>{faq.answer}</p></details>)}</div></section>
    <section className="product-cta"><span className="eyebrow">BUILD YOUR NEXT IDEA</span><h2>You build the experience.<br />We provide the data.</h2><p>Connect your product to Indian company data with Ledgerline.</p><div className="product-actions"><Link className="button secondary" href="/signup">Get your API key →</Link><Link className="button outline" href="/docs">Read the documentation</Link></div></section>
    <footer className="product-footer"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link><p>Indian market data for the products of tomorrow.</p><div><Link href="/docs">API reference</Link><Link href="/dashboard">Dashboard</Link><a href="/swagger.json">OpenAPI</a></div></footer>
  </main>;
}
