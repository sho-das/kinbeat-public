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

// Called once per model reply. A reply with no usage block still counts as a call.
export function addUsage(raw: unknown): void {
  const usage = scope.getStore();
  if (!usage) return;
  const block = (raw ?? {}) as RawUsage;
  const input = count(block.input_tokens);
  usage.calls++;
  usage.inputTokens += input;
  usage.cachedTokens += Math.min(input, count(block.input_tokens_details?.cached_tokens));
  usage.outputTokens += count(block.output_tokens);
}

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
