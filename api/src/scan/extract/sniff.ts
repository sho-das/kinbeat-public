import { maskName } from '../scrubber';
import { zipNames } from './zip';

type FileKind = 'png' | 'jpg' | 'webp' | 'pdf' | 'docx' | 'zip' | 'text';

const TEXT_EXTENSIONS = [
  'txt', 'md', 'csv', 'json', 'log', 'jsonl', 'eml', 'html', 'xml', 'sql',
  'env', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'toml', 'properties',
  'sh', 'js', 'ts', 'py', 'rb', 'go', 'java', 'php', 'tf',
];
const IMAGE_EXTENSIONS: Record<string, FileKind> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' };

const KNOWN_EXTENSIONS = [...Object.keys(IMAGE_EXTENSIONS), 'pdf', 'docx', 'zip', ...TEXT_EXTENSIONS];

type SniffResult = { ok: true; kind: FileKind } | { ok: false; error: string };

export function cleanName(name: string): string {
  const base = (name || 'file').split(/[\\/]/).pop() || 'file';
  return maskName(base.replace(/[^\x20-\x7e]/g, '_')).slice(0, 100) || 'file';
}

function extensionOf(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (base.startsWith('.env')) return 'env';
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1);
}

function magicKind(buffer: Buffer): FileKind | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  // A PDF starts with %PDF-. Some have a few bytes of junk first, so look in the first 1 KB, but only in a file that is not plain text.
  const head = buffer.subarray(0, 1024).toString('latin1');
  if (head.startsWith('%PDF-') || (head.includes('%PDF-') && !looksLikeText(buffer))) return 'pdf';
  if (buffer.length >= 4 && buffer.toString('latin1', 0, 4) === 'PK\u0003\u0004') {
    const names = zipNames(buffer);
    if (names.includes('word/document.xml') && names.includes('[Content_Types].xml')) return 'docx';
    return 'zip';
  }
  return null;
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  if (sample.includes(0)) return false;
  const decoded = sample.toString('utf8');
  const bad = (decoded.match(/�/g) ?? []).length;
  return bad <= Math.max(1, decoded.length * 0.01);
}

export function sniff(name: string, buffer: Buffer): SniffResult {
  const extension = extensionOf(name);
  // cleanName scans the name for secrets, so it is only built when an error needs it.
  const label = () => `"${cleanName(name)}"`;
  if (buffer.length === 0) return { ok: false, error: `File ${label()} is empty.` };
  const magic = magicKind(buffer);
  // Any other name or extension: the content decides. A known file type is read as that type, plain text is read as text.
  if (!KNOWN_EXTENSIONS.includes(extension)) {
    if (magic !== null) return { ok: true, kind: magic };
    if (looksLikeText(buffer)) return { ok: true, kind: 'text' };
    return { ok: false, error: `File ${label()} could not be read: it is not text, an image, a PDF or a Word file.` };
  }
  if (TEXT_EXTENSIONS.includes(extension)) {
    if (magic !== null || !looksLikeText(buffer)) {
      return { ok: false, error: `File ${label()} has a text extension but its content is not plain text.` };
    }
    return { ok: true, kind: 'text' };
  }
  const expected = IMAGE_EXTENSIONS[extension] ?? (extension as FileKind);
  if (magic !== expected) {
    return { ok: false, error: `File ${label()} content does not match its .${extension} extension.` };
  }
  return { ok: true, kind: expected };
}
