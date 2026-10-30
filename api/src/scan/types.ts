export type Unit = 'line' | 'message';
export type Encoding = 'plain' | 'base64' | 'hex' | 'url' | 'spelled' | 'stitched' | 'reversed';
export type Verdict = 'real' | 'example' | 'unsure';
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
}

export interface Candidate {
  type: string;
  value: string;
  spans: Span[];
  encoding: Encoding;
  score: number;
}

export interface JudgeResult {
  status: 'ok' | 'error' | 'timeout' | 'unverified' | 'limit';
  verified?: boolean;
  width?: number;
  widened?: boolean;
  calls?: number;
  mode: 'mock' | 'live' | 'rule';
  model: string;
  verdict: Verdict;
  confidence: number;
  reason: string;
  error?: string;
}
