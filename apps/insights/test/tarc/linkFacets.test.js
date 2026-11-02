const test = require('node:test');
const assert = require('node:assert/strict');
const { postText } = require('../../src/tarc/shared/bluesky');

const { enableFakePublishing, fakePublisher: fakeAgent } = require('./fakePublisher');
enableFakePublishing(test);

// Decode a facet's byte range back to the substring it covers (UTF-8).
function facetText(text, facet) {
  const buf = Buffer.from(text, 'utf8');
  return buf.slice(facet.index.byteStart, facet.index.byteEnd).toString('utf8');
}

test('bare ridetarc.org gets a clickable https facet, emoji byte offsets correct', async () => {
  const agent = fakeAgent();
  const text =
    '🚆⚠️ Rail Service Alert for Gold Line\n\n' +
    'The 11:41 a.m. departure was canceled.\n\n' +
    'Per TARC. Check ridetarc.org for updates.';
  await postText(agent, text);
  const { facets } = agent.calls[0];
  assert.ok(facets, 'expected facets');
  const itstarc = facets.find((f) => f.features[0].uri === 'https://ridetarc.org');
  assert.ok(itstarc, 'expected an ridetarc.org link facet');
  assert.equal(facetText(text, itstarc), 'ridetarc.org');
});

test('archive URL and ridetarc.org both get facets, non-overlapping', async () => {
  const agent = fakeAgent();
  const text =
    '✅ TARC reports this is resolved:\n\nGold Line delay\n\n' +
    'https://louisvilletransitalerts.app/event/123/resolved\n\nSee ridetarc.org';
  await postText(agent, text);
  const { facets } = agent.calls[0];
  const uris = facets.map((f) => f.features[0].uri).sort();
  assert.deepEqual(uris, [
    'https://louisvilletransitalerts.app/event/123/resolved',
    'https://ridetarc.org',
  ]);
  // Facets are sorted by position and cover exactly their link text.
  assert.equal(
    facetText(text, facets[0]),
    'https://louisvilletransitalerts.app/event/123/resolved',
  );
  assert.equal(facetText(text, facets[1]), 'ridetarc.org');
});

test('no links → no facets field', async () => {
  const agent = fakeAgent();
  await postText(agent, 'Plain text with no links here.');
  assert.equal(agent.calls[0].facets, undefined);
});
