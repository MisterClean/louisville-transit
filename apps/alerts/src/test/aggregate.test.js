import { describe, expect, it } from 'vitest';
import {
  buildBusIncidentsByDay,
  computeCancellationDelayStats,
  computeCohortDurationStats,
  computeDayOfWeekCounts,
  computeDisruptionMinutes,
  computeRecentBurst,
  computeRestorationDeltas,
  computeSegmentRecurrence,
  computeWorstDay,
  DEFAULT_SERVICE_HOURS_PER_DAY,
  serviceHoursForLine,
} from '../lib/aggregate.js';
import { atlantaDayUTC } from '../lib/format.js';

// Fixed reference instant so day/window math is deterministic across runs.
const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const obs = (over = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  ts: NOW - HOUR,
  resolved_ts: NOW,
  active: false,
  ...over,
});

const alert = (over = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  headline: 'Red Line Delays',
  first_seen_ts: NOW - HOUR,
  resolved_ts: NOW,
  active: false,
  ...over,
});

// ---------------------------------------------------------------------------
// serviceHoursForLine
// ---------------------------------------------------------------------------
describe('serviceHoursForLine', () => {
  it('gives owl-service lines 24h/day', () => {
    expect(serviceHoursForLine('train', 'red')).toBe(24);
    expect(serviceHoursForLine('train', 'blue')).toBe(24);
  });

  it('gives other train lines and buses the default 21h/day', () => {
    expect(serviceHoursForLine('train', 'green')).toBe(DEFAULT_SERVICE_HOURS_PER_DAY);
    expect(serviceHoursForLine('train', 'streetcar')).toBe(DEFAULT_SERVICE_HOURS_PER_DAY);
    expect(serviceHoursForLine('bus', '66')).toBe(DEFAULT_SERVICE_HOURS_PER_DAY);
  });
});

// ---------------------------------------------------------------------------
// computeDisruptionMinutes
// ---------------------------------------------------------------------------
describe('computeDisruptionMinutes', () => {
  it('sums a single span and computes the service-time denominator', () => {
    const out = computeDisruptionMinutes([], [obs({ ts: NOW - HOUR, resolved_ts: NOW })], {
      now: NOW,
      windowDays: 30,
      lines: [{ kind: 'train', line: 'red' }],
    });
    expect(out.disruptedMinutes).toBe(60);
    // Red is owl service → 24h/day.
    expect(out.serviceMinutes).toBe(24 * 30 * 60);
    expect(out.ratio).toBeCloseTo(60 / (24 * 30 * 60), 6);
  });

  it('unions overlapping spans on the same line instead of double-counting', () => {
    const out = computeDisruptionMinutes(
      [],
      [
        obs({ id: 1, ts: NOW - 60 * MIN, resolved_ts: NOW - 30 * MIN }),
        obs({ id: 2, ts: NOW - 40 * MIN, resolved_ts: NOW - 10 * MIN }),
      ],
      { now: NOW, windowDays: 30, lines: [{ kind: 'train', line: 'red' }] },
    );
    // Union of [-60,-30] and [-40,-10] is [-60,-10] = 50 minutes.
    expect(out.disruptedMinutes).toBe(50);
  });

  it('only counts in-scope routes for a multi-route alert', () => {
    const multi = alert({ routes: ['red', 'blue'], first_seen_ts: NOW - HOUR, resolved_ts: NOW });
    const scoped = computeDisruptionMinutes([multi], [], {
      now: NOW,
      windowDays: 30,
      lines: [{ kind: 'train', line: 'red' }],
    });
    expect(scoped.disruptedMinutes).toBe(60);
  });

  it('clamps spans to the window', () => {
    const out = computeDisruptionMinutes([], [obs({ ts: NOW - 40 * DAY, resolved_ts: NOW })], {
      now: NOW,
      windowDays: 30,
      lines: [{ kind: 'train', line: 'red' }],
    });
    // Only the last 30 days of the 40-day span count toward the numerator.
    expect(out.disruptedMinutes).toBe(30 * 24 * 60);
  });
});

