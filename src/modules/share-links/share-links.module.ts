import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { FilesModule } from '../files/files.module.js';
import { ShareLinksController } from './share-links.controller.js';
import { SharedFilesController } from './shared-files.controller.js';
import { ShareLinksRepository } from './share-links.repository.js';
import { ShareLinksService } from './share-links.service.js';

@Module({
  imports: [
    DatabaseModule,
    FilesModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
  ],
  controllers: [ShareLinksController, SharedFilesController],
  providers: [ShareLinksRepository, ShareLinksService],
})
export class ShareLinksModule {}
