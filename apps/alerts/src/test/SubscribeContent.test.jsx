import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import SubscribeContent from '../components/SubscribeContent.jsx';

it('links to a route feed when a TARC route is selected', async () => {
  render(<SubscribeContent />);
  await userEvent.selectOptions(screen.getByLabelText('TARC route'), '01');
  expect(screen.getByRole('link', { name: 'Open Atom feed' })).toHaveAttribute(
    'href',
    '/feed/route/01.xml',
  );
});
