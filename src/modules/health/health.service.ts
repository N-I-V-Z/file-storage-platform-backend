import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { ConfigService } from '@nestjs/config';
import type { ValidatedEnvironment } from '../../config/env.validation.js';
import { Inject } from '@nestjs/common';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../../infrastructure/storage/storage-adapter.js';
import { ClamdProbe } from '../../infrastructure/scanner/clamd-probe.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly scanner: ClamdProbe,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async readiness() {
    const [postgres, redis, storage, scanner] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
      this.storage.freeBytes().then((free) => {
        if (free < BigInt(this.config.getOrThrow('minDiskFreeBytes')))
          throw new Error('Storage below free-space reserve');
      }),
      this.scanner.ping(),
    ]);
    const services = {
      postgres: postgres.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' ? 'up' : 'down',
      storage: storage.status === 'fulfilled' ? 'up' : 'down',
      scanner: scanner.status === 'fulfilled' ? 'up' : 'down',
    };
    if (Object.values(services).includes('down')) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        services,
      });
    }
    return { status: 'ok', services };
  }
}
