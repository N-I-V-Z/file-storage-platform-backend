import { createServer, type Server, type Socket } from 'node:net';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { scanWithClamd } from './clamd-client.js';

const servers: Server[] = [];
const sockets = new Set<Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function daemon(
  respond: (request: Buffer, socket: import('node:net').Socket) => void,
) {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let request = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      request = Buffer.concat([request, chunk]);
      respond(request, socket);
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

function complete(request: Buffer) {
  return request.subarray(-4).equals(Buffer.alloc(4));
}

it('streams INSTREAM chunks and accepts only an explicit clean reply', async () => {
  let received: Buffer = Buffer.alloc(0);
  const port = await daemon((request, socket) => {
    if (!complete(request)) return;
    received = request;
    socket.end('stream: OK\0');
  });
  await expect(
    scanWithClamd({
      host: '127.0.0.1',
      port,
      source: Readable.from([Buffer.from('abc'), Buffer.from('def')]),
      timeoutMs: 2000,
    }),
  ).resolves.toBe('clean');
  expect(received.subarray(0, 10).toString()).toBe('zINSTREAM\0');
  expect(received.readUInt32BE(10)).toBe(3);
  expect(received.subarray(14, 17).toString()).toBe('abc');
  expect(received.readUInt32BE(17)).toBe(3);
  expect(received.subarray(21, 24).toString()).toBe('def');
});

it('returns infected only for a FOUND verdict', async () => {
  const port = await daemon((request, socket) => {
    if (complete(request)) socket.end('stream: Eicar-Test-Signature FOUND\0');
  });
  await expect(
    scanWithClamd({
      host: '127.0.0.1',
      port,
      source: Readable.from([Buffer.from('malware')]),
      timeoutMs: 2000,
    }),
  ).resolves.toBe('infected');
});

it.each(['stream: INSTREAM size limit exceeded ERROR\0', 'garbage\0'])(
  'rejects scanner failure response %s',
  async (reply) => {
    const port = await daemon((request, socket) => {
      if (complete(request)) socket.end(reply);
    });
    await expect(
      scanWithClamd({
        host: '127.0.0.1',
        port,
        source: Readable.from([Buffer.from('data')]),
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
  },
);

it('rejects a disconnected daemon without a verdict', async () => {
  const port = await daemon((request, socket) => {
    if (complete(request)) socket.end();
  });
  await expect(
    scanWithClamd({
      host: '127.0.0.1',
      port,
      source: Readable.from([Buffer.from('data')]),
      timeoutMs: 2000,
    }),
  ).rejects.toThrow();
});

it('times out when the daemon does not respond', async () => {
  const port = await daemon(() => undefined);
  await expect(
    scanWithClamd({
      host: '127.0.0.1',
      port,
      source: Readable.from([Buffer.from('data')]),
      timeoutMs: 30,
    }),
  ).rejects.toThrow();
});
