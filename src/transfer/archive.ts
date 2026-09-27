import { zipSync, unzipSync } from 'fflate';
import { crc32 } from 'node:zlib';
import { parseManifest, safeAttachmentPath, type Manifest } from './manifest';
export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
export function buildArchive(manifest: Manifest, files: Record<string, Uint8Array>): Uint8Array {
  parseManifest(manifest);
  const entries = { ...files, 'manifest.json': Buffer.from(JSON.stringify(manifest, null, 2)) };
  if (Object.values(entries).reduce((sum, file) => sum + file.length, 0) > MAX_EXPANDED_BYTES)
    throw new Error('Workspace package exceeds the size limit.');
  const data = zipSync(entries, { level: 0 });
  if (data.length > MAX_ARCHIVE_BYTES) throw new Error('Workspace package exceeds the size limit.');
  return data;
}
export function readArchive(data: Uint8Array): {
  manifest: Manifest;
  files: Record<string, Uint8Array>;
} {
  if (data.length > MAX_ARCHIVE_BYTES) throw new Error('Workspace package exceeds the size limit.');
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    const names = new Set<string>();
    files = unzipSync(data, {
      filter: (entry) => {
        if (entry.name === 'files/' && entry.originalSize === 0) return false;
        const key = entry.name.toLowerCase();
        if (
          names.has(key) ||
          names.size >= 1001 ||
          (entry.name !== 'manifest.json' && !safeAttachmentPath(entry.name))
        )
          throw new Error('Invalid archive entry.');
        names.add(key);
        total += entry.originalSize;
        if (
          total > MAX_EXPANDED_BYTES ||
          (entry.name === 'manifest.json' && entry.originalSize > 2 * 1024 * 1024)
        )
          throw new Error('Archive size limit.');
        return true;
      },
    });
    if (!files['manifest.json']) throw new Error('Missing manifest.');
    verifyZipChecksums(data, files);
  } catch {
    throw new Error('Invalid or oversized workspace package.');
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  } catch {
    throw new Error('Invalid workspace manifest.');
  }
  const manifest = parseManifest(value);
  for (const item of manifest.workspace.items) {
    if (item.location.kind === 'attachment' && !Object.hasOwn(files, item.location.path))
      throw new Error('An attachment is missing from the package.');
  }
  return { manifest, files };
}

function verifyZipChecksums(data: Uint8Array, files: Record<string, Uint8Array>): void {
  // fflate checks the structure, but does not check ZIP's built-in CRC-32.
  // Keep this bounded to standard ZIP archives; ZIP64 is unnecessary for 25 MiB packages.
  const zip = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let end = zip.length - 22;
  const lowerBound = Math.max(0, zip.length - 65557);
  while (end >= lowerBound && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < lowerBound || zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0)
    throw new Error('Invalid ZIP directory.');
  const count = zip.readUInt16LE(end + 10);
  let position = zip.readUInt32LE(end + 16);
  if (
    count > 1002 ||
    count !== zip.readUInt16LE(end + 8) ||
    position + zip.readUInt32LE(end + 12) !== end ||
    end + 22 + zip.readUInt16LE(end + 20) !== zip.length
  )
    throw new Error('Invalid ZIP directory.');
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || zip.readUInt32LE(position) !== 0x02014b50)
      throw new Error('Invalid ZIP entry.');
    const flags = zip.readUInt16LE(position + 8);
    const nameLength = zip.readUInt16LE(position + 28);
    const next =
      position +
      46 +
      nameLength +
      zip.readUInt16LE(position + 30) +
      zip.readUInt16LE(position + 32);
    if (flags & 1 || next > end) throw new Error('Invalid ZIP entry.');
    const name = zip
      .subarray(position + 46, position + 46 + nameLength)
      .toString(flags & 0x800 ? 'utf8' : 'latin1');
    const file = files[name];
    if (
      file &&
      (file.length !== zip.readUInt32LE(position + 24) ||
        crc32(file) !== zip.readUInt32LE(position + 16))
    )
      throw new Error('Corrupt ZIP entry.');
    position = next;
  }
  if (position !== end) throw new Error('Invalid ZIP directory.');
}
