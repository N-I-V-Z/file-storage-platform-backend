import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { AuditRepository } from './audit.repository.js';
import { AuditListQueryDto } from './dto/audit-list-query.dto.js';

@Injectable()
export class AuditService {
  constructor(
    private readonly audit: AuditRepository,
    private readonly projects: ProjectsRepository,
  ) {}

  async list(ownerId: string, projectId: string, query: AuditListQueryDto) {
    const project = await this.projects.findOwned(ownerId, projectId);
    if (!project) throw new NotFoundException('Project not found');
    const result = await this.audit.list(projectId, query.page, query.pageSize);
    return { ...result, page: query.page, pageSize: query.pageSize };
  }
}
