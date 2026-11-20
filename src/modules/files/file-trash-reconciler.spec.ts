import { ConfigService } from '@nestjs/config';
import type { ValidatedEnvironment } from '../../config/env.validation.js';
import { FileTrashReconciler } from './file-trash-reconciler.js';
import { FilesRepository } from './files.repository.js';
import { FileTrashService } from './file-trash.service.js';

describe('FileTrashReconciler', () => {
  it('does not sweep shared database rows during test app bootstrap', async () => {
    const listPurgeCandidates = vi.fn(async () => []);
    const files = { listPurgeCandidates } as unknown as FilesRepository;
    const trash = {} as FileTrashService;
    const config = {
      getOrThrow: vi.fn(() => 'test'),
    } as unknown as ConfigService<ValidatedEnvironment, true>;
    const reconciler = new FileTrashReconciler(files, trash, config);
    await reconciler.onApplicationBootstrap();
    expect(listPurgeCandidates).not.toHaveBeenCalled();
    reconciler.onModuleDestroy();
  });

  it('still scans pending purges on normal app bootstrap', async () => {
    const listPurgeCandidates = vi.fn(async () => []);
    const files = { listPurgeCandidates } as unknown as FilesRepository;
    const trash = {} as FileTrashService;
    const config = {
      getOrThrow: vi.fn(() => 'production'),
    } as unknown as ConfigService<ValidatedEnvironment, true>;
    const reconciler = new FileTrashReconciler(files, trash, config);
    await reconciler.onApplicationBootstrap();
    expect(listPurgeCandidates).toHaveBeenCalledOnce();
    reconciler.onModuleDestroy();
  });
});
