import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertSeparate, postgresEnvironment, run, sha256 } from './common.mjs';

export async function backup({
  destination = process.argv[2],
  storageRoot = process.env.STORAGE_ROOT,
  acknowledgement = process.env.BACKUP_OFFLINE_ACK,
  databaseUrl = process.env.DATABASE_URL,
  runner = run,
} = {}) {
  if (acknowledgement !== 'api-stopped')
    throw new Error(
      'Set BACKUP_OFFLINE_ACK=api-stopped after stopping API writes',
    );
  if (!destination || !storageRoot)
    throw new Error('Destination and STORAGE_ROOT are required');
  const root = await realpath(storageRoot);
  const destinationPath = resolve(destination);
  assertSeparate(root, destinationPath);
  const pgEnv = postgresEnvironment(databaseUrl);
  process.umask(0o077);
  await mkdir(destinationPath, { recursive: true, mode: 0o700 });
  const backupRoot = await realpath(destinationPath);
  assertSeparate(root, backupRoot);
  const temporary = await mkdtemp(join(backupRoot, '.incomplete-'));
  try {
    const database = join(temporary, 'database.dump');
    const storage = join(temporary, 'storage.tar.gz');
    await runner(
      'pg_dump',
      ['--format=custom', '--no-owner', '--file', database],
      pgEnv,
    );
    await runner('pg_restore', ['--list', database], pgEnv);
    await runner(
      'tar',
      [
        '-C',
        root,
        '-czf',
        storage,
        'objects',
        'temporary',
        'quarantine',
        'processing',
      ],
      process.env,
    );
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      databaseSha256: await sha256(database),
      storageSha256: await sha256(storage),
    };
    await writeFile(
      join(temporary, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { mode: 0o600 },
    );
    const completed = join(
      backupRoot,
      `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
    );
    await rename(temporary, completed);
    return completed;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  backup()
    .then((path) => {
      process.stdout.write(`Backup complete: ${path}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
