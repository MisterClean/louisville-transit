import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import Timeline from '../components/Timeline.jsx';

it('renders the selected TARC bus route with seven day columns', () => {
  render(
    <Timeline
      alerts={[]}
      observations={[]}
      selectedLines={null}
      showBus
      selectedBusRoutes={['01']}
      numDays={7}
      onLineClick={() => {}}
    />,
  );
  const link = screen.getByText('#01').closest('a');
  expect(link).toHaveAttribute('href', '/route/01');
  expect(link.closest('tr').querySelectorAll('td')).toHaveLength(8);
});
