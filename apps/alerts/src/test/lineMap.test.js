import { describe, expect, it } from 'vitest';
import { buildLineMap } from '../lib/lineMap.js';

describe('legacy rail schematic maps', () => {
  it('returns no fabricated rail schematic for TARC buses or an obsolete rail link', () => {
    expect(buildLineMap('01')).toBeNull();
    expect(buildLineMap('gold', null, { preferPortrait: true })).toBeNull();
  });
});
