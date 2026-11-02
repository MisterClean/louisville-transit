import { describe, expect, it } from 'vitest';
import {
  buildDailyTrend,
  buildHourOfWeek,
  buildIncidentsByDay,
  buildSignalsByLine,
  buildTodaySummary,
  buildWeekSummary,
  computeDurationHistogram,
  computeLineReliability,
  computeStatsLeaderboards,
  computeSummaryStats,
  computeTypicalDurations,
  computeYearOverYear,
  describePeakWindow,
  listWeeks,
  typicalDurationKey,
  weekStartUTC,
} from '../lib/aggregate.js';
import { formatDuration, formatGap, formatRelativeTime, formatWeekRange } from '../lib/format.js';
import {
  buildSearchMatchers,
  filterIncidents,
  findRelatedIncidents,
  groupIncidentRecords,
  incidentCategory,
  incidentHeadlineText,
  isDetourIncident,
  isPlannedIncident,
  legacyKind,
  modeLabel,
  observationSignals,
  officialRecordFromIncident,
  searchFilterIncidents,
} from '../lib/incidents.js';
import {
  officialAlertFromOfficial,
  incident as v2Incident,
  lifecycle as v2Lifecycle,
} from './v2TestHelpers.js';

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  it('returns null for falsy input', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });

  it('formats minutes only', () => {
    expect(formatDuration(5 * 60_000)).toBe('~5m');
    expect(formatDuration(59 * 60_000)).toBe('~59m');
  });

  it('formats whole hours', () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe('~2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(90 * 60_000)).toBe('~1h 30m');
  });

  it('formats days, hours, and minutes past 24h', () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe('~1d');
    expect(formatDuration(28 * 60 * 60_000 + 41 * 60_000)).toBe('~1d 4h 41m');
    expect(formatDuration(25 * 60 * 60_000)).toBe('~1d 1h');
    expect(formatDuration(24 * 60 * 60_000 + 30 * 60_000)).toBe('~1d 30m');
  });
});

// ---------------------------------------------------------------------------
// filterIncidents
// ---------------------------------------------------------------------------
const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('legacyKind', () => {
  it('treats exported MARTA rail and streetcar modes as train incidents', () => {
    expect(legacyKind(v2Incident({ mode: 'rail', routes: ['RED'] }))).toBe('train');
    expect(legacyKind(v2Incident({ mode: 'streetcar', routes: ['streetcar'] }))).toBe('train');
  });

  it('treats MARTA route A (Rapid A Line BRT) as a bus, not the streetcar', () => {
    expect(legacyKind(v2Incident({ kind: 'bus', mode: 'bus', routes: ['A'] }))).toBe('bus');
  });
});

// Official/detection record builders — still used by the analytics tests below
// (computeSummaryStats, computeYearOverYear, groupIncidentRecords, …), which
// continue to operate on incident-derived row inputs.
const makeAlert = (overrides = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  first_seen_ts: NOW - DAY,
  active: false,
  resolved_ts: NOW - DAY + 30 * 60_000,
  ...overrides,
});

const makeObs = (overrides = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  ts: NOW - DAY,
  active: false,
  resolved_ts: NOW - DAY + 30 * 60_000,
  ...overrides,
});

const modeForKind = (kind) => kind;
const agencyForKind = () => 'official';
const lifecycle = ({ first_seen_ts, ts, onset_ts, resolved_ts, active, duration_ms }) => ({
  first_seen_ts: first_seen_ts ?? ts ?? null,
  onset_ts: onset_ts ?? null,
  resolved_ts: resolved_ts ?? null,
  active: active ?? false,
  duration_ms: duration_ms ?? null,
});
const detectionFromObs = (_kind, routes, obs = {}) => ({
  id: obs.id ?? 1,
  source: obs.detection_source ?? 'gap',
  scope: {
    route: obs.line ?? routes?.[0] ?? null,
    direction: obs.direction ?? null,
    direction_label: obs.direction_label ?? null,
    from_station: obs.from_station ?? null,
    to_station: obs.to_station ?? null,
    stations: obs.stations ?? [],
  },
  lifecycle: lifecycle({
    first_seen_ts: obs.first_seen_ts ?? obs.ts ?? NOW - DAY,
    onset_ts: obs.onset_ts ?? null,
    resolved_ts: obs.resolved_ts ?? NOW - DAY + 30 * 60_000,
    active: obs.active ?? false,
    duration_ms: obs.duration_ms ?? null,
  }),
  post_url: obs.post_url ?? null,
  resolved_post_url: obs.resolved_post_url ?? null,
  description: obs.bot_description ?? null,
  evidence: {
    signals: obs.signals ?? null,
    details: obs.evidence ?? null,
    bullets: obs.bot_evidence_bullets ?? [],
    onset_description: obs.onset_description ?? null,
    train_number: obs.train_number ?? null,
    resolved_description: obs.bot_resolved_description ?? null,
  },
});
const alertFromOfficial = (base, official = {}) => ({
  id: official.alert_id ?? official.id ?? 'a',
  headline: official.headline ?? 'Red Line Delays',
  description: official.short_description ?? official.description ?? null,
  post_url: official.post_url ?? null,
  resolved_reply_url: official.resolved_reply_url ?? null,
  lifecycle: lifecycle({
    first_seen_ts: official.first_seen_ts ?? base.first_seen_ts,
    resolved_ts: official.resolved_ts ?? base.resolved_ts,
    active: official.active ?? base.active,
    duration_ms: official.duration_ms ?? base.duration_ms,
  }),
  scope: {
    from_station: official.affected_from_station ?? official.from_station ?? null,
    to_station: official.affected_to_station ?? official.to_station ?? null,
    stations: official.affected_stations ?? official.stations ?? [],
    mentioned_stations: official.mentioned_stations ?? [],
    direction: official.affected_direction ?? official.direction ?? null,
  },
  agency_event_window: {
    start_ts: official.agency_event_start_ts ?? null,
    end_ts: official.agency_event_end_ts ?? null,
    start_is_date_only: official.agency_event_start_is_date_only ?? false,
    end_is_date_only: official.agency_event_end_is_date_only ?? false,
  },
  versions: official.versions,
});

// Nested v2 incident builders for the incidents-native filter/search tests.
// `aInc` is an official-alert-only incident, `oInc` a bot-only one. Overrides
// use the old test vocabulary but are converted to the v2 wire shape here.
let _incSeq = 0;
const aInc = (over = {}) => {
  const {
    kind = 'train',
    routes = ['red'],
    first_seen_ts = NOW - DAY,
    resolved_ts = NOW - DAY + 30 * 60_000,
    active = false,
    official,
    observations,
    ...top
  } = over;
  const base = { first_seen_ts, resolved_ts, active, duration_ms: top.duration_ms ?? null };
  return {
    id: `inc${_incSeq++}`,
    agency: agencyForKind(kind),
    mode: modeForKind(kind),
    routes,
    lifecycle: lifecycle(base),
    sources: observations?.length ? [agencyForKind(kind), 'bot'] : [agencyForKind(kind)],
    official_alert: alertFromOfficial(base, {
      alert_id: 'a',
      headline: 'Red Line Delays',
      ...official,
    }),
    detections: (observations ?? []).map((o) => detectionFromObs(kind, routes, o)),
    status: null,
    ...top,
  };
};
const oInc = (over = {}) => {
  const {
    kind = 'train',
    routes = ['red'],
    first_seen_ts = NOW - DAY,
    resolved_ts = NOW - DAY + 30 * 60_000,
    active = false,
    obs,
    ...top
  } = over;
  const detection = {
    id: 1,
    kind,
    line: routes[0],
    ts: first_seen_ts,
    resolved_ts,
    active,
    ...obs,
  };
  return {
    id: `inc${_incSeq++}`,
    agency: agencyForKind(kind),
    mode: modeForKind(kind),
    routes,
    lifecycle: lifecycle({ first_seen_ts, resolved_ts, active, duration_ms: top.duration_ms }),
    sources: ['bot'],
    official_alert: null,
    detections: [detectionFromObs(kind, routes, detection)],
    status: null,
    ...top,
  };
};

