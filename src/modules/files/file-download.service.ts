import { pipeline } from 'node:stream/promises';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../../infrastructure/storage/storage-adapter.js';
import { parseByteRange } from './byte-range.js';
import { FilesRepository } from './files.repository.js';

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@Injectable()
export class FileDownloadService {
  private activeDownloads = 0;

  constructor(
    private readonly files: FilesRepository,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async send(
    request: Request,
    response: Response,
    projectId: string,
    fileId: string,
    head: boolean,
  ): Promise<void> {
    const file = await this.files.findReady(projectId, fileId);
    if (!file) throw new NotFoundException('File not found');
    if (
      file.sizeBytes === null ||
      file.sha256 === null ||
      file.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new ServiceUnavailableException('File metadata is unavailable');
    }
    if (
      this.activeDownloads >= this.config.getOrThrow('maxConcurrentDownloads')
    ) {
      throw new HttpException(
        'Download capacity reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeDownloads++;
    try {
      let handle;
      try {
        handle = await this.storage.openObject(file.storageKey);
      } catch {
        throw new ServiceUnavailableException('File object is unavailable');
      }
      try {
        const stats = await handle.stat();
        const size = Number(file.sizeBytes);
        if (!stats.isFile() || stats.size !== size) {
          throw new ServiceUnavailableException('File object is inconsistent');
        }
        const etag = `"${file.sha256}"`;
        const rangeHeader = request.headers.range;
        const ifRange = request.headers['if-range'];
        const useRange =
          rangeHeader !== undefined &&
          (ifRange === undefined || ifRange === etag);
        let range;
        if (useRange) {
          try {
            range = parseByteRange(rangeHeader, size);
          } catch {
            response.status(416);
            response.setHeader('Content-Range', `bytes */${size}`);
            response.setHeader('Accept-Ranges', 'bytes');
            response.setHeader('Cache-Control', 'private, no-store');
            response.end();
            return;
          }
        }
        const start = range?.start ?? 0;
        const end = range?.end ?? size - 1;
        response.status(range ? 206 : 200);
        response.setHeader('Content-Type', file.contentType);
        response.setHeader(
          'Content-Disposition',
          contentDisposition(file.originalName),
        );
        response.setHeader('Content-Length', range ? end - start + 1 : size);
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('ETag', etag);
        response.setHeader('Cache-Control', 'private, no-store');
        if (range) {
          response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        }
        if (head || size === 0) {
          response.end();
          return;
        }
        const abort = new AbortController();
        const onClose = () => {
          if (!response.writableFinished) abort.abort();
        };
        response.once('close', onClose);
        const timer = setTimeout(
          () => abort.abort(),
          this.config.getOrThrow('downloadTimeoutMs'),
        );
        timer.unref();
        try {
          await pipeline(
            handle.createReadStream({ start, end, autoClose: false }),
            response,
            { signal: abort.signal },
          );
        } catch (error) {
          if (!response.destroyed) response.destroy(error as Error);
        } finally {
          clearTimeout(timer);
          response.off('close', onClose);
        }
      } finally {
        await handle.close();
      }
    } finally {
      this.activeDownloads--;
    }
  }
}
