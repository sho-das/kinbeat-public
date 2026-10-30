import { detect, real } from './detectors';
import { canJoin, decodeAll, linePieces, Piece } from './decoders';
import { needsNormalising, normalise } from './normalise';
import { widenSpan } from './spans';
import { Candidate, Span } from './types';

const MAX_STITCH = 3;
const MAX_BLANK_GAP = 1;
const MIN_PIECE_CHARS = 3;
const FIXED_LENGTH: Record<string, number> = { aws_key: 20, github_token: 40 };
const LEADING_TOKEN = /^["'`(\[]*([A-Za-z0-9_+/=.-]*[A-Za-z0-9_+/=-])/;
// A word, with or without a capital at the start of a sentence ("Please", "Thanks").
const LOOKS_LIKE_A_WORD = /^[A-Za-z][a-z]{0,10}$/;
const LABEL_INSIDE = /(?:password|passwd|passcode|secret|api[_-]?key|token|recovery[_ -]?code)[A-Za-z0-9_-]*\s*[:=]/i;

// A split secret continues on the next line as one unbroken chunk, so only the leading token of each
// later line is joined. A chunk that reads as a plain word ("npm", "sample", "Please") is not a key.
function joinable(group: Piece[]): Piece[] | null {
  const out: Piece[] = [{ ...group[0], text: group[0].text.trimEnd() }];
  for (let i = 1; i < group.length; i++) {
    const match = LEADING_TOKEN.exec(group[i].text);
    if (!match || LOOKS_LIKE_A_WORD.test(match[1])) return null;
    if (i < group.length - 1 && !/^[\s"'`,;.)\]]*$/.test(group[i].text.slice(match[0].length))) return null;
    out.push({ ...group[i], start: group[i].start + match[0].length - match[1].length, text: match[1] });
  }
  return out;
}

function overlappingIndexes(found: Candidate[], spans: Span[]): number[] {
  const indexes: number[] = [];
  found.forEach((candidate, index) => {
    if (candidate.spans.some((a) => spans.some((b) => a.start < b.end && b.start < a.end))) indexes.push(index);
  });
  return indexes;
}

// A picture is read several ways and the same text then gets scanned again. The last few small texts are remembered,
// so equal text is scanned once. The returned list is shared, so callers must not change it.
const RECENT_LIMIT = 8;
const RECENT_MAX_CHARS = 100_000;
const recent = new Map<string, Candidate[]>();

export function findCandidates(text: string): Candidate[] {
  if (text.length > RECENT_MAX_CHARS) return scanText(text);
  const hit = recent.get(text);
  if (hit) return hit;
  const found = scanText(text);
  recent.set(text, found);
  if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value as string);
  return found;
}

// Called when a scan ends, so no scanned text stays in memory between scans.
export function clearRecentCandidates(): void {
  recent.clear();
}

export function recentCandidateCount(): number {
  return recent.size;
}

function scanText(text: string): Candidate[] {
  if (!needsNormalising(text)) return widen(text, findIn(text));
  const clean = normalise(text);
  return widen(
    text,
    findIn(clean.text).map((candidate) => ({
      ...candidate,
      spans: candidate.spans.map((span) => ({ start: clean.start(span.start), end: clean.end(span.end) })),
    })),
  );
}

// Plain and stitched secrets get a wider mask. A decoded chunk already covers its whole encoded form.
function widen(text: string, candidates: Candidate[]): Candidate[] {
  return candidates.map((candidate) => {
    if (candidate.encoding !== 'plain' && candidate.encoding !== 'stitched') return candidate;
    const spans = candidate.spans.slice();
    const last = spans.length - 1;
    spans[last] = widenSpan(text, spans[last], candidate.type);
    return { ...candidate, spans };
  });
}

function findIn(text: string): Candidate[] {
  const found: Candidate[] = [];
  const seen = new Set<string>();

  const add = (candidate: Candidate) => {
    const key = `${candidate.value}@${candidate.spans[0].start}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(candidate);
  };

  for (const match of detect(text)) {
    add({
      type: match.type,
      value: match.value,
      spans: [{ start: match.start, end: match.end }],
      encoding: 'plain',
      score: match.score,
    });
  }

  for (const chunk of decodeAll(text)) {
    for (const match of detect(chunk.decoded)) {
      add({
        type: match.type,
        value: match.value,
        spans: [{ start: chunk.start, end: chunk.end }],
        encoding: chunk.encoding,
        score: match.score - 0.05,
      });
    }
  }

  const all = linePieces(text).map((piece, line) => ({ piece, line })).filter(({ piece }) => piece.text.length > 0);
  const pieces = all.map(({ piece }) => piece);
  for (let i = 0; i < pieces.length - 1; i++) {
    for (let size = 2; size <= MAX_STITCH && i + size <= pieces.length; size++) {
      const original = pieces.slice(i, i + size);
      if (all.slice(i, i + size).some(({ line, piece }, index, list) => index > 0 && line - list[index - 1].line > (piece.author !== null ? MAX_BLANK_GAP : 0) + 1)) continue;
      if (original.some((piece, index) => index > 0 && !canJoin(original[index - 1], piece))) continue;
      const group = joinable(original);
      if (!group) continue;
      const bounds: Array<{ from: number; to: number }> = [];
      let joined = '';
      for (const piece of group) {
        bounds.push({ from: joined.length, to: joined.length + piece.text.length });
        joined += piece.text;
      }
      for (const match of detect(joined)) {
        const spans: Span[] = [];
        const contributions: string[] = [];
        group.forEach((piece, index) => {
          const from = Math.max(match.start, bounds[index].from);
          const to = Math.min(match.end, bounds[index].to);
          if (from < to) {
            spans.push({ start: piece.start + from - bounds[index].from, end: piece.start + to - bounds[index].from });
            contributions.push(joined.slice(from, to));
          }
        });
        if (spans.length < 2 || LABEL_INSIDE.test(match.value) || !real(contributions[0])) continue;
        if (contributions.some((part) => (part.match(/[A-Za-z0-9]/g) ?? []).length < MIN_PIECE_CHARS)) continue;
        const overlapping = overlappingIndexes(found, spans);
        if (overlapping.some((index) => found[index].encoding === 'plain' && found[index].value.length === FIXED_LENGTH[found[index].type])) continue;
        const partial = overlapping.every(
          (index) => match.value.length > found[index].value.length && match.value.includes(found[index].value),
        );
        if (!partial) continue;
        for (const index of overlapping.reverse()) found.splice(index, 1);
        add({ type: match.type, value: match.value, spans, encoding: 'stitched', score: match.score - 0.1 });
      }
    }
  }

  // A value spoken in words ("foxtrot six echo ...") has its own first word found as a plain value.
  // That word is part of the spoken secret, so it is not a finding of its own.
  const spoken = found.filter((candidate) => candidate.encoding === 'spelled').map((candidate) => candidate.spans[0]);
  const kept = found.filter((candidate) => candidate.encoding !== 'plain' || !spoken.some((span) => candidate.spans[0].start >= span.start && candidate.spans[0].end <= span.end));
  return kept.sort((a, b) => a.spans[0].start - b.spans[0].start);
}
