const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function enableFakePublishing(test) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-publisher-test-'));
  const previous = {
    enabled: process.env.TRANSIT_PUBLISH_ENABLED,
    state: process.env.TRANSIT_STATE_DIR,
  };
  process.env.TRANSIT_PUBLISH_ENABLED = 'true';
  process.env.TRANSIT_STATE_DIR = directory;
  test.after(() => {
    for (const [name, value] of [
      ['TRANSIT_PUBLISH_ENABLED', previous.enabled],
      ['TRANSIT_STATE_DIR', previous.state],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
}

function fakePublisher({ did = 'did:plc:testpublisher', known = [], receipt } = {}) {
  const records = new Map(
    known.map((uri) => [uri, { uri, cid: `cid-${uri.split('/').pop()}`, value: {} }]),
  );
  const calls = [],
    posted = [];
  const agent = {
    session: { did },
    calls,
    posted,
    records,
    com: {
      atproto: {
        repo: {
          getRecord: async ({ repo, collection, rkey }) => {
            const value = records.get(`at://${repo}/${collection}/${rkey}`);
            if (!value)
              throw Object.assign(new Error('Record not found'), {
                error: 'RecordNotFound',
                status: 404,
              });
            return { data: value };
          },
          putRecord: async ({ repo, collection, rkey, record }) => {
            const result = receipt || {
              uri: `at://${repo}/${collection}/${rkey}`,
              cid: `cid-${rkey}`,
            };
            records.set(`at://${repo}/${collection}/${rkey}`, { ...result, value: record });
            calls.push(record);
            posted.push({ record, ...result });
            return { data: result };
          },
        },
      },
    },
  };
  return agent;
}
module.exports = { enableFakePublishing, fakePublisher };
