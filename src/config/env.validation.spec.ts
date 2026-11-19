import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './env.validation.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL:
    'postgresql://file_storage:local-password@127.0.0.1:5432/file_storage',
  REDIS_URL: 'redis://127.0.0.1:6379',
  STORAGE_ROOT: './.local-storage',
  CORS_ORIGINS: 'http://localhost:3000,https://app.example.com',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnvironment', () => {
  it('returns typed local service settings', () => {
    expect(validateEnvironment(valid)).toEqual({
      nodeEnv: 'development',
      port: 4000,
      databaseUrl: valid.DATABASE_URL,
      redisUrl: valid.REDIS_URL,
      storageRoot: resolve('./.local-storage'),
      maxUploadBytes: 512 * 1024 * 1024,
      projectQuotaBytes: 10 * 1024 * 1024 * 1024,
      minDiskFreeBytes: 1024 * 1024 * 1024,
      maxConcurrentUploads: 4,
      uploadTimeoutMs: 600_000,
      maxConcurrentDownloads: 16,
      downloadTimeoutMs: 600_000,
      corsOrigins: ['http://localhost:3000', 'https://app.example.com'],
      jwtAccessSecret: valid.JWT_ACCESS_SECRET,
      jwtRefreshSecret: valid.JWT_REFRESH_SECRET,
    });
  });

  it('rejects unsafe upload limits', () => {
    expect(() =>
      validateEnvironment({ ...valid, MAX_UPLOAD_BYTES: '0' }),
    ).toThrow(/MAX_UPLOAD_BYTES/);
    expect(() =>
      validateEnvironment({ ...valid, PROJECT_QUOTA_BYTES: '100' }),
    ).toThrow(/PROJECT_QUOTA_BYTES/);
    expect(() =>
      validateEnvironment({ ...valid, MAX_CONCURRENT_UPLOADS: '1000' }),
    ).toThrow(/MAX_CONCURRENT_UPLOADS/);
  });

  it('rejects missing database connection before startup', () => {
    expect(() =>
      validateEnvironment({ ...valid, DATABASE_URL: undefined }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid database scheme and port', () => {
    expect(() =>
      validateEnvironment({ ...valid, DATABASE_URL: 'http://db' }),
    ).toThrow(/DATABASE_URL/);
    expect(() => validateEnvironment({ ...valid, PORT: '70000' })).toThrow(
      /PORT/,
    );
  });

  it('rejects non-origin CORS entries', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        CORS_ORIGINS: 'http://localhost:3000/private',
      }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('requires distinct, strong authentication secrets', () => {
    expect(() =>
      validateEnvironment({ ...valid, JWT_ACCESS_SECRET: undefined }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      validateEnvironment({ ...valid, JWT_ACCESS_SECRET: 'too-short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      validateEnvironment({
        ...valid,
        JWT_ACCESS_SECRET: 'replace-with-random-access-secret',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      validateEnvironment({
        ...valid,
        JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });
});
