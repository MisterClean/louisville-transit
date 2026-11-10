const Fs = require('fs-extra');
const Os = require('node:os');
const Path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileP = promisify(execFile);

async function encodeFrames(
  frames,
  { prefix = 'tarc-video', framerate = 16, holdSeconds = 1 } = {},
) {
  if (!frames) return null;
  const tmpDir = await Fs.mkdtemp(Path.join(Os.tmpdir(), `${prefix}-`));
  try {
    const count = await stageFrames(frames, tmpDir);
    if (count < 2) return null;
    const holdFrames = Math.max(0, Math.round(framerate * holdSeconds));
    const lastIdx = count - 1;
    const lastPath = Path.join(tmpDir, `frame_${String(lastIdx).padStart(3, '0')}.jpg`);
    for (let k = 1; k <= holdFrames; k++) {
      await Fs.copyFile(
        lastPath,
        Path.join(tmpDir, `frame_${String(lastIdx + k).padStart(3, '0')}.jpg`),
      );
    }

    const outPath = Path.join(tmpDir, 'out.mp4');
    await execFileP(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-framerate',
        String(framerate),
        '-i',
        Path.join(tmpDir, 'frame_%03d.jpg'),
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-preset',
        'fast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outPath,
      ],
      { timeout: 60_000 },
    );
    return await Fs.readFile(outPath);
  } finally {
    await Fs.remove(tmpDir).catch(() => {});
  }
}

async function stageFrames(frames, directory) {
  let count = 0;
  let bytes = 0;
  for await (const frame of frames) {
    if (!Buffer.isBuffer(frame)) throw new Error('Video frame must be a Buffer');
    bytes += frame.length;
    if (count >= 600 || bytes > 128 * 1024 * 1024) throw new Error('Video frame budget exceeded');
    await Fs.writeFile(Path.join(directory, `frame_${String(count).padStart(3, '0')}.jpg`), frame);
    count++;
  }
  return count;
}
module.exports = { encodeFrames, stageFrames };
