import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import BrowseMenu from '../components/BrowseMenu.jsx';

describe('BrowseMenu', () => {
  it('shows bus route links even before dynamic incident data loads', async () => {
    render(<BrowseMenu alerts={null} observations={null} />);

    await userEvent.click(screen.getByRole('button', { name: /browse/i }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Bus routes')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '#01' })).toHaveAttribute(
      'href',
      '/route/01',
    );
    expect(within(menu).getByRole('menuitem', { name: /All routes/ })).toHaveAttribute(
      'href',
      '/routes',
    );
    // The streetcar is a rail line, not a bus route — it must never appear here.
    expect(within(menu).queryByRole('menuitem', { name: '#ATLSC' })).toBeNull();
  });
});
