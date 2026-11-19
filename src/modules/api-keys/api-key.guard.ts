import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service.js';
import { API_KEY_SCOPE_METADATA } from './api-key-scope.decorator.js';
import type { ApiKeyScope } from './api-key-scopes.js';

export interface ApiKeyRequest extends Request {
  apiKeyProject?: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<ApiKeyScope>(
      API_KEY_SCOPE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!scope) throw new UnauthorizedException('API key scope required');
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const [scheme, token, extra] =
      request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'ApiKey' || !token || extra) {
      throw new UnauthorizedException('API key required');
    }
    const projectId = request.params.projectId;
    if (typeof projectId !== 'string') {
      throw new UnauthorizedException('Invalid project');
    }
    request.apiKeyProject = await this.keys.verify(token, projectId, scope);
    return true;
  }
}
