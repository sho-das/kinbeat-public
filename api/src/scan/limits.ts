// For limits where 0 or a bad value means "use the default".
export const positiveEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const numberEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// At most `max` calls run at once. The others wait in the order they came. max of 0 or less means no limit.
export class Gate {
  private live = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  // A call that is cancelled while it waits is dropped, and never takes a slot.
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error('Cancelled');
    if (this.max <= 0) return fn();
    if (this.live >= this.max) {
      await new Promise<void>((resolve, reject) => {
        const turn = () => {
          signal?.removeEventListener('abort', leave);
          resolve();
        };
        const leave = () => {
          this.waiting = this.waiting.filter((entry) => entry !== turn);
          reject(new Error('Cancelled'));
        };
        this.waiting.push(turn);
        signal?.addEventListener('abort', leave, { once: true });
      });
    } else {
      this.live++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.live--;
    }
  }
}

// Model calls per UTC day, in memory. A limit of 0 is off. A visitor over their own allowance does not use up the total.
export class DailyCap {
  private day = -1;
  private total = 0;
  private visitors = new Map<string, number>();

  constructor(private readonly totalLimit: number, private readonly visitorLimit: number, private readonly now: () => number = Date.now) {}

  take(owner = 'unknown'): boolean {
    if (this.totalLimit <= 0 && this.visitorLimit <= 0) return true;
    const day = Math.floor(this.now() / 86_400_000);
    if (day !== this.day) {
      this.day = day;
      this.total = 0;
      this.visitors.clear();
    }
    const used = this.visitors.get(owner) ?? 0;
    if (this.visitorLimit > 0 && used >= this.visitorLimit) return false;
    if (this.totalLimit > 0 && this.total >= this.totalLimit) return false;
    this.visitors.set(owner, used + 1);
    this.total++;
    return true;
  }

  // True when the day's total is used up (not just one visitor's share).
  totalUsed(): boolean {
    return this.totalLimit > 0 && this.total >= this.totalLimit;
  }
}

// Model time for Ask AI per UTC day, in seconds. The AI server is billed by the second, so this is the spend cap.
// The plan lists days and their allowance, "2026-11-04:4500,2026-11-05:13500"; a day takes the latest entry on or before it.
// What a day does not use rolls over to the next, up to twice one day's allowance. In memory: a restart starts the day afresh.
export class AskBudget {
  private day = -1;
  private usedMs = 0;
  private carryMs = 0;

  constructor(
    private readonly plan: Array<{ from: number; seconds: number }>,
    private readonly now: () => number = Date.now,
  ) {}

  static fromEnv(name: string, fallbackSeconds: number): AskBudget {
    const plan = (process.env[name] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [date, seconds] = part.split(':');
        return { from: Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000), seconds: Number(seconds) };
      })
      .filter((entry) => Number.isFinite(entry.from) && Number.isFinite(entry.seconds) && entry.seconds >= 0)
      .sort((a, b) => a.from - b.from);
    return new AskBudget(plan.length ? plan : [{ from: 0, seconds: fallbackSeconds }]);
  }

  private allowanceMs(day: number): number {
    let seconds = this.plan[0]?.seconds ?? 0;
    for (const entry of this.plan) if (entry.from <= day) seconds = entry.seconds;
    return seconds * 1000;
  }

  private roll(): void {
    const day = Math.floor(this.now() / 86_400_000);
    if (day === this.day) return;
    // Days are kept one at a time: a gap of several days still carries at most one day's leftover.
    const leftover = this.day < 0 ? 0 : Math.max(0, this.allowanceMs(this.day) + this.carryMs - this.usedMs);
    this.day = day;
    this.carryMs = Math.min(leftover, this.allowanceMs(day));
    this.usedMs = 0;
  }

  // Seconds still available today.
  remaining(): number {
    this.roll();
    return Math.max(0, (this.allowanceMs(this.day) + this.carryMs - this.usedMs) / 1000);
  }

  // 0 or less seconds in the plan means no limit.
  allowed(): boolean {
    this.roll();
    return this.allowanceMs(this.day) <= 0 || this.remaining() > 0;
  }

  spend(ms: number): void {
    this.roll();
    this.usedMs += Math.max(0, ms);
  }
}
