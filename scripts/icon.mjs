import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const size = 256,
  rgba = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const cx = Math.max(64, Math.min(192, x)),
      cy = Math.max(64, Math.min(192, y));
    const background =
      x >= 8 && x < 248 && y >= 8 && y < 248 && (x - cx) ** 2 + (y - cy) ** 2 <= 56 ** 2;
    if (!background) continue;
    let color = [66, 124, 246, 255];
    const bottom = 174 + (Math.abs(x - 128) * 31) / 50;
    if (x >= 78 && x <= 178 && y >= 55 && y <= bottom) color = [255, 255, 255, 255];
    if (
      (x >= 102 && x <= 154 && Math.abs(y - 93) <= 5) ||
      (x >= 102 && x <= 139 && Math.abs(y - 119) <= 5)
    )
      color = [66, 124, 246, 255];
    rgba.set(color, i);
  }
function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const scan = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++)
  rgba.copy(scan, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(scan)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync('resources/icon.png', png);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
writeFileSync('resources/icon.ico', Buffer.concat([icoHeader, png]));
