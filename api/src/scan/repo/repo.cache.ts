import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPO_STORE, RepoStore } from '../../store/types';

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry {
  slug: string;
  at: number;
  value: unknown;
}

// Finished repository scans, shared by every visitor and device. A result is only valid for the exact commit it was made from
// (the commit id is part of the key), so a new commit always means a new scan. It holds masked results only, like the scan record.
// Memory is the fast front. Every result is also saved in the database with the commit id, the commit time and the commit link,
// so the same commit gives the same result for everyone, also after a restart. Without a database it lives in memory only.
@Injectable()
export class RepoCache {
  private readonly logger = new Logger(RepoCache.name);
  private readonly entries = new Map<string, Entry>();

  constructor(@Inject(REPO_STORE) private readonly store: RepoStore) {}

  async get(key: string, now = Date.now()): Promise<unknown | undefined> {
    const entry = this.entries.get(key);
    if (entry) {
      if (now - entry.at > KEEP_MS) {
        this.entries.delete(key);
      } else {
        // Used entries move to the back, so the least recently used one is at the front.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
      }
    }
    try {
      const row = await this.store.get(key);
      if (!row || now - Date.parse(row.at) > KEEP_MS) return undefined;
      this.remember(key, row.slug, row.value, Date.parse(row.at));
      return row.value;
    } catch (error) {
      this.logger.warn(`saved result could not be read: ${(error as Error).name}`);
      return undefined;
    }
  }

  async set(key: string, slug: string, sha: string, value: unknown, commit: { at: string | null; url: string }, now = Date.now()): Promise<void> {
    this.remember(key, slug, value, now);
    try {
      await this.store.put({ key, slug, sha, commitAt: commit.at, commitUrl: commit.url, at: new Date(now).toISOString(), value });
    } catch (error) {
      this.logger.warn(`result could not be saved: ${(error as Error).name}`);
    }
  }

  // Called when GitHub says the repository is gone or no longer public.
  async forget(slug: string): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.slug === slug) {
        this.entries.delete(key);
        removed++;
      }
    }
    try {
      removed += await this.store.forget(slug);
    } catch (error) {
      this.logger.warn(`saved results could not be removed: ${(error as Error).name}`);
    }
    return removed;
  }

  private remember(key: string, slug: string, value: unknown, at: number): void {
    this.entries.delete(key);
    this.entries.set(key, { slug, at, value });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
  }

  size(): number {
    return this.entries.size;
  }
}
