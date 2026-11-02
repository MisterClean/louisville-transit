import { describe, expect, it } from 'vitest';
import {
  currentlyOut,
  groupOutagesByStation,
  outagesForLine,
  outagesForStation,
  stationReliability,
  summarizeOutages,
} from '../lib/accessibility.js';

const DAY = 24 * 60 * 60 * 1000;
const now = 10 * DAY;

const outage = (overrides) => ({
  id: 'marta-a',
  agency: 'marta',
  station: { slug: 'midtown-station', name: 'Midtown', lines: ['red', 'gold'] },
  unit_type: 'elevator',
  unit_label: 'to platform',
  headline: 'Elevator out',
  description: null,
  lifecycle: {
    first_seen_ts: now - 2 * DAY,
    restored_ts: null,
    active: true,
    duration_ms: null,
  },
  source_url: null,
  ...overrides,
});

describe('accessibility derivations', () => {
  it('returns active outages sorted by current duration and line-filtered', () => {
    const rows = currentlyOut(
      [
        outage({ id: 'short', lifecycle: { first_seen_ts: now - DAY, active: true } }),
        outage({
          id: 'long',
          station: { slug: 'five-points-station', name: 'Five Points', lines: ['blue'] },
          lifecycle: { first_seen_ts: now - 3 * DAY, active: true },
        }),
        outage({ id: 'old', lifecycle: { first_seen_ts: now - 5 * DAY, active: false } }),
      ],
      { now },
    );
    expect(rows.map((r) => r.id)).toEqual(['long', 'short']);
    expect(currentlyOut(rows, { now, line: 'red' }).map((r) => r.id)).toEqual(['short']);
  });

  it('returns station outages with active rows first', () => {
    const rows = outagesForStation(
      [
        outage({
          id: 'restored',
          lifecycle: { first_seen_ts: now - DAY, restored_ts: now, active: false },
        }),
        outage({ id: 'active', lifecycle: { first_seen_ts: now - 2 * DAY, active: true } }),
      ],
      'midtown-station',
      { now },
    );
    expect(rows.map((r) => r.id)).toEqual(['active', 'restored']);
  });

  it('returns line outages with active rows first', () => {
    const rows = outagesForLine(
      [
        outage({
          id: 'restored',
          lifecycle: { first_seen_ts: now - DAY, restored_ts: now, active: false },
        }),
        outage({
          id: 'blue',
          station: { slug: 'five-points-station', name: 'Five Points', lines: ['blue'] },
          lifecycle: { first_seen_ts: now - 3 * DAY, active: true },
        }),
        outage({ id: 'active', lifecycle: { first_seen_ts: now - 2 * DAY, active: true } }),
      ],
      'red',
      { now },
    );
    expect(rows.map((r) => r.id)).toEqual(['active', 'restored']);
  });

  it('summarizes active outages by unit total and distinct station', () => {
    const rows = [
      outage({ id: 'a' }),
      outage({ id: 'b' }),
      outage({
        id: 'c',
        station: { slug: 'five-points-station', name: 'Five Points', lines: ['blue'] },
      }),
    ];
    // 'a' and 'b' share Midtown, so it counts once.
    expect(summarizeOutages(rows)).toEqual({ total: 3, stations: 2 });
  });

  it('collapses multiple units at one station into a single group, longest-out first', () => {
    const rows = currentlyOut(
      [
        outage({ id: 'elevator', lifecycle: { first_seen_ts: now - DAY, active: true } }),
        outage({
          id: 'escalator',
          unit_type: 'escalator',
          lifecycle: { first_seen_ts: now - 3 * DAY, active: true },
        }),
        outage({
          id: 'fivepoints',
          station: { slug: 'five-points-station', name: 'Five Points', lines: ['blue'] },
          lifecycle: { first_seen_ts: now - 2 * DAY, active: true },
        }),
      ],
      { now },
    );
    const groups = groupOutagesByStation(rows);
    expect(groups.map((g) => g.key)).toEqual(['midtown-station', 'five-points-station']);
    expect(groups[0]).toMatchObject({
      name: 'Midtown',
      slug: 'midtown-station',
      lines: ['red', 'gold'],
    });
    expect(groups[0].outages.map((o) => o.id)).toEqual(['escalator', 'elevator']);
  });

  it('summarizes station reliability inside the requested window', () => {
    const rows = stationReliability(
      [
        outage({ id: 'active', lifecycle: { first_seen_ts: now - 2 * DAY, active: true } }),
        outage({
          id: 'restored',
          lifecycle: { first_seen_ts: now - 4 * DAY, restored_ts: now - 3 * DAY, active: false },
        }),
      ],
      { now, windowDays: 7 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].outageCount).toBe(2);
    expect(rows[0].currentlyOut).toBe(1);
    expect(rows[0].totalDownMs).toBe(3 * DAY);
  });
});
