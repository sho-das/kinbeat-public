import { inflateRawSync } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  // When given, only entries it says yes to are read. The others are passed over before anything is counted or unpacked.
  keep?: (name: string) => boolean;
}

interface ZipRead {
  entries: ZipEntry[];
  skipped: Record<string, number>;
}

const ZIP64 = 0xffffffff;

export function isSafePath(name: string): boolean {
  if (!name || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split(/[\\/]/).some((part) => part === '..');
}

// The file names listed in the zip's table of contents, without unpacking anything. Empty when the table cannot be read.
export function zipNames(zip: Buffer): string[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const names: string[] = [];
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) return names;
    const flags = zip.readUInt16LE(offset + 8);
    const nameLength = zip.readUInt16LE(offset + 28);
    names.push(zip.toString(flags & 0x800 ? 'utf8' : 'latin1', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  return names;
}

export function readZip(zip: Buffer, limits: ZipLimits): ZipRead {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a valid zip file.');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === ZIP64) throw new Error('Zip files over 4 GB (zip64) are not supported.');

  const entries: ZipEntry[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  let total = 0;

  for (let i = 0; i < count; i++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString(flags & 0x800 ? 'utf8' : 'latin1', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (!isSafePath(name)) {
      skip('unsafe path');
      continue;
    }
    const base = name.split(/[\\/]/).pop() ?? '';
    if (name.startsWith('__MACOSX/') || base.startsWith('._') || base === '.DS_Store' || name.split('/').includes('.git')) continue;
    if (limits.keep && !limits.keep(name)) continue;
    if (entries.length >= limits.maxEntries) {
      skip('over the file limit');
      continue;
    }
    if (flags & 1) {
      skip('password protected');
      continue;
    }
    if (method !== 0 && method !== 8) {
      skip('unsupported compression');
      continue;
    }
    if (compressed === ZIP64 || size === ZIP64 || size > limits.maxEntryBytes) {
      skip('file over the size limit');
      continue;
    }
    if (total + size > limits.maxTotalBytes) {
      skip('over the total size limit');
      continue;
    }
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) {
      skip('damaged entry');
      continue;
    }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);
    let data: Buffer;
    try {
      data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: size + 1 });
    } catch {
      skip('damaged entry');
      continue;
    }
    if (data.length !== size) {
      skip('damaged entry');
      continue;
    }
    total += size;
    entries.push({ name, data });
  }
  return { entries, skipped };
}
