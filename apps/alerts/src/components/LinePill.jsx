import { formatBusRoute } from '../lib/busRoutes.js';
import { normalizeTrainLine, TRAIN_LINES } from '../lib/trainLines.js';

// Each pill is a link to the relevant /line/:id or /route/:id page. Brand
// colors stay loud, so we lean on subtle hover affordance (cursor + slight
// dim) rather than a competing visual cue. Multi-route alerts render one
// pill per route, each with its own destination.
const PILL_BASE =
  'inline-flex items-center min-w-0 max-w-full min-h-[24px] px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity';
// Tighter chip for dense lists (e.g. the accessibility outage rows), where a
// transfer station's full "X Line" pills crowd the row.
const PILL_COMPACT =
  'inline-flex items-center min-w-0 max-w-full min-h-[18px] px-1.5 py-px rounded-full text-[11px] font-semibold leading-none cursor-pointer hover:opacity-80 transition-opacity';

export default function LinePill({ kind, line, routes, linked = true, compact = false }) {
  const keys = routes?.length > 0 ? routes : [line];
  const base = compact ? PILL_COMPACT : PILL_BASE;
  const chipClass = linked ? base : base.replace('cursor-pointer hover:opacity-80', '');
  // Every pill caps at its container width and truncates its label — a long
  // route name (e.g. "#114 Columbia Dr / Snapfinger Woods Dr") otherwise blows
  // the compact row's width and pushes the elapsed-time chip off a phone screen.
  const renderChip = (key, href, className, label, props = {}) =>
    linked ? (
      <a key={key} href={href} className={className} title={label} {...props}>
        <span className="min-w-0 truncate">{label}</span>
      </a>
    ) : (
      <span key={key} className={className} title={label} {...props}>
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  return (
    <>
      {keys.map((key) => {
        const normalizedKey = kind === 'train' ? normalizeTrainLine(key) : key;
        const info = kind === 'train' ? TRAIN_LINES[normalizedKey] : null;
        if (info) {
          const label =
            compact || normalizedKey === 'streetcar' ? info.label : `${info.label} Line`;
          return renderChip(key, `/line/${normalizedKey}`, chipClass, label, {
            style: { backgroundColor: info.color, color: info.textColor },
          });
        }
        const busLabel = kind === 'bus' ? formatBusRoute(key) : key;
        return renderChip(
          key,
          kind === 'bus' ? `/route/${key}` : '/',
          `${chipClass} bg-slate-700 text-white`,
          busLabel,
        );
      })}
    </>
  );
}
