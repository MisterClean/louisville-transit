const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clipWindow } = require('../scripts/runtime/media');
const { validateJsonSize, boundedFetch } = require('../src/tarc/shared/boundedFetch');

test('historical clips never query present-day vehicle reuse', () => {
  const onset = Date.UTC(2026, 10, 1, 12);
  assert.deepEqual(clipWindow({ first_seen: onset, resolved: onset + 120000 }, onset + 86400000), {
    start: onset - 300000,
    end: onset + 420000,
  });
  assert.equal(clipWindow({ first_seen: onset }, onset + 86400000).end, onset + 900000);
});

test('social validation rejects oversized collections and bounded transport rejects oversized bytes', async () => {
  assert.throws(() => validateJsonSize({ items: Array(1001).fill(null) }), /collection/);
  const saved = global.fetch;
  global.fetch = async () =>
    new Response('x'.repeat(1025), { headers: { 'content-type': 'text/plain' } });
  try {
    await assert.rejects(
      boundedFetch('https://example.invalid', {}, { maxBytes: 1024 }),
      /byte limit/,
    );
  } finally {
    global.fetch = saved;
  }
});
