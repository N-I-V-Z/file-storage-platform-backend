import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export function postgresEnvironment(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const url = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  delete env.DATABASE_URL;
  return env;
}

export function run(command, args, env, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let errors = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      errors += chunk.toString();
    });
    child.on('error', () => reject(new Error(`${command} could not start`)));
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(output)
        : reject(
            new Error(
              `${command} exited with status ${code}: ${errors.trim().slice(0, 300)}`,
            ),
          ),
    );
  });
}

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function contains(parent, child) {
  const value = relative(parent, child);
  return (
    value === '' ||
    (value !== '..' &&
      !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      !isAbsolute(value))
  );
}

export function assertSeparate(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  if (contains(a, b) || contains(b, a))
    throw new Error('Backup and storage paths must be separate');
}

export async function resolvedDirectory(path) {
  return realpath(path);
}
