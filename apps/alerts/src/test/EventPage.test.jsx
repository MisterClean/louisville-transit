import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import EventPage from '../components/EventPage.jsx';
import { incident } from './v2TestHelpers.js';

const getIncidentWithContext = vi.hoisted(() => vi.fn());
vi.mock('../lib/incidentStore.js', () => ({ getIncidentWithContext }));

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});

it('shows a TARC bus alert and its event permalink', async () => {
  const event = incident({
    id: 'tarc-76',
    agency: 'tarc',
    kind: 'bus',
    routes: ['76'],
    official: { headline: 'Route 76 detour' },
  });
  getIncidentWithContext.mockResolvedValue({ incident: event, incidents: [event] });
  render(<EventPage eventId="tarc-76" />);
  expect(await screen.findByText(/Route 76 detour/i)).toBeInTheDocument();
  expect(getIncidentWithContext).toHaveBeenCalledWith('tarc-76');
});

it('shows a not-found message for an unknown incident', async () => {
  getIncidentWithContext.mockResolvedValue(null);
  render(<EventPage eventId="missing" />);
  expect(await screen.findByText(/not found/i)).toBeInTheDocument();
});
