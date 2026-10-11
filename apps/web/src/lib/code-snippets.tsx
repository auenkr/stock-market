import type { ReactNode } from "react";

/**
 * A code snippet authored as ordered `[tokenClass, text]` pairs.
 *
 * Plain-text form for the clipboard is `snippetText()`, so a snippet is only
 * ever written once. Token classes are styled by `.syntax-*` in globals.css.
 */
export type CodeToken = readonly [CodeTokenClass, string];

export type CodeTokenClass =
  | "plain"
  | "comment"
  | "keyword"
  | "string"
  | "number"
  | "key"
  | "flag"
  | "punct";

export function snippetText(tokens: readonly CodeToken[]): string {
  return tokens.map(([, text]) => text).join("");
}

export function renderTokens(tokens: readonly CodeToken[]): ReactNode[] {
  return tokens.map(([tokenClass, text], index) =>
    tokenClass === "plain"
      ? text
      : <span key={index} className={`syntax-${tokenClass}`}>{text}</span>,
  );
}

export const TOKEN_CLASS: Record<CodeTokenClass, string> = {
  plain: "syntax-plain",
  comment: "syntax-comment",
  keyword: "syntax-keyword",
  string: "syntax-string",
  number: "syntax-number",
  key: "syntax-key",
  flag: "syntax-flag",
  punct: "syntax-punct",
};

export const MCP_SERVER_URL = "https://stock-market-mcp.auenkr.com/mcp";
export const API_BASE_URL = "https://stock-market-api.auenkr.com";
export const CLAUDE_MARKETPLACE = "AuenKr/ledgerline-claude-plugins";
export const CLAUDE_PLUGIN = "ledgerline@ledgerline-claude";

/* ---------------------------------------------------------------- helpers */

type LexRule = readonly [RegExp, CodeTokenClass, boolean?];

/**
 * Splits `source` into `[class, text]` pairs using an ordered rule list.
 *
 * Rules marked `lineStart` only apply at the start of a line, which is tracked
 * here rather than with `^`/`\b`: `lex` hands each rule the *remaining* slice,
 * so an anchored pattern would match on every token.
 */
function lex(source: string, rules: readonly LexRule[]): CodeToken[] {
  const out: CodeToken[] = [];
  let rest = source;
  let atLineStart = true;
  while (rest.length) {
    let matched = false;
    for (const [pattern, tokenClass, lineStartOnly] of rules) {
      if (lineStartOnly && !atLineStart) continue;
      // Sticky patterns carry lastIndex between calls, so anchor each attempt.
      pattern.lastIndex = 0;
      const match = pattern.exec(rest);
      if (match && match[0]) {
        out.push([tokenClass, match[0]]);
        rest = rest.slice(match[0].length);
        atLineStart = false;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const character = rest[0]!;
      out.push(["plain", character]);
      if (character === "\n") atLineStart = true;
      rest = rest.slice(1);
    }
  }
  return out;
}

/** Collapses neighbouring tokens that share a class, keeping the array tidy. */
function coalesce(tokens: readonly CodeToken[]): CodeToken[] {
  const out: [CodeTokenClass, string][] = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (last && last[0] === token[0]) last[1] += token[1];
    else out.push([token[0], token[1]]);
  }
  return out;
}

/**
 * Builds a lexer from JSON-ish structure text: keys, string values, numbers,
 * booleans, null and punctuation. It runs only at module load, over strings we
 * author here, so it stays a fixed cost rather than runtime client work.
 *
 * Every rule is sticky so it only matches at the cursor; an unanchored match
 * would advance the cursor by the wrong length and corrupt the text.
 */
function lexJson(text: string): CodeToken[] {
  return coalesce(
    lex(text, [
      [/"(?:\\.|[^"\\])*"(?=\s*:)/y, "key"],
      [/"(?:\\.|[^"\\])*"/y, "string"],
      [/\b(?:true|false|null)\b/y, "keyword"],
      [/-?\d+(?:\.\d+)?\b/y, "number"],
      [/[{}[\],:]/y, "punct"],
    ]),
  );
}

/** Builds a lexer for shell lines: comments, commands, flags, strings and `$var`. */
function lexShell(text: string): CodeToken[] {
  return coalesce(
    lex(text, [
      [/#[^\n]*/y, "comment"],
      [/"(?:\\.|[^"\\])*"/y, "string"],
      [/'[^']*'/y, "string"],
      [/[A-Za-z][\w./@-]*/y, "key", true],
      [/[ \t]+--?[A-Za-z][\w-]*/y, "flag"],
      [/\$[A-Za-z_]\w*|\$\{[^}]*\}|\$\([^)]*\)/y, "keyword"],
    ]),
  );
}

