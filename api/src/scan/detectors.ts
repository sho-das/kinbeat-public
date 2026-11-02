import { RawMatch } from './types';

interface Rule {
  type: string;
  pattern: RegExp;
  group?: number;
  groups?: number[];
  score: (value: string) => number;
  accept?: (value: string, match: RegExpMatchArray) => boolean;
  weak?: boolean;
}

const fixed = (score: number) => () => score;

const genericScore = (value: string): number => {
  if (value.length < 8) return 0.4;
  const mixed = /[A-Za-z]/.test(value) && /[0-9]/.test(value);
  return mixed && value.length >= 12 ? 0.75 : 0.6;
};

const CODE_LIKE = [
  // A call such as getPassword() or req.body.password(), and a value that starts with a bracket such as (e) =>. A value like P@ss(2024)xZ is kept.
  /^[A-Za-z_$][\w$.?:<>,-]*\(/,
  /^\(/,
  // A regular expression written as a value, such as /^(?=.*[a-z]).{8,}$/. A value with only a leading slash, such as a base64 key, is kept.
  /^\/.+\/[gimsuy]*;?$/,
  /^(?:process\.env|os\.environ|env\.|config\.|this\.|self\.|settings\.)/i,
  /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+[,;]?$/,
  // A generic type such as Optional[str], and a name of lowercase words such as tls-secret: both point at something and hold no secret.
  /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\[/,
  /^(?:string|number|boolean|any|object|null|undefined|true|false|required|optional|none|empty)$/i,
];
// A name written as one word, such as new-password, newPassword, new_password, PasswordInput or SECRET_KEY, points at something.
// After an = or : with no quotes it is a name used in code. In quotes it is a text value, which may be a real password, so it is kept.
const NAME_SHAPES = [/^[a-z]+-[a-z]{1,12}$/, /^[a-z]+(?:[A-Z][a-z]+)+$/, /^[a-z]+(?:_[a-z]+)+$/, /^(?:[A-Z][a-z]+){2,}$/, /^[A-Z]+(?:_[A-Z]+)+$/];
const PLACEHOLDER = [
  // A YAML tag or an encrypted value, such as !vault, ENC[AES256_GCM,...] or $ANSIBLE_VAULT;1.1, holds no readable secret.
  /^!{1,2}[a-z]+$/,
  /^ENC\[/,
  /^\$ANSIBLE_VAULT/,
  // A template slot or an empty bracket, judged on the whole value. A value that only starts with $ or [ can be a real secret.
  /^\$\{[A-Za-z_][\w.-]*\}$/,
  /^\$[A-Z_][A-Z0-9_]*$/,
  /^\{\{[^}]*\}\}$/,
  // A note in brackets holds words only. With digits inside, such as [X9k2mQ7vLp], it may be a real value and is kept.
  /^\{[A-Za-z][A-Za-z _.-]*\}$/,
  /^<[A-Za-z][A-Za-z _.-]*>$/,
  /^<\/?[A-Za-z][A-Za-z0-9-]*\/?>$/,
  /^\[[A-Za-z][A-Za-z _.-]*\]$/,
  // The first word of a bracketed note, such as [hidden by admin] or [REDACTED. A bracket followed by digits or symbols is kept.
  /^[\[<{][A-Za-z][A-Za-z_-]*[\]>}]?$/,
  /^%[A-Za-z_][\w.]*%$/,
  /^@[A-Z_][A-Z0-9_]*@$/,
  /^%(?:\d\$)?[sdif]$/,
  /^(?:your|my)[_-]/i,
  /[_-]here$/i,
  /^x{4,}$/i,
  /^(?:replace|insert|enter|put|fill)[_ -]?(?:me|this|in|here|your\w*)$/i,
  /^change[_-]me$/i,
  /^\*+$/,
  /^(?:password|passwd|pass|secret|token)$/i,
  // Words that name something and hold no secret: an HTTP scheme (Bearer), the name of an environment variable (DB_PASSWORD),
  // a pointer to a secret store (arn:aws:secretsmanager:..., vault://...), a lookup key (user:1234:profile) and the name of a stored secret (db-credentials).
  /^(?:bearer|basic|digest|oauth|negotiate)$/i,
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:PASSWORD|PASSWD|PWD|TOKEN|KEY|SECRET|CREDENTIALS?)$/,
  /^(?:arn:aws[\w-]*:|vault:\/\/|ssm:|secret:\/\/|op:\/\/|akv:\/\/|projects\/[^/]+\/secrets\/)/i,
  /^[a-z][a-z0-9_-]*:\d+:[a-z][a-z0-9_:-]*$/,
  /^[a-z][a-z_-]*(?::[a-z][a-z_-]*){2,}$/,
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:secrets?|credentials?|tokens?)$/,
];
// A type name or a keyword of a programming language, such as the string in password: string or the async in handle = async () =>.
// Trailing punctuation is ignored, so string) and string): count too. It is the same in any language and any project.
const CODE_WORD =
  /^(?:string|number|boolean|bool|any|unknown|void|never|object|bigint|symbol|int|float|double|str|bytes|list|dict|array|map|set|char|long|short|null|nil|none|undefined|true|false|async|await|function|func|def|fn|lambda|class|const|let|var|new|return|this|self|type|typeof|interface|enum|readonly|optional|required|import|export|void|secretstr|secretbytes|chararray|bytearray|stringbuilder|after|before|hover|focus|visited|checked|disabled)$/i;
// Plain function words. In a sentence such as how do I reset my password: is there a link, the word after the colon is not a value.
// Only the short password rule uses this, and only after a colon: pwd=at is still a short password.
const PLAIN_WORD = /^(?:is|it|its|the|a|an|to|of|for|and|or|you|your|my|me|we|are|was|be|if|in|on|at|as|how|what|why|when|where|which|that|this|there|here|do|can|will|should|must|has|have|had|not)$/i;
// Several words in a row that start with a capital, such as Mot de passe or Password must be 8 characters, are a sentence.
// All-lowercase words, such as correct horse battery staple, may be a passphrase and are kept.
const looksLikeSentence = (value: string) => {
  const words = value.split(' ');
  if (words.length < 2 || !words.every((word) => /^[\p{L}\p{N}'",.:;!?()+%-]+$/u.test(word))) return false;
  return /^\p{Lu}\p{Ll}/u.test(value);
};
// Validation rules written as a string, such as Laravel's required|min:8 or required|same:password. Every part must be a known rule name.
const RULE_NAMES = new Set(['required', 'nullable', 'sometimes', 'string', 'numeric', 'integer', 'boolean', 'email', 'min', 'max', 'size', 'between', 'same', 'different', 'confirmed', 'unique', 'exists', 'regex', 'alpha', 'alpha_num', 'alpha_dash', 'in', 'not_in', 'url', 'date', 'array', 'accepted', 'present', 'filled']);
const looksLikeRules = (value: string) => /^[a-z_]+(?::[\w,.-]+)?(?:\|[a-z_]+(?::[\w,.-]+)?)*$/.test(value) && value.split('|').every((part) => RULE_NAMES.has(part.split(':')[0]));
const hasCodeWord = (value: string) => {
  const core = value.replace(/[)\]};:,>=?]+$/, '');
  return CODE_WORD.test(core) || looksLikeSentence(value) || looksLikeRules(value);
};
export const real = (value: string, quoted = false) =>
  /[A-Za-z0-9]/.test(value) && ![...CODE_LIKE, ...PLACEHOLDER, ...(quoted ? [] : NAME_SHAPES)].some((pattern) => pattern.test(value)) && !hasCodeWord(value);
const isQuoted = (match: RegExpMatchArray) => match[1] !== undefined || match[2] !== undefined;
const entropy = (value: string): number => {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) bits -= (count / value.length) * Math.log2(count / value.length);
  return bits;
};

