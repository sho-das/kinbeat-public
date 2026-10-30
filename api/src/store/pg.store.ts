import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { AdminRecord, AuditEntry, AuditRow, AuthStore, CaseRecord, CaseStore, normaliseEmail, ScanRecord, ScanRow, RepoResultRow, RepoStore, ScanStore } from './types';

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

function toScanRow(row: any): ScanRow {
  return {
    id: row.id,
    at: iso(row.at),
    kind: row.kind,
    label: row.label,
    ...(row.chars !== null ? { chars: row.chars } : {}),
    ...(row.files !== null ? { files: row.files } : {}),
    durationMs: row.duration_ms,
    mode: row.mode,
    model: row.model,
    summary: row.summary,
    verdicts: row.verdicts,
  };
}

function toCase(row: any): CaseRecord {
  return {
    id: row.id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    scanId: row.scan_id,
    scanLabel: row.scan_label,
    findingId: row.finding_id,
    type: row.type,
    encoding: row.encoding,
    ...(row.source !== null ? { source: row.source } : {}),
    place: row.place,
    preview: row.preview,
    hash: row.hash,
    confidence: row.confidence,
    verdict: row.verdict,
    status: row.status,
    owner: row.owner,
    history: row.history,
  };
}

const CASE_COLUMNS = 'id, created_at, updated_at, scan_id, scan_label, finding_id, type, encoding, source, place, preview, hash, confidence, verdict, status, owner, history';

function caseValues(c: CaseRecord): unknown[] {
  return [c.id, c.createdAt, c.updatedAt, c.scanId, c.scanLabel, c.findingId, c.type, c.encoding, c.source ?? null, JSON.stringify(c.place), c.preview, c.hash, JSON.stringify(c.confidence), c.verdict, c.status, c.owner, JSON.stringify(c.history)];
}

export class PgScanStore implements ScanStore {
  constructor(private readonly pool: Pool) {}

  async save(entry: ScanRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO scans (id, at, kind, label, chars, files, duration_ms, mode, model, summary, verdicts, result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [entry.id, entry.at, entry.kind, entry.label, entry.chars ?? null, entry.files ?? null, entry.durationMs, entry.mode, entry.model, JSON.stringify(entry.summary), JSON.stringify(entry.verdicts), JSON.stringify(entry.result)],
    );
  }

  async list(): Promise<ScanRow[]> {
    const { rows } = await this.pool.query('SELECT id, at, kind, label, chars, files, duration_ms, mode, model, summary, verdicts FROM scans ORDER BY at DESC, id DESC LIMIT 200');
    return rows.map(toScanRow);
  }

  async get(id: string): Promise<ScanRecord | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM scans WHERE id = $1', [id]);
    return rows[0] ? { ...toScanRow(rows[0]), result: rows[0].result } : undefined;
  }

  async purge(olderThanDays: number): Promise<number> {
    const { rowCount } = await this.pool.query("DELETE FROM scans WHERE at < now() - make_interval(days => $1)", [olderThanDays]);
    return rowCount ?? 0;
  }
}

export class PgCaseStore implements CaseStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<CaseRecord[]> {
    const { rows } = await this.pool.query(`SELECT ${CASE_COLUMNS} FROM cases ORDER BY updated_at DESC, id DESC`);
    return rows.map(toCase);
  }

  async get(id: string): Promise<CaseRecord | undefined> {
    const { rows } = await this.pool.query(`SELECT ${CASE_COLUMNS} FROM cases WHERE id = $1`, [id]);
    return rows[0] ? toCase(rows[0]) : undefined;
  }

  async findByHash(hash: string, type: string): Promise<CaseRecord | undefined> {
    const { rows } = await this.pool.query(`SELECT ${CASE_COLUMNS} FROM cases WHERE hash = $1 AND type = $2`, [hash, type]);
    return rows[0] ? toCase(rows[0]) : undefined;
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM cases');
    return rows[0].n;
  }

  async insert(record: CaseRecord): Promise<{ record: CaseRecord; created: boolean }> {
    const { rows } = await this.pool.query(
      `INSERT INTO cases (${CASE_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (hash, type) WHERE hash IS NOT NULL DO NOTHING RETURNING ${CASE_COLUMNS}`,
      caseValues(record),
    );
    if (rows[0]) return { record: toCase(rows[0]), created: true };
    const existing = record.hash ? await this.findByHash(record.hash, record.type) : undefined;
    if (!existing) throw new Error('Could not save the case.');
    return { record: existing, created: false };
  }

  async update(id: string, change: (record: CaseRecord) => void): Promise<CaseRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT ${CASE_COLUMNS} FROM cases WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return undefined;
      }
      const record = toCase(rows[0]);
      change(record);
      await client.query('UPDATE cases SET updated_at=$2, scan_label=$3, status=$4, owner=$5, history=$6 WHERE id=$1', [id, record.updatedAt, record.scanLabel, record.status, record.owner, JSON.stringify(record.history)]);
      await client.query('COMMIT');
      return record;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const toAdmin = (row: any): AdminRecord => ({ id: row.id, email: row.email, createdAt: iso(row.created_at), ...(row.last_login ? { lastLogin: iso(row.last_login) } : {}) });

