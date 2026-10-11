"use client";

import { useState } from "react";
import { CodeBlock } from "./code-block";
import {
  CLAUDE_MCP_ADD,
  MCP_CHATGPT_CONFIG,
  MCP_OAUTH_CONFIG,
  type CodeToken,
} from "../lib/code-snippets";

type Tab = {
  id: string;
  label: string;
  filename: string;
  tokens: readonly CodeToken[];
  copyLabel: string;
  note: React.ReactNode;
};

const tabs: Tab[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    filename: "terminal",
    tokens: CLAUDE_MCP_ADD,
    copyLabel: "Copy command",
    note: (
      <>Run this once in your shell, then type <code>/mcp</code> in Claude Code and choose <strong>Authenticate</strong> for <code>ledgerline</code>. A browser opens, you sign in with Google, and you approve <code>market:read</code>. Or install the whole plugin with <code>claude plugin install ledgerline@ledgerline-claude</code>.</>
    ),
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    filename: "mcp_config.json",
    tokens: MCP_CHATGPT_CONFIG,
    copyLabel: "Copy config",
    note: (
      <>ChatGPT reads remote MCP servers from its <code>mcpServers</code> config. This server uses OAuth, so ChatGPT opens the Ledgerline consent page to link your account — no API key needed.</>
    ),
  },
  {
    id: "cursor",
    label: "Cursor & others",
    filename: "mcp_config.json",
    tokens: MCP_OAUTH_CONFIG,
    copyLabel: "Copy config",
    note: (
      <>Most MCP clients read the same <code>mcpServers</code> shape. Add <code>&quot;type&quot;: &quot;http&quot;</code> whenever you supply a <code>url</code> — a <code>url</code> with no <code>type</code> is rejected. See <a href="#mcp-get-started">MCP · Get started</a> for API-key auth and for clients that need an explicit header.</>
    ),
  },
];

export function McpConfigTabs() {
  const [active, setActive] = useState(tabs[0]!.id);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!;

  return (
    <div className="mcp-config-tabs">
      <div className="mcp-config-tabs-bar" role="tablist" aria-label="MCP client">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`mcp-tab-${tab.id}`}
            aria-selected={tab.id === current.id}
            aria-controls="mcp-tab-panel"
            tabIndex={tab.id === current.id ? 0 : -1}
            className={tab.id === current.id ? "selected" : ""}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="mcp-tab-panel" aria-labelledby={`mcp-tab-${current.id}`}>
        <CodeBlock tokens={current.tokens} label={current.copyLabel} filename={current.filename} />
        <p className="mcp-config-note">{current.note}</p>
      </div>
    </div>
  );
}
