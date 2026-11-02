import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SCAN_STORE, ScanRecord, ScanRow, ScanStore } from '../store/types';
import { fixedReason, sentence } from './reasons';


interface Scanned {
  mode: string;
  model: string;
  summary: Record<string, number>;
  findings: Array<{ judge: { status: string; verdict?: string } }>;
}

@Injectable()
export class ScanLog {
  constructor(@Inject(SCAN_STORE) private readonly store: ScanStore) {}

  async record(meta: { kind: ScanRecord['kind']; label: string; chars?: number; files?: number; startedAt: number }, result: Scanned): Promise<string> {
    const verdicts = { real: 0, unsure: 0, example: 0, not_secret: 0, none: 0 };
    for (const f of result.findings) {
      const v = f.judge.status === 'ok' ? f.judge.verdict : undefined;
      if (v === 'real' || v === 'unsure' || v === 'example' || v === 'not_secret') verdicts[v]++;
      else verdicts.none++;
    }
    const id = randomUUID();
    await this.store.save({
      id,
      at: new Date().toISOString(),
      kind: meta.kind,
      label: meta.label,
      chars: meta.chars,
      files: meta.files,
      durationMs: Date.now() - meta.startedAt,
      mode: result.mode,
      model: result.model,
      summary: result.summary,
      verdicts,
      result,
    });
    return id;
  }

  list(): Promise<ScanRow[]> {
    return this.store.list();
  }

  // A record saved before reasons were fixed sentences still holds the AI's own words, so it is shown with our sentence instead. The stored row is not changed.
  async get(id: string): Promise<ScanRecord | undefined> {
    const record = await this.store.get(id);
    const findings = (record?.result as { findings?: Array<{ judge?: { status?: string; reason?: string; code?: string } }> } | undefined)?.findings;
    if (!record || !Array.isArray(findings)) return record;
    const cleaned = findings.map((finding) => (finding.judge && finding.judge.status !== 'skipped' && !finding.judge.code ? { ...finding, judge: { ...finding.judge, code: 'OLD', reason: sentence('OLD') } } : finding));
    return { ...record, result: { ...(record.result as object), findings: cleaned.map((finding) => (finding.judge ? { ...finding, judge: fixedReason(finding.judge) } : finding)) } };
  }
}
