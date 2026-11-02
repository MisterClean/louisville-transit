import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { linkifyMentionedStations } from '../components/event/AffectedStations.jsx';

describe('linkifyMentionedStations — MARTA SHOUTED + bare prose', () => {
  const text =
    'Green line is only servicing from Bankhead to Ashby, on the EB platform. ' +
    'Customers must board on the EB platform at Ashby for service to Bankhead.';
  const mentions = ['ASHBY Station', 'BANKHEAD Station'];

  it('links bare title-case mentions against SHOUTED canonical names', () => {
    const parts = linkifyMentionedStations(text, mentions, null);
    expect(Array.isArray(parts)).toBe(true);
    const links = parts.filter((p) => typeof p !== 'string');
    // Bankhead x2, Ashby x2
    expect(links.length).toBe(4);
    for (const l of links) {
      expect(l.props.name).toMatch(/Station$/); // canonical drives the slug
      expect(['Bankhead', 'Ashby']).toContain(l.props.label); // prose wording preserved
    }
  });

  it('renders dotted-underline links to /station/:slug, keeping prose wording', () => {
    const html = renderToStaticMarkup(<p>{linkifyMentionedStations(text, mentions, null)}</p>);
    expect(html).toContain('href="/station/bankhead-station"');
    expect(html).toContain('href="/station/ashby-station"');
    expect(html).toContain('>Bankhead<');
    expect(html).toContain('>Ashby<');
    // The added link text must not inject the " Station" suffix into the prose.
    expect(html).not.toContain('Bankhead Station to');
  });
});

it('links embedded HTTP(S) details and leaves unsafe schemes as text', () => {
  const html = renderToStaticMarkup(
    <p>
      {linkifyMentionedStations(
        'Details: https://bit.ly/Rt76detour. Ignore javascript:alert(1)',
        [],
        null,
      )}
    </p>,
  );
  expect(html).toContain('href="https://bit.ly/Rt76detour"');
  expect(html).toContain('</a>.');
  expect(html).not.toContain('href="javascript:');
});
