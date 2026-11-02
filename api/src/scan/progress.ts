import { Injectable } from '@nestjs/common';

// What a running scan is doing now, so the page can show it while it waits. The page picks a random id, sends it with the
// scan, and asks for the step with the same id. The server keeps only the step and two numbers, never text from the scan.
type ProgressStep = 'download' | 'site' | 'files' | 'pictures' | 'ai';
export type Progress = (step: ProgressStep, done?: number, total?: number) => void;

interface ProgressState {
  step: ProgressStep;
  done?: number;
  total?: number;
}

const PROGRESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEEP_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 2000;

@Injectable()
export class ScanProgress {
  private readonly entries = new Map<string, ProgressState & { at: number }>();

  // A reporter for one scan, or none when the page sent no valid id. Only the visitor who started the scan can read it.
  reporter(owner: string, id: unknown): Progress | undefined {
    if (typeof id !== 'string' || !PROGRESS_ID.test(id)) return undefined;
    const key = `${owner}|${id}`;
    return (step, done, total) => {
      this.sweep();
      this.entries.delete(key);
      this.entries.set(key, { step, ...(done !== undefined && total !== undefined ? { done, total } : {}), at: Date.now() });
    };
  }

  get(owner: string, id: string): ProgressState | undefined {
    const entry = this.entries.get(`${owner}|${id}`);
    if (!entry || Date.now() - entry.at > KEEP_MS) return undefined;
    const { at: _at, ...state } = entry;
    return state;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (now - entry.at > KEEP_MS) this.entries.delete(key);
    while (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
  }
}
