import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ActiveAlerts from '../components/ActiveAlerts.jsx';
import { incident } from './v2TestHelpers.js';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// Nested incident shape with a MARTA block — ActiveCard shows `official.headline`
// directly, so the headline doubles as a stable text handle in assertions.
const activeInc = (over = {}) =>
  incident({
    id: 'a1',
    kind: 'train',
    routes: ['red'],
    active: true,
    first_seen_ts: NOW - 20 * MIN,
    resolved_ts: null,
    official: {
      alert_id: 'x',
      headline: 'Red Line Delays',
      post_url: 'https://bsky.app/profile/x/post/a1',
      first_seen_ts: NOW - 20 * MIN,
    },
    observations: [],
    ...over,
  });

describe('ActiveAlerts', () => {
  it('renders the "Active Now" heading with the combined active + long-running count', () => {
    render(
      <ActiveAlerts
        incidents={[activeInc({ id: 'a1' })]}
        longRunningIncidents={[activeInc({ id: 'lr1', first_seen_ts: NOW - 3 * 24 * 60 * MIN })]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
      />,
    );
    // 1 active + 1 long-running, merged and re-bucketed by category. Scope to
    // the section's h2 — sub-section labels (h3) also carry counts.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/Active Now\s*\(2\)/);
  });

  it('buckets active incidents into Disruptions and Planned sections', () => {
    render(
      <ActiveAlerts
        incidents={[
          activeInc({
            id: 'd1',
            official: { headline: 'Red Line gap', post_url: 'https://bsky.app/profile/x/post/d1' },
          }),
          activeInc({
            id: 'd2',
            kind: 'bus',
            routes: ['66'],
            official: {
              headline: 'Route 66 detour',
              post_url: 'https://bsky.app/profile/x/post/d2',
            },
          }),
          activeInc({
            id: 'p1',
            kind: 'train',
            routes: ['gold'],
            official: {
              headline: 'Gold Line planned service change',
              agency_event_start_ts: NOW + DAY,
              post_url: 'https://bsky.app/profile/x/post/p1',
            },
          }),
        ]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
      />,
    );
    expect(screen.getByText(/^Disruptions$/)).toBeInTheDocument();
    expect(screen.getByText(/Planned & scheduled/)).toBeInTheDocument();
    expect(screen.getByText('Red Line gap')).toBeInTheDocument();
    expect(screen.getByText('Route 66 detour')).toBeInTheDocument();
    expect(screen.getByText('Gold Line planned service change')).toBeInTheDocument();
  });

  it('routes a delay-status incident into the amber Delays band', () => {
    render(
      <ActiveAlerts
        incidents={[
          activeInc({
            id: 'dl1',
            status: { type: 'delay' },
            official: {
              headline: 'Red/Gold Line delays',
              post_url: 'https://bsky.app/profile/x/post/dl1',
            },
          }),
          activeInc({
            id: 'd1',
            official: {
              headline: 'Blue Line suspended',
              post_url: 'https://bsky.app/profile/x/post/d1',
            },
          }),
        ]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
      />,
    );
    // The amber Delays band exists, distinct from the red Disruptions band.
    expect(screen.getByText(/^Delays$/)).toBeInTheDocument();
    expect(screen.getByText(/^Disruptions$/)).toBeInTheDocument();
    expect(screen.getByText('Red/Gold Line delays')).toBeInTheDocument();
    expect(screen.getByText('Blue Line suspended')).toBeInTheDocument();
  });

  it('routes a detour-status incident into a collapsed Detours band', () => {
    render(
      <ActiveAlerts
        incidents={[
          activeInc({
            id: 'dt1',
            kind: 'bus',
            routes: ['71'],
            status: { type: 'detour' },
            official: {
              headline: 'Route 71 detour',
              post_url: 'https://bsky.app/profile/x/post/dt1',
            },
          }),
          activeInc({
            id: 'd1',
            official: {
              headline: 'Blue Line suspended',
              post_url: 'https://bsky.app/profile/x/post/d1',
            },
          }),
        ]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
      />,
    );
    // The Detours band exists, distinct from the red Disruptions band, and is
    // collapsed by default — so the live disruption shows but the detour row
    // stays folded away.
    expect(screen.getByText(/^Detours$/)).toBeInTheDocument();
    expect(screen.getByText(/^Disruptions$/)).toBeInTheDocument();
    expect(screen.getByText('Blue Line suspended')).toBeInTheDocument();
    expect(screen.queryByText('Route 71 detour')).not.toBeInTheDocument();
  });

  it('keeps the first two incidents as full cards and collapses the rest to compact rows', () => {
    render(
      <ActiveAlerts
        incidents={[
          activeInc({
            id: 'a1',
            official: { headline: 'First', post_url: 'https://bsky.app/profile/x/post/a1' },
          }),
          activeInc({
            id: 'a2',
            official: { headline: 'Second', post_url: 'https://bsky.app/profile/x/post/a2' },
          }),
          activeInc({
            id: 'a3',
            official: { headline: 'Third', post_url: 'https://bsky.app/profile/x/post/a3' },
          }),
        ]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
      />,
    );
    // All three are present somewhere in the section.
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
    // Only full cards carry a Share/Copy link, so exactly two appear.
    expect(screen.getAllByText(/share|copy link/i)).toHaveLength(2);
    // The collapsed row still links straight to the event permalink.
    expect(document.querySelector('a[href="/event/a3"]')).not.toBeNull();
  });

  it('shows the burst chip only when the recent rate clears the threshold', () => {
    const { rerender } = render(
      <ActiveAlerts
        incidents={[activeInc()]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
        burst={{ recentCount: 4, windowHours: 3, ratio: 2.5 }}
      />,
    );
    expect(screen.getByText(/4 in 3h · 2\.5× typical rate/)).toBeInTheDocument();

    // Below the ratio threshold (2×) → no chip.
    rerender(
      <ActiveAlerts
        incidents={[activeInc()]}
        now={NOW}
        typicalDurations={null}
        stationIndex={null}
        burst={{ recentCount: 4, windowHours: 3, ratio: 1.2 }}
      />,
    );
    expect(screen.queryByText(/typical rate/)).not.toBeInTheDocument();
  });
});
