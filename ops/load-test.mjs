import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
};
const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;

export function parseOptions(args, env = process.env) {
  if (env.LOAD_ACK !== 'disposable-project')
    throw new Error('Set LOAD_ACK=disposable-project for a test-only project');
  if (!env.LOAD_EMAIL || !env.LOAD_PASSWORD)
    throw new Error('LOAD_EMAIL and LOAD_PASSWORD are required');
  const [
    originInput,
    projectId,
    filePath,
    countInput = '5',
    concurrencyInput = '2',
  ] = args;
  if (!originInput || !projectId || !filePath)
    throw new Error(
      'Usage: pnpm ops:load <api-origin> <project-id> <sample-file> [count] [concurrency]',
    );
  const origin = new URL(originInput);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== originInput ||
    origin.username ||
    origin.password
  )
    throw new Error('API origin must be an HTTP(S) origin');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId,
    )
  )
    throw new Error('Project ID must be a UUID');
  const count = Number(countInput);
  const concurrency = Number(concurrencyInput);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 20 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4
  )
    throw new Error('Count must be 1–20 and concurrency 1–4');
  const name = basename(filePath);
  const contentType = MIME[extname(name).toLowerCase()];
  if (!contentType)
    throw new Error('Sample type must be PDF, PNG, JPEG, WebP, MP4 or ZIP');
  return {
    origin: origin.origin,
    projectId,
    filePath,
    name,
    contentType,
    count,
    concurrency,
    email: env.LOAD_EMAIL,
    password: env.LOAD_PASSWORD,
  };
}

async function checked(response, expected) {
  if (response.status !== expected)
    throw new Error(`HTTP ${response.status}; expected ${expected}`);
  return response;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(fraction * sorted.length) - 1]);
}

export async function runLoad(options, fetcher = fetch) {
  const bytes = await readFile(options.filePath);
  if (bytes.length === 0 || bytes.length > MAX_SAMPLE_BYTES)
    throw new Error('Sample must be 1 byte to 8 MiB');
  const api = `${options.origin}/api/v1`;
  const login = await checked(
    await fetcher(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: options.email,
        password: options.password,
      }),
      cache: 'no-store',
    }),
    200,
  );
  const token = (await login.json()).data?.accessToken;
  if (typeof token !== 'string' || !token)
    throw new Error('Login response is invalid');
  const auth = { Authorization: `Bearer ${token}` };
  let next = 0;
  const uploadMs = [];
  const downloadMs = [];
  const failures = [];
  let transferredBytes = 0;
  async function worker() {
    while (next < options.count) {
      const index = next++;
      let fileId;
      try {
        const form = new FormData();
        form.append(
          'file',
          new Blob([bytes], { type: options.contentType }),
          options.name,
        );
        const startUpload = performance.now();
        const upload = await checked(
          await fetcher(`${api}/projects/${options.projectId}/files`, {
            method: 'POST',
            headers: auth,
            body: form,
            cache: 'no-store',
          }),
          201,
        );
        uploadMs.push(performance.now() - startUpload);
        const data = (await upload.json()).data;
        fileId = data?.id;
        if (typeof fileId !== 'string')
          throw new Error('Upload response has no file ID');
        const downloadUrl = `${api}/projects/${options.projectId}/files/${fileId}/download`;
        const startDownload = performance.now();
        const download = await checked(
          await fetcher(downloadUrl, { headers: auth, cache: 'no-store' }),
          200,
        );
        const full = Buffer.from(await download.arrayBuffer());
        const downloadDuration = performance.now() - startDownload;
        if (!full.equals(bytes))
          throw new Error('Downloaded bytes do not match sample');
        const end = Math.min(bytes.length - 1, 15);
        const range = await checked(
          await fetcher(downloadUrl, {
            headers: { ...auth, Range: `bytes=0-${end}` },
            cache: 'no-store',
          }),
          206,
        );
        if (
          !Buffer.from(await range.arrayBuffer()).equals(
            bytes.subarray(0, end + 1),
          )
        )
          throw new Error('Range bytes do not match sample');
        downloadMs.push(downloadDuration);
        transferredBytes += full.length + end + 1;
      } catch (error) {
        failures.push({
          iteration: index + 1,
          reason: error instanceof Error ? error.message : 'Unknown failure',
        });
      } finally {
        if (fileId) {
          try {
            await checked(
              await fetcher(
                `${api}/projects/${options.projectId}/files/${fileId}`,
                { method: 'DELETE', headers: auth, cache: 'no-store' },
              ),
              204,
            );
            await checked(
              await fetcher(
                `${api}/projects/${options.projectId}/trash/${fileId}`,
                { method: 'DELETE', headers: auth, cache: 'no-store' },
              ),
              204,
            );
          } catch {
            failures.push({
              iteration: index + 1,
              reason: 'Cleanup failed; inspect disposable project',
            });
          }
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: options.concurrency }, () => worker()),
  );
  return {
    attempted: options.count,
    completed: downloadMs.length,
    failures,
    transferredBytes,
    uploadP50Ms: percentile(uploadMs, 0.5),
    uploadP95Ms: percentile(uploadMs, 0.95),
    downloadP50Ms: percentile(downloadMs, 0.5),
    downloadP95Ms: percentile(downloadMs, 0.95),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = parseOptions(process.argv.slice(2));
    runLoad(options)
      .then((result) => {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        if (result.failures.length) process.exitCode = 1;
      })
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