// A version number such as 4.5.7, v1.2.3-beta.1 or kustomize/v4.5.7. It names a release and holds no secret.
const VERSION = /^(?:[a-z0-9-]+\/)?v?\d+(?:\.\d+)+(?:[-+][A-Za-z0-9.]+)?$/i;
// A word that names a password. A value after it is kept even when it looks like a version, since a person may choose 10.4.12.
const PASSWORD_NAME = /^(?:password|passwd|passcode|pwd)/i;

const NOT_RANDOM = [
  /^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$|^[0-9a-f]{128}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[a-z][a-z0-9+.-]*:\/\//i,
  /^[\/.~]/,
  /^\d{4}-\d{2}-\d{2}/,
  /\.[A-Za-z]{2,5}$/,
  /%[0-9A-Fa-f]{2}/,
  /^[A-Za-z]{2,5}-\d{2,}(?:-\d+)*$/,
  VERSION,
  // A Kubernetes API version such as external-secrets.io/v1beta1 or apps/v1.
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\/v\d+(?:(?:alpha|beta)\d+)?$/,
];
const readableBase64 = (value: string): boolean => {
  if (value.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const text = Buffer.from(value, 'base64').toString('latin1');
  return (text.match(/[\x20-\x7e]/g)?.length ?? 0) / text.length >= 0.95;
};
const randomLooking = (value: string): boolean =>
  value.length >= 12 && /\p{L}/u.test(value) && /\d/.test(value) && entropy(value) >= 3.3 && !readableBase64(value) && !NOT_RANDOM.some((pattern) => pattern.test(value));

// Style class names such as hover:bg-red-500/20 or data-active:after:opacity-100: a chain of plain words and small numbers,
// often with more colons inside. A random token has segments that mix letters and digits, so it does not match.
const STYLE_SEGMENT = '-?(?:[a-z]+|\\d{1,4}(?:\\.\\d)?|\\[[^\\]\\s]{1,30}\\])';
const STYLE_CHAIN = new RegExp(`^${STYLE_SEGMENT}(?:[-:/]${STYLE_SEGMENT})*$`);
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
    pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----(?:(?!-----BEGIN)[\s\S]){0,12000}?-----END (?:[A-Z]+ )*PRIVATE KEY-----/d,
    score: fixed(0.97),
  },
  {
    type: 'jwt',
    // A match may start only at the start of a run, and each part has an upper bound. Without both, text such as eyJ-eyJ-eyJ-... took minutes.
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,20000}\.eyJ[A-Za-z0-9_-]{8,20000}\.[A-Za-z0-9_-]{8,20000}/d,
    score: fixed(0.85),
  },
  {
    type: 'generic_secret',
    pattern: new RegExp(`(?:password|passwd|passcode|pwd|secret|api[_ -]?key|token|recovery[_ -]?code)[A-Za-z0-9_-]{0,40}(?:[ \\t]*(?::=|[:=])[ \\t]*|[ \\t]+is[ \\t]+(?=\\S*\\d))(?:"([^"\\n]{6,200})"|'([^'\\n]{6,200})'|(${WHOLE}))`, 'dgi'),
    groups: [1, 2, 3],
    score: genericScore,
    accept: (value, match) => real(value, isQuoted(match)) && (!VERSION.test(value) || PASSWORD_NAME.test(match[0])),
  },
  {
    type: 'generic_secret',
    pattern: /(?:password|passwd|passcode|pwd)[A-Za-z0-9_-]{0,40}[ \t]*(?::=|[:=])[ \t]*["']?([^\s"'<>(){}\[\],;&]{1,5})(?=\s|["']|$)/dgi,
    group: 1,
    score: (value) => (value.length < 4 ? 0.3 : 0.45),
    accept: (value, match) => real(value) && !FILLER.test(value) && !(match[0].includes(':') && PLAIN_WORD.test(value)),
  },
  {
    type: 'generic_secret',
    pattern: /"(?:[A-Za-z0-9]{1,20}[_-])*(?:password|passwd|pwd|secret|api_?key|access_?token|client_?secret|token)"\s*:\s*"([^"\n]{6,200})"/dgi,
    group: 1,
    score: genericScore,
    accept: (value) => real(value, true),
  },
  {
    type: 'generic_secret',
    pattern: /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s\/:@"']{0,100}:([^\s\/@"']{4,200})@/dgi,
    group: 1,
    score: () => 0.8,
    accept: (value) => real(value),
  },
  {
    type: 'generic_secret',
    pattern: /\bBearer\s+([A-Za-z0-9._~+\/=-]{20,500})/dg,
    group: 1,
    score: () => 0.8,
    accept: (value) => real(value),
  },
  {
    type: 'generic_secret',
    pattern: /\bcurl\b[^\n]{0,200}?\s-u\s+["']?[^\s:"']{1,100}:([^\s"']{4,200})/dg,
    group: 1,
    score: () => 0.8,
    accept: (value) => real(value),
  },
  {
    type: 'generic_secret',
    // A label right after a quote or a colon is a piece of a text such as "user:1234:profile" or an arn, not a label.
    // A value in backticks is read without them, so `report-2026.csv` is seen as a file name.
    pattern: /(?<!\]\s)(?<![\p{L}\p{M}\p{N}_"':-])\p{L}[\p{L}\p{M}\p{N}_-]{1,30}[ \t]*[:=\uff1a][ \t]*`?([^\s"'`<>(){}\[\],;&]{10,128})/dgu,
    group: 1,
    score: () => 0.55,
    accept: (value) => real(value) && randomLooking(value) && !looksLikeCode(value) && !STYLE_CHAIN.test(value),
    weak: true,
  },
  {
    // A value inside an XML element named like a secret, such as <password>...</password> in a Maven settings.xml.
    // The whole element name must be the secret word (dotted names such as gpg.passphrase count), so <ClientSecretId> does not.
    type: 'generic_secret',
    pattern: /<((?:[\w-]+\.)*(?:password|passphrase|passwd|secret|token|api[_-]?key|master))>([^<\s]{6,200})<\/\1>/dgi,
    group: 2,
    score: () => 0.75,
    accept: (value) => !/\$\{|\$\(|#\{|@@/.test(value) && !/^(?:true|false|yes|no|null)$/i.test(value) && (/^\{[A-Za-z0-9+\/]{20,}={0,2}\}$/.test(value) || (!value.startsWith('{') && real(value, true))),
  },
  // Fixed shapes: the form of the value alone says it is a credential.
  { type: 'api_key', pattern: /\bSK[0-9a-f]{32}\b/d, score: fixed(0.9) },
  { type: 'api_key', pattern: /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{60,80}/d, score: fixed(0.93) },
  { type: 'api_key', pattern: /\bya29\.[A-Za-z0-9_-]{30,}/d, score: fixed(0.9) },
  {
    // A name with a secret word in it and a quoted value that looks random, such as db_pass = "..." or authKey: '...'.
    type: 'generic_secret',
    pattern: /(?<![A-Za-z])(?:pass|auth|credentials?|secret|token|api[_-]?key|private[_-]?key|pwd)(?![a-z])[A-Za-z0-9_.-]{0,30}["']?[ \t]*[:=\uff1a][ \t]*(?:"([^"\n]{10,200})"|'([^'\n]{10,200})')/dgi,
    groups: [1, 2],
    score: () => 0.55,
    accept: (value) => !value.startsWith('-----BEGIN') && real(value, true) && randomLooking(value) && !looksLikeCode(value),
  },
  {
    // A literal that stands after an environment lookup of a secret, such as process.env.JWT_SECRET || "...". The lookup itself is not flagged.
    type: 'generic_secret',
    pattern: /process\.env\.\w*(?:secret|token|pass|pwd|cred|auth|api_?key|private_?key|signing_?key|access_?key)\w*[ \t]*(?:\|\||\?\?)[ \t]*(?:"([^"\n]{10,200})"|'([^'\n]{10,200})')/dgi,
    groups: [1, 2],
    score: () => 0.6,
    accept: (value) => real(value, true) && randomLooking(value) && !looksLikeCode(value),
  },
  {
    type: 'generic_secret',
    pattern: /(?:os\.getenv|os\.environ\.get|getenv|ENV\.fetch)\([ \t]*["'][^"'\n]*(?:secret|token|pass|pwd|cred|auth|api_?key|private_?key|signing_?key|access_?key)[^"'\n]*["'][ \t]*,[ \t]*(?:"([^"\n]{10,200})"|'([^'\n]{10,200})')/dgi,
    groups: [1, 2],
    score: () => 0.6,
    accept: (value) => real(value, true) && randomLooking(value) && !looksLikeCode(value),
  },
  {
    // A Terraform variable that is named like a secret and has a literal default.
    type: 'generic_secret',
    pattern: /\bvariable[ \t]+"[^"\n]*(?:pass|secret|token|api_?key|private_?key|cred)[^"\n]*"[ \t]*\{[^}]{0,300}?\bdefault[ \t]*=[ \t]*"([^"\n]{6,200})"/dgi,
    group: 1,
    score: genericScore,
    accept: (value) => real(value, true),
  },
];

// A CSS class such as border-gray-300, ring-offset-2 or bg-primary/50, and a property chain such as member?.display_name1,
// are code and not a secret. A word-and-number class has only lowercase words and short numbers, which a random token never does.
const CSS_CLASS = /^[a-z]+(?:-(?:[a-z]{1,12}|\d{1,3}))+(?:\/\d{1,3})?$/;
const PROPERTY_CHAIN = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/;
const PLAIN_NAME = /^[A-Za-z_$]+\d{0,2}$/;
function looksLikeCode(value: string): boolean {
  if (CSS_CLASS.test(value)) return true;
  if (!PROPERTY_CHAIN.test(value)) return false;
  // A chain with ?. is code. A plain chain is code only when every part is a short readable name, so a token such as a.b.c is kept.
  return value.includes('?.') || value.split('.').every((part) => part.length <= 20 && PLAIN_NAME.test(part));
}

// Built once. matchAll works on a copy, so these are safe to share between calls.
const COMPILED = RULES.map((rule) => ({ rule, pattern: new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g') }));

// A table has its names on the first line and the values below, so a per-line rule never joins them.
// This reads a header line with a secret-like column name, then takes that column from the rows under it.
const CSV_DELIMITERS = [',', '\t', ';', '|'];
const CSV_HEADER = /^[A-Za-z][A-Za-z0-9 _.-]{0,40}$/;
const CSV_SECRET_HEADER = /^(?:[\w.-]*[ _.-])?(?:password|passwd|pwd|passcode|secret|token|api[ _.-]?key|private[ _.-]?key|credential)s?$/i;
const CSV_NOT_A_SECRET = /^(?:true|false|yes|no|y|n|null|none|n\/a|\d+|\d{4}-\d{2}-\d{2}.*)$/i;
const CSV_MAX_ROWS = 5000;
interface Cell {
  text: string;
  start: number;
  end: number;
}
// Splits one line at a delimiter outside quotes. start and end are positions in the whole text and leave out quotes and spaces.
function splitCells(line: string, offset: number, delimiter: string): Cell[] {
  const cells: Cell[] = [];
  let from = 0;
  let quoted = false;
  for (let index = 0; index <= line.length; index++) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    if (index < line.length && (quoted || char !== delimiter)) continue;
    let start = from;
    let end = index;
    while (start < end && /[ \t"]/.test(line[start])) start++;
    while (end > start && /[ \t"\r]/.test(line[end - 1])) end--;
    cells.push({ text: line.slice(start, end), start: offset + start, end: offset + end });
    from = index + 1;
  }
  return cells;
}
function tableSecrets(text: string): RawMatch[] {
  const found: RawMatch[] = [];
  const lines: Array<{ text: string; offset: number }> = [];
  for (let offset = 0; offset <= text.length; ) {
    const end = text.indexOf('\n', offset);
    const stop = end < 0 ? text.length : end;
    lines.push({ text: text.slice(offset, stop), offset });
    offset = stop + 1;
  }
  for (let row = 0; row < lines.length - 1; row++) {
    const header = lines[row];
    if (header.text.length > 400) continue;
    for (const delimiter of CSV_DELIMITERS) {
      if (!header.text.includes(delimiter)) continue;
      const names = splitCells(header.text, header.offset, delimiter).filter((cell, index, all) => cell.text !== '' || (index > 0 && index < all.length - 1));
      if (names.length < 2 || !names.every((cell) => CSV_HEADER.test(cell.text))) continue;
      const columns = names.map((cell, index) => (CSV_SECRET_HEADER.test(cell.text) ? index : -1)).filter((index) => index >= 0);
      if (!columns.length) continue;
      // A line that starts or ends with the delimiter, such as a markdown table, has an empty first or last cell.
      const edge = header.text.trim().startsWith(delimiter) ? 1 : 0;
      let next = row + 1;
      for (; next < lines.length && next - row <= CSV_MAX_ROWS; next++) {
        const line = lines[next];
        if (line.text.trim() === '') break;
        if (/^[\s|+:-]+$/.test(line.text)) continue;
        const all = splitCells(line.text, line.offset, delimiter);
        const cells = edge ? all.slice(1, all.length - (line.text.trim().endsWith(delimiter) ? 1 : 0)) : all;
        if (cells.length !== names.length) break;
        for (const column of columns) {
          const cell = cells[column];
          if (!cell || cell.text.length < 4 || CSV_NOT_A_SECRET.test(cell.text) || !real(cell.text, true)) continue;
          found.push({ type: 'generic_secret', value: cell.text, start: cell.start, end: cell.end, score: genericScore(cell.text) });
        }
      }
      // The rows read here are not read again as a header, so a long text stays one pass.
      row = Math.max(row, next - 1);
      break;
    }
  }
  return found;
}

// A Kubernetes Secret (kind: Secret) keeps its values under data: (base64) or stringData: (plain text).
// The file says these are secrets, so each value is a finding even when it does not look random.
// Read line by line, one document (between --- lines) at a time, so a big file stays one pass.
const K8S_KIND = /^[ \t]*(?:-[ \t]+)?kind:[ \t]*["']?Secret["']?[ \t]*(?:#.*)?$/im;
const K8S_API = /^[ \t]*(?:-[ \t]+)?apiVersion:[ \t]*["']?v1["']?[ \t]*(?:#.*)?$/m;
const K8S_FIELD = /^([ \t]*(?:-[ \t]+)?)(data|stringData):[ \t]*(?:#.*)?$/;
const K8S_KEY = /^([ \t]+)([\w.-]+):[ \t]*(.*?)[ \t]*$/;
const K8S_SECRET_KEY = /pass|secret|token|key|cred|auth|private|htpasswd|docker(?:cfg|configjson)|\.env$/i;
const K8S_PUBLIC_KEY = /(?:^|\.)(?:crt|pem|cert|namespace)$|^ca\b/i;
const K8S_MAX_BLOCK_LINES = 200;
const K8S_MAX_VALUE = 8_000;

function kubernetesSecrets(text: string): RawMatch[] {
  if (!K8S_KIND.test(text)) return [];
  const found: RawMatch[] = [];
  const lines: Array<{ text: string; offset: number }> = [];
  for (let offset = 0; offset <= text.length; ) {
    const end = text.indexOf('\n', offset);
    const stop = end < 0 ? text.length : end;
    lines.push({ text: text.slice(offset, stop).replace(/\r$/, ''), offset });
    offset = stop + 1;
  }
  const indent = (line: string) => line.length - line.trimStart().length;
  const keyColumn = (line: string) => line.match(/^[ \t]*(?:-[ \t]+)?/)![0].length;
  let first = 0;
  for (let last = 0; last <= lines.length; last++) {
    if (last < lines.length && !/^---[ \t]*$/.test(lines[last].text)) continue;
    const doc = lines.slice(first, last);
    first = last + 1;
    const docText = doc.map((line) => line.text).join('\n');
    if (!K8S_KIND.test(docText) || !K8S_API.test(docText)) continue;
    const kindLine = doc.find((line) => K8S_KIND.test(line.text))!;
    for (let row = 0; row < doc.length; row++) {
      const field = K8S_FIELD.exec(doc[row].text);
      // Only data: and stringData: that sit beside kind: count, never a nested field of the same name.
      if (!field || field[1].length !== keyColumn(kindLine.text)) continue;
      const decode = field[2] === 'data';
      const fieldIndent = field[1].length;
      for (let child = row + 1; child < doc.length; child++) {
        const line = doc[child];
        if (line.text.trim() === '' || line.text.trim().startsWith('#')) continue;
        if (indent(line.text) <= fieldIndent) break;
        const key = K8S_KEY.exec(line.text);
        if (!key) continue;
        let value = key[3].replace(/[ \t]+#.*$/, '');
        let start = line.offset + line.text.indexOf(value, key[1].length + key[2].length + 1);
        let end = start + value.length;
        if (/^[|>][+-]?$/.test(value)) {
          // A block value: the indented lines below the key.
          const body: Array<{ text: string; offset: number }> = [];
          for (let next = child + 1; next < doc.length && body.length < K8S_MAX_BLOCK_LINES; next++) {
            if (doc[next].text.trim() !== '' && indent(doc[next].text) <= indent(line.text)) break;
            if (doc[next].text.trim() !== '') body.push(doc[next]);
          }
          if (!body.length) continue;
          child += body.length;
          // A block of NAME=value lines is a settings file; the other rules read each of its lines. Base64 padding (==) is not a NAME=value.
          if (body.every((part) => /^[ \t]*[A-Za-z_][\w.-]{0,40}[ \t]*=[ \t]*[^=\s]/.test(part.text))) continue;
          const head = body[0];
          const tail = body[body.length - 1];
          start = head.offset + indent(head.text);
          end = tail.offset + tail.text.length;
          value = text.slice(start, end);
        } else {
          const quoted = /^(["'])(.*)\1$/.exec(value);
          if (quoted) {
            value = quoted[2];
            start += 1;
            end -= 1;
          }
        }
        if (value.length < 4 || value.length > K8S_MAX_VALUE || K8S_PUBLIC_KEY.test(key[2]) || /\{\{|\$\{/.test(value)) continue;
        // A data: value must really be base64; text such as <base64-encoded-token> is a placeholder, not a secret.
        if (decode && !/^[A-Za-z0-9+/\s]+={0,2}$/.test(value)) continue;
        const plain = decode ? Buffer.from(value.replace(/\s+/g, ''), 'base64').toString('utf8') : value;
        if (/BEGIN CERTIFICATE/.test(plain) || plain.trim().length < 8 || !real(plain.trim(), true)) continue;
        // Secrets also hold plain settings such as url, type or project. Only a key named like a secret, a random-looking value
        // or a private key counts, and a link with no password in it never does.
        const settingLink = /^[a-z][a-z0-9+.-]*:\/\/[^\s@]*$/i.test(plain.trim());
        if (settingLink || !(K8S_SECRET_KEY.test(key[2]) || randomLooking(plain.trim()) || /PRIVATE KEY/.test(plain))) continue;
        found.push({ type: /PRIVATE KEY/.test(plain) ? 'private_key' : 'generic_secret', value, start, end, score: 0.8 });
      }
    }
  }
  return found;
}

export function detect(text: string): RawMatch[] {
  const found: RawMatch[] = [];
  const seen = new Set<string>();
  for (const { rule, pattern } of COMPILED) {
    for (const match of text.matchAll(pattern)) {
      const group = rule.groups ? (rule.groups.find((index) => match[index] !== undefined) ?? 0) : (rule.group ?? 0);
      const value = match[group];
      const indices = match.indices?.[group];
      if (!value || !indices) continue;
      if (rule.accept && !rule.accept(value, match)) continue;
      const key = `${indices[0]}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        type: rule.type,
        value,
        start: indices[0],
        end: indices[1],
        score: rule.score(value),
        ...(rule.weak ? { weak: true } : {}),
      });
    }
  }
  for (const match of [...tableSecrets(text), ...kubernetesSecrets(text)]) {
    const key = `${match.start}:${match.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(match);
  }
  return found;
}
