import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { STORAGE_ADAPTER } from '../src/infrastructure/storage/storage-adapter.js';
import { FilesystemStorage } from '../src/infrastructure/storage/filesystem-storage.js';
import { scanWithClamd } from '../src/infrastructure/scanner/clamd-client.js';

const eicar = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

it.skipIf(process.env.CLAMD_LIVE !== '1')(
  'accepts clean bytes and detects the EICAR test signature with local clamd',
  async () => {
    const port = Number(process.env.CLAMD_PORT ?? '3310');
    const scan = (bytes: Buffer) =>
      scanWithClamd({
        host: process.env.CLAMD_HOST ?? '127.0.0.1',
        port,
        source: Readable.from([bytes]),
        timeoutMs: 30_000,
      });
    expect(Buffer.byteLength(eicar)).toBe(68);
    await expect(scan(Buffer.from('clean scanner smoke test'))).resolves.toBe(
      'clean',
    );
    await expect(scan(Buffer.from(eicar))).resolves.toBe('infected');
  },
);

it.skipIf(process.env.CLAMD_LIVE !== '1')(
  'finalizes an HTTP upload only after the real daemon scans its temporary file',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'fsp-clamd-live-'));
    const email = `clamd-live-${randomUUID()}@example.com`;
    let nestApp: INestApplication | undefined;
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(STORAGE_ADAPTER)
        .useFactory({ factory: () => new FilesystemStorage(root) })
        .compile();
      nestApp = module.createNestApplication();
      configureHttp(nestApp, nestApp.get(ConfigService));
      await nestApp.init();
      await request(nestApp.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(nestApp.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const project = await request(nestApp.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${login.body.data.accessToken as string}`)
        .send({ name: 'ClamAV live' })
        .expect(201);
      const uploaded = await request(nestApp.getHttpServer())
        .post(`/api/v1/projects/${project.body.data.id as string}/files`)
        .set('Authorization', `Bearer ${login.body.data.accessToken as string}`)
        .attach('file', Buffer.from('%PDF-1.7\nclean live test'), {
          filename: 'clean.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      const stored = await nestApp
        .get(PrismaService)
        .storedFile.findUniqueOrThrow({
          where: { id: uploaded.body.data.id as string },
        });
      expect(stored.status).toBe('READY');
      expect(stored.scannedAt).toBeInstanceOf(Date);
    } finally {
      if (nestApp) {
        const prisma = nestApp.get(PrismaService);
        await prisma.storedFile.deleteMany({
          where: { project: { owner: { email } } },
        });
        await prisma.user.deleteMany({ where: { email } });
        await nestApp.close();
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
