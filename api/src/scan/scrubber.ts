import { findCandidates } from './candidates';
import { sentence } from './reasons';
import { Candidate } from './types';

export const SLICE_LIMIT = 400;
export const SLICE_WIDTHS = [SLICE_LIMIT, 800];
const MIN_FORBIDDEN_LENGTH = 4;

// The one sentence a visitor sees when the safety check stops a finding from going to the AI.
const BLOCKED_REASON = 'We could not be sure the secret was fully hidden. Treat it as a real secret.';

export type ScrubResult = { ok: true; slice: string } | { ok: false; error: string };

function tokenFor(candidate: Candidate): string {
  return `[SECRET:${candidate.type}:${candidate.value.length}]`;
}

export function forbiddenStrings(text: string, candidates: Candidate[]): string[] {
  const forbidden = new Set<string>();
  for (const candidate of candidates) {
    forbidden.add(candidate.value);
    forbidden.add(Buffer.from(candidate.value).toString('base64'));
    forbidden.add(Buffer.from(candidate.value).toString('hex'));
    forbidden.add(encodeURIComponent(candidate.value));
    for (const span of candidate.spans) {
      const raw = text.slice(span.start, span.end);
      forbidden.add(raw);
      // A value written over several lines is also forbidden line by line, so one line of it can never be shown alone.
      if (raw.includes('\n')) for (const line of raw.split('\n')) forbidden.add(line.trim());
    }
  }
  return [...forbidden].filter((item) => item.length >= MIN_FORBIDDEN_LENGTH);
}

function findLeak(haystack: string, forbidden: string[]): string | null {
  for (const item of forbidden) {
    if (haystack.includes(item)) return item;
  }
  return null;
}

const FIELD_SEPARATOR = '\u0001';

// The parts of a finding that the scrubber looks at. Any finding shape that has these fields fits.
export interface FindingParts {
  preview?: unknown;
  line?: unknown;
  place?: object | null;
  judge?: object | null;
}

// The fields of one finding that can carry text from the user's input. The reason is always one of our fixed sentences, so it is not searched.
function visibleText(finding: FindingParts | null | undefined): string {
  const place = finding?.place as { file?: unknown } | null | undefined;
  const judge = finding?.judge as { slice?: unknown; facts?: unknown } | null | undefined;
  const line = finding?.line as { before?: unknown; mark?: unknown; after?: unknown } | null | undefined;
  return [finding?.preview, place?.file, judge?.slice, judge?.facts, line?.before, line?.mark, line?.after].filter((v) => typeof v === 'string').join(FIELD_SEPARATOR);
}

// Looks for a found secret, raw or JSON-escaped, in the visible fields of one finding.
export function findingLeak(finding: FindingParts | null | undefined, forbidden: string[]): string | null {
  const text = visibleText(finding);
  for (const item of forbidden) {
    if (text.includes(item) || text.includes(JSON.stringify(item).slice(1, -1))) return item;
  }
  return null;
}

// Keeps the finding, drops everything that could show the secret.
export function withhold<T extends { place?: object | null; line?: unknown }>(finding: T, forbidden: string[] = []): T {
  const place = (finding.place as { file?: unknown } | null | undefined)?.file !== undefined ? { ...finding.place, file: '[file name hidden]' } : finding.place;
  // The caller's finding type has a judge field; the blocked judge below takes its place.
  return {
    ...finding,
    preview: 'Hidden for safety',
    // The line stays when it holds no copy of the value, so the visitor can still see where it sits.
    line: finding.line && findingLeak({ line: finding.line }, forbidden) === null ? finding.line : undefined,
    place,
    judge: { status: 'blocked', code: 'LEAK_GUARD', reason: sentence('LEAK_GUARD') },
  } as unknown as T;
}

const TAG = /\[SECRET:[a-z_]+:\d+\]/g;
const PIECE = 6;

