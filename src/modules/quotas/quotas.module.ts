import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { QuotasRepository } from './quotas.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [QuotasRepository],
  exports: [QuotasRepository],
})
export class QuotasModule {}
