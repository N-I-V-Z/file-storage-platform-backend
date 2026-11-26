import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { QuotasRepository } from './quotas.repository.js';
import { UsageRepository } from './usage.repository.js';
import { UsageService } from './usage.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [QuotasRepository, UsageRepository, UsageService],
  exports: [QuotasRepository, UsageService],
})
export class QuotasModule {}
