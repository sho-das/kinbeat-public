import { AsyncLocalStorage } from 'node:async_hooks';

// What the model calls of one request used. Tokens are the pieces of text a model reads and writes; providers bill by them.
export interface Usage {
  calls: number;
  inputTokens: number;
  // The part of inputTokens the provider had already seen and bills at the lower cached price.
  cachedTokens: number;
  outputTokens: number;
}

// The usage block of a model reply. Every field is checked, because it comes from the network.
interface RawUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  input_tokens_details?: { cached_tokens?: unknown } | null;
}

const scope = new AsyncLocalStorage<Usage>();
const empty = (): Usage => ({ calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 });
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

// Runs fn with a fresh counter. Every model call made inside it, however deep, adds to that counter.
export function trackUsage<T>(fn: () => T): T {
  return scope.run(empty(), fn);
}

// The counter of the request that is running, or undefined outside trackUsage.
export function currentUsage(): Usage | undefined {
  const usage = scope.getStore();
  return usage ? { ...usage } : undefined;
}

// The usage block of one reply as plain counts.
function read(raw: unknown): Usage {
  const block = (raw ?? {}) as RawUsage;
  const input = count(block.input_tokens);
  return { calls: 1, inputTokens: input, cachedTokens: Math.min(input, count(block.input_tokens_details?.cached_tokens)), outputTokens: count(block.output_tokens) };
}

const addTo = (total: Usage, part: Usage) => {
  total.calls += part.calls;
  total.inputTokens += part.inputTokens;
  total.cachedTokens += part.cachedTokens;
  total.outputTokens += part.outputTokens;
};

// Called once per model reply. A reply with no usage block still counts as a call.
export function addUsage(raw: unknown): void {
  const part = read(raw);
  monthSpend.add(part);
  const usage = scope.getStore();
  if (usage) addTo(usage, part);
}

// Where the month totals are kept between restarts. The memory store keeps them for one process only.
export interface SpendStore {
  getMonth(month: string): Promise<Usage | undefined>;
  addMonth(month: string, part: Usage): Promise<void>;
}

// The calendar month in UTC, for example 2026-11.
export const monthKey = (at = new Date()): string => at.toISOString().slice(0, 7);

// This month's model usage across every request, and the guard that stops calls near the monthly limit.
// The limit is MODEL_MONTH_LIMIT_USD; without it, or without prices, nothing is ever stopped.
// Calls stop at STOP_AT of the limit, so the last few calls in flight cannot push the month over it.
const STOP_AT = 0.95;

export class MonthSpend {
  private month = monthKey();
  private total = empty();
  private store?: SpendStore;

  // Loads this month's totals from the store and keeps adding to it from now on.
  async attach(store: SpendStore): Promise<void> {
    this.store = store;
    const saved = await store.getMonth(this.month);
    if (saved) this.total = { ...saved };
  }

  add(part: Usage): void {
    this.roll();
    addTo(this.total, part);
    void this.store?.addMonth(this.month, part).catch(() => undefined);
  }

  usage(): Usage {
    this.roll();
    return { ...this.total };
  }

  cost(): number | undefined {
    return costOf(this.usage());
  }

  limit(): number | undefined {
    const value = price('MODEL_MONTH_LIMIT_USD');
    return value && value > 0 ? value : undefined;
  }

  // True when the month's cost has reached STOP_AT of the limit.
  blocked(): boolean {
    const limit = this.limit();
    const cost = this.cost();
    return limit !== undefined && cost !== undefined && cost >= limit * STOP_AT;
  }

  // A new month starts from zero.
  private roll(): void {
    const now = monthKey();
    if (now !== this.month) {
      this.month = now;
      this.total = empty();
    }
  }

  // For tests only: forget everything.
  reset(): void {
    this.month = monthKey();
    this.total = empty();
    this.store = undefined;
  }
}

export const monthSpend = new MonthSpend();

// Prices in US dollars per one million tokens, from the provider's price page. Unset means the cost is not known.
function price(name: string): number | undefined {
  const raw = (process.env[name] ?? '').trim();
  const value = Number(raw);
  return raw !== '' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// The cost of a usage in US dollars, or undefined when the input or output price is not set.
// Cached tokens cost the cached price when one is set, and the full input price when not.
export function costOf(usage: Usage): number | undefined {
  const input = price('MODEL_PRICE_INPUT');
  const output = price('MODEL_PRICE_OUTPUT');
  if (input === undefined || output === undefined) return undefined;
  const cached = price('MODEL_PRICE_CACHED') ?? input;
  const dollars = ((usage.inputTokens - usage.cachedTokens) * input + usage.cachedTokens * cached + usage.outputTokens * output) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}

// The share of input tokens the provider had cached, from 0 to 1.
export const cachedShare = (usage: Usage): number => (usage.inputTokens > 0 ? usage.cachedTokens / usage.inputTokens : 0);
