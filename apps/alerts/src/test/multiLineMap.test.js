import { describe, expect, it } from 'vitest';
import { affectedLineSegments } from '../lib/incidents.js';
import { buildMultiLineMap, sliceTrackBetween } from '../lib/lineMap.js';
import { incident as v2Incident } from './v2TestHelpers.js';

describe('sliceTrackBetween', () => {
  // A simple horizontal polyline; stations sit on two of its points.
  const track = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ];

  it('returns an SVG path between the two nearest points', () => {
    const d = sliceTrackBetween([track], { x: 10, y: 0 }, { x: 20, y: 0 });
    expect(typeof d).toBe('string');
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('L');
  });

  it('picks the branch that best covers both endpoints', () => {
    const right = track;
    const wrong = [
      { x: 0, y: 100 },
      { x: 30, y: 100 },
    ];
    const d = sliceTrackBetween([wrong, right], { x: 10, y: 0 }, { x: 20, y: 0 });
    // The chosen path should hug y=0 (the right branch), not y=100.
    expect(d).not.toContain(',100');
  });

  it('returns null when no polyline has two usable points', () => {
    expect(sliceTrackBetween([[{ x: 0, y: 0 }]], { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it('does not overshoot when the nearest vertex sits past the end station', () => {
    // Sparse track: both stations snap to the same vertex (y=30), which is
    // *beyond* the end station (y=12). The slice is a single vertex, so the
    // old per-segment trim (gated on length>=2) never fired and the highlight
    // drew a stub down to y=30 and back. The chord-projection trim drops it.
    // Regression for sparse track slices that previously overshot short station spans.
    const sparse = [
      { x: 0, y: 30 },
      { x: 0, y: 40 },
    ];
    const d = sliceTrackBetween([sparse], { x: 0, y: 0 }, { x: 0, y: 12 });
    expect(d).not.toContain(',30');
    expect(d).not.toContain(',40');
    expect(d).toBe('M0.0,0.0L0.0,12.0');
  });
});

describe('buildMultiLineMap', () => {
  it('returns null when no known line is given', () => {
    expect(buildMultiLineMap([])).toBeNull();
    expect(buildMultiLineMap(['not-a-line'])).toBeNull();
  });

  it('does not invent rail geometry for TARC route selections', () => {
    expect(buildMultiLineMap(['01', '03'])).toBeNull();
    expect(buildMultiLineMap(['red', 'gold'])).toBeNull();
  });
});

describe('affectedLineSegments', () => {
  it('returns one segment per merged observation, each on its own line', () => {
    // Observation ts ordering vs the MARTA anchor decides the primary (closest)
    // and the order of the extras.
    const T = 1_000_000_000_000;
    const incident = v2Incident({
      id: '115102',
      kind: 'train',
      routes: ['red', 'gold', 'green'],
      official: {
        alert_id: '115102',
        first_seen_ts: T,
        affected_from_station: null,
        affected_to_station: null,
      },
      observations: [
        {
          line: 'red',
          from_station: 'CIVIC CENTER Station',
          to_station: 'FIVE POINTS Station',
          ts: T,
        },
        {
          line: 'gold',
          from_station: 'ARTS CENTER Station',
          to_station: 'FIVE POINTS Station',
          ts: T + 1000,
        },
        {
          line: 'green',
          from_station: 'BANKHEAD Station',
          to_station: 'FIVE POINTS Station',
          ts: T + 2000,
        },
      ],
    });
    const segs = affectedLineSegments(incident);
    expect(segs).toEqual([
      { line: 'red', from: 'CIVIC CENTER Station', to: 'FIVE POINTS Station' },
      { line: 'gold', from: 'ARTS CENTER Station', to: 'FIVE POINTS Station' },
      { line: 'green', from: 'BANKHEAD Station', to: 'FIVE POINTS Station' },
    ]);
  });

  it('uses the alert-level segment (line null) for a pure MARTA alert', () => {
    const incident = v2Incident({
      id: 'a1',
      kind: 'train',
      routes: ['red', 'gold'],
      official: {
        alert_id: 'a1',
        affected_from_station: 'CIVIC CENTER Station',
        affected_to_station: 'FIVE POINTS Station',
      },
      observations: [],
    });
    expect(affectedLineSegments(incident)).toEqual([
      { line: null, from: 'CIVIC CENTER Station', to: 'FIVE POINTS Station' },
    ]);
  });

  it('returns the single segment for a standalone observation', () => {
    const incident = v2Incident({
      id: 'o1',
      kind: 'train',
      routes: ['red'],
      official: null,
      observations: [
        {
          line: 'red',
          from_station: 'CIVIC CENTER Station',
          to_station: 'FIVE POINTS Station',
          ts: 1,
        },
      ],
    });
    expect(affectedLineSegments(incident)).toEqual([
      { line: 'red', from: 'CIVIC CENTER Station', to: 'FIVE POINTS Station' },
    ]);
  });

  it('skips segments with no endpoints', () => {
    const incident = v2Incident({
      id: 'm1',
      kind: 'train',
      routes: ['red'],
      official: { alert_id: 'm1', affected_from_station: null, affected_to_station: null },
      observations: [{ line: 'red', from_station: null, to_station: null, ts: 1 }],
    });
    expect(affectedLineSegments(incident)).toEqual([]);
  });
});
