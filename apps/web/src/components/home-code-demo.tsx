"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { CopyButton } from "./copy-button";
import {
  CLAUDE_MCP_ADD,
  CLI_EXAMPLE,
  MCP_CHATGPT_CONFIG,
  MCP_OAUTH_CONFIG,
  REST_EXAMPLE,
  renderTokens,
  snippetText,
  type CodeToken,
} from "../lib/code-snippets";

type Example = "rest" | "claude" | "chatgpt" | "mcp" | "cli";

const examples: Record<Example, { filename: string; format: string; tokens: readonly CodeToken[]; footer: string; href: string; link: string }> = {
  rest: {
    filename: "your-next-product.ts",
    format: "REST / JSON",
    tokens: REST_EXAMPLE,
    footer: "GET /api/v1/financials/{symbol}",
    href: "/docs#endpoint=%2Fapi%2Fv1%2Ffinancials%2F%7Bsymbol%7D",
    link: "Try it live",
  },
  claude: {
    filename: "terminal",
    format: "Claude Code",
    tokens: CLAUDE_MCP_ADD,
    footer: "Then run /mcp and authenticate",
    href: "/documentation#claude-code",
    link: "Claude Code setup",
  },
  chatgpt: {
    filename: "mcp_config.json",
    format: "ChatGPT",
    tokens: MCP_CHATGPT_CONFIG,
    footer: "Apps & connectors · OAuth",
    href: "/documentation#chatgpt",
    link: "ChatGPT setup",
  },
  mcp: {
    filename: "mcp_config.json",
    format: "MCP",
    tokens: MCP_OAUTH_CONFIG,
    footer: "Streamable HTTP · /mcp",
    href: "/documentation#mcp-get-started",
    link: "MCP setup guide",
  },
  cli: {
    filename: "terminal",
    format: "CLI",
    tokens: CLI_EXAMPLE,
    footer: "JSON output · terminal-ready",
    href: "/documentation#cli-get-started",
    link: "CLI setup guide",
  },
};

const tabs: { value: Example; label: string }[] = [
  { value: "rest", label: "REST" },
  { value: "claude", label: "Claude Code" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "mcp", label: "MCP" },
  { value: "cli", label: "CLI" },
];

export function HomeCodeDemo() {
  const [selected, setSelected] = useState<Example>("rest");
  const example = examples[selected];

  return <div className="product-code-scene" data-reveal>
    <div className="code-scene-label"><span className="mono">&lt;/&gt; BUILT FOR YOUR STACK</span><span>Choose your workflow</span></div>
    <div className="product-code" data-motion-code aria-label="Integration example">
      <div className="product-code-top"><span className="window-dots"><i /><i /><i /></span><span>{example.filename}</span></div>
      <div className="product-code-tabs" role="tablist" aria-label="Integration format">
        {tabs.map((tab) => <button key={tab.value} type="button" role="tab" id={`home-tab-${tab.value}`} aria-selected={tab.value === selected} aria-controls="home-code-panel" tabIndex={tab.value === selected ? 0 : -1} className={tab.value === selected ? "selected" : ""} onClick={() => setSelected(tab.value)}>{tab.label}</button>)}
      </div>
      <div className="product-code-body" id="home-code-panel" role="tabpanel" aria-labelledby={`home-tab-${selected}`}><pre><code>{renderTokens(example.tokens)}</code></pre><CopyButton text={snippetText(example.tokens)} label="Copy" /></div>
      <div className="product-code-bottom"><span>{example.footer}</span><Link href={example.href}>{example.link} <ExternalLink size={12} aria-hidden="true" /></Link></div>
    </div>
    <div className="code-scene-foot"><span><span aria-hidden="true">↳</span> Your idea. Your language. Your product.</span><span className="mono">{example.format}</span></div>
  </div>;
}
