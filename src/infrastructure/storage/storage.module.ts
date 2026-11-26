import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { FilesystemStorage } from './filesystem-storage.js';
import { STORAGE_ADAPTER } from './storage-adapter.js';

@Module({
  providers: [
    {
      provide: STORAGE_ADAPTER,
      useFactory: (config: ConfigService<ValidatedEnvironment, true>) =>
        new FilesystemStorage(config.getOrThrow('storageRoot')),
      inject: [ConfigService],
    },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
