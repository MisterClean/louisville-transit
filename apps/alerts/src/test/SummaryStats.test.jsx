import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SummaryStats from '../components/SummaryStats.jsx';

// SummaryStats renders two strips (a mobile card grid + a desktop strip), so
// the same label legitimately appears more than once — assertions use
// getAllByText / queryAllByText accordingly.
const baseProps = {
  activeCount: 2,
  weeklyCount: 5,
  mostAffectedKind: 'train',
  mostAffectedId: 'red',
  quietestLineId: 'streetcar',
  quietestLineDays: 10,
  alerts: [],
  observations: [],
};
describe('SummaryStats', () => {
  it('renders the 7-day volume figure', () => {
    render(<SummaryStats {...baseProps} />);
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/in last 7 days/i).length).toBeGreaterThan(0);
  });

  it('shows the active-now figure when showActive is set, and hides it otherwise', () => {
    const { rerender } = render(<SummaryStats {...baseProps} showActive />);
    expect(screen.getAllByText(/active now/i).length).toBeGreaterThan(0);

    rerender(<SummaryStats {...baseProps} showActive={false} />);
    expect(screen.queryAllByText(/active now/i)).toHaveLength(0);
    expect(screen.queryAllByText(/all clear/i)).toHaveLength(0);
  });

  it('renders an "all clear" active label when nothing is active', () => {
    render(<SummaryStats {...baseProps} activeCount={0} showActive />);
    expect(screen.getAllByText(/all clear/i).length).toBeGreaterThan(0);
  });
});
