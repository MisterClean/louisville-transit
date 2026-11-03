#!/usr/bin/env node
// Rasterize the tracked SVG master for Bluesky's PNG profile-image upload.
const path = require('node:path');
const sharp = require('sharp');

const svg = path.resolve(__dirname, '../../../../branding/bluesky-bus-avatar.svg');
const png = path.resolve(__dirname, '../../../../branding/bluesky-bus-avatar.png');

sharp(svg)
  .resize(1024, 1024)
  .png({ compressionLevel: 9 })
  .toFile(png)
  .then((info) => {
    if (info.size >= 1_000_000) {
      throw new Error(`Avatar is too large for Bluesky: ${info.size} bytes`);
    }
    console.log(`Wrote ${png} (${info.size} bytes)`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
