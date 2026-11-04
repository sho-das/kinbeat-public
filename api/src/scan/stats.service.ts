import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Two public numbers for the home page: scans started and sessions since launch. A session is one visitor on one UTC day,
// counted when the page loads; only a count is kept, never who. Saved to a small file so a restart keeps the numbers.
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);
  private readonly file = process.env.STATS_FILE || join(process.cwd(), 'data', 'stats.json');
  private scans = 0;
  private sessions = 0;
  private day = -1;
  private seen = new Set<string>();
  private loaded: Promise<void>;
  private saving: Promise<void> = Promise.resolve();

  constructor() {
    this.loaded = readFile(this.file, 'utf8')
      .then((text) => {
        const saved = JSON.parse(text) as { scans?: number; sessions?: number };
        this.scans = Number(saved.scans) || 0;
        this.sessions = Number(saved.sessions) || 0;
      })
      .catch(() => undefined);
  }

  async scan(): Promise<void> {
    await this.loaded;
    this.scans++;
    this.save();
  }

  async session(owner: string): Promise<void> {
    await this.loaded;
    const day = Math.floor(Date.now() / 86_400_000);
    if (day !== this.day) {
      this.day = day;
      this.seen.clear();
    }
    if (this.seen.has(owner)) return;
    this.seen.add(owner);
    this.sessions++;
    this.save();
  }

  async read(): Promise<{ scans: number; sessions: number }> {
    await this.loaded;
    return { scans: this.scans, sessions: this.sessions };
  }

  private save(): void {
    const text = JSON.stringify({ scans: this.scans, sessions: this.sessions });
    this.saving = this.saving
      .then(() => mkdir(dirname(this.file), { recursive: true }))
      .then(() => writeFile(this.file, text))
      .catch((error) => this.logger.warn(`stats not saved: ${(error as Error).message}`));
  }
}
