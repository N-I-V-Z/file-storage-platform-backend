import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../storage/storage-adapter.js';
import { scanWithClamd } from './clamd-client.js';
import type { MalwareScanner } from './scanner-adapter.js';

@Injectable()
export class ClamdScanner implements MalwareScanner {
  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  scan(storageKey: string, signal: AbortSignal) {
    return scanWithClamd({
      host: this.config.getOrThrow('clamdHost'),
      port: this.config.getOrThrow('clamdPort'),
      timeoutMs: this.config.getOrThrow('scanTimeoutMs'),
      maxBytes: this.config.getOrThrow('maxUploadBytes'),
      source: this.storage.openTemporary(storageKey),
      signal,
    });
  }
}
