const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { fakePublisher } = require('./fakePublisher');
const { main } = require('../../scripts/runtime/publish');
const bluesky = require('../../src/tarc/shared/bluesky');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarc-runtime-publisher-'));
  const previous = { ...process.env };
  Object.assign(process.env, {
    TRANSIT_STATE_DIR: dir,
    TRANSIT_WEB_DIR: dir,
    TRANSIT_PUBLISH_ENABLED: 'true',
    BLUESKY_BUS_DID: 'did:plc:bus',
    BLUESKY_BUS_IDENTIFIER: 'bus.test',
    BLUESKY_BUS_APP_PASSWORD: 'fake',
    BLUESKY_ALERTS_DID: 'did:plc:alerts',
    BLUESKY_ALERTS_IDENTIFIER: 'alerts.test',
    BLUESKY_ALERTS_APP_PASSWORD: 'fake',
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const now = 1900000000000;
  const health = {
    status: 'ok',
    sources: Object.fromEntries(
      ['vehicles', 'trip_updates', 'alerts'].map((name) => [name, { source_timestamp: now }]),
    ),
  };
  const agents = {
    BUS: fakePublisher({ did: 'did:plc:bus' }),
    ALERTS: fakePublisher({ did: 'did:plc:alerts' }),
  };
  let logins = 0;
  const options = {
    now,
    health,
    stateDir: dir,
    webDir: dir,
    events: [],
    media: {},
    agentGetter: async (kind) => {
      logins++;
      return agents[kind];
    },
  };
  return { dir, now, options, agents, logins: () => logins };
}
function event(id, now, extra = {}) {
  return {
    id,
    mode: 'bus',
    routes: ['19'],
    lifecycle: { first_seen_ts: now, active: true },
    detections: [{ description: 'Two buses observed together.' }],
    ...extra,
  };
}

test('disabled publisher does no authentication or state creation', async (t) => {
  const { dir, options, logins } = setup(t);
  process.env.TRANSIT_PUBLISH_ENABLED = 'false';
  assert.deepEqual(await main(options), { disabled: true, posted: 0 });
  assert.equal(logins(), 0);
  assert.equal(fs.existsSync(path.join(dir, 'runtime-publisher.sqlite')), false);
});

test('first enabled run baselines silently; only newly observed fresh incidents publish', async (t) => {
  const { now, options, agents, logins } = setup(t);
  const existing = event('old', now - 1000);
  options.events = [existing];
  assert.equal((await main(options)).baseline, true);
  assert.equal(logins(), 0);
  options.now = now + 1000;
  options.events = [existing, event('new', now + 1000)];
  assert.equal((await main(options)).posted, 1);
  assert.equal(agents.BUS.calls.length, 1);
  await main(options);
  assert.equal(agents.BUS.calls.length, 1);
});

test('stale or incomplete feeds cannot establish the publication baseline', async (t) => {
  const { dir, options } = setup(t);
  options.health.sources.alerts.source_timestamp -= 400000;
  await assert.rejects(main(options), /stale/);
  assert.equal(fs.existsSync(path.join(dir, 'runtime-publisher.sqlite')), false);
});

test('partial replies recover after restart without reposting root or successful resolution', async (t) => {
  const { dir, now, options, agents } = setup(t);
  await main(options);
  const fresh = event('thread', now + 1000);
  options.now = now + 1000;
  options.events = [fresh];
  await main(options);
  const root = agents.BUS.posted[0];
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'thread.mp4'), Buffer.from('test clip'));
  options.media = { thread: { video_url: '/data/media/thread.mp4' } };
  options.events = [
    { ...fresh, lifecycle: { ...fresh.lifecycle, active: false, resolved_ts: now + 2000 } },
  ];
  options.now = now + 2000;
  let failVideo = true;
  const original = agents.BUS.com.atproto.repo.putRecord;
  agents.BUS.com.atproto.repo.putRecord = async (request) => {
    if (request.record.text.startsWith('Observed vehicle') && failVideo) {
      failVideo = false;
      throw new Error('Temporary video delivery failure');
    }
    return original(request);
  };
  options.adapter = {
    ...bluesky,
    postWithVideo: async (agent, text, _buffer, _alt, reply, key) =>
      bluesky.postText(agent, text, reply, key),
  };
  await assert.rejects(main(options), /Temporary video delivery/);
  assert.equal(agents.BUS.calls.length, 2);
  assert.equal(agents.BUS.calls[1].reply.root.uri, root.uri);
  // Re-open the module and durable databases as a fresh process would.
  delete require.cache[require.resolve('../../scripts/runtime/publish')];
  await require('../../scripts/runtime/publish').main(options);
  assert.equal(agents.BUS.calls.length, 3);
  assert.equal(agents.BUS.calls[2].reply.root.uri, root.uri);
  const db = new Database(path.join(dir, 'runtime-publisher.sqlite'), { readonly: true });
  try {
    assert.equal(
      db.prepare("SELECT count(*) n FROM runtime_outbox WHERE status='sent'").get().n,
      3,
    );
  } finally {
    db.close();
  }
  await main(options);
  assert.equal(agents.BUS.calls.length, 3);
});

