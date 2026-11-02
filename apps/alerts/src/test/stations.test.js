import { describe, expect, it } from 'vitest';
import { buildStationIndex, slugifyStation } from '../lib/stations.js';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const makeObs = (overrides = {}) => ({
  id: 1,
  kind: 'train',
  line: 'red',
  from_station: 'FIVE POINTS Station',
  to_station: 'GARNETT Station',
  ts: NOW - DAY,
  resolved_ts: NOW - DAY + 10 * 60_000,
  active: false,
  ...overrides,
});

const makeAlert = (overrides = {}) => ({
  alert_id: 1,
  kind: 'train',
  routes: ['red'],
  affected_from_station: 'FIVE POINTS Station',
  affected_to_station: null,
  first_seen_ts: NOW - DAY,
  resolved_ts: NOW - DAY + 60_000,
  active: false,
  ...overrides,
});

describe('slugifyStation', () => {
  it('lowercases and dashifies', () => {
    expect(slugifyStation('FIVE POINTS Station')).toBe('five-points-station');
    expect(slugifyStation('Centennial Olympic Park')).toBe('centennial-olympic-park');
    expect(slugifyStation('King Historic District')).toBe('king-historic-district');
  });

  it('handles parenthetical line qualifiers', () => {
    expect(slugifyStation('Airport (Red)')).toBe('airport-red');
    expect(slugifyStation('Ashby (Blue/Green)')).toBe('ashby-blue-green');
  });

  it('returns null for empty/null input', () => {
    expect(slugifyStation(null)).toBeNull();
    expect(slugifyStation('')).toBeNull();
    expect(slugifyStation('---')).toBeNull();
  });
});

describe('buildStationIndex', () => {
  it('returns an empty map for empty input', () => {
    const r = buildStationIndex([], [], { now: NOW });
    expect(r.size).toBe(0);
  });

  it('indexes both endpoints of an observation', () => {
    const o = makeObs({ from_station: 'FIVE POINTS Station', to_station: 'GARNETT Station' });
    const r = buildStationIndex([], [o], { now: NOW });
    expect(r.has('five-points-station')).toBe(true);
    expect(r.has('garnett-station')).toBe(true);
  });

  it('preserves an unknown historical route key without inventing a rail roster', () => {
    const r = buildStationIndex([], [makeObs({ line: 'RED' })], { now: NOW });
    expect(r.get('five-points-station').lines).toContain('RED');
  });

  it('drops observations outside the rolling window', () => {
    const old = makeObs({ ts: NOW - 100 * DAY });
    const r = buildStationIndex([], [old], { now: NOW, windowDays: 90 });
    expect(r.size).toBe(0);
  });

  it('skips bus incidents', () => {
    const o = makeObs({ kind: 'bus', line: '66', from_station: 'Foo', to_station: 'Bar' });
    expect(buildStationIndex([], [o], { now: NOW }).size).toBe(0);
  });

  it('counts alerts and observations together at a station', () => {
    const o = makeObs({ from_station: 'FIVE POINTS Station', to_station: null });
    const a = makeAlert({ affected_from_station: 'FIVE POINTS Station' });
    const r = buildStationIndex([a], [o], { now: NOW });
    expect(r.get('five-points-station').count).toBe(2);
  });

  it('does not double-count an observation that touches a station at both endpoints', () => {
    // Same name in both endpoints is contrived but the dedup guard is real.
    const o = makeObs({ from_station: 'FIVE POINTS Station', to_station: 'FIVE POINTS Station' });
    const r = buildStationIndex([], [o], { now: NOW });
    expect(r.get('five-points-station').count).toBe(1);
  });

  it('indexes alert mentioned_stations alongside the segment endpoints', () => {
    const a = makeAlert({
      affected_from_station: null,
      affected_to_station: null,
      mentioned_stations: ['Peachtree Center Station'],
    });
    const r = buildStationIndex([a], [], { now: NOW });
    expect(r.get('peachtree-center-station').alerts).toContain(a);
  });

  it('mentioned_stations dedupes against the segment endpoints', () => {
    // Upstream extractor includes between/from-to results in
    // mentioned_stations too — overlap shouldn't double-count.
    const a = makeAlert({
      affected_from_station: 'FIVE POINTS Station',
      affected_to_station: null,
      mentioned_stations: ['FIVE POINTS Station'],
    });
    const r = buildStationIndex([a], [], { now: NOW });
    expect(r.get('five-points-station').alerts).toHaveLength(1);
  });

  it('ties an observation to inner stops via the enumerated stations fill', () => {
    const o = makeObs({
      line: 'red',
      from_station: 'CIVIC CENTER Station',
      to_station: 'GARNETT Station',
      stations: [
        'CIVIC CENTER Station',
        'PEACHTREE CENTER Station',
        'FIVE POINTS Station',
        'GARNETT Station',
      ],
    });
    const r = buildStationIndex([], [o], { now: NOW });
    expect(r.get('peachtree-center-station').observations).toContain(o);
    expect(r.get('five-points-station').observations).toContain(o);
    expect(r.get('civic-center-station').observations).toContain(o);
    expect(r.get('garnett-station').observations).toContain(o);
  });

  it('falls back to from/to when an observation has no stations fill', () => {
    const o = makeObs({
      from_station: 'FIVE POINTS Station',
      to_station: 'GARNETT Station',
      stations: [],
    });
    const r = buildStationIndex([], [o], { now: NOW });
    expect(r.get('five-points-station').observations).toContain(o);
    expect(r.get('garnett-station').observations).toContain(o);
  });

  it('ties an alert to inner stops via affected_stations', () => {
    const a = makeAlert({
      routes: ['red'],
      affected_from_station: 'CIVIC CENTER Station',
      affected_to_station: 'GARNETT Station',
      affected_stations: [
        'CIVIC CENTER Station',
        'PEACHTREE CENTER Station',
        'FIVE POINTS Station',
        'GARNETT Station',
      ],
    });
    const r = buildStationIndex([a], [], { now: NOW });
    expect(r.get('peachtree-center-station').alerts).toContain(a);
    expect(r.get('five-points-station').alerts).toContain(a);
  });
});
