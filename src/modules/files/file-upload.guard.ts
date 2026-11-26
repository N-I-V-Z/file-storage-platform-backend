import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { ProjectsService } from '../projects/projects.service.js';

@Injectable()
export class FileUploadGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly keys: ApiKeysService,
    private readonly projects: ProjectsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const projectId = request.params.projectId;
    if (typeof projectId !== 'string') {
      throw new UnauthorizedException('Project required');
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        projectId,
      )
    ) {
      throw new BadRequestException('Invalid project ID');
    }
    const [scheme, token, extra] =
      request.headers.authorization?.split(' ') ?? [];
    if (!token || extra)
      throw new UnauthorizedException('Access token required');
    if (scheme === 'Bearer') {
      await this.jwt.authenticate(request as AuthenticatedRequest);
      const principal = (request as AuthenticatedRequest).authPrincipal;
      if (!principal) throw new UnauthorizedException('Access token required');
      await this.projects.get(principal.userId, projectId);
      return true;
    }
    if (scheme === 'ApiKey') {
      await this.keys.verify(token, projectId, 'files:write');
      return true;
    }
    throw new UnauthorizedException('Access token required');
  }
}
