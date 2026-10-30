import { RawMatch } from './types';

interface Rule {
  type: string;
  pattern: RegExp;
  group?: number;
  groups?: number[];
  score: (value: string) => number;
  accept?: (value: string) => boolean;
}

const fixed = (score: number) => () => score;

const genericScore = (value: string): number => {
  if (value.length < 8) return 0.4;
  const mixed = /[A-Za-z]/.test(value) && /[0-9]/.test(value);
  return mixed && value.length >= 12 ? 0.75 : 0.6;
};

const CODE_LIKE = [
  /\(/,
  /^(?:process\.env|os\.environ|env\.|config\.|this\.|self\.|settings\.)/i,
  /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/,
  /^[a-z]+(?:[A-Z][a-z]+)+$/,
  /^(?:string|number|boolean|any|object|null|undefined|true|false|required|optional|none|empty)$/i,
  /^[A-Za-z]+(?: [A-Za-z]+)+$/,
];
const PLACEHOLDER = [
  /^[\[<${{]/,
  /^(?:your|my)[_-]/i,
  /[_-]here$/i,
  /^x{4,}$/i,
  /^(?:replace|insert|enter|put|fill)[_ -]?(?:me|this|in|here|your\w*)$/i,
  /^change[_-]me$/i,
  /^\*+$/,
  /^(?:password|passwd|pass|secret|token)$/i,
];
export const real = (value: string) => /[A-Za-z0-9]/.test(value) && ![...CODE_LIKE, ...PLACEHOLDER].some((pattern) => pattern.test(value));
const entropy = (value: string): number => {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) bits -= (count / value.length) * Math.log2(count / value.length);
  return bits;
};

const NOT_RANDOM = [
  /^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$|^[0-9a-f]{128}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[a-z][a-z0-9+.-]*:\/\//i,
  /^[\/.~]/,
  /^\d{4}-\d{2}-\d{2}/,
  /\.[A-Za-z]{2,5}$/,
  /%[0-9A-Fa-f]{2}/,
  /^[A-Za-z]{2,5}-\d{2,}(?:-\d+)*$/,
  /^\d+(?:\.\d+)+(?:-[A-Za-z0-9.]+)?$/,
];
const readableBase64 = (value: string): boolean => {
  if (value.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const text = Buffer.from(value, 'base64').toString('latin1');
  return (text.match(/[\x20-\x7e]/g)?.length ?? 0) / text.length >= 0.95;
};
const randomLooking = (value: string): boolean =>
  value.length >= 12 && /\p{L}/u.test(value) && /\d/.test(value) && entropy(value) >= 3.3 && !readableBase64(value) && !NOT_RANDOM.some((pattern) => pattern.test(value));

const FILLER = /^(?:no|yes|na|n\/a|tbd|ok|nil|nan|none|null)$/i;
const WHOLE = '(?:(?!&[A-Za-z0-9_]+=|[,;.]+(?:\\s|$))[^\\s"\']){6,200}';

const RULES: Rule[] = [
  { type: 'aws_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/d, score: fixed(0.95) },
  { type: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/d, score: fixed(0.95) },
  { type: 'slack_token', pattern: /\bxox[abprse]-[A-Za-z0-9-]{10,}/d, score: fixed(0.93) },
  { type: 'api_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,200}/d, score: fixed(0.95) },
  { type: 'api_key', pattern: /\bsk-proj-[A-Za-z0-9_-]{20,200}/d, score: fixed(0.95) },
  { type: 'api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/d, score: fixed(0.9) },
  { type: 'api_key', pattern: /\b[sr]k_live_[0-9A-Za-z]{20,99}\b/d, score: fixed(0.95) },
  { type: 'api_key', pattern: /\bwhsec_[0-9A-Za-z]{24,99}\b/d, score: fixed(0.9) },
  { type: 'api_key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/d, score: fixed(0.95) },
  { type: 'api_key', pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/d, score: fixed(0.93) },
  { type: 'github_token', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}/d, score: fixed(0.95) },
  { type: 'github_token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/d, score: fixed(0.95) },
  { type: 'github_token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/d, score: fixed(0.9) },
  { type: 'github_token', pattern: /\bhf_[A-Za-z0-9]{34}\b/d, score: fixed(0.9) },
  {
    type: 'private_key',
    pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]{0,12000}?-----END (?:[A-Z]+ )*PRIVATE KEY-----/d,
    score: fixed(0.97),
  },
  {
    type: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/d,
    score: fixed(0.85),
  },
  {
    type: 'generic_secret',
    pattern: new RegExp(`(?:password|passwd|passcode|pwd|secret|api[_ -]?key|token|recovery[_ -]?code)[A-Za-z0-9_-]{0,40}(?:[ \\t]*[:=][ \\t]*|[ \\t]+is[ \\t]+(?=\\S*\\d))(?:"([^"\\n]{6,200})"|'([^'\\n]{6,200})'|(${WHOLE}))`, 'dgi'),
    groups: [1, 2, 3],
    score: genericScore,
    accept: real,
  },
  {
    type: 'generic_secret',
    pattern: /(?:password|passwd|passcode|pwd)[A-Za-z0-9_-]{0,40}[ \t]*[:=][ \t]*["']?([^\s"'<>(){}\[\],;&]{1,5})(?=\s|["']|$)/dgi,
    group: 1,
    score: (value) => (value.length < 4 ? 0.3 : 0.45),
    accept: (value) => real(value) && !FILLER.test(value),
  },
  {
    type: 'generic_secret',
    pattern: /"(?:password|passwd|pwd|secret|api_?key|access_?token|client_?secret|token)"\s*:\s*"([^"\n]{6,200})"/dgi,
    group: 1,
    score: genericScore,
    accept: real,
  },
  {
    type: 'generic_secret',
    pattern: /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s\/:@"']{1,100}:([^\s\/@"']{4,200})@/dgi,
    group: 1,
    score: () => 0.8,
    accept: real,
  },
  {
    type: 'generic_secret',
    pattern: /\bBearer\s+([A-Za-z0-9._~+\/=-]{20,500})/dg,
    group: 1,
    score: () => 0.8,
    accept: real,
  },
  {
    type: 'generic_secret',
    pattern: /\bcurl\b[^\n]{0,200}?\s-u\s+["']?[^\s:"']{1,100}:([^\s"']{4,200})/dg,
    group: 1,
    score: () => 0.8,
    accept: real,
  },
  {
    type: 'generic_secret',
    pattern: /(?<!\]\s)\p{L}[\p{L}\p{M}\p{N}_-]{1,30}[ \t]*[:=\uff1a][ \t]*([^\s"'<>(){}\[\],;&]{10,128})/dgu,
    group: 1,
    score: () => 0.55,
    accept: (value) => real(value) && randomLooking(value),
  },
];

// Built once. matchAll works on a copy, so these are safe to share between calls.
const COMPILED = RULES.map((rule) => ({ rule, pattern: new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g') }));

export function detect(text: string): RawMatch[] {
  const found: RawMatch[] = [];
  const seen = new Set<string>();
  for (const { rule, pattern } of COMPILED) {
    for (const match of text.matchAll(pattern)) {
      const group = rule.groups ? (rule.groups.find((index) => match[index] !== undefined) ?? 0) : (rule.group ?? 0);
      const value = match[group];
      const indices = match.indices?.[group];
      if (!value || !indices) continue;
      if (rule.accept && !rule.accept(value)) continue;
      const key = `${indices[0]}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        type: rule.type,
        value,
        start: indices[0],
        end: indices[1],
        score: rule.score(value),
      });
    }
  }
  return found;
}
