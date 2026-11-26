import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import {
  AdminAuditQueryDto,
  AdminListQueryDto,
} from './dto/admin-list-query.dto.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @Header('Cache-Control', 'private, no-store')
  overview() {
    return this.admin.overview();
  }

  @Get('projects')
  @Header('Cache-Control', 'private, no-store')
  projects(@Query() query: AdminListQueryDto) {
    return this.admin.projects(query);
  }

  @Get('audit-events')
  @Header('Cache-Control', 'private, no-store')
  auditEvents(@Query() query: AdminAuditQueryDto) {
    return this.admin.auditEvents(query);
  }
}
