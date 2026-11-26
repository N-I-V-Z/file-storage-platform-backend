import { pipeline } from 'node:stream/promises';
import type { FileHandle } from 'node:fs/promises';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  RequestTimeoutException,
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

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new RequestTimeoutException('Download interrupted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new RequestTimeoutException('Download interrupted'));
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

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
      let handle: FileHandle | undefined;
      try {
        const opening = this.storage.openObject(file.storageKey);
        void opening
          .then((lateHandle) => {
            if (abort.signal.aborted && handle !== lateHandle) {
              void lateHandle.close().catch(() => undefined);
            }
          })
          .catch(() => undefined);
        handle = await raceAbort(opening, abort.signal);
      } catch {
        if (abort.signal.aborted)
          throw new RequestTimeoutException('Download interrupted');
        throw new ServiceUnavailableException('File object is unavailable');
      }
      try {
        let stats;
        try {
          stats = await raceAbort(handle.stat(), abort.signal);
        } catch {
          if (abort.signal.aborted)
            throw new RequestTimeoutException('Download interrupted');
          throw new ServiceUnavailableException('File object is unavailable');
        }
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
        let firstChunk = Buffer.alloc(0);
        if (!head && size > 0) {
          const length = Math.min(end - start + 1, 64 * 1024);
          firstChunk = Buffer.allocUnsafe(length);
          let received = 0;
          try {
            while (received < length) {
              const read = await raceAbort(
                handle.read(
                  firstChunk,
                  received,
                  length - received,
                  start + received,
                ),
                abort.signal,
              );
              if (read.bytesRead === 0)
                throw new Error('Unexpected end of file');
              received += read.bytesRead;
            }
          } catch {
            if (abort.signal.aborted)
              throw new RequestTimeoutException('Download interrupted');
            throw new ServiceUnavailableException('File object is unavailable');
          }
        }
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
        if (abort.signal.aborted)
          throw new RequestTimeoutException('Download interrupted');
        try {
          response.write(firstChunk);
          if (start + firstChunk.length > end) {
            response.end();
            return;
          }
          await pipeline(
            handle.createReadStream({
              start: start + firstChunk.length,
              end,
              autoClose: false,
            }),
            response,
            { signal: abort.signal },
          );
        } catch (error) {
          if (!response.destroyed) response.destroy(error as Error);
        }
      } finally {
        if (abort.signal.aborted) {
          void handle.close().catch(() => undefined);
        } else {
          await handle.close();
        }
      }
    } finally {
      clearTimeout(timer);
      response.off('close', onClose);
      this.activeDownloads--;
    }
  }
}
