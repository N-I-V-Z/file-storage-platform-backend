import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { FilesModule } from '../files/files.module.js';
import { OperationsService } from './operations.service.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [DatabaseModule, StorageModule, FilesModule],
  controllers: [AdminController],
  providers: [AdminGuard, AdminRepository, AdminService, OperationsService],
})
export class AdminModule {}
