import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionsRepository } from './sessions.repository.js';
import { JwtAuthGuard } from './auth.guard.js';

@Module({
  imports: [UsersModule, DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsRepository,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
