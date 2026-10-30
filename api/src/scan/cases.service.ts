import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CASE_STORE, CaseRecord, CaseStatus, CaseStore } from '../store/types';
import { ScanLog } from './scan.log';
import { maskFreeText } from './scrubber';

export { CaseRecord, CaseStatus };
const STATUSES = ['open', 'owner_notified', 'rotated', 'closed', 'false_alarm'] as const;
const MAX_CASES = 5000;

interface StoredFinding {
  id: string;
  type: string;
  encoding: string;
  source?: string;
  place: Record<string, unknown>;
  preview: string;
  hash: string | null;
  confidence: { level: string; score: number };
  judge: { status: string; verdict?: string };
}

@Injectable()
export class CasesService {
  constructor(
    private readonly scanLog: ScanLog,
    @Inject(CASE_STORE) private readonly store: CaseStore,
  ) {}

  list() {
    return this.store.list();
  }

  async get(id: string) {
    const found = await this.store.get(id);
    if (!found) throw new NotFoundException(`No case with id ${id}`);
    return found;
  }

  async create(scanId: string, findingId: string) {
    const scan = await this.scanLog.get(scanId);
    if (!scan) throw new NotFoundException('That scan is no longer in the log. Scan again, then track the finding.');
    const finding = (scan.result as { findings: StoredFinding[] }).findings.find((f) => f.id === findingId);
    if (!finding) throw new NotFoundException(`No finding ${findingId} in scan ${scanId}`);
    if (finding.hash) {
      const existing = await this.store.findByHash(finding.hash, finding.type);
      if (existing) return existing;
    }
    if ((await this.store.count()) >= MAX_CASES) throw new BadRequestException(`The case limit of ${MAX_CASES} is reached. Close or remove old cases first.`);
    const now = new Date().toISOString();
    const record: CaseRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      scanId,
      scanLabel: scan.label,
      findingId,
      type: finding.type,
      encoding: finding.encoding,
      source: finding.source,
      place: finding.place,
      preview: finding.preview,
      hash: finding.hash,
      confidence: finding.confidence,
      verdict: finding.judge.status === 'ok' ? (finding.judge.verdict ?? 'unsure') : 'none',
      status: 'open',
      owner: '',
      history: [{ at: now, status: 'open', note: 'Case opened from a scan.' }],
    };
    return (await this.store.insert(record)).record;
  }

  async update(id: string, body: { status?: unknown; note?: unknown; owner?: unknown }) {
    const { status, note, owner } = body ?? {};
    if (status !== undefined && !STATUSES.includes(status as CaseStatus)) {
      throw new BadRequestException(`status must be one of ${STATUSES.join(', ')}`);
    }
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
      throw new BadRequestException('note must be text of at most 500 characters');
    }
    if (owner !== undefined && (typeof owner !== 'string' || owner.length > 100)) {
      throw new BadRequestException('owner must be text of at most 100 characters');
    }
    const saved = await this.store.update(id, (record) => {
      if (typeof owner === 'string') record.owner = maskFreeText(owner.trim());
      const changed = typeof status === 'string' && status !== record.status;
      if (changed) record.status = status as CaseStatus;
      const text = typeof note === 'string' ? maskFreeText(note.trim()) : '';
      if (changed || text) record.history.push({ at: new Date().toISOString(), status: record.status, note: text });
      record.updatedAt = new Date().toISOString();
    });
    if (!saved) throw new NotFoundException(`No case with id ${id}`);
    return saved;
  }
}
