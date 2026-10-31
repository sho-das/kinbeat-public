import { Candidate } from './types';

export interface MaskedLine {
  before: string;
  mark: string;
  after: string;
}

const SIDE = 70;
const MAX_MARK = 40;

// The line a finding sits on, with every found value replaced by stars. The value of this finding is kept apart so the page can highlight it.
export function maskedLine(text: string, candidates: Candidate[], candidate: Candidate, forbidden: string[] = []): MaskedLine {
  const own = candidate.spans[0];
  const from = text.lastIndexOf('\n', own.start - 1) + 1;
  const stop = text.indexOf('\n', own.end);
  const to = stop === -1 ? text.length : stop;
  const spans = candidates
    .flatMap((c) => c.spans)
    .filter((s) => s.start >= from && s.end <= to && s !== own && (s.end <= own.start || s.start >= own.end))
    .sort((a, b) => a.start - b.start);
  const hide = (start: number, end: number): string => {
    let out = '';
    let at = start;
    for (const s of spans) {
      if (s.end <= at || s.start >= end) continue;
      const a = Math.max(s.start, at);
      out += text.slice(at, a) + '*'.repeat(Math.min(s.end, end) - a);
      at = Math.min(s.end, end);
    }
    return out + text.slice(at, end);
  };
  // The same value can also stand elsewhere on the line as plain text. Every copy is hidden, so the line is safe to show.
  const longestFirst = [...forbidden].sort((a, b) => b.length - a.length);
  const hideCopies = (value: string) => longestFirst.reduce((out, item) => out.split(item).join('*'.repeat(item.length)), value);
  const clean = (value: string) => hideCopies(value.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' '));
  const left = Math.max(from, own.start - SIDE);
  const right = Math.min(to, own.end + SIDE);
  return {
    before: (left > from ? '...' : '') + clean(hide(left, own.start)),
    mark: '*'.repeat(Math.min(own.end - own.start, MAX_MARK)),
    after: clean(hide(own.end, right)) + (right < to ? '...' : ''),
  };
}
