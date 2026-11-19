import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { FilesystemStorage } from '../src/infrastructure/storage/filesystem-storage.js';
import { STORAGE_ADAPTER } from '../src/infrastructure/storage/storage-adapter.js';

describe('private streaming download (e2e)', () => {
  let app: INestApplication;
  let root: string;
  let storage: FilesystemStorage;
  let projectId: string;
  let fileId: string;
  let auth: string;
  let foreignAuth: string;
  let reader: string;
  let writer: string;
  const ownerEmail = `download-${randomUUID()}@example.com`;
  const foreignEmail = `download-${randomUUID()}@example.com`;
  const bytes = Buffer.from('%PDF-1.7\nhello range world\n');

  const path = () => `/api/v1/projects/${projectId}/files/${fileId}/download`;

  async function seedReady(content: Buffer) {
    const storageKey = randomUUID();
    const id = randomUUID();
    await writeFile(join(root, 'temporary', storageKey), content);
    await storage.promote(storageKey);
    await app.get(PrismaService).storedFile.create({
      data: {
        id,
        projectId,
        storageKey,
        originalName: 'sample.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(Math.max(content.length, 1)),
        sizeBytes: BigInt(content.length),
        sha256: createHash('sha256').update(content).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return { id, storageKey };
  }

  async function account(email: string) {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'long-test-password' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'long-test-password' })
      .expect(200);
    return `Bearer ${login.body.data.accessToken as string}`;
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fsp-download-'));
    storage = new FilesystemStorage(root);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
    auth = await account(ownerEmail);
    foreignAuth = await account(foreignEmail);
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Download' })
      .expect(201);
    projectId = project.body.data.id as string;
    const keyPath = `/api/v1/projects/${projectId}/api-keys`;
    const readKey = await request(app.getHttpServer())
      .post(keyPath)
      .set('Authorization', auth)
      .send({ name: 'Reader', scopes: ['files:read'] })
      .expect(201);
    const writeKey = await request(app.getHttpServer())
      .post(keyPath)
      .set('Authorization', auth)
      .send({ name: 'Writer', scopes: ['files:write'] })
      .expect(201);
    reader = `ApiKey ${readKey.body.data.token as string}`;
    writer = `ApiKey ${writeKey.body.data.token as string}`;
    const storageKey = randomUUID();
    fileId = randomUUID();
    await writeFile(join(root, 'temporary', storageKey), bytes);
    await storage.promote(storageKey);
    await app.get(PrismaService).storedFile.create({
      data: {
        id: fileId,
        projectId,
        storageKey,
        originalName: 'report.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(bytes.length),
        sizeBytes: BigInt(bytes.length),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  });

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.storedFile.deleteMany({
        where: { project: { owner: { email: ownerEmail } } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: [ownerEmail, foreignEmail] } },
      });
      await app.close();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('authorizes before serving a ready file', async () => {
    const open = vi.spyOn(storage, 'openObject');
    await request(app.getHttpServer()).get(path()).expect(401);
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', foreignAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', writer)
      .expect(403);
    expect(open).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get(path().replace(fileId, randomUUID()))
      .set('Authorization', auth)
      .expect(404);
    const response = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', reader)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(bytes);
    expect(response.headers['content-type']).toMatch(/^application\/pdf/);
    expect(response.headers['content-length']).toBe(String(bytes.length));
    expect(response.headers['content-disposition']).toContain('report.pdf');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers.etag).toBe(
      `"${createHash('sha256').update(bytes).digest('hex')}"`,
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    open.mockRestore();
  });

  it('returns matching HEAD metadata with no body', async () => {
    const response = await request(app.getHttpServer())
      .head(path())
      .set('Authorization', auth);
    expect(response.status).toBe(200);
    expect(response.headers['content-length']).toBe(String(bytes.length));
    expect(response.body).toEqual({});
  });

  it('serves a single byte range and rejects invalid ranges', async () => {
    const range = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', auth)
      .set('Range', 'bytes=0-0');
    expect(range.status).toBe(206);
    expect(range.headers['content-range']).toBe(`bytes 0-0/${bytes.length}`);
    expect(range.headers['content-length']).toBe('1');
    expect(range.body).toEqual(bytes.subarray(0, 1));
    const tail = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', auth)
      .set('Range', 'bytes=-5');
    expect(tail.status).toBe(206);
    expect(tail.body).toEqual(bytes.subarray(-5));
    const openEnded = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', auth)
      .set('Range', `bytes=${bytes.length - 3}-`);
    expect(openEnded.status).toBe(206);
    expect(openEnded.body).toEqual(bytes.subarray(-3));
    const ifRangeMismatch = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', auth)
      .set('Range', 'bytes=0-0')
      .set('If-Range', '"stale"');
    expect(ifRangeMismatch.status).toBe(200);
    expect(ifRangeMismatch.body).toEqual(bytes);
    const headRange = await request(app.getHttpServer())
      .head(path())
      .set('Authorization', auth)
      .set('Range', 'bytes=0-0');
    expect(headRange.status).toBe(206);
    expect(headRange.headers['content-length']).toBe('1');
    const invalid = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', auth)
      .set('Range', `bytes=${bytes.length}-`);
    expect(invalid.status).toBe(416);
    expect(invalid.headers['content-range']).toBe(`bytes */${bytes.length}`);
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', auth)
      .set('Range', 'bytes=0-1,3-4')
      .expect(416);
  });

  it('hides non-ready files and rejects revoked read keys', async () => {
    const pendingId = randomUUID();
    await app.get(PrismaService).storedFile.create({
      data: {
        id: pendingId,
        projectId,
        storageKey: randomUUID(),
        originalName: 'pending.pdf',
        contentType: 'application/pdf',
        reservationBytes: 1n,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await request(app.getHttpServer())
      .get(path().replace(fileId, pendingId))
      .set('Authorization', auth)
      .expect(404);
    const issued = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/api-keys`)
      .set('Authorization', auth)
      .send({ name: 'Revoke me', scopes: ['files:read'] })
      .expect(201);
    const token = issued.body.data.token as string;
    const keyId = issued.body.data.id as string;
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/api-keys/${keyId}`)
      .set('Authorization', auth)
      .expect(204);
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', `ApiKey ${token}`)
      .expect(401);
  });

  it('handles empty files and unavailable storage objects', async () => {
    const empty = await seedReady(Buffer.alloc(0));
    const emptyPath = path().replace(fileId, empty.id);
    const response = await request(app.getHttpServer())
      .get(emptyPath)
      .set('Authorization', auth);
    expect(response.status).toBe(200);
    expect(response.headers['content-length']).toBe('0');
    const range = await request(app.getHttpServer())
      .get(emptyPath)
      .set('Authorization', auth)
      .set('Range', 'bytes=0-0');
    expect(range.status).toBe(416);
    expect(range.headers['content-range']).toBe('bytes */0');
    const missing = await seedReady(Buffer.from('%PDF-1.7\nmissing'));
    await storage.remove(missing.storageKey);
    await request(app.getHttpServer())
      .get(path().replace(fileId, missing.id))
      .set('Authorization', auth)
      .expect(503);
  });

  it('limits concurrent downloads and releases the slot after completion', async () => {
    const config = app.get(ConfigService);
    const originalLimit = config.getOrThrow<number>('maxConcurrentDownloads');
    config.set('maxConcurrentDownloads', 1);
    const open = storage.openObject.bind(storage);
    let entered!: () => void;
    let release!: () => void;
    const opening = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const spy = vi
      .spyOn(storage, 'openObject')
      .mockImplementation(async (id) => {
        entered();
        await gate;
        return open(id);
      });
    try {
      const first = request(app.getHttpServer())
        .get(path())
        .set('Authorization', auth)
        .then((response) => response);
      await opening;
      await request(app.getHttpServer())
        .get(path())
        .set('Authorization', auth)
        .expect(429);
      release();
      expect((await first).status).toBe(200);
    } finally {
      release();
      spy.mockRestore();
      config.set('maxConcurrentDownloads', originalLimit);
    }
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', auth)
      .expect(200);
  });
});
