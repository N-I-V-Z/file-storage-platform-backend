export interface ByteRange {
  start: number;
  end: number;
}

export function parseByteRange(value: string, size: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) {
    throw new RangeError('Invalid byte range');
  }
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (
    (start !== undefined && !Number.isSafeInteger(start)) ||
    (end !== undefined && !Number.isSafeInteger(end))
  ) {
    throw new RangeError('Invalid byte range');
  }
  if (start === undefined) {
    if (end === undefined || end === 0)
      throw new RangeError('Invalid byte range');
    return { start: Math.max(0, size - end), end: size - 1 };
  }
  if (start >= size || (end !== undefined && end < start)) {
    throw new RangeError('Unsatisfiable byte range');
  }
  return { start, end: Math.min(end ?? size - 1, size - 1) };
}
