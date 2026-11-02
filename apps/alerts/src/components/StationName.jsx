import { displayStationName, isKnownStationSlug, slugifyStation } from '../lib/stations.js';
import HighlightedText from './HighlightedText.jsx';

// Render a station name. Becomes a link to /station/:slug whenever the slug
// resolves to a known TARC roster station, even if there are no recent
// incidents in the window. Falls back to plain text when the slug does not match
// the roster.
// When `searchQuery` is non-empty, matched substrings get wrapped in <mark>.
// `label` overrides the rendered text while the slug still derives from `name`:
// inline linkify passes the station name exactly as TARC's prose wrote it
// ("Bankhead") so the sentence reads unchanged, even though `name` is the
// canonical "BANKHEAD Station" the slug resolves from.
export default function StationName({
  name,
  label,
  stationIndex: _stationIndex,
  searchQuery = '',
}) {
  if (!name) return null;
  const slug = slugifyStation(name);
  // Display drops parenthetical line qualifiers — line context is already
  // visible elsewhere on every render site that uses this component.
  // Slug still derives from the full name so qualified stations stay
  // distinct from /station/central-green.
  const display = label ?? displayStationName(name);
  const inner = <HighlightedText text={display} query={searchQuery} />;
  const known = slug && isKnownStationSlug(slug);
  const href = `/station/${slug}`;
  if (known) {
    // Dotted underline as a "this text is interactive" cue without going as
    // loud as full blue-link styling — these names appear inline inside
    // descriptive sentences, so a subtle always-on
    // affordance reads better than nothing-until-hover. Solidifies + turns
    // blue on hover to confirm it's a link.
    return (
      <a
        href={href}
        className="underline decoration-dotted decoration-slate-400 dark:decoration-slate-500 underline-offset-[3px] hover:decoration-solid hover:decoration-blue-500 hover:text-blue-500"
      >
        {inner}
      </a>
    );
  }
  return <>{inner}</>;
}
