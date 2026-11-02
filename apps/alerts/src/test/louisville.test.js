import { describe, expect, it } from 'vitest';
import { BUS_ROUTE_NAMES, formatBusRoute } from '../lib/busRoutes.js';
import { dataUrl } from '../lib/dataSource.js';
import { isWebsiteIncident } from '../lib/incidents.js';

describe('Louisville data boundary', () => {
  it('fetches published files from the same origin', () => {
    expect(dataUrl('alerts-recent.json')).toBe('/data/alerts-recent.json');
  });
  it('preserves leading zeroes on public TARC route labels', () => {
    expect(BUS_ROUTE_NAMES['01']).toBe('Broadway – Bardstown');
    expect(formatBusRoute('01')).toBe('#01 Broadway – Bardstown');
  });
  it('accepts TARC bus incidents while excluding foreign and rail incidents', () => {
    expect(isWebsiteIncident({ agency: 'tarc', mode: 'bus', routes: ['01'] })).toBe(true);
    expect(isWebsiteIncident({ agency: 'marta', mode: 'bus', routes: ['01'] })).toBe(false);
    expect(isWebsiteIncident({ agency: 'tarc', mode: 'train', routes: [] })).toBe(false);
  });
});
