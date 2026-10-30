import { createCanvas, loadImage } from '@napi-rs/canvas';

const MAX_PIXELS = 40_000_000;
const MAX_SIDE = 2000;
const SMALL_SIDE = 1400;
const MAX_SEND_BYTES = 4 * 1024 * 1024;

// The size a PNG, JPEG or WebP says it has, read from its first bytes. A small file can claim a huge size,
// and decoding it would need gigabytes, so this is checked before anything is decoded.
export function declaredSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length >= 24 && buffer.toString('latin1', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let at = 2;
    while (at + 9 < buffer.length) {
      if (buffer[at] !== 0xff) return null;
      const marker = buffer[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(at + 5), width: buffer.readUInt16BE(at + 7) };
      }
      at += 2 + buffer.readUInt16BE(at + 2);
    }
    return null;
  }
  if (buffer.length >= 30 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buffer.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    if (kind === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

// A picture is shrunk to a sensible size and re-encoded as PNG before it goes to the model. The re-encoding also drops
// any hidden metadata. Nothing larger than MAX_SEND_BYTES is sent.
export async function prepareForModel(buffer: Buffer): Promise<Buffer> {
  const size = declaredSize(buffer);
  if (!size || size.width < 1 || size.height < 1) throw new Error('Image size could not be read.');
  if (size.width * size.height > MAX_PIXELS) throw new Error('Image is too large to read.');
  const image = await loadImage(buffer);
  if (image.width * image.height > MAX_PIXELS) throw new Error('Image is too large to read.');
  for (const side of [MAX_SIDE, SMALL_SIDE]) {
    const factor = Math.min(1, side / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * factor));
    const height = Math.max(1, Math.round(image.height * factor));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const png = canvas.toBuffer('image/png');
    if (png.length <= MAX_SEND_BYTES) return png;
  }
  throw new Error('Image is too large to send.');
}