describe('filterIncidents', () => {
  it('returns everything when no filters are set', () => {
    const result = filterIncidents([aInc(), oInc()]);
    expect(result).toHaveLength(2);
  });

  it('filters incidents by train line', () => {
    const out = filterIncidents([aInc({ routes: ['red'] }), aInc({ routes: ['blue'] })], {
      lines: ['red'],
    });
    expect(out).toHaveLength(1);
    expect(out[0].routes).toContain('red');
  });

  it('filters train observation incidents by line', () => {
    const blue = oInc({ routes: ['blue'], obs: { id: 2, line: 'blue' } });
    const out = filterIncidents([oInc(), blue], { lines: ['red'] });
    expect(out).toHaveLength(1);
    expect(out[0].routes).toContain('red');
  });

  it('hides old resolved incidents when startTs is set', () => {
    const old = aInc({ first_seen_ts: NOW - 10 * DAY, resolved_ts: NOW - 9 * DAY });
    const recent = aInc({ first_seen_ts: NOW - DAY });
    const out = filterIncidents([old, recent], { startTs: NOW - 5 * DAY });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(recent.id);
  });

  it('keeps active incidents regardless of startTs', () => {
    const active = aInc({ first_seen_ts: NOW - 10 * DAY, resolved_ts: null, active: true });
    expect(filterIncidents([active], { startTs: NOW - 5 * DAY })).toHaveLength(1);
  });

  it('hides bus incidents when showBus is false', () => {
    const bus = oInc({ kind: 'bus', routes: ['66'], obs: { id: 2, kind: 'bus', line: '66' } });
    const train = oInc({ obs: { id: 3, kind: 'train', line: 'red' } });
    const out = filterIncidents([bus, train], { showBus: false });
    expect(out).toHaveLength(1);
    expect(out[0].mode).toBe('train');
  });

  it('shows bus incidents independently of train line filter', () => {
    const bus = oInc({ kind: 'bus', routes: ['66'], obs: { id: 2, kind: 'bus', line: '66' } });
    expect(filterIncidents([bus], { lines: ['red'], showBus: true })).toHaveLength(1);
  });

  it('filters bus incidents by selected bus routes', () => {
    const a22 = aInc({ kind: 'bus', routes: ['22'], official: { alert_id: 'a22' } });
    const a66 = aInc({ kind: 'bus', routes: ['66'], official: { alert_id: 'a66' } });
    const out = filterIncidents([a22, a66], { busRoutes: ['22'] });
    expect(out).toHaveLength(1);
    expect(out[0].routes).toContain('22');
  });

  it('hides bus alert incidents when showBus is false', () => {
    const bus = aInc({ kind: 'bus', routes: ['22'] });
    const train = aInc({ kind: 'train', routes: ['red'] });
    const out = filterIncidents([bus, train], { showBus: false });
    expect(out).toHaveLength(1);
    expect(out[0].mode).toBe('train');
  });

  // selectedDay narrows to a single Atlanta calendar day. Reference day is the
  // UTC midnight of NOW's Atlanta day; helpers below construct timestamps
  // relative to it.
  describe('selectedDay', () => {
    // atlantaDayUTC of NOW (1e12) lands on 2001-09-09 UTC.
    const dayUtc = Date.UTC(2001, 8, 9);
    const onDayTs = dayUtc + 12 * 60 * 60_000; // noon UTC, well within the day

    it('keeps incidents that started on the pinned day', () => {
      const a = aInc({ first_seen_ts: onDayTs, resolved_ts: onDayTs + 60_000 });
      expect(filterIncidents([a], { selectedDay: dayUtc, now: NOW })).toHaveLength(1);
    });

    it('drops incidents from a different day', () => {
      const earlier = aInc({
        first_seen_ts: onDayTs - 3 * DAY,
        resolved_ts: onDayTs - 3 * DAY + 60_000,
      });
      expect(filterIncidents([earlier], { selectedDay: dayUtc, now: NOW })).toHaveLength(0);
    });

    it('keeps active incidents whose span crosses the pinned day', () => {
      // Started 2 days before the pinned day, still active.
      const active = aInc({ first_seen_ts: onDayTs - 2 * DAY, resolved_ts: null, active: true });
      const out = filterIncidents([active], { selectedDay: dayUtc, now: onDayTs + 60_000 });
      expect(out).toHaveLength(1);
    });
  });
});

describe('incidentHeadlineText', () => {
  it('uses the earliest official version as the stable MARTA incident title', () => {
    const inc = aInc({
      kind: 'train',
      routes: ['red'],
      official: {
        headline: 'Red Line Service Resuming Normal Routing',
        versions: [
          {
            ts: NOW,
            headline: '95th/Dan Ryan-bound Subway Trains Rerouted to Elevated Tracks',
          },
          {
            ts: NOW + 20 * 60_000,
            headline: 'Red Line Service Resuming Normal Routing',
          },
        ],
      },
    });

    expect(incidentHeadlineText(inc)).toBe(
      '95th/Dan Ryan-bound Subway Trains Rerouted to Elevated Tracks',
    );
  });
});

// ---------------------------------------------------------------------------
// groupIncidentRecords
// ---------------------------------------------------------------------------
// The fuzzy alert↔observation pairing now happens server-side in official-insights
// (covered by its export-web test). The frontend's groupIncidentRecords only
// REGROUPS records by the _incidentId that pairing stamped on them — so these
// fixtures share an _incidentId to express "same incident."
const makeAlertForMerge = (overrides = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  headline: 'Red Line Delays',
  first_seen_ts: NOW,
  last_seen_ts: NOW + 20 * 60_000,
  resolved_ts: NOW + 30 * 60_000,
  active: false,
  post_url: 'https://bsky.app/a',
  _incidentId: 'm1',
  ...overrides,
});

const makeObsForMerge = (overrides = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  from_station: 'CIVIC CENTER Station',
  to_station: 'FIVE POINTS Station',
  ts: NOW + 5 * 60_000,
  resolved_ts: NOW + 30 * 60_000,
  active: false,
  post_url: 'https://bsky.app/b',
  _incidentId: 'm1',
  ...overrides,
});

