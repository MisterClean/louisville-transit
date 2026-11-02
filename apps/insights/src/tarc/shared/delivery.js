// Durable Bluesky receipts. Frozen records and valid TIDs survive uncertain
// network outcomes; retries reconcile with the authenticated PDS first.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function publishingEnabled() {
  return process.env.TRANSIT_PUBLISH_ENABLED === 'true';
}

function requirePublishing() {
  if (!publishingEnabled()) throw new Error('Bluesky publishing is disabled');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(canonical(value)),
    )
    .digest('hex');
}

const CLOCK = crypto.randomInt(1024);
let lastMicros = 0n;
function nextTid() {
  const micros = BigInt(Date.now()) * 1000n;
  lastMicros = micros > lastMicros ? micros : lastMicros + 1n;
  let value = (lastMicros << 10n) | BigInt(CLOCK);
  const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 13; i++) {
    result = alphabet[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

function openDeliveries() {
  const directory = process.env.TRANSIT_STATE_DIR || path.resolve(__dirname, '../../..', 'state');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(directory, 'deliveries.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries (
    account TEXT NOT NULL, intent TEXT NOT NULL, rkey TEXT NOT NULL,
    payload TEXT, status TEXT NOT NULL DEFAULT 'preparing', lease_until INTEGER NOT NULL DEFAULT 0,
    uri TEXT, cid TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY(account,intent), UNIQUE(account,rkey)
  )`);
  return db;
}

async function readRemote(agent, row) {
  try {
    const { data } = await agent.com.atproto.repo.getRecord({
      repo: row.account,
      collection: 'app.bsky.feed.post',
      rkey: row.rkey,
    });
    if (
      JSON.stringify(canonical(data.value)) !== JSON.stringify(canonical(JSON.parse(row.payload)))
    ) {
      throw new Error(
        'Bluesky record differs from frozen delivery; manual reconciliation required',
      );
    }
    return { uri: data.uri, cid: data.cid };
  } catch (error) {
    if (error.error === 'RecordNotFound' || error.status === 404) return null;
    throw error;
  }
}

async function publishRecord(agent, intent, prepare, { db: providedDb } = {}) {
  requirePublishing();
  const account = agent.session?.did;
  if (!account) throw new Error('Publishing requires an authenticated account DID');
  const db = providedDb || openDeliveries();
  const key = digest(intent);
  const read = () =>
    db.prepare('SELECT * FROM deliveries WHERE account=? AND intent=?').get(account, key);
  let ownsLease = false;
  try {
    let row = read();
    if (row?.status === 'sent') return { uri: row.uri, cid: row.cid };
    const now = Date.now();
    const claimed = db.transaction(() => {
      let current = read();
      if (!current) {
        db.prepare('INSERT INTO deliveries(account,intent,rkey,created_at) VALUES (?,?,?,?)').run(
          account,
          key,
          nextTid(),
          now,
        );
        current = read();
      }
      if (current.lease_until > now) return false;
      db.prepare('UPDATE deliveries SET lease_until=? WHERE account=? AND intent=?').run(
        now + 10 * 60_000,
        account,
        key,
      );
      return true;
    })();
    if (!claimed) throw new Error('Delivery is already being prepared by another worker');
    ownsLease = true;
    row = read();
    if (!row.payload) {
      const record = {
        $type: 'app.bsky.feed.post',
        ...(await prepare()),
        createdAt: new Date(row.created_at).toISOString(),
      };
      const count = [
        ...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(record.text || ''),
      ].length;
      if (count > 300 || Buffer.byteLength(record.text || '', 'utf8') > 3000)
        throw new Error('Bluesky post exceeds text limits');
      db.prepare(
        "UPDATE deliveries SET payload=?,status='prepared' WHERE account=? AND intent=?",
      ).run(JSON.stringify(record), account, key);
      row = read();
    }
    // Includes the crash-after-write case. A failed read is never treated as absence.
    let receipt = await readRemote(agent, row);
    if (!receipt) {
      db.prepare("UPDATE deliveries SET status='uncertain' WHERE account=? AND intent=?").run(
        account,
        key,
      );
      try {
        const { data } = await agent.com.atproto.repo.putRecord({
          repo: account,
          collection: 'app.bsky.feed.post',
          rkey: row.rkey,
          record: JSON.parse(row.payload),
          swapRecord: null,
          validate: true,
        });
        receipt = { uri: data.uri, cid: data.cid };
      } catch (error) {
        receipt = await readRemote(agent, row);
        if (!receipt) throw error;
      }
    }
    db.prepare(
      "UPDATE deliveries SET status='sent',uri=?,cid=?,lease_until=0 WHERE account=? AND intent=?",
    ).run(receipt.uri, receipt.cid, account, key);
    return receipt;
  } finally {
    if (ownsLease)
      db.prepare('UPDATE deliveries SET lease_until=0 WHERE account=? AND intent=?').run(
        account,
        key,
      );
    if (!providedDb) db.close();
  }
}

function savePreview({ text, alt, image, key }) {
  const directory = path.join(
    process.env.TRANSIT_STATE_DIR || path.resolve(__dirname, '../../..', 'state'),
    'previews',
  );
  fs.mkdirSync(directory, { recursive: true });
  const id = digest(key || text).slice(0, 24);
  const imageFile = image ? `${id}.jpg` : null;
  if (image) fs.writeFileSync(path.join(directory, imageFile), image);
  fs.writeFileSync(
    path.join(directory, `${id}.json`),
    JSON.stringify(
      {
        text,
        alt: alt || null,
        image: imageFile,
        prepared_at: new Date().toISOString(),
        published: false,
      },
      null,
      2,
    ),
  );
  // Keep bounded local previews while durable source incidents remain in SQLite.
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(200)) {
    fs.rmSync(path.join(directory, file.name), { force: true });
    fs.rmSync(path.join(directory, file.name.replace(/\.json$/, '.jpg')), { force: true });
  }
  return id;
}

module.exports = {
  publishingEnabled,
  requirePublishing,
  digest,
  nextTid,
  openDeliveries,
  publishRecord,
  savePreview,
};
