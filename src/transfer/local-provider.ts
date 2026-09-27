import { open, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MAX_ARCHIVE_BYTES } from './archive';
export async function readLocalArchive(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES)
      throw new Error('Workspace package exceeds the size limit.');
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_ARCHIVE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_ARCHIVE_BYTES) throw new Error('Workspace package exceeds the size limit.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}
export async function writeLocalArchive(path: string, data: Uint8Array): Promise<void> {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, data, { flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
