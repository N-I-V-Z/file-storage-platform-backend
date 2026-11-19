import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionsRepository } from './sessions.repository.js';

@Module({
  imports: [UsersModule, DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SessionsRepository],
})
export class AuthModule {}
