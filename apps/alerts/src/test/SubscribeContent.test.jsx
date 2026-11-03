import { render, screen, within } from '@testing-library/react';
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
  expect(screen.getByRole('link', { name: 'Open JSON Feed' })).toHaveAttribute(
    'href',
    '/feed/route/01.json',
  );
});

it('links to incident exports and the position archive', () => {
  render(<SubscribeContent />);
  for (const [name, href] of [
    ['Recent incidents', '/data/alerts-recent.json'],
    ['archive index', '/data/alerts-index.json'],
    ['incident CSV', '/data/alerts.csv'],
    ['position archive index', '/data/positions/index.json'],
    ['JSON Feed', '/feed.json'],
  ]) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  }
  expect(screen.getByText(/November 2, 2026, is partial/)).toBeInTheDocument();
  expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
});

it('expands and copies the latest-day example without hardcoding a date', async () => {
  const user = userEvent.setup();
  render(<SubscribeContent />);
  const example = screen.getByText('Find and read the latest listed day').closest('details');
  await user.click(within(example).getByText('Find and read the latest listed day'));
  await user.click(within(example).getByRole('button', { name: 'Copy example' }));
  expect(within(example).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  const copied = await navigator.clipboard.readText();
  expect(copied).toContain('.days[0].files.bus.path');
  expect(copied).toContain('read_parquet');
  expect(copied).not.toContain('2026-11-02');
});

it('copies the incident count example', async () => {
  const user = userEvent.setup();
  render(<SubscribeContent />);
  const example = screen.getByText('Count incidents in the recent JSON').closest('details');
  await user.click(within(example).getByText('Count incidents in the recent JSON'));
  await user.click(within(example).getByRole('button', { name: 'Copy example' }));
  expect(await navigator.clipboard.readText()).toContain("jq '.incidents | length'");
});
