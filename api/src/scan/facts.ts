import { Candidate } from './types';

const HINT_SCAN_LIMIT = 1500;
const HINT_WORDS = /\b(example|sample|dummy|placeholder|fake|revoked|rotated|expired|test|demo|mock)\b/gi;
const FILE_TYPES: Array<[string, RegExp]> = [
  ['env', /(?:^|\.)env(?:\.[a-z]+)?$|\.env$/i],
  ['code', /\.(?:ts|tsx|js|jsx|mjs|py|go|java|rb|php|cs|sh)$/i],
  ['config', /\.(?:json|ya?ml|toml|ini|cfg|conf)$/i],
  ['doc', /\.md$/i],
  ['log', /\.log$/i],
  ['text', /\.(?:txt|csv)$/i],
];
const FOLDERS: Array<[string, RegExp]> = [
  ['tests', /^(?:tests?|__tests__|specs?)$/i],
  ['fixtures', /^(?:fixtures?|mocks?|__mocks__)$/i],
  ['docs', /^(?:docs?|documentation)$/i],
  ['example', /^(?:examples?|samples?)$/i],
];

export function buildFacts(text: string, candidate: Candidate, fileName?: string, all: Candidate[] = [candidate]): string {
  const parts = (fileName ?? '').split(/[\\/>]/).map((part) => part.trim()).filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  const fileType = fileName === undefined ? 'text' : FILE_TYPES.find(([, pattern]) => pattern.test(base))?.[0] ?? 'other';
  const folders = parts.slice(0, -1);
  const folder = FOLDERS.find(([, pattern]) => folders.some((part) => pattern.test(part)))?.[0] ?? (/\.(?:example|sample)$/i.test(base) ? 'example' : 'none');

  const start = candidate.spans[0].start;
  const from = Math.max(0, start - HINT_SCAN_LIMIT / 2);
  // A hint word inside a found secret is the secret itself, so found secrets are blanked out before looking for hint words.
  let window = text.slice(from, start + HINT_SCAN_LIMIT / 2);
  for (const found of [candidate, ...all]) {
    for (const span of found.spans) {
      const a = Math.max(span.start, from) - from;
      const b = Math.min(span.end, from + window.length) - from;
      if (b > a) window = window.slice(0, a) + ' '.repeat(b - a) + window.slice(b);
    }
  }
  let hint = 'none';
  let nearest = Infinity;
  for (const match of window.matchAll(HINT_WORDS)) {
    const distance = Math.abs(from + (match.index ?? 0) - start);
    if (distance < nearest) {
      nearest = distance;
      hint = match[1].toLowerCase();
    }
  }
  return `file_type=${fileType}; folder=${folder}; hint=${hint}`;
}
