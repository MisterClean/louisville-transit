import { useEffect, useRef, useState } from 'react';

// Copies a plain-text summary of the incident to the clipboard — the
// paste-into-a-thread companion to ShareLink (which copies just the URL).
// Same clipboard-with-prompt-fallback pattern as ShareLink; no navigator.share
// path because a multi-line text blob isn't a great OS-share-sheet payload.
export default function CopySummary({ text }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!text) return null;

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this summary', text);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
    >
      {copied ? 'Copied!' : 'Copy summary 📋'}
    </button>
  );
}
