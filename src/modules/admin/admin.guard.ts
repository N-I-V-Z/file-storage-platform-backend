import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authPrincipal;
    if (principal?.role !== 'ADMIN')
      throw new ForbiddenException('Admin access required');
    return true;
  }
}