/** Builds a lexer for JavaScript/TypeScript: strings, keywords and comments. */
function lexJs(text: string): CodeToken[] {
  return coalesce(
    lex(text, [
      [/\/\/[^\n]*/y, "comment"],
      [/`(?:\\.|[^`\\])*`/y, "string"],
      [/"(?:\\.|[^"\\])*"/y, "string"],
      [/'(?:\\.|[^'\\])*'/y, "string"],
      [/\b(?:const|await|async|return|import|from|export|function|new|if|throw|default)\b/y, "keyword"],
      [/\b[A-Za-z_$][\w$]*(?=\s*\()/y, "key"],
    ]),
  );
}

export function jsonSnippet(text: string): CodeToken[] {
  return lexJson(text);
}

export function shellSnippet(text: string): CodeToken[] {
  return lexShell(text);
}

export function jsSnippet(text: string): CodeToken[] {
  return lexJs(text);
}

/* -------------------------------------------------------------- constants */

export const MCP_URL = MCP_SERVER_URL;

/** `mcpServers` entry with an API key, used by clients without OAuth. */
export const MCP_API_KEY_CONFIG = jsonSnippet(
  `{
  "mcpServers": {
    "ledgerline": {
      "type": "http",
      "url": "${MCP_SERVER_URL}",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}`,
);

/** Same server, OAuth instead of a key: Claude Code, Cursor and most clients. */
export const MCP_OAUTH_CONFIG = jsonSnippet(
  `{
  "mcpServers": {
    "ledgerline": {
      "type": "http",
      "url": "${MCP_SERVER_URL}"
    }
  }
}`,
);

/** ChatGPT reads remote MCP servers from `mcpServers` in its own config. */
export const MCP_CHATGPT_CONFIG = jsonSnippet(
  `{
  "mcpServers": {
    "ledgerline": {
      "type": "streamable-http",
      "url": "${MCP_SERVER_URL}"
    }
  }
}`,
);

export const CLAUDE_PLUGIN_INSTALL = shellSnippet(
  `claude plugin marketplace add ${CLAUDE_MARKETPLACE}
claude plugin install ${CLAUDE_PLUGIN}`,
);

export const CLAUDE_MCP_ADD = shellSnippet(
  `claude mcp add --transport http ledgerline ${MCP_SERVER_URL}`,
);

export const REST_EXAMPLE = jsSnippet(
  `// From a company symbol to financial data.
const response = await fetch(
  \`\${API_BASE_URL}/api/v1/financials/TCS\`,
  { headers: { "X-API-Key": API_KEY } }
);

const financials = await response.json();
// Build something worth investing in.`,
);

export const CLI_EXAMPLE = shellSnippet(
  `# Install Ledgerline CLI
pnpm add -g @auenkr/legerline-cli

# Configure your dashboard API key
legerline set-api-key "<your-api-key>"

# Search, then explore company data
legerline get_v1_company_search --q reliance
legerline get_api_v1_company_profile \\
  --symbol "/company/RELIANCE/consolidated/"`,
);

export const CLI_INSTALL = shellSnippet("pnpm add -g @auenkr/legerline-cli\nlegerline --help");

export const CLI_CONFIG = shellSnippet(
  `legerline set-api-key "<your-api-key>"
legerline config
legerline tools`,
);

export const CLI_FIRST_REQUEST = shellSnippet(
  `legerline get_v1_company_search --q reliance

# Use the symbol returned by search unchanged.
legerline get_api_v1_company_profile --symbol "/company/RELIANCE/consolidated/"`,
);

export const CLI_ENV = shellSnippet(
  `export LEGERLINE_API_KEY="<your-api-key>"
export LEGERLINE_API_URL="${API_BASE_URL}"
legerline get_v1_company_search --q reliance`,
);

export const AUTH_HEADER = shellSnippet("X-API-Key: <your-api-key>");

export const SCREEN_CALL = shellSnippet(
  `MCP tool: screen_companies
Arguments: { "query": "Market Capitalization > 500 AND Price to Earning < 15" }

CLI:
legerline get_api_v1_screen --query 'Market Capitalization > 500 AND Price to Earning < 15'`,
);

export const SCREEN_RESULT = jsonSnippet(
  `{
  "query": "Market Capitalization > 500 AND Price to Earning < 15",
  "count": 1,
  "columns": ["Order", "Company", "CMP", "P/E"],
  "data": [{
    "Order": 1,
    "Company": "Example Industries",
    "Symbol": "/company/EXAMPLE/",
    "CMP": 196.75,
    "P/E": 12.4
  }]
}`,
);