// Block-only back-stop. If any 6 characters of a detected value are still in the slice, a rule or a mask was too short.
// Pieces that are plain lowercase or uppercase words, or one repeated character, are skipped: they are common text.
function findPartialLeak(slice: string, candidates: Candidate[]): string | null {
  const visible = slice.replace(TAG, '');
  for (const candidate of candidates) {
    const value = candidate.value;
    if (value.length < PIECE + 2) continue;
    for (let i = 0; i + PIECE <= value.length; i++) {
      const piece = value.slice(i, i + PIECE);
      if (/^[a-z]+$|^[A-Z]+$|^(.)\1+$|^\s|\s$/.test(piece)) continue;
      if (visible.includes(piece)) return piece;
    }
  }
  return null;
}

const PERSONAL: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ID]'],
  [/(?<![A-Za-z0-9_\[])\+?(?:\d[\s().-]?){10,14}\d(?![A-Za-z0-9_\]])/g, '[PHONE]'],
];

export function maskPersonal(text: string): string {
  return PERSONAL.reduce((out, [pattern, token]) => out.replace(pattern, token), text);
}

export function maskName(name: string): string {
  const spans = findCandidates(name).flatMap((candidate) => candidate.spans.map((span) => ({ ...span, token: tokenFor(candidate) })));
  spans.sort((a, b) => b.start - a.start);
  let out = name;
  for (const span of spans) out = out.slice(0, span.start) + span.token + out.slice(span.end);
  return out;
}

export function maskFreeText(text: string): string {
  return maskPersonal(maskName(text));
}

const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MIN_COPY_LENGTH = 4;

