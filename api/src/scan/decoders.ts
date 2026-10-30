import { Encoding } from './types';

interface Chunk {
  encoding: Encoding;
  start: number;
  end: number;
  decoded: string;
}

interface Stamp {
  value: number;
  clock: boolean;
}

export interface Piece {
  start: number;
  text: string;
  author: string | null;
  stamp: Stamp | null;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const NATO = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
  'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
  'xray', 'yankee', 'zulu',
];

const WORDS = [...Object.keys(UNITS), ...Object.keys(TEENS), ...Object.keys(TENS), ...NATO];
const TOKEN = `(?:${WORDS.join('|')}|[A-Za-z0-9])(?![A-Za-z0-9])`;
const SPELLED = new RegExp(`(?<![A-Za-z0-9])${TOKEN}(?:,? ${TOKEN}){3,}`, 'gi');
const LONG_RUN = 12;
const SHORT_RUN = 4;
const MAX_GAP_MINUTES = 180;
const BASE64 = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/])/g;
const HEX = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}){10,}(?![0-9A-Fa-f])/g;
const URL_ENCODED = /\S+/g;
const HAS_PERCENT_CODE = /%[0-9A-Fa-f]{2}/;
const AUTHOR_PREFIX = /^\[([^\]]+)\]\s*([\w.-]+):\s*/;

function isReadable(decoded: string, minLength = 6): boolean {
  if (decoded.length < minLength) return false;
  const printable = decoded.match(/[\x20-\x7e\r\n\t]/g)?.length ?? 0;
  return printable / decoded.length >= 0.95;
}

function collect(text: string, pattern: RegExp, encoding: Encoding, decode: (raw: string) => string | null): Chunk[] {
  const chunks: Chunk[] = [];
  for (const match of text.matchAll(pattern)) {
    const decoded = decode(match[0]);
    if (decoded === null || decoded === match[0] || !isReadable(decoded)) continue;
    const start = match.index ?? 0;
    chunks.push({ encoding, start, end: start + match[0].length, decoded });
  }
  return chunks;
}

export function decodeBase64(text: string): Chunk[] {
  return collect(text, BASE64, 'base64', (raw) => Buffer.from(raw, 'base64').toString('utf8'));
}

export function decodeHex(text: string): Chunk[] {
  return collect(text, HEX, 'hex', (raw) => Buffer.from(raw, 'hex').toString('utf8'));
}

export function decodeUrl(text: string): Chunk[] {
  if (!HAS_PERCENT_CODE.test(text)) return [];
  return collect(text, URL_ENCODED, 'url', (raw) => {
    if (!HAS_PERCENT_CODE.test(raw)) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  });
}

function speak(tokens: string[]): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].toLowerCase();
    if (word in TENS) {
      const next = tokens[i + 1]?.toLowerCase();
      if (next !== undefined && next in UNITS && UNITS[next] > 0) {
        out += String(TENS[word] + UNITS[next]);
        i++;
      } else {
        out += String(TENS[word]);
      }
    } else if (word in TEENS) {
      out += String(TEENS[word]);
    } else if (word in UNITS) {
      out += String(UNITS[word]);
    } else if (NATO.includes(word)) {
      out += word[0];
    } else {
      out += tokens[i];
    }
  }
  return out;
}

export function decodeSpelled(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const match of text.matchAll(SPELLED)) {
    const tokens = match[0].split(/,? /);
    const words = tokens.filter((token) => token.length > 1).length;
    const long = tokens.length >= LONG_RUN;
    const short = tokens.length >= SHORT_RUN && words * 2 >= tokens.length;
    if (!long && !short) continue;
    const start = match.index ?? 0;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const decoded = text.slice(lineStart, start) + speak(tokens);
    if (!isReadable(decoded, 1)) continue;
    chunks.push({ encoding: 'spelled', start, end: start + match[0].length, decoded });
  }
  return chunks;
}

const VENDOR_START = /(?:AKIA|ASIA|gh[pousr]_|github_pat_|glpat-|xox[abprse]-|sk-ant-|sk-proj-|[sr]k_live_|AIza|SG\.)/;
const MAX_REVERSED_LINE = 2000;

function decodeReversed(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    if (line.length <= MAX_REVERSED_LINE) {
      for (const match of line.matchAll(/[A-Za-z0-9_.-]{12,}/g)) {
        const backwards = [...match[0]].reverse().join('');
        if (VENDOR_START.test(backwards) && !VENDOR_START.test(match[0])) {
          const start = offset + (match.index ?? 0);
          chunks.push({ encoding: 'reversed', start, end: start + match[0].length, decoded: backwards });
        }
      }
    }
    offset += line.length + 1;
  }
  return chunks;
}

// A chunk that decodes to more base64 is decoded once more. Two layers is the limit.
function decodeLayers(chunks: Chunk[]): Chunk[] {
  const deeper: Chunk[] = [];
  for (const chunk of chunks) {
    if (chunk.encoding !== 'base64') continue;
    for (const inner of decodeBase64(chunk.decoded)) deeper.push({ ...chunk, decoded: inner.decoded });
  }
  return [...chunks, ...deeper];
}

export function decodeAll(text: string): Chunk[] {
  return decodeLayers([...decodeBase64(text), ...decodeHex(text), ...decodeUrl(text), ...decodeSpelled(text), ...decodeReversed(text)]);
}

function parseStamp(raw: string): Stamp | null {
  const clock = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (clock) return { value: Number(clock[1]) * 60 + Number(clock[2]), clock: true };
  const parsed = Date.parse(raw.trim().replace(' ', 'T'));
  return Number.isNaN(parsed) ? null : { value: parsed / 60_000, clock: false };
}

export function linePieces(text: string): Piece[] {
  const pieces: Piece[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const prefix = AUTHOR_PREFIX.exec(line);
    const length = prefix?.[0].length ?? 0;
    pieces.push({
      start: offset + length,
      text: line.slice(length),
      author: prefix ? prefix[2].toLowerCase() : null,
      stamp: prefix ? parseStamp(prefix[1]) : null,
    });
    offset += line.length + 1;
  }
  return pieces;
}

export function canJoin(first: Piece, second: Piece): boolean {
  if (first.author !== second.author) return false;
  if (!first.stamp || !second.stamp || first.stamp.clock !== second.stamp.clock) return true;
  const gap = second.stamp.clock
    ? (second.stamp.value - first.stamp.value + 1440) % 1440
    : second.stamp.value - first.stamp.value;
  return gap >= 0 && gap <= MAX_GAP_MINUTES;
}
