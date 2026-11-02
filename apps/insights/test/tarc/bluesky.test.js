const test = require('node:test');
const assert = require('node:assert/strict');

const { postWithExternal } = require('../../src/tarc/shared/bluesky');
const { enableFakePublishing, fakePublisher } = require('./fakePublisher');
enableFakePublishing(test);

const { resolvedEventLink } = require('../../src/tarc/shared/eventLink');

test('resolvedEventLink includes an always-available fallback thumbnail', () => {
  const link = resolvedEventLink('at://did:plc:abc/app.bsky.feed.post/root', 'Resolved');
  assert.equal(link.thumbUrl, 'https://louisvilletransitalerts.app/event/root/resolved/og.png');
  assert.equal(link.fallbackThumbUrl, 'https://louisvilletransitalerts.app/og-image.png');
});

test('postWithExternal falls back when the event thumbnail is not ready', async () => {
  const originalFetch = global.fetch;
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(url);
    if (url.includes('/event/')) return { ok: false };
    return {
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    };
  };
  const agent = fakePublisher();
  const posts = agent.calls;
  agent.uploadBlob = async () => ({ data: { blob: { ref: 'uploaded-thumb' } } });
  try {
    await postWithExternal(
      agent,
      'Resolved',
      resolvedEventLink('at://did:plc:abc/app.bsky.feed.post/root', 'Resolved'),
    );
    assert.deepEqual(fetched, [
      'https://louisvilletransitalerts.app/event/root/resolved/og.png',
      'https://louisvilletransitalerts.app/og-image.png',
    ]);
    assert.deepEqual(posts[0].embed.external.thumb, { ref: 'uploaded-thumb' });
  } finally {
    global.fetch = originalFetch;
  }
});
