import { cancellationInfo } from '../../lib/cancellation.js';
import {
  botSummaryText,
  incidentHeadlineText,
  legacyKind,
  officialAlert,
  splitObservations,
} from '../../lib/incidents.js';
import { displayStationName } from '../../lib/stations.js';
import { normalizeTrainLine } from '../../lib/trainLines.js';
import StationName from '../StationName.jsx';

// Pull the routes/line out of an incident in a uniform shape. Alerts/merged
// records carry plural `routes`; standalone observations carry singular `line`.
export function incidentRoutes(incident) {
  const routes =
    Array.isArray(incident?.routes) && incident.routes.length > 0
      ? incident.routes
      : incident?.line
        ? [incident.line]
        : [];
  return legacyKind(incident) === 'train' ? routes.map(normalizeTrainLine) : routes;
}

// Plain-string variant of `describe` for places that can't render JSX —
// document.title, plain text logging, etc.
export function describeText(incident) {
  // A single-departure cancellation carries a prebuilt structured title (e.g.
  // "3:59 PM Blue Line departure from Indian Creek cancelled") — use it instead
  // of TARC's vague "Rail Service Alert for Blue Line" headline.
  const cancel = cancellationInfo(incident);
  if (cancel?.title) return cancel.title;
  if (officialAlert(incident)) return incidentHeadlineText(incident);
  const { primary } = splitObservations(incident);
  if (primary?.from_station && primary?.to_station) {
    const seg = `${displayStationName(primary.from_station)} → ${displayStationName(primary.to_station)}`;
    return primary.direction_label ? `${seg} (${primary.direction_label})` : seg;
  }
  return botSummaryText(incident);
}

export function describe(incident, stationIndex) {
  const cancel = cancellationInfo(incident);
  if (cancel?.title) return cancel.title;
  if (officialAlert(incident)) return incidentHeadlineText(incident);
  const { primary } = splitObservations(incident);
  if (primary?.from_station && primary?.to_station) {
    return (
      <>
        <StationName name={primary.from_station} stationIndex={stationIndex} /> →{' '}
        <StationName name={primary.to_station} stationIndex={stationIndex} />
        {primary.direction_label && (
          <span className="ml-2 text-base font-normal text-slate-500 dark:text-slate-400">
            ({primary.direction_label})
          </span>
        )}
      </>
    );
  }
  return botSummaryText(incident);
}
