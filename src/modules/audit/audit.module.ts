import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';
import { AuditReconciler } from './audit-reconciler.js';

@Module({
  imports: [DatabaseModule, ProjectsModule],
  controllers: [AuditController],
  providers: [AuditRepository, AuditService, AuditReconciler],
  exports: [AuditRepository],
})
export class AuditModule {}
