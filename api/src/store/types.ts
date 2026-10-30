export type CaseStatus = 'open' | 'owner_notified' | 'rotated' | 'closed' | 'false_alarm';

export interface ScanRow {
  id: string;
  at: string;
  kind: 'text' | 'template' | 'files';
  label: string;
  chars?: number;
  files?: number;
  durationMs: number;
  mode: string;
  model: string;
  summary: Record<string, number>;
  verdicts: { real: number; unsure: number; example: number; none: number };
}

export interface ScanRecord extends ScanRow {
  result: unknown;
}

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

export interface ScanStore {
  save(entry: ScanRecord): Promise<void>;
  list(): Promise<ScanRow[]>;
  get(id: string): Promise<ScanRecord | undefined>;
  purge(olderThanDays: number): Promise<number>;
}

export interface CaseStore {
  list(): Promise<CaseRecord[]>;
  get(id: string): Promise<CaseRecord | undefined>;
  findByHash(hash: string, type: string): Promise<CaseRecord | undefined>;
  count(): Promise<number>;
  insert(record: CaseRecord): Promise<{ record: CaseRecord; created: boolean }>;
  update(id: string, change: (record: CaseRecord) => void): Promise<CaseRecord | undefined>;
}

export interface AdminRecord {
  id: string;
  email: string;
  createdAt: string;
  lastLogin?: string;
}

export interface AuditEntry {
  action: string;
  adminId?: string;
  adminEmail?: string;
  detail?: Record<string, unknown>;
  ip?: string;
}

export interface AuditRow {
  id: number;
  at: string;
  action: string;
  adminId?: string;
  adminEmail?: string;
  detail: Record<string, unknown>;
  ip?: string;
}

export interface AuthStore {
  countAdmins(): Promise<number>;
  removeAdmin(email: string): Promise<void>;
  audit(entry: AuditEntry, now?: number): Promise<void>;
  listAudit(limit: number): Promise<AuditRow[]>;
  hitLimit(key: string, limit: number, windowMs: number, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  addAdmin(email: string): Promise<AdminRecord>;
  findAdminByEmail(email: string): Promise<AdminRecord | undefined>;
  createLoginToken(token: { hash: string; adminId: string; bindHash: string; expiresAt: number; ip: string }): Promise<void>;
  consumeLoginToken(hash: string, bindHash: string, now: number): Promise<AdminRecord | undefined>;
  createSession(session: { hash: string; adminId: string; expiresAt: number; ip: string; userAgent: string }): Promise<void>;
  findSession(hash: string, now: number): Promise<AdminRecord | undefined>;
  deleteSession(hash: string): Promise<void>;
  purgeExpired(now: number): Promise<number>;
}

export const AUTH_STORE = Symbol('AUTH_STORE');
export const SCAN_STORE = Symbol('SCAN_STORE');
export const CASE_STORE = Symbol('CASE_STORE');

// Admin emails are stored and looked up in this one form.
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();
