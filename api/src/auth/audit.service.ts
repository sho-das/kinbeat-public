import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdminRecord, AuditRow, AUTH_STORE, AuthStore } from '../store/types';
import { CLOCK, Clock } from './tokens';

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Detail is a small fixed set of fields. Never put a note, a secret or a token in it.
  async record(action: string, admin: Pick<AdminRecord, 'id' | 'email'> | undefined, detail: Record<string, unknown> = {}, ip?: string): Promise<void> {
    try {
      await this.store.audit({ action, adminId: admin?.id, adminEmail: admin?.email, detail, ip }, this.clock.now());
    } catch (error) {
      this.logger.error(`could not write the audit log: ${(error as Error).name}`);
    }
  }

  list(limit: number): Promise<AuditRow[]> {
    return this.store.listAudit(Math.min(Math.max(Math.floor(limit) || 100, 1), 500));
  }
}
