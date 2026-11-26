import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthPrincipal } from '../auth/auth.guard.js';
import { ProjectNameDto } from './dto/project-name.dto.js';
import { ProjectsService } from './projects.service.js';
import { UsageService } from '../quotas/usage.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly usageService: UsageService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() body: ProjectNameDto) {
    return this.projects.create(user.userId, body.name);
  }

  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.projects.list(user.userId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.projects.get(user.userId, id);
  }

  @Get(':id/usage')
  usage(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.projects.getUsage(user.userId, id);
  }

  @Get(':id/usage/breakdown')
  breakdown(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.usageService.breakdown(user.userId, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ProjectNameDto,
  ) {
    return this.projects.rename(user.userId, id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.projects.remove(user.userId, id);
  }
}
