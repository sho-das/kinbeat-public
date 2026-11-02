export type Unit = 'line' | 'message';
export type Encoding = 'plain' | 'base64' | 'hex' | 'url' | 'spelled' | 'stitched' | 'reversed';
// example and not_secret are hidden from the page; real is shown, unsure shows as possible.
export type Verdict = 'real' | 'example' | 'unsure' | 'not_secret';
export type Level = 'high' | 'medium' | 'low';

export interface Span {
  start: number;
  end: number;
}

export interface RawMatch {
  type: string;
  value: string;
  start: number;
  end: number;
  score: number;
  // Found by the weak name: value rule, the only rule whose finds our rule book may call not a secret.
  weak?: boolean;
}

export interface Candidate {
  type: string;
  value: string;
  spans: Span[];
  encoding: Encoding;
  score: number;
  weak?: boolean;
}

export interface JudgeResult {
  status: 'ok' | 'error' | 'timeout' | 'unverified' | 'limit';
  verified?: boolean;
  width?: number;
  widened?: boolean;
  mode: 'mock' | 'live' | 'rule';
  model: string;
  verdict: Verdict;
  // One of the codes or our own keys in reasons.ts. The reason is always the fixed sentence for it.
  code?: string;
  reason: string;
}
