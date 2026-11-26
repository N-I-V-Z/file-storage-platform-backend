import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { ProjectsService } from '../projects/projects.service.js';

export interface UploadAuditRequest extends AuthenticatedRequest {
  auditActor?: { actorType: 'USER' | 'API_KEY'; actorId: string };
}

@Injectable()
export class FileUploadGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly keys: ApiKeysService,
    private readonly projects: ProjectsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UploadAuditRequest>();
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
      request.auditActor = { actorType: 'USER', actorId: principal.userId };
      return true;
    }
    if (scheme === 'ApiKey') {
      const verified = await this.keys.verifyWithKeyId(
        token,
        projectId,
        'files:write',
      );
      request.auditActor = { actorType: 'API_KEY', actorId: verified.keyId };
      return true;
    }
    throw new UnauthorizedException('Access token required');
  }
}
