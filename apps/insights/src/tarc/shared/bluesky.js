// Bluesky posting for the TARC bots. Ported from cta-insights
// src/shared/bluesky.js + the per-account login wrappers (src/bus/bluesky.js
// etc.). Dropped for this slice: web-push triggers and the transitchicago.com
// link facet (image posts carry no links — facet support returns with the
// alerts poster), plus the video upload path (video is deferred).
//
// Accounts (decided 2026-06-14): THREE distinct Bluesky accounts — BUS (bus
// insights), TRAIN (rail insights), and ALERTS (official alerts + bot-detected
// issues) — each with its own identifier/app-password pair. This keeps bus and
// rail insight code parallel and matches the CTA reference's three-account
// split.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AtpAgent } = require('@atproto/api');
const { requirePublishing, publishRecord, digest } = require('./delivery');
const { boundedFetch } = require('./boundedFetch');

// Persist session JWTs to disk and resume on subsequent runs so each cron tick
// doesn't call agent.login() fresh (Bluesky caps createSession ~300/day +
// 30/5min). login() is only hit on first use or after a refresh-token expiry.
const SESSION_DIR =
  process.env.BLUESKY_SESSION_DIR ||
  path.join(
    process.env.TRANSIT_STATE_DIR || path.resolve(__dirname, '../../..', 'state'),
    'bluesky-sessions',
  );

function sessionPath(identifier) {
  const key = crypto.createHash('sha1').update(identifier).digest('hex').slice(0, 16);
  return path.join(SESSION_DIR, `${key}.json`);
}

function loadSession(identifier) {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(identifier), 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveSession(identifier, session) {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const temporary = `${sessionPath(identifier)}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(session), { mode: 0o600 });
    fs.renameSync(temporary, sessionPath(identifier));
  } catch (e) {
    console.warn(`bluesky: failed to persist session: ${e.message}`);
  }
}

function clearSession(identifier) {
  try {
    fs.unlinkSync(sessionPath(identifier));
  } catch (_) {}
}

async function login(identifier, password) {
  requirePublishing();
  if (!identifier || !password) throw new Error('Bluesky account credentials are not configured');
  const persistSession = (evt, session) => {
    if (evt === 'create' || evt === 'update') {
      if (session) saveSession(identifier, session);
    } else if (evt === 'expired') {
      clearSession(identifier);
    }
  };
  const agent = new AtpAgent({
    service: process.env.BLUESKY_SERVICE || 'https://bsky.social',
    persistSession,
    fetch: boundedFetch,
  });
  const cached = loadSession(identifier);
  if (cached) {
    try {
      await agent.resumeSession(cached);
      if (agent.session?.accessJwt) return agent;
    } catch (_) {
      clearSession(identifier);
    }
  }
  await agent.login({ identifier, password });
  return agent;
}

async function loginAccount(kind) {
  const expected = process.env[`BLUESKY_${kind}_DID`];
  if (!expected) throw new Error(`BLUESKY_${kind}_DID must be pinned before publishing`);
  const agent = await login(
    process.env[`BLUESKY_${kind}_IDENTIFIER`],
    process.env[`BLUESKY_${kind}_APP_PASSWORD`],
  );
  if (agent.session.did !== expected)
    throw new Error('Bluesky account identity differs from configured DID');
  return agent;
}

function loginBus() {
  return loginAccount('BUS');
}

function loginAlerts() {
  return loginAccount('ALERTS');
}

function postUrl(result) {
  const rkey = result.uri.split('/').pop();
  const did = result.uri.split('/')[2];
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

// Build Bluesky richtext link facets. Two link shapes appear in our posts:
//   - full archive URLs, e.g. https://louisvilletransitalerts.app/event/123
//   - the bare TARC domain "itstarc.com" in alert/cancellation provenance
//     lines ("Check itstarc.com for updates."), which has no scheme — we point
//     its facet at https://itstarc.com so it's still tappable.
// Facet byte offsets are over UTF-8, and emoji in the post (🚆⚠️) make byte and
// char positions diverge, so every offset is computed with Buffer.byteLength.
const FACET_PATTERNS = [
  { re: /https?:\/\/[^\s)]+/g, uri: (m) => m },
  { re: /\bride?tarc\.org(?:\/[^\s)]*)?/g, uri: (m) => `https://${m}` },
];

function linkFacets(text) {
  const enc = (s) => Buffer.byteLength(s, 'utf8');
  const matches = [];
  for (const { re, uri } of FACET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = m.index + m[0].length;
      // Skip a match that overlaps one already claimed (e.g. a bare domain
      // sitting inside a full URL) so facet ranges never collide.
      if (matches.some((x) => start < x.end && end > x.start)) continue;
      matches.push({ start, end, uri: uri(m[0]) });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const facets = matches.map(({ start, end, uri }) => ({
    index: { byteStart: enc(text.slice(0, start)), byteEnd: enc(text.slice(0, end)) },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
  }));
  return facets.length > 0 ? facets : undefined;
}

async function postWithImage(
  agent,
  text,
  imageBuffer,
  altText,
  replyRef = null,
  deliveryKey = null,
) {
  const result = await publishRecord(
    agent,
    deliveryKey || { text, image: digest(imageBuffer), replyRef },
    async () => {
      if (imageBuffer.length > 2_000_000) throw new Error('Bluesky image exceeds 2 MB');
      const upload = await agent.uploadBlob(imageBuffer, { encoding: 'image/jpeg' });
      const facets = linkFacets(text);
      return {
        text,
        ...(replyRef && { reply: replyRef }),
        ...(facets && { facets }),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ image: upload.data.blob, alt: altText }],
        },
      };
    },
  );
  return { url: postUrl(result), uri: result.uri, cid: result.cid };
}

