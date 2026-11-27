import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { FilesystemStorage } from '../src/infrastructure/storage/filesystem-storage.js';
import { STORAGE_ADAPTER } from '../src/infrastructure/storage/storage-adapter.js';

describe('scanned file share links (e2e)', () => {
  let app: INestApplication;
  let root: string;
  let projectId: string;
  let fileId: string;
  let ownerAuth: string;
  let otherAuth: string;
  const ownerEmail = `share-${randomUUID()}@example.com`;
  const otherEmail = `share-${randomUUID()}@example.com`;
  const bytes = Buffer.from('%PDF-1.7\nshared content\n');
  const linksPath = () =>
    `/api/v1/projects/${projectId}/files/${fileId}/share-links`;

  async function account(email: string) {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'long-test-password' })
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'long-test-password' })
      .expect(200);
    return `Bearer ${response.body.data.accessToken as string}`;
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fsp-share-'));
    const storage = new FilesystemStorage(root);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
    ownerAuth = await account(ownerEmail);
    otherAuth = await account(otherEmail);
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', ownerAuth)
      .send({ name: 'Shared files' })
      .expect(201);
    projectId = project.body.data.id as string;
    const storageKey = randomUUID();
    fileId = randomUUID();
    await writeFile(join(root, 'temporary', storageKey), bytes);
    await storage.promote(storageKey);
    await app.get(PrismaService).storedFile.create({
      data: {
        id: fileId,
        projectId,
        storageKey,
        originalName: 'shared.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(bytes.length),
        sizeBytes: BigInt(bytes.length),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        scannedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  });

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.storedFile.deleteMany({ where: { projectId } });
      await prisma.user.deleteMany({
        where: { email: { in: [ownerEmail, otherEmail] } },
      });
      await app.close();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('issues a secret once, lists metadata, downloads and revokes', async () => {
    await request(app.getHttpServer())
      .post(linksPath())
      .set('Authorization', otherAuth)
      .send({})
      .expect(404);
    const created = await request(app.getHttpServer())
      .post(linksPath())
      .set('Authorization', ownerAuth)
      .send({})
      .expect(201);
    const { id, token } = created.body.data as { id: string; token: string };
    expect(token).toMatch(/^fsps_[A-Za-z0-9_-]{43}$/);
    const stored = await app
      .get(PrismaService)
      .shareLink.findUniqueOrThrow({ where: { id } });
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(stored.tokenHash).not.toContain(token);
    const list = await request(app.getHttpServer())
      .get(linksPath())
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(list.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id })]),
    );
    expect(JSON.stringify(list.body)).not.toContain(token);
    const download = await request(app.getHttpServer())
      .get('/api/v1/shared-files/download')
      .set('Authorization', `Share ${token}`)
      .expect(200);
    expect(download.body.equals(bytes)).toBe(true);
    expect(download.headers['cache-control']).toContain('no-store');
    expect(download.headers['referrer-policy']).toBe('no-referrer');
    const head = await request(app.getHttpServer())
      .head('/api/v1/shared-files/download')
      .set('Authorization', `Share ${token}`)
      .expect(200);
    expect(Number(head.headers['content-length'])).toBe(bytes.length);
    expect(head.headers['access-control-expose-headers']).toContain(
      'Content-Disposition',
    );
    const range = await request(app.getHttpServer())
      .get('/api/v1/shared-files/download')
      .set('Authorization', `Share ${token}`)
      .set('Range', 'bytes=0-3')
      .expect(206);
    expect(range.body.equals(bytes.subarray(0, 4))).toBe(true);
    await request(app.getHttpServer())
      .delete(`${linksPath()}/${id}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/shared-files/download')
      .set('Authorization', `Share ${token}`)
      .expect(404);
  });

  it('rejects expiry outside the allowed window and unscanned files', async () => {
    for (const expiresAt of [
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 8 * 24 * 60 * 60_000),
    ]) {
      await request(app.getHttpServer())
        .post(linksPath())
        .set('Authorization', ownerAuth)
        .send({ expiresAt: expiresAt.toISOString() })
        .expect(400);
    }
    const prisma = app.get(PrismaService);
    await prisma.storedFile.update({
      where: { id: fileId },
      data: { scannedAt: null },
    });
    await request(app.getHttpServer())
      .post(linksPath())
      .set('Authorization', ownerAuth)
      .send({})
      .expect(404);
    await prisma.storedFile.update({
      where: { id: fileId },
      data: { scannedAt: new Date() },
    });
  });

  it('stops a link when its file is trashed or the link expires', async () => {
    const created = await request(app.getHttpServer())
      .post(linksPath())
      .set('Authorization', ownerAuth)
      .send({})
      .expect(201);
    const { id, token } = created.body.data as { id: string; token: string };
    const prisma = app.get(PrismaService);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${fileId}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/v1/shared-files/download')
      .set('Authorization', `Share ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/trash/${fileId}/restore`)
      .set('Authorization', ownerAuth)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/shared-files/download')
      .set('Authorization', `Share ${token}`)
      .expect(404);
    await prisma.shareLink.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .get('/api/v1/shared-files/download')
      .set('Authorization', `Share ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/shared-files/download')
      .set('Authorization', 'Share forged')
      .expect(404);
  });
});
