import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminController],
  providers: [AdminGuard, AdminRepository, AdminService],
})
export class AdminModule {}
