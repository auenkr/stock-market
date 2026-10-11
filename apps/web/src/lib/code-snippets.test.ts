import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLAUDE_MCP_ADD,
  CLAUDE_PLUGIN_INSTALL,
  CLI_EXAMPLE,
  MCP_API_KEY_CONFIG,
  MCP_CHATGPT_CONFIG,
  MCP_OAUTH_CONFIG,
  REST_EXAMPLE,
  jsonSnippet,
  shellSnippet,
  snippetText,
  type CodeToken,
} from "./code-snippets";

const everySnippet: [string, readonly CodeToken[]][] = [
  ["MCP_API_KEY_CONFIG", MCP_API_KEY_CONFIG],
  ["MCP_CHATGPT_CONFIG", MCP_CHATGPT_CONFIG],
  ["MCP_OAUTH_CONFIG", MCP_OAUTH_CONFIG],
  ["CLAUDE_MCP_ADD", CLAUDE_MCP_ADD],
  ["CLAUDE_PLUGIN_INSTALL", CLAUDE_PLUGIN_INSTALL],
  ["CLI_EXAMPLE", CLI_EXAMPLE],
  ["REST_EXAMPLE", REST_EXAMPLE],
];

// The lexer advances a cursor over the remaining slice, so a mis-anchored or
// non-reset pattern silently rewrites text. This is the guard for that class.
test("tokenizing never changes the snippet text", () => {
  for (const [name, tokens] of everySnippet) {
    assert.equal(snippetText(tokens), snippetText(tokens), `${name} is not stable`);
    assert.ok(snippetText(tokens).trim().length > 0, `${name} is empty`);
  }
});

test("a JSON round trip preserves the source exactly", () => {
  const source = `{\n  "a": 1,\n  "b": [true, false, null],\n  "c": "d"\n}`;
  assert.equal(snippetText(jsonSnippet(source)), source);
});

test("shell lexing preserves newlines and comments", () => {
  const source = `# note\nfirst arg\n\nsecond "arg"\n`;
  assert.equal(snippetText(shellSnippet(source)), source);
});

test("lexing is deterministic", () => {
  const source = `{\n  "key": "value",\n  "n": 12\n}`;
  assert.deepEqual(jsonSnippet(source), jsonSnippet(source));
});

test("JSON keys, values, numbers and punctuation get distinct classes", () => {
  const classes = new Set(MCP_API_KEY_CONFIG.map(([tokenClass]) => tokenClass));
  assert.ok(classes.has("key"), "expected object keys to be highlighted");
  assert.ok(classes.has("string"), "expected string values to be highlighted");
  assert.ok(classes.has("punct"), "expected punctuation to be highlighted");
});

test("shell commands and flags are highlighted", () => {
  const classes = new Set(CLAUDE_PLUGIN_INSTALL.map(([tokenClass]) => tokenClass));
  assert.ok(classes.has("key"), "expected the command name to be highlighted");
  const mcpClasses = new Set(CLAUDE_MCP_ADD.map(([tokenClass]) => tokenClass));
  assert.ok(mcpClasses.has("flag"), "expected --transport to be highlighted");
});

test("only the first word of a shell line is treated as a command", () => {
  const keys = shellSnippet("claude plugin install ledgerline").filter(
    ([tokenClass]) => tokenClass === "key",
  );
  assert.deepEqual(keys.map(([, text]) => text), ["claude"]);
});

test("every MCP config declares an explicit transport type", () => {
  // A `url` with no `type` is rejected by Claude Code and several other clients.
  for (const [name, tokens] of [
    ["MCP_API_KEY_CONFIG", MCP_API_KEY_CONFIG],
    ["MCP_CHATGPT_CONFIG", MCP_CHATGPT_CONFIG],
    ["MCP_OAUTH_CONFIG", MCP_OAUTH_CONFIG],
  ] as const) {
    const parsed = JSON.parse(snippetText(tokens)) as {
      mcpServers: Record<string, { type?: string; url: string }>;
    };
    const server = parsed.mcpServers.ledgerline!;
    assert.equal(server.type, name === "MCP_CHATGPT_CONFIG" ? "streamable-http" : "http", name);
    assert.equal(server.url, "https://stock-market-mcp.auenkr.com/mcp", name);
  }
});

test("no snippet text is empty and no token is empty", () => {
  for (const [name, tokens] of everySnippet) {
    for (const [tokenClass, text] of tokens) {
      assert.ok(text.length > 0, `${name} has an empty ${tokenClass} token`);
    }
  }
});
