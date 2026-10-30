import { randomUUID } from 'node:crypto';
import { AdminRecord, AuditEntry, AuditRow, AuthStore, CaseRecord, CaseStore, normaliseEmail, RepoResultRow, RepoStore, ScanRecord, ScanRow, ScanStore } from './types';

const MAX_SCANS = 200;

export class MemoryScanStore implements ScanStore {
  private entries: ScanRecord[] = [];

  async save(entry: ScanRecord): Promise<void> {
    this.entries.push(entry);
    this.entries.sort((a, b) => b.at.localeCompare(a.at));
    if (this.entries.length > MAX_SCANS) this.entries.length = MAX_SCANS;
  }

  async list(): Promise<ScanRow[]> {
    return this.entries.map(({ result: _result, ...row }) => row);
  }

  async get(id: string): Promise<ScanRecord | undefined> {
    return this.entries.find((entry) => entry.id === id);
  }

  async purge(olderThanDays: number): Promise<number> {
    const cut = Date.now() - olderThanDays * 86_400_000;
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => Date.parse(entry.at) >= cut);
    return before - this.entries.length;
  }
}

export class MemoryCaseStore implements CaseStore {
  private cases: CaseRecord[] = [];

  async list(): Promise<CaseRecord[]> {
    return [...this.cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<CaseRecord | undefined> {
    return this.cases.find((record) => record.id === id);
  }

  async findByHash(hash: string, type: string): Promise<CaseRecord | undefined> {
    return this.cases.find((record) => record.hash === hash && record.type === type);
  }

  async count(): Promise<number> {
    return this.cases.length;
  }

  async insert(record: CaseRecord): Promise<{ record: CaseRecord; created: boolean }> {
    const existing = record.hash ? await this.findByHash(record.hash, record.type) : undefined;
    if (existing) return { record: existing, created: false };
    this.cases.push(record);
    return { record, created: true };
  }

  async update(id: string, change: (record: CaseRecord) => void): Promise<CaseRecord | undefined> {
    const record = await this.get(id);
    if (record) change(record);
    return record;
  }
}

export class MemoryAuthStore implements AuthStore {
  private admins: AdminRecord[] = [];
  private tokens = new Map<string, { adminId: string; bindHash: string; expiresAt: number; usedAt?: number }>();
  private sessions = new Map<string, { adminId: string; expiresAt: number }>();

  private auditRows: AuditRow[] = [];
  private nextAudit = 1;
  private attempts = new Map<string, number[]>();

  async countAdmins(): Promise<number> {
    return this.admins.length;
  }

  async removeAdmin(email: string): Promise<void> {
    const lower = normaliseEmail(email);
    const admin = this.admins.find((a) => a.email === lower);
    if (!admin) return;
    this.admins = this.admins.filter((a) => a !== admin);
    for (const [hash, session] of this.sessions) if (session.adminId === admin.id) this.sessions.delete(hash);
    for (const [hash, token] of this.tokens) if (token.adminId === admin.id) this.tokens.delete(hash);
  }

  async audit(entry: AuditEntry, now = Date.now()): Promise<void> {
    this.auditRows.unshift({ id: this.nextAudit++, at: new Date(now).toISOString(), action: entry.action, adminId: entry.adminId, adminEmail: entry.adminEmail, detail: entry.detail ?? {}, ip: entry.ip });
  }

  async listAudit(limit: number): Promise<AuditRow[]> {
    return [...this.auditRows].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).slice(0, limit);
  }

  async hitLimit(key: string, limit: number, windowMs: number, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const times = (this.attempts.get(key) ?? []).filter((t) => now - t < windowMs);
    if (times.length >= limit) {
      this.attempts.set(key, times);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000)) };
    }
    times.push(now);
    this.attempts.set(key, times);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async addAdmin(email: string): Promise<AdminRecord> {
    const lower = normaliseEmail(email);
    const existing = this.admins.find((admin) => admin.email === lower);
    if (existing) return existing;
    const admin: AdminRecord = { id: randomUUID(), email: lower, createdAt: new Date().toISOString() };
    this.admins.push(admin);
    return admin;
  }

  async findAdminByEmail(email: string): Promise<AdminRecord | undefined> {
    const lower = normaliseEmail(email);
    return this.admins.find((admin) => admin.email === lower);
  }

  async createLoginToken(token: { hash: string; adminId: string; bindHash: string; expiresAt: number; ip: string }): Promise<void> {
    this.tokens.set(token.hash, { adminId: token.adminId, bindHash: token.bindHash, expiresAt: token.expiresAt });
  }

  async consumeLoginToken(hash: string, bindHash: string, now: number): Promise<AdminRecord | undefined> {
    const token = this.tokens.get(hash);
    if (!token || token.usedAt !== undefined || token.bindHash !== bindHash || token.expiresAt <= now) return undefined;
    token.usedAt = now;
    const admin = this.admins.find((a) => a.id === token.adminId);
    if (admin) admin.lastLogin = new Date(now).toISOString();
    return admin;
  }

  async createSession(session: { hash: string; adminId: string; expiresAt: number }): Promise<void> {
    this.sessions.set(session.hash, { adminId: session.adminId, expiresAt: session.expiresAt });
  }

  async findSession(hash: string, now: number): Promise<AdminRecord | undefined> {
    const session = this.sessions.get(hash);
    if (!session || session.expiresAt <= now) return undefined;
    return this.admins.find((admin) => admin.id === session.adminId);
  }

  async deleteSession(hash: string): Promise<void> {
    this.sessions.delete(hash);
  }

  async purgeExpired(now: number): Promise<number> {
    let removed = 0;
    for (const [hash, token] of this.tokens) if (token.expiresAt <= now) (this.tokens.delete(hash), removed++);
    for (const [hash, session] of this.sessions) if (session.expiresAt <= now) (this.sessions.delete(hash), removed++);
    return removed;
  }
}

export class MemoryRepoStore implements RepoStore {
  private readonly rows = new Map<string, RepoResultRow>();

  async get(key: string): Promise<RepoResultRow | undefined> {
    return this.rows.get(key);
  }

  async put(row: RepoResultRow): Promise<void> {
    if (!this.rows.has(row.key)) this.rows.set(row.key, row);
  }

  async forget(slug: string): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.slug === slug) {
        this.rows.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async purge(olderThanDays: number): Promise<number> {
    const limit = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (Date.parse(row.at) < limit) {
        this.rows.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
