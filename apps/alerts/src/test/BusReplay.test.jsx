import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BusReplay from '../components/BusReplay.jsx';

afterEach(() => vi.restoreAllMocks());

it('renders observed positions on the published bus shape and supports scrubbing', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      mode: 'bus',
      route: '01',
      t0: 1793652000000,
      durSec: 120,
      shapes: [
        {
          id: 'shape-1',
          coordinates: [
            [-85.8, 38.2],
            [-85.7, 38.3],
          ],
        },
      ],
      vehicles: [
        {
          id: 'bus-1',
          s: [
            [0, 38.2, -85.8],
            [60, 38.3, -85.7],
          ],
        },
      ],
    }),
  });
  render(<BusReplay eventId="incident-1" />);
  expect(
    await screen.findByRole('img', { name: /route 01 vehicle positions/i }),
  ).toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Replay time' })).toHaveAttribute('max', '120');
  expect(globalThis.fetch).toHaveBeenCalledWith('/data/tracks/incident-1.json', expect.any(Object));
});
