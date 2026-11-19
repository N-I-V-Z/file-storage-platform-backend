import { createHash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

export class FileInspector extends Transform {
  private readonly hash = createHash('sha256');
  private prefix = Buffer.alloc(0);
  sizeBytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.sizeBytes += chunk.length;
    if (this.sizeBytes > this.maxBytes) {
      callback(new Error('File size limit exceeded'));
      return;
    }
    this.hash.update(chunk);
    if (this.prefix.length < 16) {
      this.prefix = Buffer.concat([
        this.prefix,
        chunk.subarray(0, 16 - this.prefix.length),
      ]);
    }
    callback(null, chunk);
  }

  result() {
    return {
      sizeBytes: this.sizeBytes,
      sha256: this.hash.digest('hex'),
      prefix: this.prefix,
    };
  }
}
