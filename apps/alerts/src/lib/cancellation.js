// Display helpers for TARC single-departure rail cancellations.
//
// The insights export (bin/marta/export-web.js) ships a top-level `status`
// object on an incident when a TARC rail alert's prose names a specific
// cancelled departure. It's an incident-level fact, not alert metadata, and
// carries the rider-facing title + the server-computed lifecycle state — so the
// frontend stays a dumb renderer: no clock math, no "is it past?" logic here.
//
// Lifecycle (set server-side):
//   'upcoming'  — announced, before the cancelled departure's scheduled time
//   'cancelled' — the scheduled departure has passed; terminal
//
// TARC analog of cta-alert-history/src/lib/cancellation.js. Unlike Metra (which
// resolves an annulled train against the GTFS timetable and so carries a train
// number + arrival), TARC gives us only prose — so the block carries the
// parsed departure time, origin, line, and a prebuilt title, and there's no
// train-number/arrival concept.
//
// Vague reduced-service / single-tracking alerts that name no specific cancelled
// departure carry no `status` block and keep the ordinary ongoing→resolved
// status.

import { formatTime } from './format.js';

/**
 * Normalize an incident's cancellation status, or null when it isn't a
 * single-departure cancellation.
 * @param {object} incident
 * @returns {{state:string,isUpcoming:boolean,isCancelled:boolean,departureTs:number|null,origin:string|null,line:string|null,title:string|null}|null}
 */
export function cancellationInfo(incident, now = Date.now()) {
  const c = incident?.status?.type === 'cancellation' ? incident.status : null;
  if (!c?.state) return null;
  const departureTs = c.scheduled_departure_ts ?? null;
  // The producer stamps `state` at export time, but between exports the wall
  // clock can cross the scheduled departure (the export only refreshes when the
  // data changes, otherwise on a 15-min backstop). When we know the departure
  // time, re-derive upcoming/cancelled from it — the same now-vs-departure check
  // collectUpcomingCancellations already uses — so the label flips on schedule
  // instead of lagging the next export. Vague cancellations that name no
  // departure time keep the server-supplied state.
  const isUpcoming = departureTs != null ? departureTs > now : c.state === 'upcoming';
  return {
    state: isUpcoming ? 'upcoming' : 'cancelled',
    isUpcoming,
    isCancelled: !isUpcoming,
    departureTs,
    origin: c.origin ?? null,
    line: c.line ?? null,
    title: c.title ?? null,
  };
}

/** Short status-pill label, e.g. 'upcoming cancellation' / 'cancelled'. */
export function cancellationStatusLabel(info) {
  if (!info) return null;
  return info.isUpcoming ? 'upcoming cancellation' : 'cancelled';
}

/**
 * The upcoming (announced-but-not-yet-departed) single-departure cancellations
 * in a set of incidents, soonest first. Filtered to departures still ahead of
 * `now` (an 'upcoming' whose time has passed is finalizing server-side; don't
 * surface it as still-upcoming). Each entry is flattened for direct rendering.
 *
 * TARC analog of cta-alert-history's `collectUpcomingCancellations`. TARC gives
 * us only prose, so there's no train-number concept — the line key comes from the
 * incident's normalized `routes` (lowercase, e.g. `red`) for pill lookup, and the
 * status block carries the parsed departure time + origin.
 * @returns {Array<{id:string,line:string|null,departureTs:number,origin:string|null,title:string|null}>}
 */
export function collectUpcomingCancellations(incidents, { now = Date.now() } = {}) {
  const out = [];
  for (const inc of incidents || []) {
    const info = cancellationInfo(inc, now);
    if (!info?.isUpcoming || info.departureTs == null || info.departureTs <= now) continue;
    out.push({
      id: inc.id,
      line: Array.isArray(inc.routes) ? (inc.routes[0] ?? null) : null,
      departureTs: info.departureTs,
      origin: info.origin,
      title: info.title,
    });
  }
  return out.sort((a, b) => a.departureTs - b.departureTs);
}

/**
 * Rider-facing scheduled-departure phrase, e.g. "3:59 PM departure". Null when
 * no scheduled time is known.
 */
export function cancellationSchedulePhrase(info) {
  if (!info || info.departureTs == null) return null;
  return `${formatTime(info.departureTs)} departure`;
}
