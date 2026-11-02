import { useEffect, useRef, useState } from 'react';
import { useNow } from '../hooks/useNow.js';
import { formatRelativeTime } from '../lib/format.js';
import BrowseMenu from './BrowseMenu.jsx';

const FRESHNESS_NOTE =
  'This is the last time the alerts changed. The page checks for new data every 5 minutes while visible — an older time here just means nothing new has happened.';

function InfoPopover({ children, label = 'What does this mean?' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  return (
    <span ref={ref} className="inline-flex items-center ml-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex items-center justify-center hover:opacity-70 transition-opacity text-xs leading-none"
      >
        ℹ️
      </button>
      {open && (
        <span className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gh-surface border border-slate-200 dark:border-gh-border rounded-lg shadow-lg p-3 w-64 max-w-[calc(100vw-2rem)] text-xs text-slate-600 dark:text-slate-300 normal-case font-normal text-left whitespace-normal">
          {children}
        </span>
      )}
    </span>
  );
}

export default function Header({
  generatedAt,
  dark,
  onToggleDark,
  onResetFilters,
  alerts,
  observations,
}) {
  // Tick once a minute so the relative "Nm ago" label stays honest on a tab
  // left open. The absolute Atlanta time rides along as the hover tooltip.
  const now = useNow();
  const updatedAbs = generatedAt
    ? new Date(generatedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET'
    : null;
  const updatedRel = generatedAt ? formatRelativeTime(generatedAt, now) : null;

  return (
    <header className="bg-white dark:bg-gh-surface border-b border-slate-200 dark:border-gh-border">
      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* Top row: title + controls share a line at every width, so the
            controls no longer stack into a separate block below the meta on
            mobile (which pushed page content past the fold). */}
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            <button
              type="button"
              onClick={onResetFilters}
              className="min-w-0 text-left hover:opacity-70 transition-opacity"
              aria-label="Reset filters and return to default view"
            >
              Louisville Transit Alerts
            </button>
            {/* Top-aligned (self-start) so the badge tucks beside the first
                line of the title instead of floating against the vertical
                middle of a wrapped two/three-line heading on narrow screens. */}
            <span className="flex-shrink-0 self-start mt-1.5 inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] leading-none font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-600/20 dark:ring-blue-400/25">
              Beta
            </span>
          </h1>
          <div className="relative flex items-center gap-2 flex-shrink-0">
            <BrowseMenu alerts={alerts} observations={observations} align="responsive" />
            <button
              type="button"
              onClick={onToggleDark}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-gh-subtle text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border transition-colors"
              aria-label="Toggle dark mode"
            >
              {dark ? '☀️' : '🌙'}
              <span>{dark ? 'Light' : 'Dark'}</span>
            </button>
            {/* Last updated — beside the toggle on sm+; folded into the meta
                row below on mobile to keep this row short. */}
            {updatedRel && (
              <div className="hidden sm:flex items-center text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                <span title={updatedAbs ?? undefined}>Last data change: {updatedRel}</span>
                <InfoPopover>{FRESHNESS_NOTE}</InfoPopover>
              </div>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          TARC alerts and bot-detected service disruptions
        </p>
        {/* Last-updated note on mobile (sm+ shows it beside the controls above).
            The bot links moved into the Browse menu's "Follow on Bluesky"
            section so the header opens straight onto the page's content. */}
        {updatedRel && (
          <div className="sm:hidden relative flex items-center text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            <span title={updatedAbs ?? undefined}>Last data change: {updatedRel}</span>
            <InfoPopover>{FRESHNESS_NOTE}</InfoPopover>
          </div>
        )}
      </div>
    </header>
  );
}