test('all credentials and distinct pinned identities are checked before either login', async (t) => {
  const { options, logins } = setup(t);
  delete process.env.BLUESKY_ALERTS_DID;
  await assert.rejects(main(options), /BLUESKY_ALERTS_DID/);
  assert.equal(logins(), 0);
});

test('a lost outbox acknowledgment reuses the durable remote receipt after restart', async (t) => {
  const { now, options, agents } = setup(t);
  await main(options);
  options.now = now + 1000;
  options.events = [event('uncertain-root', now + 1000)];
  let lost = true;
  options.adapter = {
    ...bluesky,
    postText: async (...args) => {
      const receipt = await bluesky.postText(...args);
      if (lost) {
        lost = false;
        throw new Error('Process lost local acknowledgment');
      }
      return receipt;
    },
  };
  await assert.rejects(main(options), /local acknowledgment/);
  assert.equal(agents.BUS.calls.length, 1);
  await main(options);
  assert.equal(agents.BUS.calls.length, 1, 'a successful remote parent is reconciled, not resent');
});

test('per-route cooldown delays pending work and three-per-day cap preserves the queue', async (t) => {
  const { now, options, agents } = setup(t);
  await main(options);
  options.now = now + 1000;
  options.events = [0, 1, 2, 3].map((i) => event(`route-cap-${i}`, now + 1000));
  assert.equal((await main(options)).posted, 1);
  assert.equal((await main(options)).posted, 0);
  for (let hour = 1; hour <= 3; hour++) {
    options.now = now + 1000 + hour * 3600001;
    for (const source of Object.values(options.health.sources))
      source.source_timestamp = options.now;
    const result = await main(options);
    assert.equal(result.posted, hour < 3 ? 1 : 0);
  }
  assert.equal(agents.BUS.calls.length, 3);
  assert.equal((await main(options)).pending, 1);
});

test('one cycle attempts at most three new thread parts across routes', async (t) => {
  const { now, options } = setup(t);
  await main(options);
  options.now = now + 1000;
  options.events = [0, 1, 2, 3, 4].map((i) =>
    event(`total-cap-${i}`, now + 1000, { routes: [String(i + 1)] }),
  );
  assert.deepEqual(await main(options), { posted: 3, pending: 2 });
});

test('a new terminal cancellation publishes once without claiming service recovery', async (t) => {
  const { now, options, agents, dir } = setup(t);
  await main(options);
  options.now = now + 1000;
  options.events = [
    event('cancel-terminal', now + 1000, {
      lifecycle: { first_seen_ts: now + 1000, active: false, resolved_ts: now + 1000 },
      detections: [
        {
          source: 'cancellation',
          description: 'Route 19: 3 trips explicitly marked canceled by TARC.',
        },
      ],
    }),
  ];
  assert.equal((await main(options)).posted, 1);
  assert.match(agents.ALERTS.calls[0].text, /explicitly marked canceled/);
  await main(options);
  assert.equal(agents.ALERTS.calls.length, 1);
  const db = new Database(path.join(dir, 'runtime-publisher.sqlite'), { readonly: true });
  try {
    assert.deepEqual(db.prepare('SELECT part FROM runtime_outbox').all(), [{ part: 'root' }]);
  } finally {
    db.close();
  }
});

