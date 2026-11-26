import { describe, expect, it } from 'vitest';
import { parseByteRange } from './byte-range.js';

describe('parseByteRange', () => {
  it('supports closed, open-ended, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 });
    expect(parseByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange('bytes=-99', 10)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=8-99', 10)).toEqual({ start: 8, end: 9 });
  });

  it('rejects invalid, multi, and unsatisfiable ranges', () => {
    for (const value of [
      'bytes=10-',
      'bytes=3-2',
      'bytes=-0',
      'bytes=0-1,3-4',
      'items=0-1',
      'bytes=abc',
      'bytes=0-1',
    ]) {
      expect(() =>
        parseByteRange(value, value === 'bytes=0-1' ? 0 : 10),
      ).toThrow();
    }
  });
});
