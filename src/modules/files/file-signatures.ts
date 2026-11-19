const signatures: Record<string, (bytes: Buffer) => boolean> = {
  'image/png': (bytes) =>
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (bytes) =>
    bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
  'image/webp': (bytes) =>
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP',
  'application/pdf': (bytes) => bytes.toString('ascii', 0, 5) === '%PDF-',
  'video/mp4': (bytes) => bytes.toString('ascii', 4, 8) === 'ftyp',
  'application/zip': (bytes) =>
    bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')),
};

export function supportsMimeType(mimeType: string): boolean {
  return Object.hasOwn(signatures, mimeType);
}

export function matchesSignature(mimeType: string, prefix: Buffer): boolean {
  return signatures[mimeType]?.(prefix) ?? false;
}
