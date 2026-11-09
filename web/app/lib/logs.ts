import type { ScanResult } from "./scan";

export interface ScanRow {
  id: string;
  at: string;
  kind: "text" | "template" | "files";
  label: string;
  chars?: number;
  files?: number;
  durationMs: number;
  mode: string;
  model: string;
  summary: { findings: number; blocked: number; errors: number; unverified?: number; timeouts?: number; limited?: number; widened?: number };
  verdicts: { real: number; unsure: number; example: number; none: number };
  usage?: { calls: number; inputTokens: number; cachedTokens: number; outputTokens: number; cost?: number };
}

export interface ScanDetail extends ScanRow {
  result: ScanResult;
}

interface EvalCategory {
  category: string;
  expected: number;
  matched: number;
  recall: number;
  interval95: [number, number];
  passLine: number | null;
  status: string;
  falseAlarms: { cleanCases: number; falseAlarmCases: number; findings: number };
}

interface EvalSummary {
  categories: EvalCategory[];
  [key: string]: unknown;
}

export interface EvalRow {
  file: string;
  timestamp: string;
  mode: string;
  model: string;
  gitHash: string | null;
  summary: EvalSummary;
  cases: number;
}

export interface EvalCase {
  id: string;
  category: string;
  origin: string;
  clean: boolean;
  injection: boolean;
  pass: boolean;
  reasons: string[];
  expected: number;
  matched: number;
  findings: number;
  extra: number;
  previews: string[];
  verdicts: string[];
  obeyed: boolean;
}

export interface EvalRun extends Omit<EvalRow, "cases"> {
  node: string;
  grader: string;
  cases: EvalCase[];
}

export class LogsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function logsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new LogsError(response.status, `${url} answered ${response.status}`);
  return response;
}

export interface AuditRow {
  id: number;
  at: string;
  action: string;
  adminEmail?: string;
  detail: Record<string, unknown>;
  ip?: string;
}

export interface Admin {
  email: string;
}

export async function getMe(): Promise<Admin | null> {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()).admin ?? null;
  } catch {
    return null;
  }
}

export async function requestLink(email: string): Promise<void> {
  const response = await fetch("/api/auth/request", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  if (response.status === 429) throw new LogsError(429, "Too many requests. Try again in a few minutes.");
  if (response.status === 400) throw new LogsError(400, "Enter a valid email address.");
  if (!response.ok) throw new LogsError(response.status, "Could not send the link. Try again.");
}

export async function verifyLink(token: string): Promise<void> {
  const response = await fetch("/api/auth/verify", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  if (!response.ok) throw new LogsError(response.status, "This link is not valid any more. Ask for a new one.");
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
}

export async function getJson<T>(url: string): Promise<T> {
  return (await logsFetch(url)).json();
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export type CaseStatus = "open" | "owner_notified" | "rotated" | "closed" | "false_alarm";

export const STATUS_LABELS: Record<CaseStatus, string> = {
  open: "Open",
  owner_notified: "Owner told",
  rotated: "Rotated",
  closed: "Closed",
  false_alarm: "False alarm",
};

export interface CaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  scanId: string;
  scanLabel: string;
  findingId: string;
  type: string;
  encoding: string;
  source?: string;
  place: Record<string, unknown>;
  preview: string;
  hash: string | null;
  confidence: { level: string; score: number };
  verdict: string;
  status: CaseStatus;
  owner: string;
  history: Array<{ at: string; status: CaseStatus; note: string }>;
}

export interface CheckResult {
  id: string;
  group: "correct" | "incorrect";
  name: string;
  expected: { status: number[]; findings?: number; atLeast?: number; types?: string[]; messageIncludes?: string; noteIncludes?: string };
  actual: { status: number; findings?: number; types: string[]; message?: string; note?: string };
  pass: boolean;
  problems: string[];
  durationMs: number;
}

export interface CheckRow {
  file: string;
  timestamp: string;
  mode: string;
  summary: { total: number; passed: number; failed: number; correct: { total: number; passed: number }; incorrect: { total: number; passed: number } };
}

export interface CheckRun extends Omit<CheckRow, "file"> {
  checks: CheckResult[];
}
