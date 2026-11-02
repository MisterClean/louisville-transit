import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import BusAnalytics from '../components/BusAnalytics.jsx';

it('shows only selected route speed, occupancy and headway observations', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      speedmaps: [
        [
          'shape',
          {
            shapeId: 'shape',
            route: '01',
            bins: [null, 8],
            summary: { avg: 8, covered: 1, bins: 2 },
          },
        ],
      ],
      crowding_rollup: [{ route: '01', pctCrowded: 0.25, total: 4 }],
      headways: [
        { route: '01', directions: [{ headway_min: 20 }] },
        { route: '76', directions: [{ headway_min: 30 }] },
      ],
    }),
  });
  render(<BusAnalytics route="01" />);
  expect(await screen.findByText(/25% of 4 observations/)).toBeInTheDocument();
  expect(screen.getByText(/20 min/)).toBeInTheDocument();
  expect(screen.queryByText(/30 min/)).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Route 01 speed segments' })).toBeInTheDocument();
});
