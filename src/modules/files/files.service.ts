import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  RequestTimeoutException,
  ServiceUnavailableException,
  UnprocessableEntityException,
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
import { FoldersService } from '../folders/folders.service.js';
import { FileInspector } from './file-inspector.js';
import { matchesSignature, supportsMimeType } from './file-signatures.js';
import type { UploadAuditRequest } from './file-upload.guard.js';
import {
  MALWARE_SCANNER,
  type MalwareScanner,
} from '../../infrastructure/scanner/scanner-adapter.js';

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
    private readonly folders: FoldersService,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
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
    let folderId: string | null = null;
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
      const folderHeader = request.headers['x-folder-id'];
      if (folderHeader !== undefined) {
        if (
          typeof folderHeader !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            folderHeader,
          )
        ) {
          throw new BadRequestException('Invalid X-Folder-Id');
        }
        await this.folders.requireProjectFolder(projectId, folderHeader);
        folderId = folderHeader;
      }
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
          folderId,
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
      let verdict: 'clean' | 'infected';
      try {
        verdict = await this.scanner.scan(file.storageKey, abort.signal);
      } catch {
        throw new ServiceUnavailableException('Malware scanner unavailable');
      }
      if (verdict !== 'clean') {
        throw new UnprocessableEntityException('Malware detected');
      }
      await this.storage.promote(file.storageKey);
      const ready = await this.quotas.finalize(
        file.id,
        BigInt(file.sizeBytes),
        file.sha256,
        new Date(),
        (request as UploadAuditRequest).auditActor,
      );
      if (!ready) throw new Error('Upload reservation expired');
      return {
        id: ready.id,
        projectId: ready.projectId,
        folderId: ready.folderId,
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
    folderId: string | null,
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
    let reserved: Awaited<ReturnType<QuotasRepository['reserve']>>;
    try {
      reserved = await this.quotas.reserve({
        id,
        projectId,
        folderId,
        storageKey,
        originalName,
        contentType,
        reservationBytes: BigInt(maxBytes),
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['P2003', '23503'].includes(String(error.code))
      ) {
        throw new NotFoundException('Folder not found');
      }
      throw error;
    }
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
