import { useState } from 'react';

// Generic collapsed-by-default disclosure for a whole homepage section. Used
// to tuck the retrospective visualizations ("Trends & history") below the
// fold so the homepage opens on the "what's happening now" content instead
// of a wall of charts. Children are only mounted while open, so the heavy
// grid/heatmap renders are skipped entirely until a reader asks for them.
//
// State isn't persisted — like the long-running banner, the section
// re-collapses on every load so the default homepage stays focused.
export default function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  className = '',
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-1 py-1 rounded-md text-left hover:bg-slate-100/70 dark:hover:bg-gh-subtle/50 transition-colors"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`h-3 w-3 flex-shrink-0 text-slate-500 dark:text-slate-400 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        >
          <path
            d="M4 2.5 L8 6 L4 9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {title}
        </span>
        {subtitle && (
          <span className="text-xs font-normal normal-case text-slate-500 dark:text-slate-400">
            {subtitle}
          </span>
        )}
      </button>
      {open && <div className="mt-3 space-y-6">{children}</div>}
    </section>
  );
}
