import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { backup } from './backup.mjs';
import { restoreDrill } from './restore-drill.mjs';
import { assertSeparate, postgresEnvironment } from './common.mjs';

test('PostgreSQL URL keeps special password characters out of command arguments', () => {
  const env = postgresEnvironment(
    'postgresql://operator:pass%40word@localhost:5432/files?sslmode=require',
  );
  assert.equal(env.PGPASSWORD, 'pass@word');
  assert.equal(env.PGDATABASE, 'files');
  assert.equal(env.PGSSLMODE, 'require');
  assert.equal(env.DATABASE_URL, undefined);
});

test('backup refuses a destination inside the live storage tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fsp-ops-'));
  try {
    assert.throws(() => assertSeparate(root, join(root, 'backup')), /separate/);
    await assert.rejects(
      backup({
        destination: join(root, 'backup'),
        storageRoot: root,
        acknowledgement: 'api-stopped',
      }),
      /separate/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup publishes dump, storage archive and matching manifest only after success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fsp-ops-'));
  const live = join(root, 'live');
  const destination = join(root, 'backups');
  try {
    await mkdir(live);
    const runner = async (command, args) => {
      if (command === 'pg_dump') await writeFile(args.at(-1), 'database');
      if (command === 'tar') await writeFile(args[3], 'storage');
      return '';
    };
    const completed = await backup({
      destination,
      storageRoot: live,
      acknowledgement: 'api-stopped',
      databaseUrl: 'postgresql://operator:secret@localhost/files',
      runner,
    });
    const manifest = JSON.parse(
      await readFile(join(completed, 'manifest.json'), 'utf8'),
    );
    assert.equal(
      manifest.databaseSha256,
      createHash('sha256').update('database').digest('hex'),
    );
    assert.equal(
      manifest.storageSha256,
      createHash('sha256').update('storage').digest('hex'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restore drill rejects changed bytes before creating a database or target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fsp-ops-'));
  const storageRoot = join(root, 'live');
  const bundle = join(root, 'bundle');
  try {
    await mkdir(storageRoot);
    await mkdir(bundle);
    await writeFile(join(bundle, 'database.dump'), 'changed');
    await writeFile(join(bundle, 'storage.tar.gz'), 'data');
    await writeFile(
      join(bundle, 'manifest.json'),
      JSON.stringify({
        version: 1,
        databaseSha256: 'a'.repeat(64),
        storageSha256: 'b'.repeat(64),
      }),
    );
    await assert.rejects(
      restoreDrill({ bundle, target: join(root, 'drill'), storageRoot }),
      /checksum mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restore drill verifies a restored object against database metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fsp-ops-'));
  const live = join(root, 'live');
  const bundle = join(root, 'bundle');
  const target = join(root, 'drill');
  const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const content = Buffer.from('hello');
  const digest = createHash('sha256').update(content).digest('hex');
  try {
    await mkdir(live);
    await mkdir(bundle);
    await writeFile(join(bundle, 'database.dump'), 'database');
    await writeFile(join(bundle, 'storage.tar.gz'), 'storage');
    await writeFile(
      join(bundle, 'manifest.json'),
      JSON.stringify({
        version: 1,
        databaseSha256: createHash('sha256').update('database').digest('hex'),
        storageSha256: createHash('sha256').update('storage').digest('hex'),
      }),
    );
    const runner = async (command, args) => {
      if (command === 'tar' && args[0] === '-tzf')
        return `objects/\nobjects/aa/\nobjects/aa/${key}\n`;
      if (command === 'tar' && args[0] === '-tvzf')
        return 'drwx------ objects/\n-rw------- objects/aa/file\n';
      if (command === 'tar' && args[0] === '-xzf') {
        await mkdir(join(target, 'objects', 'aa'), { recursive: true });
        await writeFile(join(target, 'objects', 'aa', key), content);
      }
      if (command === 'psql') return `${key}|5|${digest}\n`;
      return '';
    };
    const result = await restoreDrill({
      bundle,
      target,
      storageRoot: live,
      databaseUrl: 'postgresql://operator:secret@localhost/files',
      runner,
    });
    assert.equal(result.fileRecords, 1);
    assert.match(result.dbName, /^fsp_drill_/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
