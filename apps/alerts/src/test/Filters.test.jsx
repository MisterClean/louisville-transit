import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Filters from '../components/Filters.jsx';

const defaultProps = {
  selectedLines: null,
  onLinesChange: vi.fn(),
  showBus: true,
  onShowBusChange: vi.fn(),
  availableBusRoutes: [],
  selectedBusRoutes: [],
  onBusRoutesChange: vi.fn(),
  dateRange: 90,
  onDateRangeChange: vi.fn(),
};

describe('Filters', () => {
  it('calls onShowBusChange when Bus is clicked', async () => {
    const onShowBusChange = vi.fn();
    render(<Filters {...defaultProps} onShowBusChange={onShowBusChange} />);
    await userEvent.click(screen.getByText('Buses'));
    expect(onShowBusChange).toHaveBeenCalled();
  });

  it('calls onDateRangeChange with the correct value', async () => {
    const onDateRangeChange = vi.fn();
    render(<Filters {...defaultProps} onDateRangeChange={onDateRangeChange} />);
    await userEvent.click(screen.getByText('30d'));
    expect(onDateRangeChange).toHaveBeenCalledWith(30);
  });
});
