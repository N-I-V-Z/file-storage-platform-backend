import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { ApiKeyGuard } from './api-key.guard.js';
import type { ApiKeyRequest } from './api-key.guard.js';
import { RequireApiKeyScope } from './api-key-scope.decorator.js';

@Controller('projects/:projectId')
export class ApiKeyAccessController {
  @Get('key-access')
  @Public()
  @RequireApiKeyScope('projects:read')
  @UseGuards(ApiKeyGuard)
  check(@Req() request: ApiKeyRequest) {
    return request.apiKeyProject;
  }
}
