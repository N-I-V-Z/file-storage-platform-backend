import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ValidatedEnvironment } from '../../config/env.validation.js';

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;
    if (origin && !this.config.getOrThrow('corsOrigins').includes(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }
    return true;
  }
}