// The same value written elsewhere in the text, even as an ordinary word, would show the secret to the model.
function copyMasker(all: Candidate[]): (part: string) => string {
  const byValue = new Map<string, string>();
  for (const candidate of all) {
    if (candidate.value.length >= MIN_COPY_LENGTH && !byValue.has(candidate.value)) byValue.set(candidate.value, tokenFor(candidate));
  }
  if (byValue.size === 0) return (part) => part;
  const pattern = new RegExp([...byValue.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g');
  return (part) => part.replace(pattern, (found) => byValue.get(found) ?? found);
}

interface MaskedText {
  masked: string;
  // Where each merged span's token sits in the masked text, and which candidates own it.
  tokens: Array<{ start: number; end: number; owners: Set<Candidate> }>;
  forbidden: string[];
}

// Everything that does not depend on which finding is being judged. A finding is judged up to four times
// (first slice, wider slice, retry), so the whole text is masked once per candidate list and reused.
const prepared = new WeakMap<Candidate[], { text: string; value: MaskedText }>();

function prepare(text: string, all: Candidate[]): MaskedText {
  const hit = prepared.get(all);
  if (hit && hit.text === text) return hit.value;

  const spans: Array<{ start: number; end: number; token: string; owners: Set<Candidate> }> = [];
  for (const candidate of all) {
    for (const span of candidate.spans) {
      spans.push({ start: span.start, end: span.end, token: tokenFor(candidate), owners: new Set([candidate]) });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged: typeof spans = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
      for (const owner of span.owners) last.owners.add(owner);
    } else {
      merged.push({ ...span, owners: new Set(span.owners) });
    }
  }

  const maskCopies = copyMasker(all);
  let masked = '';
  let cursor = 0;
  const tokens: MaskedText['tokens'] = [];
  for (const span of merged) {
    masked += maskCopies(text.slice(cursor, span.start));
    tokens.push({ start: masked.length, end: masked.length + span.token.length, owners: span.owners });
    masked += span.token;
    cursor = span.end;
  }
  masked += maskCopies(text.slice(cursor));

  const value = { masked, tokens, forbidden: forbiddenStrings(text, all) };
  prepared.set(all, { text, value });
  return value;
}

export function buildSlice(text: string, target: Candidate, all: Candidate[], width = SLICE_LIMIT): ScrubResult {
  const { masked, tokens, forbidden } = prepare(text, all);
  const owned = tokens.find((token) => token.owners.has(target));
  const targetStart = owned?.start ?? -1;
  const targetEnd = owned?.end ?? -1;

  if (targetStart < 0) return { ok: false, error: BLOCKED_REASON };

  const center = Math.floor((targetStart + targetEnd) / 2);
  let from = Math.max(0, center - width / 2);
  from = Math.min(from, targetStart);
  let to = Math.min(masked.length, from + width);
  // Move the cut to a space so a word is not cut in half, but never drop a whole line: the cue may sit in it.
  if (from > 0 && !/\s/.test(masked[from - 1]) && !/\s/.test(masked[from])) {
    const gap = masked.slice(from, Math.min(from + 20, targetStart)).search(/\s/);
    if (gap >= 0) from += gap + 1;
  }
  if (to < masked.length && !/\s/.test(masked[to - 1]) && !/\s/.test(masked[to])) {
    const gap = masked.slice(Math.max(to - 20, targetEnd), to).search(/\s[^\s]*$/);
    if (gap >= 0) to = Math.max(to - 20, targetEnd) + gap;
  }
  if (from > 0 && isLow(masked.charCodeAt(from))) from++;
  if (to < masked.length && isHigh(masked.charCodeAt(to - 1))) to--;
  const slice = maskPersonal(masked.slice(from, to)).slice(0, width);

  const leak = findLeak(slice, forbidden);
  if (leak !== null) {
    return { ok: false, error: BLOCKED_REASON };
  }
  if (findPartialLeak(slice, all) !== null) {
    return { ok: false, error: BLOCKED_REASON };
  }
  return { ok: true, slice };
}

// The marks around the one copy the AI judges. Any such sign already in the file becomes a plain bracket first,
// so text in the file cannot move the mark to another copy.
const MARK_OPEN = '⟪';
const MARK_CLOSE = '⟫';
const PEM_LINES = /^(-----BEGIN [^\n]*-----)[\s\S]*?(-----END [^\n]*-----)$/;

// The text around one finding exactly as written, for our own AI server only, which keeps no copy. Nothing is masked
// and nothing is blocked; only the copy to judge is marked. A private key keeps its BEGIN and END lines, with ... between.
// The words around the copy are cut at a space, up to half the width on each side; the marked copy is never cut.
export function buildRawSlice(text: string, target: Candidate, width = SLICE_LIMIT): string {
  const clean = text.replaceAll(MARK_OPEN, '[').replaceAll(MARK_CLOSE, ']');
  // A span may cover more than the value, so a passphrase is fully masked elsewhere. The mark goes around the value only,
  // when the value is written as it is inside one span; an encoded or split value keeps its spans.
  const plain = target.spans.length === 1 ? clean.indexOf(target.value, target.spans[0].start) : -1;
  const spans =
    plain >= 0 && plain + target.value.length <= target.spans[0].end
      ? [{ start: plain, end: plain + target.value.length }]
      : [...target.spans].sort((a, b) => a.start - b.start);
  const start = spans[0].start;
  const end = spans[spans.length - 1].end;
  const half = Math.floor(width / 2);
  let from = Math.max(0, start - half);
  let to = Math.min(clean.length, end + half);
  if (from > 0 && !/\s/.test(clean[from - 1])) {
    const gap = clean.slice(from, start).search(/\s/);
    if (gap >= 0) from += gap + 1;
  }
  if (to < clean.length && !/\s/.test(clean[to])) {
    const gap = clean.slice(end, to).search(/\s[^\s]*$/);
    if (gap >= 0) to = end + gap;
  }
  if (from > 0 && isLow(clean.charCodeAt(from))) from++;
  if (to < clean.length && isHigh(clean.charCodeAt(to - 1))) to--;
  const shown = (piece: string) => (target.type === 'private_key' ? piece.replace(PEM_LINES, '$1\n...\n$2') : piece);
  let out = clean.slice(from, start);
  spans.forEach((span, i) => {
    out += MARK_OPEN + shown(clean.slice(span.start, span.end)) + MARK_CLOSE;
    out += clean.slice(span.end, i + 1 < spans.length ? spans[i + 1].start : to);
  });
  return out;
}
