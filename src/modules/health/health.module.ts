import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { ClamdProbe } from '../../infrastructure/scanner/clamd-probe.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [DatabaseModule, RedisModule, StorageModule],
  controllers: [HealthController],
  providers: [HealthService, ClamdProbe],
})
export class HealthModule {}
