import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import SubscribeContent from '../components/SubscribeContent.jsx';
import { applyRouteCatalog, busRouteName, getRouteCatalog } from '../lib/busRoutes.js';
import { filterIncidents } from '../lib/incidents.js';

it('refreshes the current roster and labels while preserving route ID identity and archived names', async () => {
  render(<SubscribeContent />);
  applyRouteCatalog({
    routes: [
      { id: '1', route: '01', name: 'Renamed Broadway' },
      { id: '120', route: '120', name: 'New Connector' },
    ],
  });
  expect(await screen.findByRole('option', { name: '01 · Renamed Broadway' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '120 · New Connector' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /76 ·/ })).not.toBeInTheDocument();
  expect(getRouteCatalog().ids['01']).toBe('1');
  expect(busRouteName('76')).toBe('Jeffersonville');
  const event = {
    id: 'new',
    agency: 'tarc',
    mode: 'bus',
    routes: ['120'],
    lifecycle: { first_seen_ts: 1, active: true },
    detections: [],
  };
  expect(
    filterIncidents([event], { search: 'New Connector', routeNames: getRouteCatalog().names }),
  ).toEqual([event]);
});

it('keeps the last valid roster when a feed fails validation', () => {
  const before = getRouteCatalog();
  expect(applyRouteCatalog({ routes: [{ id: 'bad', route: '../bad', name: 'Bad' }] })).toBe(false);
  expect(getRouteCatalog()).toBe(before);
});
