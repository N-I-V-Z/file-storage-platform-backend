import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { QuotasModule } from '../quotas/quotas.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsRepository } from './projects.repository.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [DatabaseModule, QuotasModule],
  controllers: [ProjectsController],
  providers: [ProjectsRepository, ProjectsService],
  exports: [ProjectsRepository, ProjectsService],
})
export class ProjectsModule {}
