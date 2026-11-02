const test = require('node:test');
const assert = require('node:assert/strict');
const { AtpAgent } = require('@atproto/api');
const { boundedFetch } = require('../../src/tarc/shared/boundedFetch');
test('installed Atproto SDK accepts bounded actual XRPC record responses without authentication or network', async () => {
  const original = global.fetch;
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  const cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
  const record = {
    $type: 'app.bsky.feed.post',
    text: 'TARC test observation',
    createdAt: '2026-11-02T20:00:00.000Z',
  };
  const calls = [];
  global.fetch = async (input) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? String(input) : input.url,
    );
    calls.push(url);
    assert.equal(url.origin, 'https://pds.example');
    assert.equal(url.pathname, '/xrpc/com.atproto.repo.getRecord');
    return new Response(
      JSON.stringify({ uri: `at://${did}/app.bsky.feed.post/3mabc23456789`, cid, value: record }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const agent = new AtpAgent({ service: 'https://pds.example', fetch: boundedFetch });
    const response = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      rkey: '3mabc23456789',
    });
    assert.equal(response.data.cid, cid);
    assert.deepEqual(response.data.value, record);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].searchParams.get('repo'), did);
  } finally {
    global.fetch = original;
  }
});
