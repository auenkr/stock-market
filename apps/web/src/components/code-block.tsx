import { CopyButton } from "./copy-button";
import { renderTokens, snippetText, type CodeToken } from "../lib/code-snippets";

/**
 * A highlighted, copyable code block. Tokens are authored once in
 * `lib/code-snippets`; the clipboard takes their plain-text join.
 */
export function CodeBlock({
  tokens,
  label = "Copy",
  filename,
  className = "",
}: {
  tokens: readonly CodeToken[];
  label?: string;
  filename?: string;
  className?: string;
}) {
  return (
    <div className={`documentation-code ${filename ? "documentation-code-named" : ""} ${className}`.trim()}>
      <CopyButton text={snippetText(tokens)} label={label} />
      {filename && <span className="documentation-code-file">{filename}</span>}
      <pre><code>{renderTokens(tokens)}</code></pre>
    </div>
  );
}
