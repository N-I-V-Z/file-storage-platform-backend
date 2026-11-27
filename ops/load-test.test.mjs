import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOptions, runLoad } from './load-test.mjs';

const projectId = '00000000-0000-4000-8000-000000000001';
const fileId = '00000000-0000-4000-8000-000000000002';

test('load harness requires a disposable project and bounded request count', () => {
  const args = ['http://127.0.0.1:4000', projectId, 'sample.pdf', '21', '2'];
  assert.throws(() => parseOptions(args, {}), /LOAD_ACK/);
  const env = {
    LOAD_ACK: 'disposable-project',
    LOAD_EMAIL: 'owner@example.com',
    LOAD_PASSWORD: 'secret',
  };
  assert.throws(() => parseOptions(args, env), /Count must be/);
  assert.equal(parseOptions([args[0], projectId, 'sample.pdf'], env).count, 5);
});

test('load harness verifies full and range bytes and purges its file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fsp-load-'));
  const filePath = join(root, 'sample.pdf');
  const bytes = Buffer.from('%PDF-1.7\nhello\n');
  const calls = [];
  try {
    await writeFile(filePath, bytes);
    const options = parseOptions(
      ['http://127.0.0.1:4000', projectId, filePath, '1', '1'],
      {
        LOAD_ACK: 'disposable-project',
        LOAD_EMAIL: 'owner@example.com',
        LOAD_PASSWORD: 'secret',
      },
    );
    const fetcher = async (url, init) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        authorization: init.headers?.Authorization,
      });
      if (url.endsWith('/auth/login'))
        return Response.json({ data: { accessToken: 'private-token' } });
      if (init.method === 'POST')
        return Response.json({ data: { id: fileId } }, { status: 201 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (init.headers?.Range) return new Response(bytes, { status: 206 });
      return new Response(bytes, { status: 200 });
    };
    const result = await runLoad(options, fetcher);
    assert.equal(result.completed, 1);
    assert.deepEqual(result.failures, []);
    assert.equal(result.transferredBytes, bytes.length * 2);
    assert.equal(calls.filter((call) => call.method === 'DELETE').length, 2);
    assert.equal(JSON.stringify(result).includes('private-token'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
