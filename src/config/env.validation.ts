import { resolve } from 'node:path';

type EnvironmentSource = Record<string, string | undefined>;

export interface ValidatedEnvironment {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  storageRoot: string;
  corsOrigins: string[];
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
}

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function authenticationSecret(source: EnvironmentSource, name: string): string {
  const value = required(source, name);
  if (value.length < 32 || value.startsWith('replace-with-')) {
    throw new Error(
      `${name} must be a generated secret of at least 32 characters`,
    );
  }
  return value;
}

function connectionUrl(
  source: EnvironmentSource,
  name: string,
  protocols: string[],
): string {
  const value = required(source, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol) || !url.hostname) {
    throw new Error(`${name} has an invalid protocol or host`);
  }
  return value;
}

export function validateEnvironment(
  source: EnvironmentSource,
): ValidatedEnvironment {
  const jwtAccessSecret = authenticationSecret(source, 'JWT_ACCESS_SECRET');
  const jwtRefreshSecret = authenticationSecret(source, 'JWT_REFRESH_SECRET');
  if (jwtAccessSecret === jwtRefreshSecret) {
    throw new Error('JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET');
  }
  const nodeEnv = source.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const portValue = source.PORT || '4000';
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const corsOrigins = required(source, 'CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim());
  for (const origin of corsOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain HTTP origins');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw new Error('CORS_ORIGINS must contain HTTP origins');
    }
  }

  return {
    nodeEnv: nodeEnv as ValidatedEnvironment['nodeEnv'],
    port,
    databaseUrl: connectionUrl(source, 'DATABASE_URL', [
      'postgres:',
      'postgresql:',
    ]),
    redisUrl: connectionUrl(source, 'REDIS_URL', ['redis:', 'rediss:']),
    storageRoot: resolve(required(source, 'STORAGE_ROOT')),
    corsOrigins,
    jwtAccessSecret,
    jwtRefreshSecret,
  };
}
