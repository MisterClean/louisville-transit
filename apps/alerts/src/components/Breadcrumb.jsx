// Visible breadcrumb trail for detail-page headers — replaces the old smart
// "← Back" link. `items` is an ordered trail from root to current page (see
// lib/breadcrumbs.js); the last item is the current page and renders as plain
// text with aria-current. Pages are full reloads (no client router), so linked
// crumbs are plain anchors.
export default function Breadcrumb({ items, className = '' }) {
  return (
    <nav aria-label="Breadcrumb" className={`min-w-0 ${className}`}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-slate-500 dark:text-slate-400">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={item.href ?? item.label} className="flex items-center gap-x-1.5">
              {last || !item.href ? (
                <span
                  className="text-slate-700 dark:text-slate-200 font-medium max-w-[60vw] truncate"
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <a
                  href={item.href}
                  className="text-blue-500 hover:text-blue-400 hover:underline whitespace-nowrap"
                >
                  {item.label}
                </a>
              )}
              {!last && (
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600 select-none">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
