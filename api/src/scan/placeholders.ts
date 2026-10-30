// Documented example keys. Matched whole and case-sensitive, so a real key that only ends in EXAMPLE is not matched.
const DOCUMENTED = new Set(['AKIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY']);

// Obvious template text. Words people really use as passwords, like changeme or 123456, are not here.
const TEMPLATE: Array<[RegExp, string]> = [
  [/^<[^<>\s]{2,60}>$/, 'angle-bracket placeholder'],
  [/^(?:your|my)[_-][A-Za-z0-9_-]{1,40}[_-]here$/i, 'your_..._here placeholder'],
  [/^REPLACE[_-]?ME$/i, 'replace-me placeholder'],
  [/^x{6,}$/i, 'row of x characters'],
  [/^(.)\1{7,}$/, 'one repeated character'],
];

export function knownPlaceholder(value: string): string | null {
  if (DOCUMENTED.has(value)) return 'a documented example key';
  for (const [pattern, name] of TEMPLATE) if (pattern.test(value)) return name;
  return null;
}
