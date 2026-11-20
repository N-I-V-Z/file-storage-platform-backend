import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { FilesystemStorage } from '../src/infrastructure/storage/filesystem-storage.js';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../src/infrastructure/storage/storage-adapter.js';
import { FileTrashReconciler } from '../src/modules/files/file-trash-reconciler.js';

describe('private file trash (e2e)', () => {
  let app: INestApplication;
  let root: string;
  let projectId: string;
  let fileId: string;
  let ownerAuth: string;
  let foreignAuth: string;
  const email = `trash-${randomUUID()}@example.com`;
  const foreignEmail = `trash-${randomUUID()}@example.com`;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fsp-trash-'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_ADAPTER)
      .useFactory({ factory: () => new FilesystemStorage(root) })
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
    ownerAuth = `Bearer ${login.body.data.accessToken as string}`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: foreignEmail, password: 'long-test-password' })
      .expect(201);
    const foreignLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: foreignEmail, password: 'long-test-password' })
      .expect(200);
    foreignAuth = `Bearer ${foreignLogin.body.data.accessToken as string}`;
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', ownerAuth)
      .send({ name: 'Trash' })
      .expect(201);
    projectId = project.body.data.id as string;
    const storage = app.get<StorageAdapter>(STORAGE_ADAPTER);
    const storageKey = randomUUID();
    await pipeline(
      Readable.from(['%PDF-1.7']),
      storage.createTemporary(storageKey),
    );
    await storage.promote(storageKey);
    const prisma = app.get(PrismaService);
    const file = await prisma.storedFile.create({
      data: {
        projectId,
        storageKey,
        originalName: 'sample.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(8),
        sizeBytes: BigInt(8),
        sha256: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    fileId = file.id;
    await prisma.project.update({
      where: { id: projectId },
      data: { usedBytes: { increment: BigInt(8) } },
    });
  });

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.storedFile.deleteMany({
        where: { project: { owner: { email } } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: [email, foreignEmail] } },
      });
      await app.close();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('moves a READY file to trash while retaining charged bytes', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${fileId}`)
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${fileId}`)
      .set('Authorization', foreignAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/trash`)
      .set('Authorization', foreignAuth)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${fileId}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    const usage = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/usage`)
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(usage.body.data.usedBytes).toBe('8');
    const files = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/files`)
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(files.body.data.total).toBe(0);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/files/${fileId}/download`)
      .set('Authorization', ownerAuth)
      .expect(404);
    const trash = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/trash`)
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(trash.body.data.items).toEqual([
      expect.objectContaining({
        id: fileId,
        originalName: 'sample.pdf',
        sizeBytes: '8',
      }),
    ]);
    expect(JSON.stringify(trash.body.data)).not.toContain('storageKey');
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/trash/${fileId}/restore`)
      .set('Authorization', foreignAuth)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/trash/${fileId}/restore`)
      .set('Authorization', ownerAuth)
      .expect(200);
    const restored = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/files`)
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(restored.body.data.total).toBe(1);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${fileId}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    await app.get(PrismaService).storedFile.update({
      where: { id: fileId },
      data: { purgeAfter: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/trash/${fileId}/restore`)
      .set('Authorization', ownerAuth)
      .expect(409);
  });

  it('permanently purges trashed bytes and metadata exactly once', async () => {
    const prisma = app.get(PrismaService);
    const stored = await prisma.storedFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/trash/${fileId}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    expect(
      await prisma.storedFile.findUnique({ where: { id: fileId } }),
    ).toBeNull();
    await expect(
      app.get<StorageAdapter>(STORAGE_ADAPTER).openObject(stored.storageKey),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const usage = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/usage`)
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(usage.body.data.usedBytes).toBe('0');
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/trash/${fileId}`)
      .set('Authorization', ownerAuth)
      .expect(404);
  });

  it('retries a failed purge and purges expired trash', async () => {
    const prisma = app.get(PrismaService);
    const storage = app.get<StorageAdapter>(STORAGE_ADAPTER);
    const storageKey = randomUUID();
    await pipeline(
      Readable.from(['%PDF-1.7']),
      storage.createTemporary(storageKey),
    );
    await storage.promote(storageKey);
    const file = await prisma.storedFile.create({
      data: {
        projectId,
        storageKey,
        originalName: 'retry.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(8),
        sizeBytes: BigInt(8),
        sha256: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { usedBytes: { increment: BigInt(8) } },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${file.id}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    const remove = vi
      .spyOn(storage, 'remove')
      .mockRejectedValueOnce(new Error('disk unavailable'));
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/trash/${file.id}`)
      .set('Authorization', ownerAuth)
      .expect(503);
    expect(
      (await prisma.storedFile.findUniqueOrThrow({ where: { id: file.id } }))
        .status,
    ).toBe('PURGING');
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .usedBytes,
    ).toBe(BigInt(8));
    remove.mockRestore();
    await app.get(FileTrashReconciler).run();
    expect(
      await prisma.storedFile.findUnique({ where: { id: file.id } }),
    ).toBeNull();
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .usedBytes,
    ).toBe(BigInt(0));
    const expiredKey = randomUUID();
    await pipeline(
      Readable.from(['%PDF-1.7']),
      storage.createTemporary(expiredKey),
    );
    await storage.promote(expiredKey);
    const expired = await prisma.storedFile.create({
      data: {
        projectId,
        storageKey: expiredKey,
        originalName: 'expired.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(8),
        sizeBytes: BigInt(8),
        sha256: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { usedBytes: { increment: BigInt(8) } },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${expired.id}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    await prisma.storedFile.update({
      where: { id: expired.id },
      data: { purgeAfter: new Date(Date.now() - 1000) },
    });
    await app.get(FileTrashReconciler).run();
    expect(
      await prisma.storedFile.findUnique({ where: { id: expired.id } }),
    ).toBeNull();
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .usedBytes,
    ).toBe(BigInt(0));
  });

  it('charges a concurrent permanent purge only once', async () => {
    const prisma = app.get(PrismaService);
    const storage = app.get<StorageAdapter>(STORAGE_ADAPTER);
    const storageKey = randomUUID();
    await pipeline(
      Readable.from(['%PDF-1.7']),
      storage.createTemporary(storageKey),
    );
    await storage.promote(storageKey);
    const file = await prisma.storedFile.create({
      data: {
        projectId,
        storageKey,
        originalName: 'race.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(8),
        sizeBytes: BigInt(8),
        sha256: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { usedBytes: { increment: BigInt(8) } },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${file.id}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .delete(`/api/v1/projects/${projectId}/trash/${file.id}`)
          .set('Authorization', ownerAuth),
      ),
    );
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([204, 404]);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .usedBytes,
    ).toBe(BigInt(0));
  });
});
