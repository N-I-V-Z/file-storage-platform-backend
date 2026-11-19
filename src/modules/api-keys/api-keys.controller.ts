import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthPrincipal } from '../auth/auth.guard.js';
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';

@Controller('projects/:projectId/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Post()
  issue(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() body: CreateApiKeyDto,
  ) {
    return this.keys.issue(user.userId, projectId, body);
  }

  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.keys.list(user.userId, projectId);
  }

  @Delete(':keyId')
  @HttpCode(204)
  revoke(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('keyId', new ParseUUIDPipe()) keyId: string,
  ) {
    return this.keys.revoke(user.userId, projectId, keyId);
  }
}