describe('groupIncidentRecords', () => {
  it('regroups an alert and observation that share an _incidentId', () => {
    const { merged, standaloneAlerts, standaloneObs } = groupIncidentRecords(
      [makeAlertForMerge()],
      [makeObsForMerge()],
    );
    expect(merged).toHaveLength(1);
    expect(standaloneAlerts).toHaveLength(0);
    expect(standaloneObs).toHaveLength(0);
    expect(merged[0].headline).toBe('Red Line Delays');
    expect(merged[0].from_station).toBe('CIVIC CENTER Station');
  });

  it('keeps an alert with no observation as a standalone alert', () => {
    const { merged, standaloneAlerts, standaloneObs } = groupIncidentRecords(
      [makeAlertForMerge()],
      [],
    );
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(1);
    expect(standaloneObs).toHaveLength(0);
  });

  it('keeps an observation with a different _incidentId as standalone', () => {
    const { merged, standaloneAlerts, standaloneObs } = groupIncidentRecords(
      [makeAlertForMerge({ _incidentId: 'a' })],
      [makeObsForMerge({ _incidentId: 'b' })],
    );
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(1);
    expect(standaloneObs).toHaveLength(1);
  });

  it('never groups records that lack an _incidentId', () => {
    // Defensive: un-stamped records (didn't pass through incidentRecords)
    // each get a unique key so they can't accidentally merge.
    const { merged, standaloneAlerts, standaloneObs } = groupIncidentRecords(
      [makeAlertForMerge({ _incidentId: undefined })],
      [makeObsForMerge({ _incidentId: undefined })],
    );
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(1);
    expect(standaloneObs).toHaveLength(1);
  });

  it('regroups a bus alert and observation that share an _incidentId', () => {
    const busAlert = makeAlertForMerge({ kind: 'bus', routes: ['66'] });
    const busObs = makeObsForMerge({ kind: 'bus', line: '66' });
    const { merged, standaloneAlerts, standaloneObs } = groupIncidentRecords([busAlert], [busObs]);
    expect(merged).toHaveLength(1);
    expect(standaloneAlerts).toHaveLength(0);
    expect(standaloneObs).toHaveLength(0);
    expect(merged[0].routes).toEqual(['66']);
  });

  it('absorbs every observation sharing the incident onto the alert', () => {
    // A single outage commonly trips multiple detectors (pulse-cold + roundup,
    // etc.); the server groups them all under one incident, so they all fold
    // into the alert's card here.
    const obs1 = makeObsForMerge({ id: 1, ts: NOW + 1 * 60_000 });
    const obs2 = makeObsForMerge({ id: 2, ts: NOW + 2 * 60_000 });
    const { merged, standaloneObs } = groupIncidentRecords([makeAlertForMerge()], [obs1, obs2]);
    expect(merged).toHaveLength(1);
    expect(standaloneObs).toHaveLength(0);
    // Closest-to-alert wins primary; the rest go onto extra_obs.
    expect(merged[0].obs_id).toBe(1);
    expect(merged[0].extra_obs).toHaveLength(1);
    expect(merged[0].extra_obs[0].id).toBe(2);
  });

  it('collapses a bot-only incident with multiple detections into one standalone obs', () => {
    // A roundup commonly carries several detections (e.g. a ghost + a gap) under
    // one incident with no official alert. The incidents[] list shows it as a
    // single event, so the count/merge surfaces must too — not one per detector.
    const ghost = makeObsForMerge({
      id: 1,
      ts: NOW + 1 * 60_000,
      resolved_ts: NOW + 40 * 60_000,
      active: false,
      _incidentId: 'bot1',
    });
    const gap = makeObsForMerge({
      id: 2,
      ts: NOW + 5 * 60_000,
      resolved_ts: NOW + 50 * 60_000,
      active: false,
      _incidentId: 'bot1',
    });
    const { merged, standaloneAlerts, standaloneObs } = groupIncidentRecords([], [ghost, gap]);
    expect(merged).toHaveLength(0);
    expect(standaloneAlerts).toHaveLength(0);
    expect(standaloneObs).toHaveLength(1);
    // Earliest detection represents the incident onset; resolution is the latest.
    expect(standaloneObs[0].ts).toBe(NOW + 1 * 60_000);
    expect(standaloneObs[0].resolved_ts).toBe(NOW + 50 * 60_000);
    expect(standaloneObs[0].active).toBe(false);
  });

  it('keeps a multi-detection bot-only incident active if any detection is active', () => {
    const resolved = makeObsForMerge({ id: 1, ts: NOW, active: false, _incidentId: 'bot2' });
    const open = makeObsForMerge({
      id: 2,
      ts: NOW + 5 * 60_000,
      resolved_ts: null,
      active: true,
      _incidentId: 'bot2',
    });
    const { standaloneObs } = groupIncidentRecords([], [resolved, open]);
    expect(standaloneObs).toHaveLength(1);
    expect(standaloneObs[0].active).toBe(true);
    expect(standaloneObs[0].resolved_ts).toBeNull();
  });

  it('suppresses resolution fields when alert is still active', () => {
    // Bot observation ended before the MARTA alert was even posted (e.g. a
    // leading-edge ghost detection that cleared right before MARTA announced
    // the reroute). The merged incident must stay active with no resolved_ts
    // or obs_resolved_post_url leaking into the UI.
    const activeAlert = makeAlertForMerge({
      first_seen_ts: NOW,
      resolved_ts: null,
      active: true,
      resolved_reply_url: null,
    });
    const resolvedObs = makeObsForMerge({
      ts: NOW - 30 * 60_000,
      resolved_ts: NOW - 10 * 60_000,
      active: false,
      resolved_post_url: 'https://bsky.app/obs-resolution',
    });
    const { merged } = groupIncidentRecords([activeAlert], [resolvedObs]);
    expect(merged).toHaveLength(1);
    expect(merged[0].active).toBe(true);
    expect(merged[0].resolved_ts).toBeNull();
    expect(merged[0].obs_resolved_post_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildIncidentsByDay
// ---------------------------------------------------------------------------
describe('buildIncidentsByDay legacy rail buckets', () => {
  it('does not invent rail buckets for Louisville bus incidents', () => {
    expect(buildIncidentsByDay([makeAlert({ kind: 'bus', routes: ['01'] })], [], 7, NOW)).toEqual(
      {},
    );
  });
});

// ---------------------------------------------------------------------------
// computeSummaryStats
// ---------------------------------------------------------------------------
describe('computeSummaryStats', () => {
  it('returns zeros and null leader for empty data', () => {
    const r = computeSummaryStats([], [], NOW);
    expect(r).toEqual({
      activeCount: 0,
      weeklyCount: 0,
      mostAffectedKind: null,
      mostAffectedId: null,
      mostAffectedCount: 0,
      quietestLineId: null,
      quietestLineDays: 0,
    });
  });

  it('does not claim a quietest rail line without an applicable rail roster', () => {
    // Only Red has an incident; the seven other lines have no data → can't
    // claim a streak. Quietest reflects only lines we have evidence for.
    const alerts = [makeAlert({ routes: ['red'], first_seen_ts: NOW - 3 * DAY })];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.quietestLineId).toBeNull();
    expect(r.quietestLineDays).toBe(0);
  });

  it('bus history does not generate a synthetic rail quiet streak', () => {
    const alerts = [
      makeAlert({ alert_id: 1, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 60 * DAY }),
      makeAlert({ alert_id: 2, routes: ['red'], first_seen_ts: NOW - 4 * DAY }),
    ];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.quietestLineId).toBeNull();
    expect(r.quietestLineDays).toBe(0);
  });

  it('counts active incidents across alerts and observations', () => {
    const alerts = [makeAlert({ active: true, _incidentId: 'x1' })];
    const obs = [makeObs({ active: true, id: 99, _incidentId: 'x1' })];
    // Alert and obs share an _incidentId → one incident.
    expect(computeSummaryStats(alerts, obs, NOW).activeCount).toBe(1);
  });

  it('counts incidents within the last 7 days', () => {
    const recent = makeAlert({ first_seen_ts: NOW - DAY });
    const old = makeAlert({ alert_id: 2, first_seen_ts: NOW - 30 * DAY });
    expect(computeSummaryStats([recent, old], [], NOW).weeklyCount).toBe(1);
  });

  it('picks a bus route when it outpaces every train line', () => {
    const alerts = [
      makeAlert({ alert_id: 1, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 1 * DAY }),
      makeAlert({ alert_id: 2, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 2 * DAY }),
      makeAlert({ alert_id: 3, kind: 'bus', routes: ['66'], first_seen_ts: NOW - 3 * DAY }),
      makeAlert({ alert_id: 4, kind: 'train', routes: ['red'], first_seen_ts: NOW - 4 * DAY }),
    ];
    const r = computeSummaryStats(alerts, [], NOW);
    expect(r.mostAffectedKind).toBe('bus');
    expect(r.mostAffectedId).toBe('66');
    expect(r.mostAffectedCount).toBe(3);
  });

  it('does not double-count a merged alert+observation in weeklyCount', () => {
    const alert = makeAlert({ first_seen_ts: NOW - DAY, routes: ['red'], _incidentId: 'w1' });
    const obs = makeObs({ ts: NOW - DAY + 30 * 60_000, line: 'red', _incidentId: 'w1' });
    expect(computeSummaryStats([alert], [obs], NOW).weeklyCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// observationSignals
// ---------------------------------------------------------------------------
describe('observationSignals', () => {
  it('returns the signals array for roundup observations', () => {
    const obs = { detection_source: 'roundup', signals: ['gap', 'bunching'] };
    expect(observationSignals(obs)).toEqual(['gap', 'bunching']);
  });

  it('returns [detection_source] for single-signal observations', () => {
    expect(observationSignals({ detection_source: 'gap' })).toEqual(['gap']);
  });

  it('returns [] when neither field is present', () => {
    expect(observationSignals({})).toEqual([]);
  });
});

describe('incidentCategory / isPlannedIncident', () => {
  const NOW_TS = NOW;

  it('treats a MARTA alert with a multi-day date-only window as planned', () => {
    const inc = aInc({
      kind: 'bus',
      routes: ['2', '6', '10'],
      active: true,
      official: {
        headline: 'Temporary Reroute',
        agency_event_start_ts: NOW_TS - 30 * DAY,
        agency_event_end_ts: NOW_TS + 18 * DAY,
        agency_event_end_is_date_only: true,
      },
    });
    expect(incidentCategory(inc, NOW_TS)).toBe('planned');
  });

  it('treats an alert whose scheduled work starts in the future as planned', () => {
    const inc = aInc({
      kind: 'train',
      routes: ['red'],
      active: true,
      official: {
        headline: 'Weekend service change',
        agency_event_start_ts: NOW_TS + 2 * DAY,
      },
    });
    expect(incidentCategory(inc, NOW_TS)).toBe('planned');
  });

  it('falls back to a disruption for a live gap with no planned signal', () => {
    const inc = oInc({ kind: 'bus', routes: ['66'], active: true, obs: { source: 'roundup' } });
    expect(isPlannedIncident(inc, NOW_TS)).toBe(false);
    expect(incidentCategory(inc, NOW_TS)).toBe('disruption');
  });

  it('buckets a producer-classified detour into the detour band', () => {
    const inc = aInc({
      kind: 'bus',
      routes: ['71'],
      active: true,
      official: { headline: 'Route 71 detour' },
      status: { type: 'detour' },
    });
    expect(isDetourIncident(inc)).toBe(true);
    expect(incidentCategory(inc, NOW_TS)).toBe('detour');
  });

  it('keeps a scheduled detour (date-only window) in planned, not the detour band', () => {
    const inc = aInc({
      kind: 'bus',
      routes: ['71'],
      active: true,
      official: {
        headline: 'Route 71 detour',
        agency_event_start_ts: NOW_TS - DAY,
        agency_event_end_ts: NOW_TS + 5 * DAY,
        agency_event_end_is_date_only: true,
      },
      status: { type: 'detour' },
    });
    expect(incidentCategory(inc, NOW_TS)).toBe('planned');
  });

  it('does not treat a delay or bare alert as a detour', () => {
    const delay = aInc({ kind: 'bus', routes: ['15'], active: true, status: { type: 'delay' } });
    expect(isDetourIncident(delay)).toBe(false);
    const bare = oInc({ kind: 'bus', routes: ['66'], active: true, obs: { source: 'roundup' } });
    expect(isDetourIncident(bare)).toBe(false);
  });
});

describe('modeLabel', () => {
  it('labels TARC bus mode', () => {
    expect(modeLabel('bus')).toBe('TARC Bus');
  });
});

// ---------------------------------------------------------------------------
// filterIncidents — signal filter
// ---------------------------------------------------------------------------
describe('filterIncidents search', () => {
  it('matches alert headlines case-insensitively', () => {
    const a1 = aInc({ official: { headline: 'Red Line Delays at Five Points' } });
    const a2 = aInc({ official: { headline: 'Blue Line Delay near Decatur' } });
    const r = filterIncidents([a1, a2], { search: 'five points' });
    expect(r.map((i) => i.id)).toEqual([a1.id]);
  });

  it('matches observation from/to stations', () => {
    const o1 = oInc({ obs: { from_station: 'Decatur Station', to_station: 'Avondale Station' } });
    const o2 = oInc({
      obs: { from_station: 'Civic Center Station', to_station: 'Five Points Station' },
    });
    const r = filterIncidents([o1, o2], { search: 'five points' });
    expect(r.map((i) => i.id)).toEqual([o2.id]);
  });

  it('matches bus route numbers', () => {
    const o = oInc({ kind: 'bus', routes: ['66'], obs: { kind: 'bus', line: '66' } });
    expect(filterIncidents([o], { search: '66' })).toHaveLength(1);
  });

  it('returns everything when search is whitespace-only', () => {
    expect(filterIncidents([aInc()], { search: '   ' })).toHaveLength(1);
  });

  it('matches train line by user-visible label even when key differs', () => {
    const o = oInc({
      routes: ['green'],
      obs: { line: 'green', from_station: null, to_station: null },
    });
    expect(filterIncidents([o], { search: 'green' })).toHaveLength(1);
  });

  it('matches bus route by name', () => {
    const o = oInc({
      kind: 'bus',
      routes: ['01'],
      obs: { kind: 'bus', line: '01', from_station: null, to_station: null },
    });
    expect(filterIncidents([o], { search: 'Broadway' })).toHaveLength(1);
  });

  it('matches incidents via their line label', () => {
    const a = aInc({ routes: ['streetcar'], official: { headline: 'Service issue' } });
    expect(filterIncidents([a], { search: 'streetcar' })).toHaveLength(1);
  });

  it('matches signal labels (e.g. "headway gaps" → gap incidents)', () => {
    const gap = oInc({ obs: { detection_source: 'gap', from_station: null, to_station: null } });
    const ghost = oInc({
      obs: { detection_source: 'ghost', from_station: null, to_station: null },
    });
    const r = filterIncidents([gap, ghost], { search: 'headway gaps' });
    expect(r.map((i) => i.id)).toEqual([gap.id]);
  });

  it('matches signal labels for roundup observations via signals array', () => {
    const o = oInc({
      obs: {
        detection_source: 'roundup',
        signals: ['bunching', 'gap'],
        from_station: null,
        to_station: null,
      },
    });
    expect(filterIncidents([o], { search: 'bunching' })).toHaveLength(1);
  });

  it('matches "route 01" and "#01" for bus incidents', () => {
    const o = oInc({
      kind: 'bus',
      routes: ['01'],
      obs: { kind: 'bus', line: '01', from_station: null, to_station: null },
    });
    expect(filterIncidents([o], { search: 'route 01' })).toHaveLength(1);
    expect(filterIncidents([o], { search: '#01' })).toHaveLength(1);
  });
});

describe('filterIncidents signal filter', () => {
  it('keeps only incidents with an observation overlapping the selected signals', () => {
    const gap = oInc({ obs: { id: 1, detection_source: 'gap' } });
    const bunching = oInc({ obs: { id: 2, detection_source: 'bunching' } });
    const roundup = oInc({
      obs: { id: 3, detection_source: 'roundup', signals: ['ghost', 'gap'] },
    });
    const r = filterIncidents([gap, bunching, roundup], { signals: ['gap'] });
    expect(r.map((i) => i.id).sort()).toEqual([gap.id, roundup.id].sort());
  });

  it('drops MARTA-only incidents when a signal filter is active', () => {
    const r = filterIncidents([aInc(), oInc({ obs: { detection_source: 'gap' } })], {
      signals: ['gap'],
    });
    expect(r).toHaveLength(1);
    expect(r[0].official_alert).toBeNull();
  });

  it('keeps a merged incident whole when one of its observations matches', () => {
    const merged = aInc({
      id: 'm1',
      kind: 'train',
      routes: ['red'],
      first_seen_ts: NOW - DAY,
      resolved_ts: NOW,
      active: false,
      official: { alert_id: 'a', headline: 'Red Line Delays', first_seen_ts: NOW - DAY },
      observations: [{ id: 1, kind: 'train', line: 'red', detection_source: 'gap', ts: NOW - DAY }],
    });
    const r = filterIncidents([merged], { signals: ['gap'] });
    expect(r).toHaveLength(1);
    expect(r[0].official_alert).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildHourOfWeek
// ---------------------------------------------------------------------------
describe('buildHourOfWeek', () => {
  it('returns an empty 7×24 grid for empty input', () => {
    const r = buildHourOfWeek([], []);
    expect(r.grid).toHaveLength(7);
    expect(r.grid[0]).toHaveLength(24);
    expect(r.maxCount).toBe(0);
    expect(r.total).toBe(0);
  });

  it('counts incidents into their start-time bucket', () => {
    const monday3pmAtlanta = Date.UTC(2026, 0, 5, 20, 0);
    const obs = makeObs({ ts: monday3pmAtlanta });
    const { grid, total } = buildHourOfWeek([], [obs]);
    expect(total).toBe(1);
    expect(grid[1][15]).toBe(1); // Monday, 3pm
  });

  it('does not double-count a merged alert+observation pair', () => {
    const alert = makeAlert({
      first_seen_ts: NOW,
      resolved_ts: NOW + 60 * 60_000,
      _incidentId: 'h1',
    });
    const obs = makeObs({
      ts: NOW + 30 * 60_000,
      resolved_ts: NOW + 60 * 60_000,
      _incidentId: 'h1',
    });
    const { total } = buildHourOfWeek([alert], [obs]);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// describePeakWindow
// ---------------------------------------------------------------------------
describe('describePeakWindow', () => {
  // 7×24 [weekday 0=Sun..6=Sat][hour] grid builder. `cells` is a list of
  // [weekday, hour, count] tuples; everything else is zero.
  const makeGrid = (cells) => {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let total = 0;
    for (const [w, h, c] of cells) {
      grid[w][h] = c;
      total += c;
    }
    return { grid, total };
  };

  it('returns null below the minimum total', () => {
    const { grid, total } = makeGrid([[1, 16, 8]]); // Mon 4pm, only 8 starts
    expect(describePeakWindow(grid, total)).toBeNull();
  });

  it('names a clear weekday-afternoon concentration', () => {
    const { grid, total } = makeGrid([
      [1, 16, 20], // Mon 4pm (afternoon)
      [2, 7, 5], // Tue 7am (morning)
      [6, 16, 3], // Sat 4pm (weekend)
    ]);
    const r = describePeakWindow(grid, total);
    expect(r).toMatchObject({ dayType: 'weekday', label: 'afternoons', range: '3–8 PM' });
  });

  it('detects a weekend concentration', () => {
    const { grid, total } = makeGrid([
      [6, 21, 15], // Sat 9pm (evening)
      [1, 16, 4], // Mon 4pm
    ]);
    const r = describePeakWindow(grid, total);
    expect(r).toMatchObject({ dayType: 'weekend', label: 'evenings' });
  });

  it('stays silent when no window clearly leads', () => {
    const { grid, total } = makeGrid([
      [1, 7, 5], // morning
      [2, 12, 5], // midday
      [3, 16, 5], // afternoon
      [4, 21, 5], // evening
    ]);
    expect(describePeakWindow(grid, total)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// weekStartUTC / listWeeks / buildWeekSummary / formatWeekRange
// ---------------------------------------------------------------------------
describe('weekStartUTC', () => {
  it('snaps any day to its Sunday', () => {
    // 2026-05-17 is a Sunday; 05-20 is the Wednesday of that week.
    expect(weekStartUTC(Date.UTC(2026, 4, 20))).toBe(Date.UTC(2026, 4, 17));
    expect(weekStartUTC(Date.UTC(2026, 4, 23))).toBe(Date.UTC(2026, 4, 17)); // Sat
  });
  it('is a no-op for a Sunday', () => {
    expect(weekStartUTC(Date.UTC(2026, 4, 17))).toBe(Date.UTC(2026, 4, 17));
  });
});

describe('formatWeekRange', () => {
  it('collapses the month within a single-month week', () => {
    expect(formatWeekRange(Date.UTC(2026, 4, 17))).toBe('May 17–23');
    expect(formatWeekRange(Date.UTC(2026, 4, 17), { year: true })).toBe('May 17–23, 2026');
  });
  it('spells both months when the week straddles a boundary', () => {
    // 2026-04-26 (Sun) → 2026-05-02 (Sat).
    expect(formatWeekRange(Date.UTC(2026, 3, 26))).toBe('Apr 26 – May 2');
  });
});

describe('listWeeks', () => {
  it('returns Sundays most-recent-first across the data span', () => {
    const weeks = listWeeks({
      dataStartTs: Date.UTC(2026, 3, 28, 18), // Tue Apr 28 → week of Apr 26
      now: Date.UTC(2026, 4, 20, 18), // Wed May 20 → week of May 17
    });
    expect(weeks).toEqual([
      Date.UTC(2026, 4, 17),
      Date.UTC(2026, 4, 10),
      Date.UTC(2026, 4, 3),
      Date.UTC(2026, 3, 26),
    ]);
  });
  it('returns [] without a data start', () => {
    expect(listWeeks({ dataStartTs: null, now: NOW })).toEqual([]);
  });
});

describe('buildWeekSummary', () => {
  const WK = Date.UTC(2026, 4, 17); // Sun May 17 2026
  // 18:00 UTC ≈ 1pm CDT — safely the same Atlanta calendar day as the date.
  const at = (y, m, d, h = 18) => Date.UTC(y, m, d, h);

  it('counts start-in-week incidents, busiest day, affected lines, and WoW', () => {
    const obs = [
      makeObs({ line: 'red', ts: at(2026, 4, 18), resolved_ts: at(2026, 4, 18) + 30 * 60_000 }),
      makeObs({
        line: 'red',
        ts: at(2026, 4, 18, 19),
        resolved_ts: at(2026, 4, 18, 19) + 30 * 60_000,
      }),
      makeObs({
        kind: 'bus',
        line: '66',
        ts: at(2026, 4, 20),
        resolved_ts: at(2026, 4, 20) + 2 * 60 * 60_000, // 2h — longest
      }),
      // Prior week (Tue May 12) — counts only toward priorTotal.
      makeObs({ line: 'blue', ts: at(2026, 4, 12), resolved_ts: at(2026, 4, 12) + 30 * 60_000 }),
    ];
    const s = buildWeekSummary([], obs, WK, at(2026, 4, 23, 23));
    expect(s.total).toBe(3);
    expect(s.trainCount).toBe(2);
    expect(s.busCount).toBe(1);
    expect(s.lineCount).toBe(2);
    expect(s.priorTotal).toBe(1);
    expect(s.busiestDay).toMatchObject({ dayUtc: Date.UTC(2026, 4, 18), count: 2 });
    expect(s.perDay[1].count).toBe(2); // Monday
    expect(s.mostAffected[0]).toMatchObject({ kind: 'train', id: 'red', count: 2 });
    expect(s.longest).toMatchObject({ kind: 'bus', durationMs: 2 * 60 * 60_000 });
  });

  it('reports an empty week without crashing', () => {
    const s = buildWeekSummary([], [], WK, at(2026, 4, 23, 23));
    expect(s.total).toBe(0);
    expect(s.busiestDay).toBeNull();
    expect(s.longest).toBeNull();
    expect(s.mostAffected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildSignalsByLine
// ---------------------------------------------------------------------------
describe('buildSignalsByLine', () => {
  it('ignores bus observations', () => {
    const obs = [
      makeObs({ id: 1, kind: 'bus', line: '66', detection_source: 'gap' }),
      makeObs({ id: 2, kind: 'train', line: 'red', detection_source: 'gap' }),
    ];
    expect(buildSignalsByLine(obs).totals.gap).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildDailyTrend
// ---------------------------------------------------------------------------
describe('buildDailyTrend', () => {
  it('returns zeroed arrays of the right length for empty data', () => {
    const r = buildDailyTrend([], [], 30, NOW);
    expect(r.counts).toHaveLength(30);
    expect(r.avg).toHaveLength(30);
    expect(r.recent7Avg).toBe(0);
    expect(r.prior7Avg).toBe(0);
    expect(r.trendRatio).toBeNull();
  });

  it('places incidents into the right day bucket (today is last)', () => {
    const alerts = [
      makeAlert({ alert_id: 1, first_seen_ts: NOW }),
      makeAlert({ alert_id: 2, first_seen_ts: NOW - 5 * DAY }),
    ];
    const { counts } = buildDailyTrend(alerts, [], 10, NOW);
    expect(counts[counts.length - 1]).toBe(1); // today
    expect(counts[counts.length - 1 - 5]).toBe(1); // 5 days ago
  });

  it('flags an upward trend when recent 7 days outpace the prior 7', () => {
    const alerts = [];
    let id = 0;
    // Prior week: 1 incident/day. Recent week: 4 incidents/day.
    for (let d = 7; d < 14; d++) {
      alerts.push(makeAlert({ alert_id: ++id, first_seen_ts: NOW - d * DAY }));
    }
    for (let d = 0; d < 7; d++) {
      for (let i = 0; i < 4; i++) {
        alerts.push(makeAlert({ alert_id: ++id, first_seen_ts: NOW - d * DAY - i * 60_000 }));
      }
    }
    const r = buildDailyTrend(alerts, [], 30, NOW);
    expect(r.recent7Avg).toBeCloseTo(4, 5);
    expect(r.prior7Avg).toBeCloseTo(1, 5);
    expect(r.trendRatio).toBeCloseTo(4, 5);
  });
});

// ---------------------------------------------------------------------------
// findRelatedIncidents
// ---------------------------------------------------------------------------
describe('findRelatedIncidents', () => {
  const alertIncident = (over) =>
    aInc({ resolved_ts: null, active: false, official: { alert_id: over.id }, ...over });
  const botIncident = (over) => oInc({ resolved_ts: null, active: false, obs: { id: 1 }, ...over });

  const self = alertIncident({ id: 'self', first_seen_ts: NOW });

  it('returns incidents on the same line within the window', () => {
    const before = alertIncident({ id: 'before', first_seen_ts: NOW - 6 * 60 * 60_000 });
    const after = botIncident({ id: 'after', first_seen_ts: NOW + 12 * 60 * 60_000 });
    const r = findRelatedIncidents(self, [self, before, after]);
    expect(r).toHaveLength(2);
    // Newest first: the +12h incident leads, the -6h one follows.
    expect(r[0].id).toBe('after');
    expect(r[1].id).toBe('before');
  });

  it('excludes the incident itself by id', () => {
    expect(findRelatedIncidents(self, [self])).toHaveLength(0);
  });

  it('drops incidents on different lines', () => {
    const otherLine = alertIncident({ id: 'blue', routes: ['blue'], first_seen_ts: NOW - 60_000 });
    expect(findRelatedIncidents(self, [self, otherLine])).toHaveLength(0);
  });

  it('drops incidents outside the ±24h default window', () => {
    const old = alertIncident({ id: 'old', first_seen_ts: NOW - 26 * 60 * 60_000 });
    expect(findRelatedIncidents(self, [self, old])).toHaveLength(0);
  });

  it('does not cross kinds (train self vs bus incident same route key)', () => {
    // Contrived shared route key — wouldn't normally collide, but verifies the
    // kind guard.
    const bus = botIncident({
      id: 'bus',
      kind: 'bus',
      routes: ['red'],
      first_seen_ts: NOW - 60_000,
    });
    expect(findRelatedIncidents(self, [self, bus])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatGap
// ---------------------------------------------------------------------------
describe('formatGap', () => {
  it('returns empty string for null', () => {
    expect(formatGap(null)).toBe('');
  });

  it('formats sub-hour gaps in minutes', () => {
    expect(formatGap(0.25)).toBe('15m');
    expect(formatGap(0.5)).toBe('30m');
  });

  it('rounds whole hours when sub-day', () => {
    expect(formatGap(2)).toBe('2h');
    expect(formatGap(2.4)).toBe('2h');
    expect(formatGap(2.6)).toBe('3h');
  });

  it('formats multi-day gaps with optional hours', () => {
    expect(formatGap(48)).toBe('2d');
    expect(formatGap(49)).toBe('2d 1h');
    expect(formatGap(73)).toBe('3d 1h');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------
describe('formatRelativeTime', () => {
  it('returns null for a missing timestamp', () => {
    expect(formatRelativeTime(null, NOW)).toBeNull();
  });

  it('clamps sub-minute and clock-skew-future timestamps to "just now"', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('just now');
  });

  it('formats minutes, hours, and days', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59m ago');
    expect(formatRelativeTime(NOW - 2 * 60 * 60_000, NOW)).toBe('2h ago');
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe('3d ago');
  });
});

// ---------------------------------------------------------------------------
// buildSearchMatchers / searchFilterIncidents
// ---------------------------------------------------------------------------
describe('buildSearchMatchers', () => {
  it('returns hasSearch=false and a pass-through matcher for blank input', () => {
    const m = buildSearchMatchers('');
    expect(m.hasSearch).toBe(false);
    expect(m.matchesIncident(aInc())).toBe(true);
    expect(m.matchesIncident(oInc())).toBe(true);
  });

  it('matches MARTA headline case-insensitively', () => {
    const a = aInc({ official: { headline: 'Red Line Reroute at Five Points' } });
    expect(buildSearchMatchers('five points').matchesIncident(a)).toBe(true);
  });

  it('matches observation segment endpoints', () => {
    const o = oInc({
      obs: { from_station: 'Civic Center Station', to_station: 'Five Points Station' },
    });
    expect(buildSearchMatchers('civic center').matchesIncident(o)).toBe(true);
  });

  it('matches bus route by "Route N" form', () => {
    const o = oInc({ kind: 'bus', routes: ['66'], obs: { kind: 'bus', line: '66' } });
    expect(buildSearchMatchers('Route 66').matchesIncident(o)).toBe(true);
  });

  it('matches signal label aliases', () => {
    const o = oInc({ obs: { signals: ['gap'], detection_source: 'gap' } });
    expect(buildSearchMatchers('headway gap').matchesIncident(o)).toBe(true);
  });
});

describe('searchFilterIncidents', () => {
  it('returns the input unchanged when query is blank', () => {
    const incidents = [aInc(), oInc()];
    expect(searchFilterIncidents(incidents, '')).toBe(incidents);
  });

  it('narrows to incidents matching the query', () => {
    const foo = aInc({ official: { headline: 'Foo' } });
    const bar = aInc({ official: { headline: 'Bar' } });
    const r = searchFilterIncidents([foo, bar], 'foo');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(foo.id);
  });
});

// ---------------------------------------------------------------------------
// computeLineReliability
// ---------------------------------------------------------------------------
describe('computeLineReliability', () => {
  it('returns 100% incident-free for an empty cohort', () => {
    const r = computeLineReliability([], [], { now: NOW, windowDays: 90 });
    expect(r.incidentFreeDays).toBe(90);
    expect(r.totalDays).toBe(90);
    expect(r.medianGapHours).toBeNull();
    expect(r.longestStreakDays).toBe(90);
  });

  it('counts each incident-day once even when an incident spans multiple days', () => {
    const o = makeObs({
      ts: NOW - 3 * DAY,
      resolved_ts: NOW - DAY, // touches 3 calendar days
    });
    const r = computeLineReliability([], [o], { now: NOW, windowDays: 30 });
    expect(r.totalDays - r.incidentFreeDays).toBe(3);
  });

  it('finds the longest run of consecutive incident-free days', () => {
    // Incidents on day 0 and day 10 within a 20-day window — the run between
    // them is 9 days (days 1–9), tied with the run before day 10 (days 11–19).
    const obs = [
      makeObs({ ts: NOW, resolved_ts: NOW + 60_000 }),
      makeObs({ id: 2, ts: NOW - 10 * DAY, resolved_ts: NOW - 10 * DAY + 60_000 }),
    ];
    const r = computeLineReliability([], obs, { now: NOW, windowDays: 20 });
    expect(r.longestStreakDays).toBe(9);
  });

  it('computes median gap in hours between consecutive starts', () => {
    const obs = [
      makeObs({ id: 1, ts: NOW - 10 * 60 * 60_000 }),
      makeObs({ id: 2, ts: NOW - 7 * 60 * 60_000 }), // 3h gap
      makeObs({ id: 3, ts: NOW - 1 * 60 * 60_000 }), // 6h gap
    ];
    const r = computeLineReliability([], obs, { now: NOW, windowDays: 90 });
    expect(r.medianGapHours).toBeCloseTo(4.5, 5); // (3 + 6) / 2
  });
});

// ---------------------------------------------------------------------------
// computeDurationHistogram
// ---------------------------------------------------------------------------
describe('computeDurationHistogram', () => {
  it('returns empty bins for empty input', () => {
    const r = computeDurationHistogram([], [], { now: NOW, windowDays: 90 });
    expect(r.total).toBe(0);
    expect(r.bins.every((b) => b.count === 0)).toBe(true);
  });

  it('bins durations into the right buckets', () => {
    const obs = [
      makeObs({ id: 1, ts: NOW, resolved_ts: NOW + 5 * 60_000 }), // < 15m
      makeObs({ id: 2, ts: NOW, resolved_ts: NOW + 20 * 60_000 }), // 15-30m
      makeObs({ id: 3, ts: NOW, resolved_ts: NOW + 45 * 60_000 }), // 30m-1h
      makeObs({ id: 4, ts: NOW, resolved_ts: NOW + 90 * 60_000 }), // 1-2h
      makeObs({ id: 5, ts: NOW, resolved_ts: NOW + 5 * 60 * 60_000 }), // 4h+
    ];
    const r = computeDurationHistogram([], obs, { now: NOW, windowDays: 90 });
    expect(r.total).toBe(5);
    expect(r.bins.find((b) => b.label === '< 15m').count).toBe(1);
    expect(r.bins.find((b) => b.label === '4h+').count).toBe(1);
  });

  it('excludes active (unresolved) incidents', () => {
    const o = makeObs({ ts: NOW, resolved_ts: null, active: true });
    const r = computeDurationHistogram([], [o], { now: NOW });
    expect(r.total).toBe(0);
  });

  it('excludes incidents that started before the cutoff', () => {
    const o = makeObs({
      ts: NOW - 100 * DAY,
      resolved_ts: NOW - 99 * DAY,
    });
    const r = computeDurationHistogram([], [o], { now: NOW, windowDays: 90 });
    expect(r.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// typicalDurationKey / computeTypicalDurations
// ---------------------------------------------------------------------------
describe('typicalDurationKey', () => {
  it('returns null when fields are missing', () => {
    expect(typicalDurationKey(null)).toBeNull();
    expect(typicalDurationKey({ kind: 'train' })).toBeNull(); // no line, no detection
  });

  it('builds kind::line::signal for an observation', () => {
    expect(typicalDurationKey({ kind: 'train', line: 'red', detection_source: 'gap' })).toBe(
      'train::red::gap',
    );
  });

  it('collapses roundup to a single bucket', () => {
    expect(typicalDurationKey({ kind: 'train', line: 'red', detection_source: 'roundup' })).toBe(
      'train::red::roundup',
    );
  });

  it('prefers obs_line/obs_detection_source on merged records', () => {
    expect(
      typicalDurationKey({
        kind: 'train',
        obs_line: 'blue',
        obs_detection_source: 'gap',
        line: 'red',
      }),
    ).toBe('train::blue::gap');
  });
});

describe('computeTypicalDurations', () => {
  it('returns an empty Map when no resolved incidents qualify', () => {
    const r = computeTypicalDurations([], [], { now: NOW, windowDays: 90 });
    expect(r.size).toBe(0);
  });

  it('computes median duration per (kind, line, signal) bucket', () => {
    const obs = [
      makeObs({
        id: 1,
        line: 'red',
        detection_source: 'gap',
        ts: NOW - DAY,
        resolved_ts: NOW - DAY + 10 * 60_000,
      }),
      makeObs({
        id: 2,
        line: 'red',
        detection_source: 'gap',
        ts: NOW - DAY,
        resolved_ts: NOW - DAY + 20 * 60_000,
      }),
      makeObs({
        id: 3,
        line: 'red',
        detection_source: 'gap',
        ts: NOW - DAY,
        resolved_ts: NOW - DAY + 30 * 60_000,
      }),
    ];
    const r = computeTypicalDurations([], obs, { now: NOW });
    const bucket = r.get('train::red::gap');
    expect(bucket.count).toBe(3);
    expect(bucket.medianMs).toBe(20 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// buildTodaySummary
// ---------------------------------------------------------------------------
describe('buildTodaySummary', () => {
  // Pin "now" to a Atlanta-friendly mid-day moment so the boundary between
  // "today" and "yesterday" doesn't depend on test environment TZ.
  const TODAY_NOW = Date.UTC(2026, 4, 9, 18, 0, 0); // 2026-05-09 13:00 Atlanta

  it('returns null when there is no incident data at all', () => {
    expect(buildTodaySummary([], [], TODAY_NOW)).toBeNull();
  });

  it('reports a quiet-day message in hours when the last incident was today recent', () => {
    const o = makeObs({ ts: TODAY_NOW - 3 * 60 * 60_000 - 5 * 60_000, resolved_ts: TODAY_NOW });
    // atlantaDayUTC of `o.ts` is the same Atlanta day as TODAY_NOW only if it
    // doesn't cross local midnight; this case is mid-afternoon, so safe.
    // But the incident *is* on today, so this case will fall into busy-day.
    const out = buildTodaySummary([], [o], TODAY_NOW);
    expect(out.text).toMatch(/Today: 1 incident/);
  });

  it('reports active count when at least one incident is ongoing', () => {
    const o1 = makeObs({
      id: 1,
      line: 'red',
      ts: TODAY_NOW - 10 * 60_000,
      active: true,
      resolved_ts: null,
    });
    const o2 = makeObs({ id: 2, line: 'blue', ts: TODAY_NOW - 5 * 60_000 });
    const out = buildTodaySummary([], [o1, o2], TODAY_NOW);
    expect(out.text).toMatch(/2 incidents/);
    expect(out.text).toMatch(/1 still ongoing/);
  });

  it('exposes last-week link metadata for incidents that started that day', () => {
    const today = makeObs({ id: 1, ts: TODAY_NOW - 60_000 });
    // Same weekday a week earlier (TODAY_NOW is 2026-05-09 → 2026-05-02).
    const weekAgo = makeObs({ id: 2, ts: TODAY_NOW - 7 * DAY + 60_000 });
    const out = buildTodaySummary([], [today, weekAgo], TODAY_NOW);
    expect(out.lastWeek).toEqual({ count: 1, label: 'Saturday, May 2', iso: '2026-05-02' });
    // The clause lives in lastWeek, not the narrative text.
    expect(out.text).not.toMatch(/last Saturday/);
  });
});

// ---------------------------------------------------------------------------
// computeStatsLeaderboards
// ---------------------------------------------------------------------------
describe('computeStatsLeaderboards', () => {
  it('returns null fields when there is no data', () => {
    const r = computeStatsLeaderboards([], [], { now: NOW });
    expect(r.worstDay).toBeNull();
    expect(r.worstHour).toBeNull();
    expect(r.worstStation).toBeNull();
    expect(r.longestIncident).toBeNull();
  });

  it('picks the day with the most distinct incidents as worstDay', () => {
    const obs = [
      makeObs({ id: 1, ts: NOW - 5 * DAY }),
      makeObs({ id: 2, ts: NOW - 5 * DAY + 60_000 }),
      makeObs({ id: 3, ts: NOW - 5 * DAY + 120_000 }),
      makeObs({ id: 4, ts: NOW - DAY }),
    ];
    const r = computeStatsLeaderboards([], obs, { now: NOW });
    expect(r.worstDay.count).toBe(3);
  });

  it('picks the longest resolved incident', () => {
    const short = makeObs({
      id: 1,
      ts: NOW - DAY,
      resolved_ts: NOW - DAY + 10 * 60_000,
      post_url: 'https://bsky.app/profile/x/post/short',
    });
    const long = makeObs({
      id: 2,
      ts: NOW - DAY,
      resolved_ts: NOW - DAY + 4 * 60 * 60_000,
      post_url: 'https://bsky.app/profile/x/post/long',
    });
    const r = computeStatsLeaderboards([], [short, long], { now: NOW });
    expect(r.longestIncident.id).toBe('long');
    expect(r.longestIncident.durationMs).toBe(4 * 60 * 60_000);
  });

  it('skips active incidents when picking longestIncident', () => {
    const active = makeObs({
      id: 1,
      ts: NOW - 10 * DAY,
      resolved_ts: null,
      active: true,
      post_url: 'https://bsky.app/profile/x/post/active',
    });
    const r = computeStatsLeaderboards([], [active], { now: NOW });
    expect(r.longestIncident).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeYearOverYear
// ---------------------------------------------------------------------------
describe('computeYearOverYear', () => {
  const YEAR = 365 * DAY;

  it('returns enoughData=false when dataStartTs is inside the prior window', () => {
    const r = computeYearOverYear([], [], {
      now: NOW,
      windowDays: 30,
      dataStartTs: NOW - 30 * DAY,
    });
    expect(r.enoughData).toBe(false);
  });

  it('still counts the current window when there is not enough data for YoY', () => {
    const obs = [
      makeObs({ id: 1, ts: NOW - 5 * DAY, first_seen_ts: NOW - 5 * DAY }),
      makeObs({ id: 2, ts: NOW - 10 * DAY, first_seen_ts: NOW - 10 * DAY }),
    ];
    const r = computeYearOverYear([], obs, {
      now: NOW,
      windowDays: 30,
      dataStartTs: NOW - 60 * DAY, // dataset younger than a year
    });
    expect(r.enoughData).toBe(false);
    expect(r.currentCount).toBe(2); // current count is still valid…
    expect(r.pctChange).toBeNull(); // …but the YoY comparison is suppressed
  });

  it('counts current vs prior 30-day windows separately', () => {
    const obs = [
      // 3 incidents in the current window (last 30 days)
      makeObs({ id: 1, ts: NOW - 5 * DAY, first_seen_ts: NOW - 5 * DAY }),
      makeObs({ id: 2, ts: NOW - 10 * DAY, first_seen_ts: NOW - 10 * DAY }),
      makeObs({ id: 3, ts: NOW - 15 * DAY, first_seen_ts: NOW - 15 * DAY }),
      // 5 incidents in the same 30-day window a year ago
      makeObs({ id: 4, ts: NOW - YEAR - 1 * DAY, first_seen_ts: NOW - YEAR - 1 * DAY }),
      makeObs({ id: 5, ts: NOW - YEAR - 5 * DAY, first_seen_ts: NOW - YEAR - 5 * DAY }),
      makeObs({ id: 6, ts: NOW - YEAR - 10 * DAY, first_seen_ts: NOW - YEAR - 10 * DAY }),
      makeObs({ id: 7, ts: NOW - YEAR - 20 * DAY, first_seen_ts: NOW - YEAR - 20 * DAY }),
      makeObs({ id: 8, ts: NOW - YEAR - 25 * DAY, first_seen_ts: NOW - YEAR - 25 * DAY }),
      // Outside both windows — should not count.
      makeObs({ id: 9, ts: NOW - 60 * DAY, first_seen_ts: NOW - 60 * DAY }),
    ];
    const r = computeYearOverYear([], obs, {
      now: NOW,
      windowDays: 30,
      dataStartTs: NOW - 2 * YEAR,
    });
    expect(r.enoughData).toBe(true);
    expect(r.currentCount).toBe(3);
    expect(r.priorCount).toBe(5);
    expect(r.pctChange).toBeCloseTo((3 - 5) / 5, 5); // -40%
  });

  it('returns null pctChange when prior window had zero incidents', () => {
    const obs = [makeObs({ id: 1, ts: NOW - 5 * DAY, first_seen_ts: NOW - 5 * DAY })];
    const r = computeYearOverYear([], obs, {
      now: NOW,
      windowDays: 30,
      dataStartTs: NOW - 2 * YEAR,
    });
    expect(r.pctChange).toBeNull();
    expect(r.currentCount).toBe(1);
    expect(r.priorCount).toBe(0);
  });
});

describe('officialRecordFromIncident version union', () => {
  it('folds every official_alerts[] member into one chronological version timeline', () => {
    const t0 = 1_782_000_000_000;
    const delay = officialAlertFromOfficial(
      { id: 'sc-delay', headline: 'Streetcar delays', description: 'Heavy traffic delays.' },
      { first_seen_ts: t0, resolved_ts: t0 + 20 * 60_000 },
    );
    const clear = officialAlertFromOfficial(
      {
        id: 'sc-clear',
        headline: 'Streetcar service alert',
        description: 'Update: Streetcars resumed normal schedule.',
      },
      { first_seen_ts: t0 + 23 * 60_000, resolved_ts: t0 + 40 * 60_000 },
    );
    const inc = v2Incident({
      mode: 'streetcar',
      routes: ['streetcar'],
      official_alert: delay,
      official_alerts: [delay, clear],
      lifecycle: v2Lifecycle({ first_seen_ts: t0, resolved_ts: t0 + 40 * 60_000 }),
    });

    const rec = officialRecordFromIncident(inc);
    expect(Array.isArray(rec.versions)).toBe(true);
    expect(rec.versions).toHaveLength(2);
    // Normalized to short_description (the field the timeline renders).
    expect(rec.versions[0].short_description).toMatch(/Heavy traffic/);
    expect(rec.versions[1].short_description).toMatch(/resumed normal schedule/);
  });

  it('leaves versions unset for a single-alert incident (timeline synthesizes one)', () => {
    const only = officialAlertFromOfficial(
      { id: 'gold', headline: 'Gold Line delays', description: 'Delays on the Gold line.' },
      { first_seen_ts: 1_782_000_000_000 },
    );
    const inc = v2Incident({ mode: 'rail', routes: ['gold'], official_alert: only });
    const rec = officialRecordFromIncident(inc);
    expect(rec.versions).toBeUndefined();
  });
});
