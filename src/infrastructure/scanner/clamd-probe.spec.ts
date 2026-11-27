import { createServer } from 'node:net';
import { once } from 'node:events';
import { pingClamd } from './clamd-probe.js';

async function withDaemon(
  reply: string,
  test: (port: number) => Promise<void>,
) {
  const server = createServer((socket) => {
    socket.once('data', (request) => {
      expect(request.toString()).toBe('zPING\0');
      socket.end(reply);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP port');
    await test(address.port);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('clamd readiness probe', () => {
  it('accepts only a bounded PONG reply', async () => {
    await withDaemon('PONG\0', async (port) => {
      await expect(pingClamd('127.0.0.1', port)).resolves.toBeUndefined();
    });
    await withDaemon('ERROR\0', async (port) => {
      await expect(pingClamd('127.0.0.1', port)).rejects.toThrow('rejected');
    });
  });
});
