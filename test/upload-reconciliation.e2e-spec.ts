import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { FilesystemStorage } from '../src/infrastructure/storage/filesystem-storage.js';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../src/infrastructure/storage/storage-adapter.js';
import { QuotasRepository } from '../src/modules/quotas/quotas.repository.js';
import { UploadReconciler } from '../src/modules/files/upload-reconciler.js';

describe('upload reconciliation (e2e)', () => {
  let app: INestApplication;
  let root: string;
  const email = `upload-reconcile-${randomUUID()}@example.com`;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fsp-reconcile-'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_ADAPTER)
      .useFactory({ factory: () => new FilesystemStorage(root) })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.storedFile.deleteMany({
        where: { project: { owner: { email } } },
      });
      await prisma.user.deleteMany({ where: { email } });
      await app.close();
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('releases abandoned temp and promoted objects after restart', async () => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.create({
      data: { email, passwordHash: 'unused' },
    });
    const project = await prisma.project.create({
      data: { ownerId: user.id, name: 'Reconcile' },
    });
    const quota = app.get(QuotasRepository);
    const storage = app.get<StorageAdapter>(STORAGE_ADAPTER);
    const keys: string[] = [];
    for (const promoted of [false, true]) {
      const id = randomUUID();
      const storageKey = randomUUID();
      keys.push(storageKey);
      await quota.reserve({
        id,
        projectId: project.id,
        storageKey,
        originalName: 'lost.pdf',
        contentType: 'application/pdf',
        reservationBytes: 512n,
      });
      await pipeline(
        Readable.from(['%PDF-1.7']),
        storage.createTemporary(storageKey),
      );
      if (promoted) await storage.promote(storageKey);
      await prisma.storedFile.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    }
    await app.get(UploadReconciler).run();
    expect(
      await prisma.storedFile.count({ where: { projectId: project.id } }),
    ).toBe(0);
    const updated = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    expect(updated.reservedBytes).toBe(0n);
    expect(await readdir(join(root, 'temporary'))).toEqual([]);
    await expect(
      import('node:fs/promises').then((fs) =>
        fs.stat(storage.objectPath(keys[1])),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await app.get(UploadReconciler).run();
  });
});
