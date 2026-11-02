require('../../src/shared/env');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const bluesky = require('../../src/tarc/shared/bluesky');
const { analyticsCandidates } = require('./analytics-publications');
const { publishingEnabled } = require('../../src/tarc/shared/delivery');

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS publisher_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS publisher_baseline(event_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS runtime_outbox(event_id TEXT NOT NULL,part TEXT NOT NULL,account TEXT NOT NULL,route TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',uri TEXT,cid TEXT,created_at INTEGER NOT NULL,sent_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,attempted_at INTEGER,PRIMARY KEY(event_id,part));`);
  if (!db.pragma('table_info(runtime_outbox)').some((column) => column.name === 'attempted_at'))
    db.exec('ALTER TABLE runtime_outbox ADD COLUMN attempted_at INTEGER');
}
function credentials() {
  for (const account of ['BUS', 'ALERTS'])
    for (const suffix of ['IDENTIFIER', 'APP_PASSWORD', 'DID']) {
      const value = process.env[`BLUESKY_${account}_${suffix}`];
      if (!value || (suffix === 'DID' && !value.startsWith('did:')))
        throw new Error(
          `BLUESKY_${account}_${suffix} must be configured before enabling publishing`,
        );
    }
  if (process.env.BLUESKY_BUS_DID === process.env.BLUESKY_ALERTS_DID)
    throw new Error('BUS and ALERTS must have distinct pinned DIDs');
}
function fresh(health, now) {
  return (
    health.status === 'ok' &&
    ['vehicles', 'trip_updates', 'alerts'].every((name) => {
      const source = health.sources?.[name];
      return (
        source &&
        !source.error &&
        source.source_timestamp > now - 300000 &&
        source.source_timestamp <= now + 60000
      );
    })
  );
}
function textLimit(text, limit = 295) {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)]
    .slice(0, limit)
    .map((x) => x.segment)
    .join('');
}
function accountFor(event) {
  return event.official_alert ||
    (event.detections || []).some((detection) =>
      ['cancellation', 'incident-roundup'].includes(detection.source),
    )
    ? 'ALERTS'
    : 'BUS';
}
function cancellation(event) {
  return (event.detections || []).some((detection) => detection.source === 'cancellation');
}
function describe(event) {
  return (
    event.official_alert?.headline ||
    event.official_alert?.header ||
    event.detections?.[0]?.description ||
    `Route ${(event.routes || []).join(', ')} service observation`
  );
}
function mediaFile(url, webDir) {
  if (!/^\/data\/media\/[\w.-]+\.(jpg|jpeg|png|mp4)$/.test(url || '')) return null;
  const filename = path.join(webDir, url.slice(6));
  return fs.existsSync(filename) ? filename : null;
}
async function main(options = {}) {
  // This guard deliberately precedes all disk, credential and network work.
  if (!publishingEnabled()) return { disabled: true, posted: 0 };
  credentials();
  const now = options.now ?? Date.now(),
    stateDir = options.stateDir || process.env.TRANSIT_STATE_DIR,
    webDir = options.webDir || process.env.TRANSIT_WEB_DIR;
  const read = (name) => JSON.parse(fs.readFileSync(path.join(webDir, name), 'utf8'));
  const health = options.health || read('health.json');
  if (!fresh(health, now))
    throw new Error('Publishing deferred: required source feeds are incomplete or stale');
  const events = (options.events || read('alerts.json').incidents || []).filter(
    (e) => e.mode === 'bus',
  );
  let media = options.media;
  if (!media) {
    try {
      media = read('media/media-index.json');
    } catch {
      media = {};
    }
  }
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(stateDir, 'runtime-publisher.sqlite'));
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');
  schema(db);
  const agents = new Map(),
    adapter = options.adapter || bluesky;
  const login = async (account) => {
    if (!agents.has(account)) {
      const agent = await (options.agentGetter
        ? options.agentGetter(account)
        : account === 'BUS'
          ? bluesky.loginBus()
          : bluesky.loginAlerts());
      if (agent.session?.did !== process.env[`BLUESKY_${account}_DID`])
        throw new Error('Publisher account differs from pinned DID');
      agents.set(account, agent);
    }
    return agents.get(account);
  };
  function freezeMedia(file, eventId, part) {
    if (!file) return null;
    const id = crypto.createHash('sha256').update(`${eventId}:${part}`).digest('hex');
    const directory = path.join(stateDir, 'publisher-media');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const output = path.join(directory, id + path.extname(file));
    if (!fs.existsSync(output)) fs.copyFileSync(file, output);
    return output;
  }
  function enqueue(event, part, account, payload) {
    const existing = db
      .prepare('SELECT * FROM runtime_outbox WHERE event_id=? AND part=?')
      .get(event.id, part);
    if (existing) return;
    payload = {
      ...payload,
      event_id: event.id,
      account_did: process.env[`BLUESKY_${account}_DID`],
      facts: event,
      media: freezeMedia(payload.media, event.id, part),
    };
    db.prepare(
      'INSERT INTO runtime_outbox(event_id,part,account,route,payload,created_at) VALUES(?,?,?,?,?,?)',
    ).run(event.id, part, account, (event.routes || []).join(','), JSON.stringify(payload), now);
  }
  try {
    const initialized = db.prepare("SELECT value FROM publisher_meta WHERE key='enabled_at'").get();
    if (!initialized) {
      db.transaction(() => {
        db.prepare("INSERT INTO publisher_meta VALUES('enabled_at',?)").run(String(now));
        const insert = db.prepare('INSERT OR IGNORE INTO publisher_baseline VALUES(?)');
        for (const event of events) insert.run(event.id);
      })();
      return { baseline: true, posted: 0 };
    }
    let analyticsMedia = options.analyticsMedia,
      analytics = options.analytics;
    if (!analyticsMedia) {
      try {
        analyticsMedia = read('media/analytics-media.json');
      } catch {
        analyticsMedia = {};
      }
    }
    if (!analytics) {
      try {
        analytics = read('analytics.json');
      } catch {
        analytics = {};
      }
    }
    const enabledAt = Number(initialized.value),
      byId = new Map(events.map((e) => [e.id, e]));
    for (const event of events) {
      const root = db
        .prepare("SELECT * FROM runtime_outbox WHERE event_id=? AND part='root'")
        .get(event.id);
      const account = root?.account || accountFor(event);
      if (!root) {
        if (db.prepare('SELECT 1 FROM publisher_baseline WHERE event_id=?').get(event.id)) continue;
        if (
          (!event.lifecycle?.active && !cancellation(event)) ||
          event.lifecycle.first_seen_ts < enabledAt ||
          event.lifecycle.first_seen_ts < now - 900000
        )
          continue;
        const publicUrl = process.env.PUBLIC_URL || process.env.PUBLIC_BASE_URL;
        const link = publicUrl
          ? `\n${publicUrl.replace(/\/$/, '')}/event/${encodeURIComponent(event.id)}`
          : '';
        enqueue(event, 'root', account, {
          text: textLimit(describe(event), Math.max(0, 295 - [...link].length)) + link,
          alt: media[event.id]?.alt || describe(event),
          media: mediaFile(media[event.id]?.image_url, webDir),
          kind: mediaFile(media[event.id]?.image_url, webDir) ? 'image' : 'text',
        });
      }
    }
    const history = db
      .prepare("SELECT payload,created_at FROM runtime_outbox WHERE part='root' AND created_at>=?")
      .all(now - 86400000)
      .map((row) => {
        const facts = JSON.parse(row.payload).facts;
        return {
          kind: facts.analytics?.kind,
          routes: facts.routes || [],
          timestamp: row.created_at,
        };
      });
    for (const candidate of analyticsCandidates({
      media: analyticsMedia,
      analytics,
      enabledAt,
      now,
      history,
    })) {
      const image = mediaFile(candidate.image_url, webDir);
      if (candidate.image_url && !image) continue;
      enqueue(candidate, 'root', 'BUS', {
        text:
          candidate.analytics.kind === 'crowding-rollup'
            ? candidate.text
            : textLimit(candidate.text),
        alt: candidate.alt,
        kind: image ? 'image' : 'text',
        media: image,
      });
    }
    // Schedule replies independently after their root receipt is durably known.
    for (const root of db
      .prepare("SELECT * FROM runtime_outbox WHERE part='root' AND status='sent'")
      .all()) {
      const facts = JSON.parse(root.payload).facts;
      if (facts.analytics?.posts) {
        if (JSON.parse(root.payload).account_did !== process.env.BLUESKY_BUS_DID)
          throw new Error('Frozen rollup account DID differs from configured identity');
        for (let i = 1; i < facts.analytics.posts.length; i++) {
          const parent =
            i === 1
              ? root
              : db
                  .prepare('SELECT * FROM runtime_outbox WHERE event_id=? AND part=?')
                  .get(root.event_id, `rollup-${i - 1}`);
          if (parent?.status !== 'sent') break;
          enqueue(facts, `rollup-${i}`, 'BUS', {
            text: facts.analytics.posts[i].text,
            kind: 'text',
            reply: {
              root: { uri: root.uri, cid: root.cid },
              parent: { uri: parent.uri, cid: parent.cid },
            },
          });
        }
      }
      const event = byId.get(root.event_id);
      if (!event) continue;
      if (JSON.parse(root.payload).account_did !== process.env[`BLUESKY_${root.account}_DID`])
        throw new Error('Frozen root account DID differs from configured identity');
      const ref = {
        root: { uri: root.uri, cid: root.cid },
        parent: { uri: root.uri, cid: root.cid },
      };
      const video = mediaFile(media[event.id]?.video_url, webDir);
      if (video)
        enqueue(event, 'video', root.account, {
          text: 'Observed vehicle movement during this event.',
          alt: media[event.id]?.video_alt || 'Replay of recorded TARC vehicle positions.',
          media: video,
          kind: 'video',
          reply: ref,
        });
      if (event.lifecycle?.resolved_ts && !cancellation(event))
        enqueue(event, 'resolution', root.account, {
          text: textLimit(
            event.official_alert
              ? 'TARC no longer lists this alert as active.'
              : 'This service observation has ended in subsequent recorded snapshots.',
          ),
          kind: 'text',
          reply: ref,
        });
    }
    let posted = 0,
      attempted = 0;
    const errors = [];
    const rows = db
      .prepare(
        "SELECT * FROM runtime_outbox WHERE status='pending' ORDER BY CASE part WHEN 'root' THEN 0 WHEN 'video' THEN 1 ELSE 2 END,created_at,event_id",
      )
      .all();
    for (const row of rows) {
      if (attempted >= 3) break;
      if (row.part === 'root') {
        const prior = db
          .prepare(
            "SELECT route,COALESCE(sent_at,attempted_at,created_at) timestamp FROM runtime_outbox WHERE part='root' AND event_id!=? AND (status='sent' OR attempts>0) AND COALESCE(sent_at,attempted_at,created_at)>=?",
          )
          .all(row.event_id, now - 86400000);
        const routes = row.route.split(',');
        if (
          routes.some((route) => {
            const relevant = prior.filter((item) => item.route.split(',').includes(route));
            return relevant.length >= 3 || relevant.some((item) => item.timestamp > now - 3600000);
          })
        )
          continue;
      }
      const payload = JSON.parse(row.payload),
        key = {
          publisher: 'tarc-runtime-v1',
          account: row.account,
          event: row.event_id,
          part: row.part,
        };
      db.prepare(
        'UPDATE runtime_outbox SET attempts=attempts+1,attempted_at=COALESCE(attempted_at,?) WHERE event_id=? AND part=?',
      ).run(now, row.event_id, row.part);
      try {
        attempted++;
        if (process.env[`BLUESKY_${row.account}_DID`] !== payload.account_did)
          throw new Error('Frozen outbox account DID differs from configured identity');
        const agent = await login(row.account);
        if (agent.session.did !== payload.account_did)
          throw new Error('Frozen outbox account DID differs from configured identity');
        const result =
          payload.kind === 'image'
            ? await adapter.postWithImage(
                agent,
                payload.text,
                fs.readFileSync(payload.media),
                payload.alt,
                payload.reply || null,
                key,
              )
            : payload.kind === 'video'
              ? await adapter.postWithVideo(
                  agent,
                  payload.text,
                  fs.readFileSync(payload.media),
                  payload.alt,
                  payload.reply || null,
                  key,
                )
              : await adapter.postText(agent, payload.text, payload.reply || null, key);
        if (!result.uri || !result.cid) throw new Error('Publisher returned no durable receipt');
        db.prepare(
          "UPDATE runtime_outbox SET status='sent',uri=?,cid=?,sent_at=?,last_error=NULL WHERE event_id=? AND part=?",
        ).run(result.uri, result.cid, now, row.event_id, row.part);
        posted++;
        if (payload.media) fs.rmSync(payload.media, { force: true });
      } catch (error) {
        db.prepare('UPDATE runtime_outbox SET last_error=? WHERE event_id=? AND part=?').run(
          error.message,
          row.event_id,
          row.part,
        );
        errors.push(error.message);
      }
    }
    if (errors.length)
      throw new Error(`Publisher deferred ${errors.length} part(s): ${errors.join('; ')}`);
    return {
      posted,
      pending: db.prepare("SELECT COUNT(*) n FROM runtime_outbox WHERE status='pending'").get().n,
    };
  } finally {
    db.close();
  }
}
if (require.main === module)
  main()
    .then((result) => console.log('Publisher:', JSON.stringify(result)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { main, fresh, schema };
