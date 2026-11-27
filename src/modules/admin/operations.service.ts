import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidatedEnvironment } from '../../config/env.validation.js';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../../infrastructure/storage/storage-adapter.js';
import { FileDownloadService } from '../files/file-download.service.js';
import { FilesService } from '../files/files.service.js';

@Injectable()
export class OperationsService {
  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly uploads: FilesService,
    private readonly downloads: FileDownloadService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async snapshot() {
    const [diskFreeBytes, temporary] = await Promise.all([
      this.storage.freeBytes(),
      this.storage.temporaryUsage(),
    ]);
    return {
      diskFreeBytes: diskFreeBytes.toString(),
      minDiskFreeBytes: String(this.config.getOrThrow('minDiskFreeBytes')),
      temporaryBytes: temporary.bytes.toString(),
      temporaryFiles: temporary.files,
      temporaryTruncated: temporary.truncated,
      activeUploads: this.uploads.getActiveUploads(),
      activeDownloads: this.downloads.getActiveDownloads(),
      processRssBytes: String(process.memoryUsage().rss),
      processUptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
