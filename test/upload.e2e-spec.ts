import { createHash, randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { FilesystemStorage } from '../src/infrastructure/storage/filesystem-storage.js';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../src/infrastructure/storage/storage-adapter.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { MALWARE_SCANNER } from '../src/infrastructure/scanner/scanner-adapter.js';

describe('streaming upload (e2e)', () => {
  let app: INestApplication;
  let root: string;
  let accountAuth: string;
  const email = `upload-${randomUUID()}@example.com`;
  const emails = [email];
  let scannerMode: 'clean' | 'infected' | 'offline' = 'clean';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fsp-upload-'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_ADAPTER)
      .useFactory({ factory: () => new FilesystemStorage(root) })
      .overrideProvider(MALWARE_SCANNER)
      .useValue({
        scan: async (storageKey: string) => {
          if (scannerMode === 'offline') throw new Error('scanner unavailable');
          let bytes = 0;
          for await (const chunk of app
            .get<StorageAdapter>(STORAGE_ADAPTER)
            .openTemporary(storageKey)) {
            bytes += Buffer.from(chunk).length;
          }
          if (bytes === 0) throw new Error('No temporary upload to scan');
          return scannerMode;
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'long-test-password' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'long-test-password' })
      .expect(200);
    accountAuth = `Bearer ${login.body.data.accessToken as string}`;
  });

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.storedFile.deleteMany({
        where: { project: { owner: { email: { in: emails } } } },
      });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      await app.close();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function scannerFixture() {
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', accountAuth)
      .send({ name: 'Scanner fixture' })
      .expect(201);
    return project.body.data.id as string;
  }

  async function expectRejectedScan(status: number) {
    const projectId = await scannerFixture();
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/files`)
      .set('Authorization', accountAuth)
      .attach('file', Buffer.from('%PDF-1.7\nscanner fixture'), {
        filename: 'scan.pdf',
        contentType: 'application/pdf',
      })
      .expect(status);
    const prisma = app.get(PrismaService);
    expect(await prisma.storedFile.count({ where: { projectId } })).toBe(0);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(project.usedBytes).toBe(0n);
    expect(project.reservedBytes).toBe(0n);
    expect(await readdir(join(root, 'temporary'))).toEqual([]);
  }

  it('rejects detected malware without retaining bytes or quota', async () => {
    scannerMode = 'infected';
    try {
      await expectRejectedScan(422);
    } finally {
      scannerMode = 'clean';
    }
  });

  it('fails closed when the scanner is unavailable', async () => {
    scannerMode = 'offline';
    try {
      await expectRejectedScan(503);
    } finally {
      scannerMode = 'clean';
    }
  });

  it('streams a signed file and returns ready metadata', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', accountAuth)
      .send({ name: 'Upload' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const bytes = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.alloc(256 * 1024, 7),
    ]);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/files`)
      .set('Authorization', accountAuth)
      .set('X-Content-SHA256', digest)
      .attach('file', bytes, {
        filename: 'picture.png',
        contentType: 'image/png',
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        projectId,
        originalName: 'picture.png',
        contentType: 'image/png',
        sizeBytes: bytes.length,
        sha256: digest,
        status: 'ready',
      },
    });
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain(root);
    const stored = await app.get(PrismaService).storedFile.findUniqueOrThrow({
      where: { id: response.body.data.id as string },
    });
    expect(stored.status).toBe('READY');
    expect(stored.scannedAt).toBeInstanceOf(Date);
  });

  it('uploads into a project folder and rejects missing or foreign folders', async () => {
    const accountEmail = `upload-folder-${randomUUID()}@example.com`;
    emails.push(accountEmail);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: accountEmail, password: 'long-test-password' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: accountEmail, password: 'long-test-password' })
      .expect(200);
    const auth = `Bearer ${login.body.data.accessToken as string}`;
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Folder upload' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const folder = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/folders`)
      .set('Authorization', auth)
      .send({ name: 'Media' })
      .expect(201);
    const folderId = folder.body.data.id as string;
    const bytes = Buffer.from('%PDF-1.7\nfolder upload\n');
    const path = `/api/v1/projects/${projectId}/files`;
    const upload = (header: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', auth)
        .set('X-Folder-Id', header)
        .attach('file', bytes, {
          filename: 'folder.pdf',
          contentType: 'application/pdf',
        });
    const uploaded = await upload(folderId).expect(201);
    expect(uploaded.body.data.folderId).toBe(folderId);
    const stored = await app.get(PrismaService).storedFile.findUniqueOrThrow({
      where: { id: uploaded.body.data.id as string },
    });
    expect(stored.folderId).toBe(folderId);
    await upload(randomUUID()).expect(404);
    await upload('not-a-uuid').expect(400);
    const other = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Other folder project' })
      .expect(201);
    const foreignFolder = await request(app.getHttpServer())
      .post(`/api/v1/projects/${other.body.data.id as string}/folders`)
      .set('Authorization', auth)
      .send({ name: 'Foreign' })
      .expect(201);
    await upload(foreignFolder.body.data.id as string).expect(404);
    const root = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth)
      .attach('file', bytes, {
        filename: 'root.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(root.body.data.folderId).toBeNull();
    const usage = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/usage`)
      .set('Authorization', auth)
      .expect(200);
    expect(usage.body.data.reservedBytes).toBe('0');
    expect(usage.body.data.usedBytes).toBe(String(bytes.length * 2));
  });

  it('enforces key scope and cleans failed uploads', async () => {
    const accountEmail = `upload-key-${randomUUID()}@example.com`;
    emails.push(accountEmail);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: accountEmail, password: 'long-test-password' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: accountEmail, password: 'long-test-password' })
      .expect(200);
    const auth = `Bearer ${login.body.data.accessToken as string}`;
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Key upload' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const keyPath = `/api/v1/projects/${projectId}/api-keys`;
    const reader = await request(app.getHttpServer())
      .post(keyPath)
      .set('Authorization', auth)
      .send({ name: 'Reader', scopes: ['files:read'] })
      .expect(201);
    const writer = await request(app.getHttpServer())
      .post(keyPath)
      .set('Authorization', auth)
      .send({ name: 'Writer', scopes: ['files:write'] })
      .expect(201);
    const bytes = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(64 * 1024, 1),
    ]);
    const path = `/api/v1/projects/${projectId}/files`;
    await request(app.getHttpServer())
      .post(path)
      .attach('file', bytes, {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      })
      .expect(401);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `ApiKey ${reader.body.data.token as string}`)
      .attach('file', bytes, {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
    const uploaded = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `ApiKey ${writer.body.data.token as string}`)
      .attach('file', bytes, {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(uploaded.body.data.status).toBe('ready');
    const secondProject = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Other project' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${secondProject.body.data.id as string}/files`)
      .set('Authorization', `ApiKey ${writer.body.data.token as string}`)
      .attach('file', bytes, {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
    const foreignEmail = `upload-foreign-${randomUUID()}@example.com`;
    emails.push(foreignEmail);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: foreignEmail, password: 'long-test-password' })
      .expect(201);
    const foreignLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: foreignEmail, password: 'long-test-password' })
      .expect(200);
    await request(app.getHttpServer())
      .post(path)
      .set(
        'Authorization',
        `Bearer ${foreignLogin.body.data.accessToken as string}`,
      )
      .attach('file', bytes, {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      })
      .expect(404);
    const config = app.get(ConfigService);
    const getOrThrow = config.getOrThrow.bind(config);
    const exactLimit = vi
      .spyOn(config, 'getOrThrow')
      .mockImplementation((key: string) =>
        key === 'maxUploadBytes' ? bytes.length : getOrThrow(key),
      );
    try {
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', auth)
        .attach('file', bytes, {
          filename: 'exact.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
    } finally {
      exactLimit.mockRestore();
    }
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth)
      .set('X-Content-SHA256', '0'.repeat(64))
      .attach('file', bytes, {
        filename: 'bad.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth)
      .attach('file', bytes, { filename: 'fake.png', contentType: 'image/png' })
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth)
      .attach('file', bytes, {
        filename: 'one.pdf',
        contentType: 'application/pdf',
      })
      .attach('file', bytes, {
        filename: 'two.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    const limit = vi
      .spyOn(config, 'getOrThrow')
      .mockImplementation((key: string) =>
        key === 'maxUploadBytes' ? 1024 : getOrThrow(key),
      );
    try {
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', auth)
        .attach('file', bytes, {
          filename: 'large.pdf',
          contentType: 'application/pdf',
        })
        .expect(413);
    } finally {
      limit.mockRestore();
    }
    const storage = app.get<StorageAdapter>(STORAGE_ADAPTER);
    const free = vi.spyOn(storage, 'freeBytes').mockResolvedValue(0n);
    try {
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', auth)
        .attach('file', bytes, {
          filename: 'disk.pdf',
          contentType: 'application/pdf',
        })
        .expect(507);
    } finally {
      free.mockRestore();
    }
    const write = vi
      .spyOn(storage, 'createTemporary')
      .mockImplementation(() => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      });
    try {
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', auth)
        .attach('file', bytes, {
          filename: 'write.pdf',
          contentType: 'application/pdf',
        })
        .expect(507);
    } finally {
      write.mockRestore();
    }
    const projectAfter = await app
      .get(PrismaService)
      .project.findUniqueOrThrow({
        where: { id: projectId },
      });
    expect(projectAfter.usedBytes).toBe(BigInt(bytes.length * 2));
    expect(projectAfter.reservedBytes).toBe(0n);
    expect(
      await app.get(PrismaService).storedFile.count({ where: { projectId } }),
    ).toBe(2);
    expect(await readdir(join(root, 'temporary'))).toEqual([]);
  });

  it('releases a partial upload on abort and limits concurrent requests', async () => {
    const accountEmail = `upload-abort-${randomUUID()}@example.com`;
    emails.push(accountEmail);
    const prisma = app.get(PrismaService);
    const user = await prisma.user.create({
      data: { email: accountEmail, passwordHash: 'unused' },
    });
    const project = await prisma.project.create({
      data: { ownerId: user.id, name: 'Abort' },
    });
    const folder = await prisma.folder.create({
      data: { projectId: project.id, name: 'Partial' },
    });
    const config = app.get(ConfigService);
    const original = config.getOrThrow.bind(config);
    const limits = vi
      .spyOn(config, 'getOrThrow')
      .mockImplementation((key: string) =>
        key === 'maxConcurrentUploads' ? 1 : original(key),
      );
    const partial = () => {
      const stream = new PassThrough() as PassThrough & Request;
      stream.headers = {
        'content-type': 'multipart/form-data; boundary=boundary',
        'x-folder-id': folder.id,
      };
      stream.write(
        '--boundary\r\nContent-Disposition: form-data; name="file"; filename="partial.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\n',
      );
      return stream;
    };
    const first = partial();
    const service = app.get(FilesService);
    const result = service
      .upload(first, project.id)
      .catch((error: unknown) => error);
    try {
      await vi.waitFor(async () => {
        expect(
          await prisma.storedFile.count({
            where: { projectId: project.id, folderId: folder.id },
          }),
        ).toBe(1);
      });
      await expect(service.upload(partial(), project.id)).rejects.toMatchObject(
        { status: 429 },
      );
      first.emit('aborted');
      await expect(result).resolves.toMatchObject({ status: 408 });
      expect(
        await prisma.storedFile.count({ where: { projectId: project.id } }),
      ).toBe(0);
      const after = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(after.reservedBytes).toBe(0n);
      expect(await readdir(join(root, 'temporary'))).toEqual([]);
    } finally {
      limits.mockRestore();
      first.destroy();
    }
  });

  it('releases a partial upload after its deadline', async () => {
    const accountEmail = `upload-timeout-${randomUUID()}@example.com`;
    emails.push(accountEmail);
    const prisma = app.get(PrismaService);
    const user = await prisma.user.create({
      data: { email: accountEmail, passwordHash: 'unused' },
    });
    const project = await prisma.project.create({
      data: { ownerId: user.id, name: 'Timeout' },
    });
    const config = app.get(ConfigService);
    const original = config.getOrThrow.bind(config);
    const deadline = vi
      .spyOn(config, 'getOrThrow')
      .mockImplementation((key: string) =>
        key === 'uploadTimeoutMs' ? 100 : original(key),
      );
    const stream = new PassThrough() as PassThrough & Request;
    stream.headers = {
      'content-type': 'multipart/form-data; boundary=boundary',
    };
    stream.write(
      '--boundary\r\nContent-Disposition: form-data; name="file"; filename="slow.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\n',
    );
    try {
      await expect(
        app.get(FilesService).upload(stream, project.id),
      ).rejects.toMatchObject({ status: 408 });
      expect(
        await prisma.storedFile.count({ where: { projectId: project.id } }),
      ).toBe(0);
      const after = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(after.reservedBytes).toBe(0n);
      expect(await readdir(join(root, 'temporary'))).toEqual([]);
    } finally {
      deadline.mockRestore();
      stream.destroy();
    }
  });
});
