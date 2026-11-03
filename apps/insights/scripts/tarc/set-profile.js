#!/usr/bin/env node
// Sets displayName, description, and avatar for the Louisville Bluesky account
// from lib/bot-accounts.js and the tracked avatar in branding/. Idempotent:
// upsertProfile reads the current record and merges, so re-running only changes
// the three fields we manage. Regenerate the PNG from the tracked SVG as needed.
//
// Usage:
//   node scripts/tarc/set-profile.js [--kind=alerts] [--dry-run]
//   node scripts/tarc/set-profile.js --no-avatar   # text fields only

require('dotenv').config({
  path: require('node:path').join(__dirname, '..', '..', '.env'),
});

const fs = require('node:fs');
const path = require('node:path');
const argv = require('minimist')(process.argv.slice(2), {
  boolean: ['dry-run', 'no-avatar'],
});
const { login } = require('../../src/tarc/shared/bluesky');
const { credsFor, selectAccounts } = require('./lib/bot-accounts');

const ASSET_DIR = path.join(__dirname, '..', '..', 'assets', 'tarc');

async function applyOne(account) {
  const { identifier, password } = credsFor(account);
  if (!identifier || !password) {
    console.warn(`[${account.label}] no credentials in env, skipping`);
    return;
  }

  let avatarBuf = null;
  if (!argv['no-avatar']) {
    const avatarPath = account.avatarSource
      ? path.resolve(__dirname, '../../../../', account.avatarSource)
      : path.join(ASSET_DIR, account.avatar);
    if (!fs.existsSync(avatarPath)) {
      throw new Error(
        `[${account.label}] missing ${avatarPath} — generate the profile image first`,
      );
    }
    avatarBuf = fs.readFileSync(avatarPath);
  }

  console.log(`\n[${account.label}] ${account.handle}`);
  console.log(`  displayName: ${account.displayName}`);
  console.log(`  description:\n    ${account.description.replace(/\n/g, '\n    ')}`);
  console.log(`  avatar: ${argv['no-avatar'] ? '(unchanged)' : account.avatarSource || account.avatar}`);

  if (argv['dry-run']) {
    console.log('  [dry-run] not writing profile');
    return;
  }

  const agent = await login(identifier, password);

  let avatarBlob;
  if (avatarBuf) {
    const upload = await agent.uploadBlob(avatarBuf, { encoding: 'image/png' });
    avatarBlob = upload.data.blob;
  }

  await agent.upsertProfile((existing) => ({
    ...existing,
    displayName: account.displayName,
    description: account.description,
    ...(avatarBlob ? { avatar: avatarBlob } : {}),
  }));

  console.log('  ✓ profile updated');
}

async function main() {
  const accounts = selectAccounts(argv.kind);
  for (const account of accounts) {
    try {
      await applyOne(account);
    } catch (e) {
      console.error(`[${account.label}] failed: ${e.stack || e.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