const VIDEO_SERVICE = 'https://video.bsky.app';
const MAX_POLL_ATTEMPTS = 150; // 5 min @ 2s intervals

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postWithVideo(
  agent,
  text,
  videoBuffer,
  altText,
  replyRef = null,
  deliveryKey = null,
) {
  const result = await publishRecord(
    agent,
    deliveryKey || { text, video: digest(videoBuffer), replyRef },
    async () => {
      const { data: serviceAuth } = await agent.com.atproto.server.getServiceAuth({
        aud: `did:web:${agent.dispatchUrl.host}`,
        lxm: 'com.atproto.repo.uploadBlob',
        exp: Math.floor(Date.now() / 1000) + 60 * 30,
      });
      const token = serviceAuth.token;

      const uploadUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`);
      uploadUrl.searchParams.append('did', agent.session.did);
      uploadUrl.searchParams.append('name', 'tarc-insights.mp4');

      let uploadResponse;
      for (let attempt = 1; attempt <= 3; attempt++) {
        uploadResponse = await boundedFetch(uploadUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'video/mp4',
            'Content-Length': videoBuffer.length.toString(),
          },
          body: videoBuffer,
        });
        if (uploadResponse.ok) break;
        const errBody = await uploadResponse.json().catch(() => ({}));
        if (attempt >= 3)
          throw new Error(`Video upload failed after 3 attempts: ${JSON.stringify(errBody)}`);
        await sleep(1000 * attempt);
      }

      const jobStatus = await uploadResponse.json();
      let blob = jobStatus.blob;
      const videoServiceAgent = new AtpAgent({ service: VIDEO_SERVICE, fetch: boundedFetch });
      let lastLogged = null;
      let polls = 0;

      while (!blob) {
        if (++polls > MAX_POLL_ATTEMPTS) throw new Error('Video processing timed out');
        await sleep(2000);
        const { data: status } = await videoServiceAgent.app.bsky.video.getJobStatus({
          jobId: jobStatus.jobId,
        });
        const state = status.jobStatus.state;
        const progress = status.jobStatus.progress;
        const label = progress ? `${state}: ${progress}%` : state;
        if (label !== lastLogged) {
          console.log(`video processing: ${label}`);
          lastLogged = label;
        }
        if (status.jobStatus.blob) blob = status.jobStatus.blob;
        else if (state === 'JOB_STATE_FAILED')
          throw new Error(`Video processing failed: ${status.jobStatus.error || 'unknown'}`);
      }

      const facets = linkFacets(text);
      return {
        text,
        ...(replyRef && { reply: replyRef }),
        ...(facets && { facets }),
        embed: {
          $type: 'app.bsky.embed.video',
          video: blob,
          alt: altText,
        },
      };
    },
  );
  return { url: postUrl(result), uri: result.uri, cid: result.cid };
}

async function postText(agent, text, replyRef = null, deliveryKey = null) {
  const facets = linkFacets(text);
  const result = await publishRecord(agent, deliveryKey || { text, replyRef }, async () => ({
    text,
    ...(replyRef && { reply: replyRef }),
    ...(facets && { facets }),
  }));
  return { url: postUrl(result), uri: result.uri, cid: result.cid };
}

async function postWithExternal(agent, text, link, replyRef = null) {
  const result = await publishRecord(agent, { text, link, replyRef }, async () => {
    let thumb;
    for (const thumbUrl of [link?.thumbUrl, link?.fallbackThumbUrl].filter(Boolean)) {
      try {
        const resp = await boundedFetch(thumbUrl, {}, { maxBytes: 2_000_000 });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const ct = resp.headers.get('content-type') || 'image/png';
          const upload = await agent.uploadBlob(buf, { encoding: ct });
          thumb = upload.data.blob;
          break;
        }
      } catch (_) {}
    }
    const facets = linkFacets(text);
    return {
      text,
      ...(replyRef && { reply: replyRef }),
      ...(facets && { facets }),
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: link.url,
          title: link.title,
          description: link.description,
          ...(thumb && { thumb }),
        },
      },
    };
  });
  return { url: postUrl(result), uri: result.uri, cid: result.cid };
}

// Quote-post (`app.bsky.embed.record`): `text` with the quoted post embedded as
// a card, optionally threaded under `replyRef`. The alerts account uses this to
// attach "🕵 Related observation" detector posts into an alert/roundup thread.
// Ported from cta-insights src/shared/bluesky.js postQuote.
async function postQuote(agent, text, quoted, replyRef = null) {
  const facets = linkFacets(text);
  const result = await publishRecord(agent, { text, quoted, replyRef }, async () => ({
    text,
    ...(replyRef && { reply: replyRef }),
    ...(facets && { facets }),
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: quoted.uri, cid: quoted.cid },
    },
  }));
  return { url: postUrl(result), uri: result.uri, cid: result.cid };
}

// Fetch a post's record (its cid + value) from an at:// URI. Null if the URI is
// malformed or the record is gone (deleted/expired). Ported from cta-insights.
async function getPostRecord(agent, uri) {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri);
  if (!m) return null;
  const [, repo, collection, rkey] = m;
  try {
    const { data } = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
    return { uri, cid: data.cid, value: data.value };
  } catch (_) {
    return null;
  }
}

// Delete a post by its at:// URI (the agent must be logged in as the repo that
// owns it). Returns true on delete, false if the URI is malformed or the record
// is already gone. Used by maintenance cleanups that retract mis-posted alerts.
async function deletePost(agent, uri) {
  requirePublishing();
  const m = /^at:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri || '');
  if (!m) return false;
  const [, repo, collection, rkey] = m;
  try {
    await agent.com.atproto.repo.deleteRecord({ repo, collection, rkey });
    return true;
  } catch (_e) {
    return false;
  }
}

// Build a {root, parent} reply ref for threading a reply onto an EXISTING post
// (from a prior cron run) — unlike the same-run self-threading the insight bins
// do with a just-posted {uri, cid}. Inherits the thread root from the parent's
// own reply.root so every reply lands in one thread, and walks the thread to the
// newest leaf so sequential replies chain rather than fan out. Null if the
// parent post can't be fetched. Ported from cta-insights resolveReplyRef.
async function resolveReplyRef(agent, parentUri) {
  const record = await getPostRecord(agent, parentUri);
  if (!record) return null;
  const root = record.value?.reply?.root || { uri: record.uri, cid: record.cid };
  let parent = { uri: record.uri, cid: record.cid };
  if (typeof agent.getPostThread === 'function') {
    try {
      const resp = await agent.getPostThread({ uri: parentUri, depth: 100 });
      const top = resp?.data?.thread;
      if (top?.post) {
        let bestLeaf = top.post;
        let bestTs = Date.parse(top.post.indexedAt || '') || 0;
        const visit = (node) => {
          if (!node?.post) return;
          const replies = node.replies || [];
          if (replies.length === 0) {
            const t = Date.parse(node.post.indexedAt || '') || 0;
            if (t >= bestTs) {
              bestTs = t;
              bestLeaf = node.post;
            }
            return;
          }
          for (const r of replies) visit(r);
        };
        visit(top);
        parent = { uri: bestLeaf.uri, cid: bestLeaf.cid };
      }
    } catch (_e) {
      // Fall through to the original-post parent — better to land as a sibling
      // than to fail the resolution post entirely.
    }
  }
  return { root, parent };
}

module.exports = {
  login,
  loginBus,
  loginAlerts,
  postWithImage,
  postWithVideo,
  postText,
  postWithExternal,
  postQuote,
  getPostRecord,
  resolveReplyRef,
  deletePost,
  linkFacets,
};
