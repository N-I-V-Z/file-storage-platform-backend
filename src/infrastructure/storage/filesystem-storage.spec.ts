import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { FilesystemStorage } from './filesystem-storage.js';

describe('FilesystemStorage', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fsp-storage-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates private directories and promotes only generated IDs', async () => {
    const storage = new FilesystemStorage(root);
    await storage.init();
    expect((await readdir(root)).sort()).toEqual([
      'objects',
      'processing',
      'quarantine',
      'temporary',
    ]);
    const id = randomUUID();
    await pipeline(Readable.from(['file bytes']), storage.createTemporary(id));
    await storage.promote(id);
    expect(await readFile(storage.objectPath(id), 'utf8')).toBe('file bytes');
    await storage.remove(id);
    expect(await readdir(join(root, 'temporary'))).toEqual([]);
    expect(() => storage.objectPath('../escape')).toThrow();
  });

  it('rejects a symlinked storage directory', async () => {
    const target = join(root, 'outside');
    await mkdir(target);
    await symlink(target, join(root, 'temporary'), 'junction');
    await expect(new FilesystemStorage(root).init()).rejects.toThrow();
  });
});
