import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { UsersService } from '../users/users.service.js';
import {
  AuthService,
  REFRESH_COOKIE_NAME,
  REFRESH_LIFETIME_MS,
} from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { Public } from './public.decorator.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthPrincipal } from './auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  @Post('register')
  @Public()
  @UseGuards(ThrottlerGuard)
  register(@Body() body: RegisterDto) {
    return this.users.register(body.email, body.password);
  }

  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body.email, body.password);
    this.setRefreshCookie(response, result.refreshCookie);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.refresh(
      request.cookies?.[REFRESH_COOKIE_NAME],
    );
    this.setRefreshCookie(response, result.refreshCookie);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Get('me')
  me(@CurrentUser() principal: AuthPrincipal) {
    return { id: principal.userId, email: principal.email };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() principal: AuthPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(principal.sessionId);
    response.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.getOrThrow('nodeEnv') === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }

  private setRefreshCookie(response: Response, value: string): void {
    response.cookie(REFRESH_COOKIE_NAME, value, {
      httpOnly: true,
      secure: this.config.getOrThrow('nodeEnv') === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: REFRESH_LIFETIME_MS,
    });
  }
}
