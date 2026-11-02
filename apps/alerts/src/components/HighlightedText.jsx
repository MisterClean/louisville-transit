import { Fragment } from 'react';

// Wrap occurrences of `query` inside `text` with <mark> for visual highlighting.
// Case-insensitive substring match, no regex — `query` is taken as a literal
// so user input like "8A" or special chars don't accidentally compile.
//
// Returns the original text when there's no query or no match — keeps callers
// from having to special-case the "render a string" path.
export default function HighlightedText({ text, query }) {
  if (text == null || text === '') return text;
  const q = (query || '').trim();
  if (q.length === 0) return text;
  const str = String(text);
  const lower = str.toLowerCase();
  const lowerQ = q.toLowerCase();
  if (!lower.includes(lowerQ)) return str;

  const parts = [];
  let i = 0;
  let pos = lower.indexOf(lowerQ, i);
  while (pos !== -1) {
    if (pos > i) parts.push(<Fragment key={`t-${i}`}>{str.slice(i, pos)}</Fragment>);
    parts.push(
      <mark
        key={`m-${pos}`}
        className="bg-yellow-200 dark:bg-yellow-900/60 text-inherit rounded-sm px-0.5"
      >
        {str.slice(pos, pos + q.length)}
      </mark>,
    );
    i = pos + q.length;
    pos = lower.indexOf(lowerQ, i);
  }
  if (i < str.length) parts.push(<Fragment key={`t-${i}`}>{str.slice(i)}</Fragment>);
  return <>{parts}</>;
}
