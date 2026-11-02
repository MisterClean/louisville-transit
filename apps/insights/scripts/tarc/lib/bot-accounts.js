// Single source of truth for the three TARC Bluesky bot accounts, shared by
// the one-off profile/starter-pack/cross-follow/intro setup scripts under
// scripts/tarc/. Credentials come from .env (see .env.example); identity and
// copy live here so the scripts stay declarative.
//
//   bus    -> @tarcbusinsights    (bunching, gaps, ghost buses, speedmaps)
//   train  -> @tarctraininsights  (rail + Louisville Streetcar insights)
//   alerts -> @tarcalertinsights  (official alerts + bot-detected outages)

const ACCOUNTS = [
  {
    label: 'bus',
    kind: 'bus',
    handle: 'tarcbusinsights.louisvilletransitalerts.app',
    identifierEnv: 'BLUESKY_BUS_IDENTIFIER',
    passwordEnv: 'BLUESKY_BUS_APP_PASSWORD',
    avatar: 'avatar-bus.png',
    displayName: 'TARC Bus Insights',
    description: [
      '🚌 TARC bus transit, live.',
      'Bunching, long gaps, ghost buses + hourly speedmaps.',
      '',
      'louisvilletransitalerts.app',
      '',
      'Not affiliated with TARC.',
    ].join('\n'),
  },
  {
    label: 'train',
    kind: 'train',
    handle: 'tarctraininsights.louisvilletransitalerts.app',
    identifierEnv: 'BLUESKY_TRAIN_IDENTIFIER',
    passwordEnv: 'BLUESKY_TRAIN_APP_PASSWORD',
    avatar: 'avatar-train.png',
    displayName: 'TARC Train Insights',
    description: [
      '🚆 TARC rail + Louisville Streetcar, live.',
      'Bunching, long gaps, ghost trains, hourly speedmaps + system snapshots.',
      '',
      'louisvilletransitalerts.app',
      '',
      'Not affiliated with TARC.',
    ].join('\n'),
  },
  {
    label: 'alerts',
    kind: 'alerts',
    handle: 'tarcalertinsights.louisvilletransitalerts.app',
    identifierEnv: 'BLUESKY_ALERTS_IDENTIFIER',
    passwordEnv: 'BLUESKY_ALERTS_APP_PASSWORD',
    avatar: 'avatar-alerts.png',
    displayName: 'TARC Alert Insights',
    description: [
      'Major TARC disruptions — suspended segments, shuttles, delays. Auto-detected outages + TARC alerts.',
      '',
      'louisvilletransitalerts.app',
      '',
      'github.com/cailinpitt/louisville-transit-insights',
      '',
      'Not affiliated with TARC.',
    ].join('\n'),
  },
];

function credsFor(account) {
  return {
    identifier: process.env[account.identifierEnv],
    password: process.env[account.passwordEnv],
  };
}

// Resolve --kind=bus|train|alerts (or a positional kind) to the account subset.
function selectAccounts(kind) {
  if (!kind) return ACCOUNTS;
  const wanted = ACCOUNTS.filter((a) => a.label === kind || a.kind === kind);
  if (wanted.length === 0) {
    throw new Error(`Unknown account kind: ${kind} (expected bus|train|alerts)`);
  }
  return wanted;
}

module.exports = { ACCOUNTS, credsFor, selectAccounts };
