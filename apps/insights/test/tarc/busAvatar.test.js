const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildBusAvatarSvg, DEFAULT_OUT } = require('../../scripts/tarc/draw-bus-avatar');

// "502" in the 5x7 sign font lights 17 + 16 + 14 dots.
const LIT_DOTS_502 = 47;

test('committed avatar SVG matches the generator output', () => {
  assert.equal(
    fs.readFileSync(DEFAULT_OUT, 'utf8'),
    buildBusAvatarSvg(),
    'Regenerate with: node apps/insights/scripts/tarc/draw-bus-avatar.js',
  );
});

test('destination sign lights exactly the dots for 502', () => {
  const svg = buildBusAvatarSvg();
  assert.equal(svg.match(/fill="url\(#led\)"/g).length, LIT_DOTS_502);
});

test('avatar uses no text elements, so no wordmark or host fonts', () => {
  assert.doesNotMatch(buildBusAvatarSvg(), /<text\b/);
  assert.doesNotMatch(buildBusAvatarSvg({ alertBadge: true }), /<text\b/);
});

test('alert badge is opt-in', () => {
  assert.doesNotMatch(buildBusAvatarSvg(), /alert badge/);
  assert.match(buildBusAvatarSvg({ alertBadge: true }), /<!-- alert badge -->/);
});
