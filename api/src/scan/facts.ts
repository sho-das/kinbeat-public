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

// Fixed fields about the file only. Example words near a value are left to the AI, which reads the text itself.
export function buildFacts(fileName?: string): string {
  const parts = (fileName ?? '').split(/[\\/>]/).map((part) => part.trim()).filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  const fileType = fileName === undefined ? 'text' : FILE_TYPES.find(([, pattern]) => pattern.test(base))?.[0] ?? 'other';
  const folders = parts.slice(0, -1);
  const folder = FOLDERS.find(([, pattern]) => folders.some((part) => pattern.test(part)))?.[0] ?? (/\.(?:example|sample)$/i.test(base) ? 'example' : 'none');
  return `file_type=${fileType}; folder=${folder}`;
}
