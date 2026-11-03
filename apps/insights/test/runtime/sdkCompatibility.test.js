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

test('installed Atproto SDK preserves guarded post writes and deletes with the resolved Zod version', async () => {
  const original = global.fetch;
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  const rkey = '3mabc23456789';
  const cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const record = {
    $type: 'app.bsky.feed.post',
    text: 'Temporary SDK compatibility test',
    createdAt: '2026-11-03T20:00:00.000Z',
  };
  const calls = [];
  global.fetch = async (input, init) => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    calls.push({ pathname, body: await request.json() });
    assert.equal(new URL(request.url).origin, 'https://pds.example');
    if (pathname === '/xrpc/com.atproto.repo.putRecord') {
      return new Response(JSON.stringify({ uri, cid }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname === '/xrpc/com.atproto.repo.deleteRecord') {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected XRPC call: ${pathname}`);
  };
  try {
    const agent = new AtpAgent({ service: 'https://pds.example', fetch: boundedFetch });
    const written = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      rkey,
      record,
      swapRecord: null,
      validate: true,
    });
    assert.equal(written.data.uri, uri);
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: 'app.bsky.feed.post',
      rkey,
    });
    assert.deepEqual(calls.map((call) => call.pathname), [
      '/xrpc/com.atproto.repo.putRecord',
      '/xrpc/com.atproto.repo.deleteRecord',
    ]);
    assert.equal(calls[0].body.swapRecord, null);
    assert.deepEqual(calls[0].body.record, record);
    assert.equal(calls[1].body.rkey, rkey);
  } finally {
    global.fetch = original;
  }
});

test('installed Atproto SDK accepts image upload responses with the resolved Zod version', async () => {
  const original = global.fetch;
  const cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  global.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, '/xrpc/com.atproto.repo.uploadBlob');
    assert.equal(request.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await request.arrayBuffer()), image);
    return new Response(JSON.stringify({
      blob: {
        $type: 'blob',
        ref: { $link: cid },
        mimeType: 'image/jpeg',
        size: image.length,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const agent = new AtpAgent({ service: 'https://pds.example', fetch: boundedFetch });
    const upload = await agent.uploadBlob(image, { encoding: 'image/jpeg' });
    assert.equal(upload.data.blob.mimeType, 'image/jpeg');
    assert.equal(upload.data.blob.size, image.length);
  } finally {
    global.fetch = original;
  }
});
