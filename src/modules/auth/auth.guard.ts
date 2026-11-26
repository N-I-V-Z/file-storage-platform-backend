import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { SessionsRepository } from './sessions.repository.js';
import { AUTH_PUBLIC_KEY } from './public.decorator.js';
import type { UserRole } from '../../generated/prisma/enums.js';

interface AccessClaims {
  sub: string;
  sid: string;
  typ: string;
}

export interface AuthPrincipal {
  userId: string;
  email: string;
  sessionId: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  authPrincipal?: AuthPrincipal;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsRepository,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      AUTH_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.authenticate(request);
    return true;
  }

  async authenticate(request: AuthenticatedRequest): Promise<void> {
    const [scheme, token, extra] =
      request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token || extra) {
      throw new UnauthorizedException('Access token required');
    }

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.config.getOrThrow('jwtAccessSecret'),
        issuer: 'file-storage-platform',
        audience: 'file-storage-web',
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
    if (claims.typ !== 'access' || !claims.sub || !claims.sid) {
      throw new UnauthorizedException('Invalid access token');
    }
    const session = await this.sessions.findById(claims.sid);
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    request.authPrincipal = {
      userId: session.userId,
      email: session.user.email,
      sessionId: session.id,
      role: session.user.role,
    };
  }
}
