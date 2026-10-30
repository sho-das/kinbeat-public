import { Injectable } from '@nestjs/common';

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry {
  slug: string;
  at: number;
  value: unknown;
}

// Finished repository scans, shared by every visitor and device. A result is only valid for the exact commit it was made from
// (the commit id is part of the key), so a new commit always means a new scan. It holds masked results only, like the scan record.
// It lives in memory today: it is lost on restart, and a database table can take its place later without changing the callers.
@Injectable()
export class RepoCache {
  private readonly entries = new Map<string, Entry>();

  get(key: string, now = Date.now()): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at > KEEP_MS) {
      this.entries.delete(key);
      return undefined;
    }
    // Used entries move to the back, so the least recently used one is at the front.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, slug: string, value: unknown, now = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { slug, at: now, value });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
  }

  // Called when GitHub says the repository is gone or no longer public.
  forget(slug: string): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.slug === slug) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.entries.size;
  }
}
