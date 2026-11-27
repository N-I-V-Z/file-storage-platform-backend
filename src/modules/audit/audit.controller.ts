import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthPrincipal } from '../auth/auth.guard.js';
import { AuditService } from './audit.service.js';
import { AuditListQueryDto } from './dto/audit-list-query.dto.js';

@Controller('projects/:projectId/audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: AuditListQueryDto,
  ) {
    return this.audit.list(user.userId, projectId, query);
  }
}
