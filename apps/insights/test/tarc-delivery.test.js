const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishRecord, openDeliveries, nextTid } = require('../src/tarc/shared/delivery');
const { login, linkFacets } = require('../src/tarc/shared/bluesky');

test('publishing disabled prevents authentication and record preparation', async () => {
  const previous = process.env.TRANSIT_PUBLISH_ENABLED;
  delete process.env.TRANSIT_PUBLISH_ENABLED;
  try {
    await assert.rejects(login('example.test', 'unused'), /disabled/);
    await assert.rejects(
      publishRecord({}, 'test', () => {
        throw new Error('must not run');
      }),
      /disabled/,
    );
  } finally {
    if (previous === undefined) delete process.env.TRANSIT_PUBLISH_ENABLED;
    else process.env.TRANSIT_PUBLISH_ENABLED = previous;
  }
});

test('uncertain write is reconciled, frozen payload survives retry, and sent records are never recreated', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-delivery-'));
  const previous = {
    enabled: process.env.TRANSIT_PUBLISH_ENABLED,
    state: process.env.TRANSIT_STATE_DIR,
  };
  process.env.TRANSIT_PUBLISH_ENABLED = 'true';
  process.env.TRANSIT_STATE_DIR = directory;
  const db = openDeliveries();
  const records = new Map();
  let writes = 0;
  let prepared = 0;
  const agent = {
    session: { did: 'did:plc:testaccount' },
    com: {
      atproto: {
        repo: {
          async getRecord({ rkey }) {
            if (!records.has(rkey))
              throw Object.assign(new Error('missing'), { error: 'RecordNotFound' });
            return { data: records.get(rkey) };
          },
          async putRecord(input) {
            assert.equal(input.swapRecord, null);
            assert.match(input.rkey, /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
            writes++;
            const data = {
              uri: `at://${input.repo}/app.bsky.feed.post/${input.rkey}`,
              cid: 'bafytest',
              value: input.record,
            };
            records.set(input.rkey, data);
            throw new Error('response lost after commit');
          },
        },
      },
    },
  };
  try {
    const prepare = async () => {
      prepared++;
      return { text: 'Route 01 observation', reply: undefined };
    };
    const receipt = await publishRecord(agent, { event: 'event-1', part: 'root' }, prepare, { db });
    assert.equal(writes, 1);
    assert.equal(prepared, 1);
    records.clear(); // A later manual deletion is not permission to recreate it.
    const again = await publishRecord(
      agent,
      { event: 'event-1', part: 'root' },
      () => {
        throw new Error('must remain frozen');
      },
      { db },
    );
    assert.deepEqual(again, receipt);
    assert.equal(writes, 1);
    assert.equal(db.prepare('SELECT status FROM deliveries').get().status, 'sent');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of [
      ['TRANSIT_PUBLISH_ENABLED', previous.enabled],
      ['TRANSIT_STATE_DIR', previous.state],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('TIDs remain unique and monotonic within a single millisecond', () => {
  const ids = Array.from({ length: 200 }, () => nextTid());
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort());
});

test('link facets use UTF-8 offsets after emoji and handle the configured public host', () => {
  const text = '🚌 Route 01 → https://transit.example/event/tarc-1';
  const [facet] = linkFacets(text);
  assert.equal(
    Buffer.from(text).subarray(facet.index.byteStart, facet.index.byteEnd).toString(),
    'https://transit.example/event/tarc-1',
  );
  assert.equal(facet.features[0].uri, 'https://transit.example/event/tarc-1');
});
