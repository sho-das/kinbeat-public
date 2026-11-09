import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SCAN_STORE, ScanRecord, ScanRow, ScanStore } from '../store/types';
import { fixedReason, sentence } from './reasons';
import { costOf, currentUsage } from './usage';
import { traceNumbers } from './trace';


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
    traceNumbers({ findings: result.findings.length, verdict_real: verdicts.real, verdict_unsure: verdicts.unsure, verdict_example: verdicts.example, verdict_not_secret: verdicts.not_secret, verdict_none: verdicts.none });
    const id = randomUUID();
    // The usage is saved with the record for the admin logs. It is not part of what the visitor gets back.
    const used = currentUsage();
    const cost = used ? costOf(used) : undefined;
    const usage = used && used.calls > 0 ? { ...used, ...(cost !== undefined ? { cost } : {}) } : undefined;
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
      ...(usage ? { usage } : {}),
      result: usage ? { ...result, usage } : result,
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
