const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { stageFrames } = require('../../src/tarc/shared/video');
test('video staging drains each lazy frame before requesting another', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarc-lazy-video-'));
  async function* frames() {
    yield Buffer.from('first');
    assert.equal(await fs.readFile(path.join(dir, 'frame_000.jpg'), 'utf8'), 'first');
    yield Buffer.from('second');
  }
  try {
    assert.equal(await stageFrames(frames(), dir), 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('video staging rejects an unbounded producer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tarc-video-budget-'));
  async function* frames() {
    while (true) yield Buffer.from('frame');
  }
  try {
    await assert.rejects(stageFrames(frames(), dir), /budget exceeded/);
    assert.equal((await fs.readdir(dir)).length, 600);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
