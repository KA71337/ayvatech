import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
// Shared across server processes and the importer; never delete another writer's lock.
export async function acquireWriteLock(root = process.env.DATA_DIR || 'data') {
  await mkdir(root, { recursive: true });
  const file = path.join(root, 'products.lock');
  const handle = await open(file, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw Object.assign(new Error('Catalogue write in progress'), { status: 409 });
    throw error;
  });
  return async () => { await handle.close(); await unlink(file); };
}
