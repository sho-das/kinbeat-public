import { readZip } from './zip';

const MAX_UNPACKED = 100 * 1024 * 1024;
const MAX_PART_CHARS = 2_000_000;
const TEXT_PART = /^word\/(?:(?:header|footer)\d*|comments|footnotes|endnotes)\.xml$/;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function unpackedSize(zip: Buffer): number {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return Number.POSITIVE_INFINITY;
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) return Number.POSITIVE_INFINITY;
    total += zip.readUInt32LE(offset + 24);
    offset += 46 + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  return total;
}

function partText(xml: string): string {
  const lines: string[] = [];
  for (const paragraph of xml.slice(0, MAX_PART_CHARS).split(/<\/w:p>/)) {
    let line = '';
    for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>/g)) {
      line += match[1] === undefined ? '\t' : match[1].replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, name: string) => {
        if (name[0] === '#') {
          const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
          return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[name] ?? whole;
      });
    }
    if (line.trim()) lines.push(line);
  }
  return lines.join('\n');
}

export async function readDocx(buffer: Buffer): Promise<string> {
  if (unpackedSize(buffer) > MAX_UNPACKED) throw new Error('Word document unpacks to too much data.');
  // The sizes above are only what the file says. This unpacks every part with a hard cap at its declared size, so a part that is bigger is caught before the real readers run.
  const checked = readZip(buffer, { maxEntries: 10_000, maxEntryBytes: MAX_UNPACKED, maxTotalBytes: MAX_UNPACKED });
  if (checked.skipped['damaged entry']) throw new Error('Word document has parts bigger than the sizes it declares.');
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const parts = [String(result.value ?? '')];
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files).filter((entry) => TEXT_PART.test(entry)).sort()) {
    const text = partText(await zip.files[name].async('string'));
    if (text) parts.push(text);
  }
  return parts.join('\n');
}
