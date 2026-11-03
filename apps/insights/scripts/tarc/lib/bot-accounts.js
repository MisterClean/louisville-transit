// Current Bluesky identity for one-off profile and intro setup scripts.
// The runtime publisher routes official alerts and observed bus events through
// this one account. Credentials stay in deployment variables, never in source.

const ACCOUNTS = [
  {
    label: 'alerts',
    kind: 'alerts',
    handle: 'tarctransitalerts.app',
    identifierEnv: 'BLUESKY_ALERTS_IDENTIFIER',
    passwordEnv: 'BLUESKY_ALERTS_APP_PASSWORD',
    avatarSource: 'branding/bluesky-bus-avatar.png',
    displayName: 'Louisville Transit Alerts',
    description: 'Independent, automated TARC alerts and bus observations for Louisville. Based on public TARC feeds; not affiliated with TARC.',
  },
];

function credsFor(account) {
  return {
    identifier: process.env[account.identifierEnv],
    password: process.env[account.passwordEnv],
  };
}

// Resolve --kind=alerts (or a positional kind) to the account subset.
function selectAccounts(kind) {
  if (!kind) return ACCOUNTS;
  const wanted = ACCOUNTS.filter((a) => a.label === kind || a.kind === kind);
  if (wanted.length === 0) {
    throw new Error(`Unknown account kind: ${kind} (expected alerts)`);
  }
  return wanted;
}

module.exports = { ACCOUNTS, credsFor, selectAccounts };
