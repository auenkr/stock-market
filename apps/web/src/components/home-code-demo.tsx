"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { CopyButton } from "./copy-button";

type Example = "rest" | "mcp" | "cli";

const examples: Record<Example, { filename: string; format: string; code: string; footer: string; href: string; link: string }> = {
  rest: {
    filename: "your-next-product.ts",
    format: "REST / JSON",
    code: `// From a company symbol to financial data.\nconst response = await fetch(\n  \`${"${API_BASE_URL}"}/api/v1/financials/TCS\`,\n  { headers: { "X-API-Key": API_KEY } }\n);\n\nconst financials = await response.json();\n// Build something worth investing in.`,
    footer: "GET /api/v1/financials/{symbol}",
    href: "/docs#endpoint=%2Fapi%2Fv1%2Ffinancials%2F%7Bsymbol%7D",
    link: "Try it live",
  },
  mcp: {
    filename: "mcp_config.json",
    format: "MCP",
    code: `{"mcpServers":{"ledgerline":{"url":"https://stock-market-mcp.auenkr.com/mcp","headers":{"Authorization":"Bearer <your-api-key>"}}}}`,
    footer: "Streamable HTTP · /mcp",
    href: "/documentation#mcp-get-started",
    link: "MCP setup guide",
  },
  cli: {
    filename: "terminal",
    format: "CLI",
    code: `# Install Ledgerline CLI\npnpm add -g @auenkr/legerline-cli\n\n# Configure your dashboard API key\nlegerline set-api-key "<your-api-key>"\n\n# Search, then explore company data\nlegerline get_v1_company_search --q reliance\nlegerline get_api_v1_company_profile \\\n  --symbol "/company/RELIANCE/consolidated/"`,
    footer: "JSON output · terminal-ready",
    href: "/documentation#cli-get-started",
    link: "CLI setup guide",
  },
};

const labels: { value: Example; label: string }[] = [
  { value: "rest", label: "REST / JSON" },
  { value: "mcp", label: "MCP" },
  { value: "cli", label: "CLI" },
];

export function HomeCodeDemo() {
  const [selected, setSelected] = useState<Example>("rest");
  const example = examples[selected];

  return <div className="product-code-scene" data-reveal>
    <div className="code-scene-label"><span className="mono">&lt;/&gt; BUILT FOR YOUR STACK</span><span>Choose your workflow</span></div>
    <div className="product-code" data-motion-code aria-label="Integration example">
      <div className="product-code-top"><span className="window-dots"><i /><i /><i /></span><span>{example.filename}</span><div className="code-format-picker"><label className="visually-hidden" htmlFor="integration-format">Integration format</label><select id="integration-format" value={selected} onChange={(event) => setSelected(event.target.value as Example)}>{labels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div>
      <div className="product-code-body"><pre><code>{selected === "rest" ? <><span className="syntax-comment">// From a company symbol to financial data.</span>{"\n"}<span className="syntax-purple">const</span>{" response = "}<span className="syntax-purple">await</span>{" fetch(\n  "}<span className="syntax-green">{"`${API_BASE_URL}/api/v1/financials/TCS`"}</span>{",\n  { headers: { "}<span className="syntax-green">{'"X-API-Key"'}</span>{": API_KEY } }\n);\n\n"}<span className="syntax-purple">const</span>{" financials = "}<span className="syntax-purple">await</span>{" response.json();\n"}<span className="syntax-comment">// Build something worth investing in.</span></> : example.code}</code></pre><CopyButton text={example.code} label="Copy" /></div>
      <div className="product-code-bottom"><span>{example.footer}</span><Link href={example.href}>{example.link} <ExternalLink size={12} aria-hidden="true" /></Link></div>
    </div>
    <div className="code-scene-foot"><span><span aria-hidden="true">↳</span> Your idea. Your language. Your product.</span><span className="mono">{example.format}</span></div>
  </div>;
}
