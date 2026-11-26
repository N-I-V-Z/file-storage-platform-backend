import type { Readable } from 'node:stream';
import { connect } from 'node:net';

export interface ScanRequest {
  host: string;
  port: number;
  source: Readable;
  timeoutMs: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export async function scanWithClamd(
  request: ScanRequest,
): Promise<'clean' | 'infected'> {
  const socket = connect({ host: request.host, port: request.port });
  socket.setNoDelay(true);
  let settled = false;
  let reply = Buffer.alloc(0);
  let resolveResult!: (value: 'clean' | 'infected') => void;
  let rejectResult!: (reason: Error) => void;
  const result = new Promise<'clean' | 'infected'>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    rejectResult(error);
  };
  const succeed = (value: 'clean' | 'infected') => {
    if (settled) return;
    settled = true;
    resolveResult(value);
  };
  const onAbort = () => fail(new Error('Malware scan interrupted'));
  request.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => fail(new Error('Malware scanner timed out')),
    request.timeoutMs,
  );
  timer.unref();

  socket.on('error', fail);
  socket.on('close', () => fail(new Error('Malware scanner disconnected')));
  socket.on('data', (chunk: Buffer) => {
    reply = Buffer.concat([reply, chunk]);
    if (reply.length > 4096) {
      fail(new Error('Malware scanner response too large'));
      return;
    }
    const end = reply.indexOf(0);
    if (end < 0) return;
    const verdict = reply.subarray(0, end).toString('utf8');
    if (verdict === 'stream: OK') succeed('clean');
    else if (/^stream: .+ FOUND$/.test(verdict)) succeed('infected');
    else fail(new Error('Malware scanner returned an invalid verdict'));
  });

  const write = (bytes: Buffer) =>
    new Promise<void>((resolve, reject) => {
      socket.write(bytes, (error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  socket.once('connect', () => {
    void (async () => {
      await write(Buffer.from('zINSTREAM\0'));
      let total = 0;
      for await (const value of request.source) {
        const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
        for (let offset = 0; offset < data.length; offset += 64 * 1024) {
          const chunk = data.subarray(offset, offset + 64 * 1024);
          total += chunk.length;
          if (total > (request.maxBytes ?? Number.MAX_SAFE_INTEGER)) {
            throw new Error('Malware scan input exceeds configured size');
          }
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          await write(length);
          await write(chunk);
        }
      }
      await write(Buffer.alloc(4));
    })().catch(fail);
  });

  if (request.signal?.aborted) onAbort();
  try {
    return await result;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
    request.source.destroy();
    socket.destroy();
  }
}
