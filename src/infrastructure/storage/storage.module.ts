import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { FilesystemStorage } from './filesystem-storage.js';

@Module({
  providers: [
    {
      provide: FilesystemStorage,
      useFactory: (config: ConfigService<ValidatedEnvironment, true>) =>
        new FilesystemStorage(config.getOrThrow('storageRoot')),
      inject: [ConfigService],
    },
  ],
  exports: [FilesystemStorage],
})
export class StorageModule {}
