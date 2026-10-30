import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { MemoryAuthStore, MemoryCaseStore, MemoryScanStore } from './memory.store';
import { migrate } from './migrate';
import { PgAuthStore, PgCaseStore, PgScanStore } from './pg.store';
import { AUTH_STORE, AuthStore, CASE_STORE, CaseStore, SCAN_STORE, ScanStore } from './types';

const POOL = Symbol('PG_POOL');
const RETENTION_DAYS = 30;
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000;

export function chooseStores(): 'memory' | 'postgres' {
  if (process.env.DATABASE_URL) return 'postgres';
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production. Without it, scans and cases would vanish on every restart.');
  }
  return 'memory';
}

@Injectable()
class StoreLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Store');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(POOL) private readonly pool: Pool | null,
    @Inject(SCAN_STORE) private readonly scans: ScanStore,
    @Inject(AUTH_STORE) private readonly auth: AuthStore,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.pool) {
      const ownerUrl = process.env.MIGRATE_DATABASE_URL;
      const owner = ownerUrl ? new Pool({ connectionString: ownerUrl, max: 1 }) : this.pool;
      let applied: string[];
      try {
        applied = await migrate(owner);
      } finally {
        if (ownerUrl) await owner.end();
      }
      this.logger.log(applied.length ? `migrations applied: ${applied.join(', ')}` : 'database is up to date');
    }
    await this.purge();
    this.timer = setInterval(() => void this.purge(), PURGE_EVERY_MS);
    this.timer.unref();
  }

  private async purge(): Promise<void> {
    try {
      const removed = await this.scans.purge(RETENTION_DAYS);
      if (removed) this.logger.log(`removed ${removed} scans older than ${RETENTION_DAYS} days`);
      await this.auth.purgeExpired(Date.now());
    } catch (error) {
      this.logger.warn(`purge failed: ${(error as Error).name}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool?.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      useFactory: (): Pool | null =>
        chooseStores() === 'postgres' ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 5_000 }) : null,
    },
    { provide: SCAN_STORE, inject: [POOL], useFactory: (pool: Pool | null): ScanStore => (pool ? new PgScanStore(pool) : new MemoryScanStore()) },
    { provide: CASE_STORE, inject: [POOL], useFactory: (pool: Pool | null): CaseStore => (pool ? new PgCaseStore(pool) : new MemoryCaseStore()) },
    { provide: AUTH_STORE, inject: [POOL], useFactory: (pool: Pool | null): AuthStore => (pool ? new PgAuthStore(pool) : new MemoryAuthStore()) },
    StoreLifecycle,
  ],
  exports: [SCAN_STORE, CASE_STORE, AUTH_STORE],
})
export class StoreModule {}