export class PgAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async countAdmins(): Promise<number> {
    return (await this.pool.query('SELECT count(*)::int AS n FROM admins')).rows[0].n;
  }

  async removeAdmin(email: string): Promise<void> {
    await this.pool.query('DELETE FROM admins WHERE email = $1', [normaliseEmail(email)]);
  }

  async audit(entry: AuditEntry, now = Date.now()): Promise<void> {
    await this.pool.query('INSERT INTO audit_log (at, admin_id, admin_email, action, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)', [new Date(now), entry.adminId ?? null, entry.adminEmail ?? null, entry.action, JSON.stringify(entry.detail ?? {}), entry.ip ?? null]);
  }

  async listAudit(limit: number): Promise<AuditRow[]> {
    const { rows } = await this.pool.query('SELECT id, at, admin_id, admin_email, action, detail, ip FROM audit_log ORDER BY at DESC, id DESC LIMIT $1', [limit]);
    return rows.map((row) => ({ id: Number(row.id), at: iso(row.at), action: row.action, ...(row.admin_id ? { adminId: row.admin_id } : {}), ...(row.admin_email ? { adminEmail: row.admin_email } : {}), detail: row.detail, ...(row.ip ? { ip: row.ip } : {}) }));
  }

  async hitLimit(key: string, limit: number, windowMs: number, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const since = new Date(now - windowMs);
      await client.query('DELETE FROM login_attempts WHERE key = $1 AND at < $2', [key, since]);
      const { rows } = await client.query('SELECT count(*)::int AS n, min(at) AS first FROM login_attempts WHERE key = $1', [key]);
      if (rows[0].n >= limit) {
        await client.query('COMMIT');
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((new Date(rows[0].first).getTime() + windowMs - now) / 1000)) };
      }
      await client.query('INSERT INTO login_attempts (key, at) VALUES ($1, $2)', [key, new Date(now)]);
      await client.query('COMMIT');
      return { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async addAdmin(email: string): Promise<AdminRecord> {
    const lower = normaliseEmail(email);
    const { rows } = await this.pool.query('INSERT INTO admins (id, email) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING *', [randomUUID(), lower]);
    return toAdmin(rows[0]);
  }

  async findAdminByEmail(email: string): Promise<AdminRecord | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM admins WHERE email = $1', [normaliseEmail(email)]);
    return rows[0] ? toAdmin(rows[0]) : undefined;
  }

  async createLoginToken(token: { hash: string; adminId: string; bindHash: string; expiresAt: number; ip: string }): Promise<void> {
    await this.pool.query('INSERT INTO login_tokens (token_hash, admin_id, bind_hash, expires_at, ip) VALUES ($1,$2,$3,$4,$5)', [token.hash, token.adminId, token.bindHash, new Date(token.expiresAt), token.ip]);
  }

  async consumeLoginToken(hash: string, bindHash: string, now: number): Promise<AdminRecord | undefined> {
    const when = new Date(now);
    const { rows } = await this.pool.query(
      'UPDATE login_tokens SET used_at = $3 WHERE token_hash = $1 AND bind_hash = $2 AND used_at IS NULL AND expires_at > $3 RETURNING admin_id',
      [hash, bindHash, when],
    );
    if (!rows[0]) return undefined;
    const admin = await this.pool.query('UPDATE admins SET last_login = $2 WHERE id = $1 RETURNING *', [rows[0].admin_id, when]);
    return admin.rows[0] ? toAdmin(admin.rows[0]) : undefined;
  }

  async createSession(session: { hash: string; adminId: string; expiresAt: number; ip: string; userAgent: string }): Promise<void> {
    await this.pool.query('INSERT INTO sessions (token_hash, admin_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)', [session.hash, session.adminId, new Date(session.expiresAt), session.ip, session.userAgent.slice(0, 200)]);
  }

  async findSession(hash: string, now: number): Promise<AdminRecord | undefined> {
    const { rows } = await this.pool.query('SELECT a.* FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = $1 AND s.expires_at > $2', [hash, new Date(now)]);
    return rows[0] ? toAdmin(rows[0]) : undefined;
  }

  async deleteSession(hash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
  }

  async purgeExpired(now: number): Promise<number> {
    const when = new Date(now);
    const tokens = await this.pool.query('DELETE FROM login_tokens WHERE expires_at <= $1', [when]);
    const sessions = await this.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [when]);
    await this.pool.query('DELETE FROM login_attempts WHERE at < $1', [new Date(now - 24 * 3_600_000)]);
    return (tokens.rowCount ?? 0) + (sessions.rowCount ?? 0);
  }
}

export class PgRepoStore implements RepoStore {
  constructor(private readonly pool: Pool) {}

  async get(key: string): Promise<RepoResultRow | undefined> {
    const { rows } = await this.pool.query('SELECT key, slug, sha, commit_at, commit_url, at, value FROM repo_results WHERE key = $1', [key]);
    const row = rows[0];
    return row ? { key: row.key, slug: row.slug, sha: row.sha, commitAt: row.commit_at ? new Date(row.commit_at).toISOString() : null, commitUrl: row.commit_url, at: new Date(row.at).toISOString(), value: row.value } : undefined;
  }

  async put(row: RepoResultRow): Promise<void> {
    await this.pool.query(
      'INSERT INTO repo_results (key, slug, sha, commit_at, commit_url, at, value) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (key) DO NOTHING',
      [row.key, row.slug, row.sha, row.commitAt, row.commitUrl, row.at, JSON.stringify(row.value)],
    );
  }

  async forget(slug: string): Promise<number> {
    const result = await this.pool.query('DELETE FROM repo_results WHERE slug = $1', [slug]);
    return result.rowCount ?? 0;
  }

  async purge(olderThanDays: number): Promise<number> {
    const result = await this.pool.query("DELETE FROM repo_results WHERE at < now() - ($1 || ' days')::interval", [String(olderThanDays)]);
    return result.rowCount ?? 0;
  }
}
