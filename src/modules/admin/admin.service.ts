import { Injectable } from '@nestjs/common';
import { AdminRepository } from './admin.repository.js';
import {
  AdminAuditQueryDto,
  AdminListQueryDto,
} from './dto/admin-list-query.dto.js';

@Injectable()
export class AdminService {
  constructor(private readonly admin: AdminRepository) {}

  async overview() {
    const { userCount, projects, fileCount } = await this.admin.overview();
    return {
      userCount,
      projectCount: projects._count._all,
      fileCount,
      quotaBytes: (projects._sum.quotaBytes ?? 0n).toString(),
      usedBytes: (projects._sum.usedBytes ?? 0n).toString(),
      reservedBytes: (projects._sum.reservedBytes ?? 0n).toString(),
    };
  }

  async projects(query: AdminListQueryDto) {
    const { items, total } = await this.admin.listProjects(
      query.page,
      query.pageSize,
    );
    return {
      items: items.map((project) => ({
        ...project,
        quotaBytes: project.quotaBytes.toString(),
        usedBytes: project.usedBytes.toString(),
        reservedBytes: project.reservedBytes.toString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async auditEvents(query: AdminAuditQueryDto) {
    const { items, total } = await this.admin.listAudit(
      query.page,
      query.pageSize,
      query.projectId,
    );
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
