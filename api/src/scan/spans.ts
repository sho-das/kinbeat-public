import { Span } from './types';

const MAX_WIDEN = 200;
const PASSWORD_LABEL = /(?:password|passwd|passcode|pwd)[A-Za-z0-9_-]{0,40}(?:\s*[:=]\s*|\s+is\s+)["']?$/i;

// A rule can stop early. The mask must not, or the end of the secret goes to the model.
// Fixed-shape tokens (cloud keys, vendor tokens, private keys) already end where their shape ends, so they are left alone.
// After a password label the mask runs to the closing quote or the end of the line. Other generic secrets run to the end of the word.
export function widenSpan(text: string, span: Span, type: string): Span {
  if (type !== 'generic_secret') return span;
  const lineEnd = text.indexOf('\n', span.end);
  const cap = Math.min(lineEnd < 0 ? text.length : lineEnd, span.end + MAX_WIDEN);
  let end = span.end;
  const before = text.slice(Math.max(0, span.start - 80), span.start);
  if (PASSWORD_LABEL.test(before)) {
    const quote = before.endsWith('"') || before.endsWith("'") ? before[before.length - 1] : null;
    const closing = quote ? text.indexOf(quote, span.end) : -1;
    end = closing >= 0 && closing <= cap ? closing : cap;
    while (end > span.end && /\s/.test(text[end - 1])) end--;
  } else {
    while (end < cap && !/\s/.test(text[end])) end++;
  }
  return { start: span.start, end: Math.max(end, span.end) };
}
