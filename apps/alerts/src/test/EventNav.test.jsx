import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EventNav from '../components/event/EventNav.jsx';
import { incident } from './v2TestHelpers.js';

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

// Three blue-line incidents + one red, so the subject (middle blue) has a
// same-line prev and a global prev/next that differ.
const incidents = [
  incident({ id: 'older-blue', kind: 'bus', routes: ['01'], first_seen_ts: NOW - 3 * HOUR }),
  incident({ id: 'red-between', kind: 'bus', routes: ['76'], first_seen_ts: NOW - 2 * HOUR }),
  incident({ id: 'subject', kind: 'bus', routes: ['01'], first_seen_ts: NOW - 1 * HOUR }),
  incident({ id: 'newest', kind: 'bus', routes: ['99'], first_seen_ts: NOW }),
];

describe('EventNav', () => {
  it('renders same-line and global rows with Previous/Next captions', () => {
    render(<EventNav incident={incidents[2]} incidents={incidents} />);

    // Directional cue is a caption, not an arrow glued to the title.
    expect(screen.getAllByText('← Previous').length).toBeGreaterThan(0);

    // "See all →" links to the single line's page.
    const seeAll = screen.getByRole('link', { name: /see all/i });
    expect(seeAll.getAttribute('href')).toBe('/route/01');

    // Same-line previous skips the red incident and points at the older blue.
    const onLine = screen.getByText(/On #01/).closest('div').parentElement;
    const bluePrev = within(onLine).getByText('← Previous').closest('a');
    expect(bluePrev.getAttribute('href')).toBe('/event/older-blue');
  });

  it('renders nothing when the subject is not in the list', () => {
    const { container } = render(
      <EventNav
        incident={incident({ id: 'ghost', kind: 'bus', routes: ['01'] })}
        incidents={incidents}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