// ---------------------------------------------------------------------------
// computeRecentBurst
// ---------------------------------------------------------------------------
describe('computeRecentBurst', () => {
  it('counts incidents in the recent window and scales the baseline', () => {
    const out = computeRecentBurst(
      [],
      [
        obs({ id: 1, ts: NOW - 1 * HOUR }),
        obs({ id: 2, ts: NOW - 2 * HOUR }),
        obs({ id: 3, ts: NOW - 10 * DAY }),
      ],
      { now: NOW, windowHours: 3, baselineDays: 30 },
    );
    expect(out.recentCount).toBe(2);
    expect(out.windowHours).toBe(3);
    expect(out.ratio).toBeGreaterThan(0);
  });

  it('returns a null ratio when there is no baseline to compare against', () => {
    const out = computeRecentBurst([], [obs({ ts: NOW - 1 * HOUR })], {
      now: NOW,
      windowHours: 3,
      baselineDays: 30,
    });
    expect(out.recentCount).toBe(1);
    expect(out.ratio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeDayOfWeekCounts
// ---------------------------------------------------------------------------
describe('computeDayOfWeekCounts', () => {
  it('returns a 7-element histogram and an honest week denominator', () => {
    const out = computeDayOfWeekCounts(
      [],
      [obs({ id: 1, ts: NOW }), obs({ id: 2, ts: NOW }), obs({ id: 3, ts: NOW })],
      { now: NOW, windowDays: 91 },
    );
    expect(out.counts).toHaveLength(7);
    expect(out.total).toBe(3);
    // All three share the same instant → one weekday bucket holds all of them.
    expect(out.maxCount).toBe(3);
    expect(out.numWeeks).toBe(13);
  });

  it('excludes incidents older than the window', () => {
    const out = computeDayOfWeekCounts([], [obs({ ts: NOW - 200 * DAY })], {
      now: NOW,
      windowDays: 91,
    });
    expect(out.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeWorstDay
// ---------------------------------------------------------------------------
describe('computeWorstDay', () => {
  it('returns the Atlanta day with the most incident starts', () => {
    const out = computeWorstDay(
      [],
      [
        obs({ id: 1, ts: NOW }),
        obs({ id: 2, ts: NOW - 30 * MIN }),
        obs({ id: 3, ts: NOW - 2 * DAY }),
      ],
      { now: NOW, windowDays: 90 },
    );
    expect(out.count).toBe(2);
    expect(out.dayUtc).toBe(atlantaDayUTC(NOW));
  });

  it('returns null when there are no incidents in the window', () => {
    expect(computeWorstDay([], [], { now: NOW })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeSegmentRecurrence
// ---------------------------------------------------------------------------
describe('computeSegmentRecurrence', () => {
  const seg = (over = {}) =>
    obs({
      from_station: 'CIVIC CENTER Station',
      to_station: 'FIVE POINTS Station',
      detection_source: 'gap',
      ...over,
    });

  it('ranks repeated station-to-station segments above the minimum count', () => {
    const out = computeSegmentRecurrence(
      [
        seg({ id: 1, ts: NOW - 1 * DAY }),
        seg({ id: 2, ts: NOW - 2 * DAY }),
        // A different segment that only appears once → below minCount.
        seg({
          id: 3,
          from_station: 'ASHBY Station',
          to_station: 'VINE CITY Station',
          ts: NOW - 1 * DAY,
        }),
      ],
      { now: NOW, windowDays: 90, minCount: 2 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      line: 'red',
      fromStation: 'CIVIC CENTER Station',
      toStation: 'FIVE POINTS Station',
      count: 2,
    });
  });

  it('ignores roundup observations and respects the line filter', () => {
    const out = computeSegmentRecurrence(
      [
        seg({ id: 1, ts: NOW - 1 * DAY }),
        seg({ id: 2, ts: NOW - 2 * DAY, detection_source: 'roundup' }),
        seg({ id: 3, line: 'blue', ts: NOW - 1 * DAY }),
      ],
      { now: NOW, windowDays: 90, minCount: 1, lineFilter: 'red' },
    );
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(1);
    expect(out[0].line).toBe('red');
  });
});

// ---------------------------------------------------------------------------
// computeCohortDurationStats
// ---------------------------------------------------------------------------
describe('computeCohortDurationStats', () => {
  // Peers share kind/line/detection_source so they bucket together.
  const peer = (id, durMin) =>
    obs({
      id,
      detection_source: 'gap',
      ts: NOW - 1 * DAY,
      resolved_ts: NOW - 1 * DAY + durMin * MIN,
    });

  it('returns the cohort median/p90 and this incident’s duration', () => {
    const target = {
      kind: 'train',
      line: 'red',
      detection_source: 'gap',
      post_url: 'https://bsky.app/profile/x/post/self',
      first_seen_ts: NOW - 2 * HOUR,
      resolved_ts: NOW - 2 * HOUR + 40 * MIN,
    };
    const peers = [peer(11, 10), peer(12, 20), peer(13, 30), peer(14, 40), peer(15, 50)];
    const out = computeCohortDurationStats(target, [], peers, {
      now: NOW,
      windowDays: 90,
      minCohort: 5,
    });
    expect(out.count).toBe(5);
    expect(out.medianMs).toBe(30 * MIN);
    expect(out.maxMs).toBe(50 * MIN);
    expect(out.thisMs).toBe(40 * MIN);
  });

  it('returns null when the cohort is below the minimum size', () => {
    const target = { kind: 'train', line: 'red', detection_source: 'gap' };
    const out = computeCohortDurationStats(target, [], [peer(11, 10), peer(12, 20)], {
      now: NOW,
      minCohort: 5,
    });
    expect(out).toBeNull();
  });

  it('returns null for an incident with no signal to bucket on', () => {
    const officialOnly = { kind: 'train', line: 'red' }; // no detection_source
    expect(computeCohortDurationStats(officialOnly, [], [], { now: NOW })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeRestorationDeltas
// ---------------------------------------------------------------------------
describe('computeRestorationDeltas', () => {
  // An alert + observation sharing an _incidentId merge into one record that
  // carries both resolution timestamps.
  const pair = ({ alertResolved, obsTs, obsResolved, id = 'r1', rkey = 'aaa' }) => ({
    alert: alert({
      _incidentId: id,
      post_url: `https://bsky.app/profile/x/post/${rkey}`,
      first_seen_ts: NOW - 60 * MIN,
      resolved_ts: alertResolved,
      active: false,
    }),
    obs: obs({
      _incidentId: id,
      post_url: `https://bsky.app/profile/x/post/${rkey}-obs`,
      ts: obsTs,
      resolved_ts: obsResolved,
      active: false,
    }),
  });

  it('flags MARTA clearing late (after service recovered)', () => {
    const { alert: a, obs: o } = pair({
      alertResolved: NOW,
      obsTs: NOW - 58 * MIN,
      obsResolved: NOW - 20 * MIN,
    });
    const out = computeRestorationDeltas([a], [o], { now: NOW, windowDays: 90 });
    expect(out.matchedCount).toBe(1);
    expect(out.officialClearedLate).toHaveLength(1);
    expect(out.officialClearedEarly).toHaveLength(0);
    expect(out.officialClearedLate[0].deltaMs).toBe(20 * MIN);
  });

  it('flags MARTA clearing early (before service recovered)', () => {
    const { alert: a, obs: o } = pair({
      alertResolved: NOW - 30 * MIN,
      obsTs: NOW - 58 * MIN,
      obsResolved: NOW - 10 * MIN,
    });
    const out = computeRestorationDeltas([a], [o], { now: NOW, windowDays: 90 });
    expect(out.officialClearedEarly).toHaveLength(1);
    expect(out.officialClearedEarly[0].deltaMs).toBe(-20 * MIN);
  });

  it('drops pairs whose observation barely overlaps the alert span', () => {
    // Obs covers only a sliver of a long alert → not a meaningful comparison.
    const a = alert({
      _incidentId: 'r2',
      post_url: 'https://bsky.app/profile/x/post/bbb',
      first_seen_ts: NOW - 10 * DAY,
      resolved_ts: NOW,
      active: false,
    });
    const o = obs({
      _incidentId: 'r2',
      ts: NOW - 30 * MIN,
      resolved_ts: NOW - 10 * MIN,
      active: false,
    });
    const out = computeRestorationDeltas([a], [o], { now: NOW, windowDays: 90 });
    expect(out.matchedCount).toBe(0);
  });

  it('drops sub-threshold deltas', () => {
    const { alert: a, obs: o } = pair({
      alertResolved: NOW,
      obsTs: NOW - 58 * MIN,
      obsResolved: NOW - 2 * MIN, // only 2 min delta, below the 5-min floor
    });
    const out = computeRestorationDeltas([a], [o], { now: NOW, windowDays: 90 });
    expect(out.matchedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildBusIncidentsByDay
// ---------------------------------------------------------------------------
describe('buildBusIncidentsByDay', () => {
  it('buckets bus incidents by day and ranks the top routes', () => {
    const busObs = (over) => obs({ kind: 'bus', line: '66', from_station: null, ...over });
    const out = buildBusIncidentsByDay(
      [],
      [
        busObs({ id: 1, line: '66', ts: NOW, resolved_ts: NOW }),
        busObs({ id: 2, line: '66', ts: NOW - 1 * DAY, resolved_ts: NOW - 1 * DAY }),
        busObs({ id: 3, line: '9', ts: NOW, resolved_ts: NOW }),
      ],
      90,
      NOW,
    );
    expect(out.topRoutes).toContain('66');
    expect(out.byRoute['66'][0]).toBe(1); // one incident today on the 66
    expect(out.aggregate[0]).toBe(2); // two distinct routes had an incident today
  });

  it('ignores train incidents', () => {
    const out = buildBusIncidentsByDay([], [obs({ kind: 'train', line: 'red' })], 90, NOW);
    expect(out.topRoutes).toHaveLength(0);
    expect(Object.keys(out.byRoute)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeCancellationDelayStats
// ---------------------------------------------------------------------------
describe('computeCancellationDelayStats', () => {
  const cancelInc = ({ depTs = NOW - DAY, origin = 'Bankhead', state = 'cancelled' } = {}) => ({
    id: `c-${depTs}-${origin}`,
    routes: ['green'],
    status: { type: 'cancellation', state, origin, scheduled_departure_ts: depTs },
  });
  const delayInc = ({ startTs = NOW - DAY, durationMs = 30 * MIN, active = false } = {}) => ({
    id: `d-${startTs}`,
    routes: ['green'],
    lifecycle: {
      first_seen_ts: startTs,
      resolved_ts: active ? null : startTs + durationMs,
      active,
      duration_ms: active ? null : durationMs,
    },
    status: { type: 'delay' },
  });

  it('counts cancellations and delay alerts in-window with per-week rates', () => {
    const out = computeCancellationDelayStats(
      [
        cancelInc({ depTs: NOW - DAY }),
        cancelInc({ depTs: NOW - 2 * DAY }),
        cancelInc({ depTs: NOW - 3 * DAY }),
        delayInc({ startTs: NOW - DAY }),
        delayInc({ startTs: NOW - 2 * DAY }),
      ],
      { now: NOW, windowDays: 90 },
    );
    expect(out.cancellations.count).toBe(3);
    expect(out.delays.count).toBe(2);
    expect(out.total).toBe(5);
    expect(out.cancellations.perWeek).toBeCloseTo(3 / (90 / 7), 5);
    expect(out.delays.perWeek).toBeCloseTo(2 / (90 / 7), 5);
  });

  it('excludes announced-but-future (upcoming) cancellations', () => {
    const out = computeCancellationDelayStats(
      [cancelInc({ depTs: NOW + DAY, state: 'upcoming' }), cancelInc({ depTs: NOW - DAY })],
      { now: NOW, windowDays: 90 },
    );
    expect(out.cancellations.count).toBe(1);
    expect(out.cancellations.hoursSinceLast).toBe(24);
  });

  it('reports recency past the window but does not count out-of-window cancellations', () => {
    const out = computeCancellationDelayStats([cancelInc({ depTs: NOW - 100 * DAY })], {
      now: NOW,
      windowDays: 90,
    });
    expect(out.cancellations.count).toBe(0);
    expect(out.cancellations.hoursSinceLast).toBe(2400);
  });

  it('groups cancellations by origin, busiest first with alpha tiebreak', () => {
    const out = computeCancellationDelayStats(
      [
        cancelInc({ origin: 'Bankhead' }),
        cancelInc({ origin: 'Bankhead', depTs: NOW - 2 * DAY }),
        cancelInc({ origin: 'Edgewood', depTs: NOW - 3 * DAY }),
        cancelInc({ origin: 'Ashby', depTs: NOW - 4 * DAY }),
      ],
      { now: NOW, windowDays: 90 },
    );
    expect(out.cancellations.byOrigin).toEqual([
      { origin: 'Bankhead', count: 2 },
      { origin: 'Ashby', count: 1 },
      { origin: 'Edgewood', count: 1 },
    ]);
    const partTotal = out.cancellations.byPartOfDay.reduce((s, p) => s + p.count, 0);
    expect(partTotal).toBe(out.cancellations.count);
  });

  it('counts origin-less cancellations in the total but omits them from the breakdown', () => {
    const out = computeCancellationDelayStats(
      [
        cancelInc({ origin: 'Bankhead' }),
        cancelInc({ origin: null, depTs: NOW - 2 * DAY }),
        cancelInc({ origin: '', depTs: NOW - 3 * DAY }),
      ],
      { now: NOW, windowDays: 90 },
    );
    expect(out.cancellations.count).toBe(3);
    expect(out.cancellations.byOrigin).toEqual([{ origin: 'Bankhead', count: 1 }]);
  });

  it('takes the median of resolved delay durations and skips active ones', () => {
    const out = computeCancellationDelayStats(
      [
        delayInc({ durationMs: 20 * MIN }),
        delayInc({ startTs: NOW - 2 * DAY, durationMs: 40 * MIN }),
        delayInc({ startTs: NOW - 3 * DAY, durationMs: 60 * MIN }),
        delayInc({ startTs: NOW - 4 * DAY, active: true }),
      ],
      { now: NOW, windowDays: 90 },
    );
    expect(out.delays.count).toBe(4);
    expect(out.delays.medianDurationMin).toBe(40);
  });

  it('returns an empty, renderable shape for a line with no history', () => {
    const out = computeCancellationDelayStats([], { now: NOW, windowDays: 90 });
    expect(out.total).toBe(0);
    expect(out.cancellations.count).toBe(0);
    expect(out.cancellations.hoursSinceLast).toBeNull();
    expect(out.delays.medianDurationMin).toBeNull();
    expect(out.cancellations.byOrigin).toEqual([]);
  });
});
