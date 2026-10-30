import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SCAN_STORE, ScanRecord, ScanRow, ScanStore } from '../store/types';


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
    const verdicts = { real: 0, unsure: 0, example: 0, none: 0 };
    for (const f of result.findings) {
      const v = f.judge.status === 'ok' ? f.judge.verdict : undefined;
      if (v === 'real' || v === 'unsure' || v === 'example') verdicts[v]++;
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

  get(id: string): Promise<ScanRecord | undefined> {
    return this.store.get(id);
  }
}
