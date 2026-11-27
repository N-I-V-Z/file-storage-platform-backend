import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertSeparate, postgresEnvironment, run, sha256 } from './common.mjs';

export async function restoreDrill({
  bundle = process.argv[2],
  target = process.argv[3],
  storageRoot = process.env.STORAGE_ROOT,
  databaseUrl = process.env.DATABASE_URL,
  runner = run,
} = {}) {
  if (!bundle || !target || !storageRoot)
    throw new Error(
      'Bundle, new target directory and STORAGE_ROOT are required',
    );
  const backupRoot = await realpath(bundle);
  const liveRoot = await realpath(storageRoot);
  const targetRoot = resolve(target);
  assertSeparate(liveRoot, targetRoot);
  assertSeparate(backupRoot, targetRoot);
  try {
    await stat(targetRoot);
    throw new Error('Restore target must not already exist');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const manifest = JSON.parse(
    await readFile(join(backupRoot, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.databaseSha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.storageSha256)
  )
    throw new Error('Invalid backup manifest');
  const database = join(backupRoot, 'database.dump');
  const storage = join(backupRoot, 'storage.tar.gz');
  for (const path of [database, storage]) {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error('Backup artifacts must be regular files');
  }
  if (
    (await sha256(database)) !== manifest.databaseSha256 ||
    (await sha256(storage)) !== manifest.storageSha256
  )
    throw new Error('Backup checksum mismatch');
  const pgEnv = postgresEnvironment(databaseUrl);
  await runner('pg_restore', ['--list', database], pgEnv);
  const members = await runner('tar', ['-tzf', storage], process.env, true);
  const details = await runner('tar', ['-tvzf', storage], process.env, true);
  const allowed = /^(objects|temporary|quarantine|processing)(\/|$)/;
  if (
    members
      .split(/\r?\n/)
      .some(
        (member) => member && (!allowed.test(member) || member.includes('..')),
      )
  )
    throw new Error('Unsafe storage archive');
  if (details.split(/\r?\n/).some((entry) => entry && !/^[-d]/.test(entry)))
    throw new Error('Storage archive contains links or special files');
  process.umask(0o077);
  const dbName = `fsp_drill_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  await runner('createdb', ['--template=template0', dbName], pgEnv);
  await mkdir(targetRoot, { mode: 0o700 });
  await runner(
    'pg_restore',
    [
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      dbName,
      database,
    ],
    pgEnv,
  );
  await runner(
    'tar',
    [
      '-xzf',
      storage,
      '-C',
      targetRoot,
      '--no-same-owner',
      '--no-same-permissions',
    ],
    process.env,
  );
  const rows = await runner(
    'psql',
    [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--field-separator',
      '|',
      '--dbname',
      dbName,
      '--command',
      "SELECT storage_key, size_bytes, sha256 FROM stored_files WHERE status IN ('READY', 'TRASHED') ORDER BY storage_key",
    ],
    pgEnv,
    true,
  );
  let fileRecords = 0;
  for (const row of rows.trim().split(/\r?\n/)) {
    if (!row) continue;
    const [storageKey, size, digest] = row.split('|');
    if (
      !/^[0-9a-f-]{36}$/.test(storageKey) ||
      !/^\d+$/.test(size) ||
      !/^[a-f0-9]{64}$/.test(digest)
    )
      throw new Error('Invalid restored file metadata');
    const object = join(
      targetRoot,
      'objects',
      storageKey.slice(0, 2),
      storageKey,
    );
    const file = await lstat(object);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      BigInt(file.size) !== BigInt(size) ||
      (await sha256(object)) !== digest
    )
      throw new Error(`Restored object mismatch: ${storageKey}`);
    fileRecords++;
  }
  return { dbName, targetRoot, fileRecords };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  restoreDrill()
    .then((result) => {
      process.stdout.write(
        `Restored into isolated database ${result.dbName} and ${result.targetRoot}; ${result.fileRecords} retained file records. Verify files, then remove these drill resources manually.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
