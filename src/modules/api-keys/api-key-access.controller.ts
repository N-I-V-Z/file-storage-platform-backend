import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { ApiKeyGuard } from './api-key.guard.js';
import type { ApiKeyRequest } from './api-key.guard.js';
import { RequireApiKeyScope } from './api-key-scope.decorator.js';

@Controller('projects/:projectId')
export class ApiKeyAccessController {
  @Get('key-access')
  @Public()
  @RequireApiKeyScope('projects:read')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard, ApiKeyGuard)
  check(@Req() request: ApiKeyRequest) {
    return request.apiKeyProject;
  }
}
