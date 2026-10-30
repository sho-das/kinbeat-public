// For limits where 0 or a bad value means "use the default".
export const positiveEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const numberEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// Runs fn over the items with at most `limit` at a time. Results come back in the order of the items.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

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
}
