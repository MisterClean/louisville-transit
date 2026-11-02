import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RelatedIncidents } from '../components/event/RelatedIncidents.jsx';
import { incident } from './v2TestHelpers.js';

const NOW = 1_000_000_000_000;

const parent = incident({
  id: 'parent',
  kind: 'train',
  routes: ['red'],
  first_seen_ts: NOW,
  resolved_ts: NOW,
  active: false,
  official: null,
  observations: [
    {
      id: 'parent',
      kind: 'train',
      line: 'red',
      detection_source: 'gap',
      from_station: 'CIVIC CENTER Station',
      to_station: 'FIVE POINTS Station',
      ts: NOW,
      resolved_ts: NOW,
      active: false,
      bot_description: 'Red Line gaps downtown',
    },
  ],
});

const related = incident({
  id: 'related-red',
  kind: 'train',
  routes: ['red'],
  first_seen_ts: NOW - 60 * 60_000,
  resolved_ts: NOW - 60 * 60_000,
  active: false,
  official: null,
  observations: [
    {
      id: 'related-red',
      kind: 'train',
      line: 'red',
      detection_source: 'bunching',
      from_station: 'ARTS CENTER Station',
      to_station: 'CIVIC CENTER Station',
      ts: NOW - 60 * 60_000,
      resolved_ts: NOW - 60 * 60_000,
      active: false,
      bot_description: 'Trains bunched north of downtown',
    },
  ],
});

const busRelated = incident({
  id: 'bus-66',
  kind: 'bus',
  routes: ['66'],
  first_seen_ts: NOW - 30 * 60_000,
  resolved_ts: NOW - 30 * 60_000,
  active: false,
  official: {
    alert_id: 'bus66',
    headline: 'Route 66 detour',
    first_seen_ts: NOW - 30 * 60_000,
    post_url: 'https://bsky.app/x',
  },
  observations: [],
});

const busPeer = incident({
  id: 'bus-66-peer',
  kind: 'bus',
  routes: ['66'],
  first_seen_ts: NOW - 10 * 60_000,
  resolved_ts: NOW,
  active: false,
  official: null,
  observations: [
    {
      id: 'bus-66-peer',
      kind: 'bus',
      line: '66',
      detection_source: 'gap',
      ts: NOW - 10 * 60_000,
      resolved_ts: NOW,
      active: false,
      bot_description: 'Long gaps detected',
    },
  ],
});

describe('RelatedIncidents', () => {
  it('shows related incidents on the same rail line', () => {
    render(<RelatedIncidents incident={parent} incidents={[parent, related, busRelated]} />);
    expect(screen.getByText('Arts Center Station')).toBeInTheDocument();
    expect(screen.getByText('Civic Center Station')).toBeInTheDocument();
    expect(screen.queryByText('Route 66 detour')).not.toBeInTheDocument();
  });

  it('shows related incidents on the same bus route', () => {
    render(<RelatedIncidents incident={busRelated} incidents={[parent, busRelated, busPeer]} />);
    expect(screen.queryByText('Red Line gaps downtown')).not.toBeInTheDocument();
    expect(screen.getByText('Long gaps')).toBeInTheDocument();
  });
});