test('canonical PUBLIC_URL supplies absolute archive links ahead of the legacy variable', async (t) => {
  const { now, options, agents } = setup(t);
  process.env.PUBLIC_URL = 'https://transit.example.test/';
  process.env.PUBLIC_BASE_URL = 'https://legacy.example.test';
  await main(options);
  options.now = now + 1000;
  options.events = [event('absolute-link', now + 1000)];
  await main(options);
  assert.match(agents.BUS.calls[0].text, /https:\/\/transit\.example\.test\/event\/absolute-link$/);
  assert.doesNotMatch(agents.BUS.calls[0].text, /legacy/);
});

const {
  analyticsCandidates,
  mapEligible,
  rollupEligible,
} = require('../../scripts/runtime/analytics-publications');
function analyticsMap(kind, now, route = '19') {
  return {
    kind,
    route,
    image_url: `/data/media/${kind}-${route}.jpg`,
    updated_at: now,
    generated_at: now,
    summary: { bins: 40, covered: 20, orange: 2, red: 1, avg: 8 },
    sample_count: 30,
    crowded_vehicle_count: 1,
  };
}

test('analytics eligibility rejects sparse coverage and unknown occupancy', () => {
  const now = 1900000000000,
    enabledAt = now - 1000,
    speed = analyticsMap('speedmap', now),
    crowd = analyticsMap('crowding', now);
  assert.equal(mapEligible(speed, 'speedmap', enabledAt, now), true);
  assert.equal(
    mapEligible(
      { ...speed, summary: { ...speed.summary, covered: 11 } },
      'speedmap',
      enabledAt,
      now,
    ),
    false,
  );
  assert.equal(mapEligible(crowd, 'crowding', enabledAt, now), true);
  for (const override of [
    { sample_count: 19 },
    { sample_count: 0 },
    { crowded_vehicle_count: 0 },
    { summary: { ...crowd.summary, orange: 0, red: 0 } },
  ])
    assert.equal(mapEligible({ ...crowd, ...override }, 'crowding', enabledAt, now), false);
  assert.equal(
    mapEligible({ ...speed, generated_at: enabledAt }, 'speedmap', enabledAt, now),
    false,
  );
  assert.equal(
    rollupEligible({ route: '19', total: 15, crowded: 4, pctCrowded: 4 / 15, crowdedVehicles: 1 }),
    true,
  );
  assert.equal(
    rollupEligible({ route: '19', total: 0, crowded: 0, pctCrowded: 0, crowdedVehicles: 0 }),
    false,
  );
});

test('hourly analytics rotate speedmaps and rest crowded routes six hours', () => {
  const now = 1900000000000,
    enabledAt = now - 86400000;
  const media = {
    a: analyticsMap('speedmap', now, '03'),
    b: analyticsMap('speedmap', now, '04'),
    c: analyticsMap('crowding', now, '03'),
    d: analyticsMap('crowding', now, '04'),
  };
  const history = [
    { kind: 'speedmap', routes: ['03'], timestamp: now - 7200000 },
    { kind: 'speedmap', routes: ['04'], timestamp: now - 10800000 },
    { kind: 'crowding', routes: ['03'], timestamp: now - 7200000 },
  ];
  assert.deepEqual(
    analyticsCandidates({ media, now, enabledAt, history }).map((row) => [
      row.analytics.kind,
      row.routes[0],
    ]),
    [
      ['speedmap', '04'],
      ['crowding', '04'],
    ],
  );
  assert.deepEqual(
    analyticsCandidates({
      media,
      now,
      enabledAt,
      history: [
        { kind: 'speedmap', routes: ['03'], timestamp: now - 1000 },
        { kind: 'crowding', routes: ['03'], timestamp: now - 1000 },
      ],
    }),
    [],
  );
});

