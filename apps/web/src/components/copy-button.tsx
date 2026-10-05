"use client";

import { useEffect, useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [feedback, setFeedback] = useState("");
  useEffect(() => { setFeedback(""); }, [text]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 2000);
    return () => clearTimeout(timer);
  }, [feedback]);

  return <button className="copy-button" type="button" onClick={async () => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Copied ✓");
    } catch {
      setFeedback("Select text to copy");
    }
  }} aria-live="polite">{feedback || label}</button>;
}
