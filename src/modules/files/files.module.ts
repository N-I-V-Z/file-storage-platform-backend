import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { QuotasModule } from '../quotas/quotas.module.js';
import { FileUploadGuard } from './file-upload.guard.js';
import { FileDownloadGuard } from './file-download.guard.js';
import { FileDownloadService } from './file-download.service.js';
import { FilesRepository } from './files.repository.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { UploadReconciler } from './upload-reconciler.js';
import { FileListService } from './file-list.service.js';

@Module({
  imports: [
    AuthModule,
    ApiKeysModule,
    ProjectsModule,
    QuotasModule,
    StorageModule,
    DatabaseModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    FileListService,
    FileUploadGuard,
    FileDownloadGuard,
    FileDownloadService,
    FilesRepository,
    UploadReconciler,
  ],
})
export class FilesModule {}
