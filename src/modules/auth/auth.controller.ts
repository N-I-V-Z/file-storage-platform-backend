import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.users.register(body.email, body.password);
  }

  @Post('login')
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
