import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const LOCK_ID = 7_212_026;

export async function migrate(pool: Pool, dir = join(process.cwd(), 'db', 'migrations')): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(join(dir, name), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