test('rollup needs multiple observed routes and a two-hour interval', () => {
  const now = 1900000000000,
    enabledAt = now - 1000;
  const route = (route) => ({ route, total: 20, crowded: 5, pctCrowded: 0.25, crowdedVehicles: 1 });
  const analytics = { generated_at: now, crowding_rollup: [route('19')] };
  assert.deepEqual(analyticsCandidates({ analytics, now, enabledAt }), []);
  analytics.crowding_rollup.push(route('27'));
  assert.equal(
    analyticsCandidates({ analytics, now, enabledAt })[0].analytics.kind,
    'crowding-rollup',
  );
  assert.deepEqual(
    analyticsCandidates({
      analytics,
      now,
      enabledAt,
      history: [{ kind: 'crowding-rollup', routes: ['19', '27'], timestamp: now - 3600000 }],
    }),
    [],
  );
});

test('analytics publish frozen image-cohort facts to BUS without inventing incidents', async (t) => {
  const { dir, now, options, agents } = setup(t);
  await main(options);
  options.now = now + 1000;
  options.analyticsMedia = { a: analyticsMap('speedmap', now + 1000) };
  options.analytics = {};
  fs.mkdirSync(path.join(dir, 'media'));
  fs.writeFileSync(path.join(dir, 'media', 'speedmap-19.jpg'), Buffer.from('fixture image'));
  agents.BUS.uploadBlob = async () => ({ data: { blob: { ref: 'image-from-source-cohort' } } });
  assert.equal((await main(options)).posted, 1);
  assert.match(agents.BUS.calls[0].text, /8.0 mph/);
  assert.equal(agents.ALERTS.calls.length, 0);
  const db = new Database(path.join(dir, 'runtime-publisher.sqlite'), { readonly: true });
  try {
    const facts = JSON.parse(db.prepare('SELECT payload FROM runtime_outbox').get().payload).facts;
    assert.equal(facts.analytics.generated_at, now + 1000);
    assert.equal(facts.lifecycle, undefined);
  } finally {
    db.close();
  }
});

test('ALERTS lane stays frozen across retry when later annotations change', async (t) => {
  const { now, options, agents } = setup(t);
  await main(options);
  options.now = now + 1000;
  options.events = [
    event('roundup-lane', now + 1000, {
      detections: [
        { source: 'incident-roundup', description: 'Two concurrent observed service signals.' },
      ],
    }),
  ];
  let lost = true;
  options.adapter = {
    ...bluesky,
    postText: async (...args) => {
      const receipt = await bluesky.postText(...args);
      if (lost) {
        lost = false;
        throw new Error('Lost local lane receipt');
      }
      return receipt;
    },
  };
  await assert.rejects(main(options), /lane receipt/);
  options.events = [event('roundup-lane', now + 1000)];
  await main(options);
  assert.equal(agents.ALERTS.calls.length, 1);
  assert.equal(agents.BUS.calls.length, 0);
});

test('crowding rollup continuations retain independent same-account reply receipts', async (t) => {
  const { dir, now, options, agents } = setup(t);
  await main(options);
  options.now = now + 1000;
  options.analyticsMedia = {};
  options.analytics = {
    generated_at: now + 1000,
    crowding_rollup: Array.from({ length: 10 }, (_, i) => ({
      route: String(i + 10),
      total: 20,
      crowded: 10,
      pctCrowded: 0.5,
      crowdedVehicles: 2,
    })),
  };
  await main(options);
  const root = agents.BUS.posted[0];
  for (let i = 0; i < 5; i++) await main(options);
  assert.ok(agents.BUS.posted.length > 1);
  for (const reply of agents.BUS.posted.slice(1))
    assert.equal(reply.record.reply.root.uri, root.uri);
  const before = agents.BUS.posted.length;
  await main(options);
  assert.equal(agents.BUS.posted.length, before);
  const db = new Database(path.join(dir, 'runtime-publisher.sqlite'), { readonly: true });
  try {
    assert.equal(
      db.prepare("SELECT count(*) n FROM runtime_outbox WHERE status='pending'").get().n,
      0,
    );
  } finally {
    db.close();
  }
});
