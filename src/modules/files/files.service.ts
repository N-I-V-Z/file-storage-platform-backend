import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  PayloadTooLargeException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Busboy from 'busboy';
import type { Request } from 'express';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../../infrastructure/storage/storage-adapter.js';
import { QuotasRepository } from '../quotas/quotas.repository.js';
import { FileInspector } from './file-inspector.js';
import { matchesSignature, supportsMimeType } from './file-signatures.js';

interface PendingUpload {
  id: string;
  storageKey: string;
}

@Injectable()
export class FilesService {
  private activeUploads = 0;

  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly quotas: QuotasRepository,
  ) {}

  async upload(request: Request, projectId: string) {
    const maxBytes = this.config.getOrThrow('maxUploadBytes');
    const minimumFree = this.config.getOrThrow('minDiskFreeBytes');
    if (this.activeUploads >= this.config.getOrThrow('maxConcurrentUploads')) {
      throw new HttpException(
        'Upload capacity reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeUploads++;
    let expectedSha256: string | undefined;
    try {
      if (
        !request.headers['content-type']?.startsWith('multipart/form-data;')
      ) {
        throw new BadRequestException('Expected multipart/form-data');
      }
      const checksumHeader = request.headers['x-content-sha256'];
      if (
        checksumHeader !== undefined &&
        (typeof checksumHeader !== 'string' ||
          !/^[0-9a-f]{64}$/.test(checksumHeader))
      ) {
        throw new BadRequestException('Invalid X-Content-SHA256');
      }
      expectedSha256 = checksumHeader;
      const contentLength = Number(request.headers['content-length']);
      if (
        Number.isFinite(contentLength) &&
        contentLength > maxBytes + 1024 * 1024
      ) {
        throw new PayloadTooLargeException('Upload exceeds file size limit');
      }
      const requiredFree =
        BigInt(minimumFree) + BigInt(maxBytes) * BigInt(this.activeUploads);
      if ((await this.storage.freeBytes()) < requiredFree) {
        throw new HttpException('Insufficient disk space', 507);
      }
    } catch (error) {
      this.activeUploads--;
      throw error;
    }
    const abort = new AbortController();
    let timedOut = false;
    let fileFailure: unknown;
    const onAborted = () => {
      if (!fileFailure) abort.abort();
    };
    request.once('aborted', onAborted);
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, this.config.getOrThrow('uploadTimeoutMs'));
    timer.unref();
    let pending: PendingUpload | undefined;
    let inputError: Error | undefined;
    let fileTask:
      | Promise<{
          id: string;
          storageKey: string;
          originalName: string;
          contentType: string;
          sizeBytes: number;
          sha256: string;
          prefix: Buffer;
          truncated: boolean;
        }>
      | undefined;

    try {
      let parser: ReturnType<typeof Busboy>;
      try {
        parser = Busboy({
          headers: request.headers,
          limits: { files: 2, parts: 2, fields: 1, fileSize: maxBytes + 1 },
        });
      } catch {
        throw new BadRequestException('Invalid multipart request');
      }
      parser.on('file', (field, stream, info) => {
        stream.on('error', () => {
          // The file stream may fail before pipeline attaches its own listener.
        });
        if (field !== 'file' || fileTask) {
          inputError = new BadRequestException('Expected one file field');
          stream.resume();
          return;
        }
        fileTask = this.streamPart(
          stream,
          info,
          projectId,
          maxBytes,
          abort.signal,
          (value) => {
            pending = value;
          },
        );
        void fileTask.catch((error: unknown) => {
          fileFailure = error;
          parser.destroy(error as Error);
        });
      });
      parser.on('field', () => {
        inputError = new BadRequestException('Unexpected form field');
      });
      parser.on('partsLimit', () => {
        inputError = new BadRequestException('Only one file is allowed');
      });
      parser.on('filesLimit', () => {
        inputError = new BadRequestException('Only one file is allowed');
      });
      await pipeline(request, parser, { signal: abort.signal });
      if (inputError) throw inputError;
      if (!fileTask) throw new BadRequestException('File field is required');
      const file = await fileTask;
      if (file.truncated || file.sizeBytes > maxBytes) {
        throw new PayloadTooLargeException('Upload exceeds file size limit');
      }
      if (!file.sizeBytes || !matchesSignature(file.contentType, file.prefix)) {
        throw new BadRequestException(
          'File signature does not match MIME type',
        );
      }
      if (expectedSha256 && file.sha256 !== expectedSha256) {
        throw new BadRequestException('Checksum mismatch');
      }
      await this.storage.promote(file.storageKey);
      const ready = await this.quotas.finalize(
        file.id,
        BigInt(file.sizeBytes),
        file.sha256,
      );
      if (!ready) throw new Error('Upload reservation expired');
      return {
        id: ready.id,
        projectId: ready.projectId,
        originalName: ready.originalName,
        contentType: ready.contentType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        status: 'ready',
        createdAt: ready.createdAt,
      };
    } catch (error) {
      if (fileTask) await fileTask.catch(() => undefined);
      if (pending) await this.cleanup(pending);
      if (timedOut || abort.signal.aborted) {
        throw new RequestTimeoutException('Upload interrupted');
      }
      const cause = fileFailure ?? error;
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === 'ENOSPC'
      ) {
        throw new HttpException('Insufficient disk space', 507);
      }
      throw cause;
    } finally {
      clearTimeout(timer);
      request.off('aborted', onAborted);
      this.activeUploads--;
    }
  }

  private async streamPart(
    stream: Readable & { truncated?: boolean },
    info: { filename?: string; mimeType: string },
    projectId: string,
    maxBytes: number,
    signal: AbortSignal,
    setPending: (value: PendingUpload) => void,
  ) {
    const originalName = info.filename;
    if (
      !originalName ||
      Buffer.byteLength(originalName) > 255 ||
      originalName === '.' ||
      originalName === '..' ||
      /[\\/]/.test(originalName) ||
      Array.from(originalName).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      stream.resume();
      throw new BadRequestException('Invalid filename');
    }
    const contentType = info.mimeType.toLowerCase();
    if (!supportsMimeType(contentType)) {
      stream.resume();
      throw new BadRequestException('Unsupported MIME type');
    }
    const id = randomUUID();
    const storageKey = randomUUID();
    const reserved = await this.quotas.reserve({
      id,
      projectId,
      storageKey,
      originalName,
      contentType,
      reservationBytes: BigInt(maxBytes),
    });
    if (!reserved) {
      stream.resume();
      throw new PayloadTooLargeException('Project quota exceeded');
    }
    setPending({ id, storageKey });
    const inspector = new FileInspector(maxBytes);
    await pipeline(
      stream,
      inspector,
      this.storage.createTemporary(storageKey),
      { signal },
    );
    return {
      id,
      storageKey,
      originalName,
      contentType,
      ...inspector.result(),
      truncated: Boolean(stream.truncated),
    };
  }

  private async cleanup(pending: PendingUpload): Promise<void> {
    try {
      if (await this.quotas.markAbandoned(pending.id)) {
        await this.storage.remove(pending.storageKey);
        await this.quotas.releaseAbandoned(pending.id);
      }
    } catch {
      // Reconciliation retries abandoned and expired uploads after a crash or I/O failure.
    }
  }
}
