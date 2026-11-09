import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { costOf } from './usage';

// Tracing: one trace per request that called the model, with one span per model call. It is sent to Langfuse, an outside
// service, so it carries numbers and a few fixed labels only. No prompt, no answer, no file name, no finding text and no
// secret is ever put in a trace: a span cannot hold free text at all (see label below).

type Value = number | boolean | string;

interface Span {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  attrs: Record<string, Value>;
  failed?: boolean;
}

export interface Trace {
  id: string;
  root: Span;
  calls: Span[];
}

const scope = new AsyncLocalStorage<Trace>();
const logger = new Logger('Trace');
const hex = (bytes: number) => randomBytes(bytes).toString('hex');

// The only strings a trace may hold. Each is checked against its own narrow shape, so text typed by a visitor or read
// from a file can never pass. A value that does not fit is dropped.
const LABELS: Record<string, RegExp> = {
  route: /^\/[a-z/-]{0,40}$/,
  model: /^[A-Za-z0-9._/-]{1,80}$/,
  status: /^(ok|error|timeout)$/,
};

export function label(kind: keyof typeof LABELS, value: unknown): string | undefined {
  return typeof value === 'string' && LABELS[kind].test(value) ? value : undefined;
}

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

// Starts a trace for one request and runs fn inside it. The caller ends it with finishTrace.
export function startTrace<T>(route: string, fn: (trace: Trace) => T): T {
  const safe = label('route', route) ?? '/other';
  const trace: Trace = { id: hex(16), root: { id: hex(8), name: safe, startMs: Date.now(), endMs: 0, attrs: { 'kinbeat.route': safe } }, calls: [] };
  return scope.run(trace, () => fn(trace));
}

// Adds numbers to the running request's trace, for example how many findings a scan had. Outside a trace it does nothing.
export function traceNumbers(numbers: Record<string, number>): void {
  const trace = scope.getStore();
  if (!trace) return;
  for (const [key, value] of Object.entries(numbers)) {
    if (/^[a-z_]{1,30}$/.test(key) && typeof value === 'number' && Number.isFinite(value)) trace.root.attrs[`kinbeat.${key}`] = value;
  }
}

export interface CallFacts {
  model: string;
  status: 'ok' | 'error' | 'timeout';
  httpStatus?: number;
  attempts: number;
  usage?: unknown;
}

// Records one model call that ran from startMs until now. Only its timing, status, model name and token counts are kept.
export function recordModelCall(startMs: number, facts: CallFacts): void {
  const trace = scope.getStore();
  if (!trace) return;
  const usage = (facts.usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } | null };
  const input = whole(usage.input_tokens);
  const attrs: Record<string, Value> = {
    'langfuse.observation.type': 'generation',
    'gen_ai.usage.input_tokens': input,
    'gen_ai.usage.output_tokens': whole(usage.output_tokens),
    'kinbeat.cached_tokens': Math.min(input, whole(usage.input_tokens_details?.cached_tokens)),
    'kinbeat.attempts': whole(facts.attempts),
    'kinbeat.status': label('status', facts.status) ?? 'error',
  };
  const model = label('model', facts.model);
  if (model) attrs['gen_ai.request.model'] = model;
  if (facts.httpStatus) attrs['http.response.status_code'] = whole(facts.httpStatus);
  trace.calls.push({ id: hex(8), name: 'model call', startMs, endMs: Date.now(), attrs, failed: facts.status !== 'ok' });
}

interface Target {
  url: string;
  auth: string;
}

// Tracing is on only when all three settings are present. Otherwise nothing is sent anywhere.
function target(): Target | undefined {
  const base = (process.env.LANGFUSE_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const publicKey = (process.env.LANGFUSE_PUBLIC_KEY ?? '').trim();
  const secretKey = (process.env.LANGFUSE_SECRET_KEY ?? '').trim();
  if (!/^https:\/\//.test(base) || !publicKey || !secretKey) return undefined;
  return { url: `${base}/api/public/otel/v1/traces`, auth: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` };
}

const nanos = (ms: number) => `${BigInt(Math.floor(ms)) * 1_000_000n}`;
const attribute = (key: string, value: Value) => ({
  key,
  value: typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { boolValue: value } : Number.isInteger(value) ? { intValue: `${value}` } : { doubleValue: value },
});

// The trace in the OpenTelemetry JSON shape (OTLP over HTTP), which Langfuse reads.
export function toOtlp(trace: Trace) {
  const span = (item: Span, parent?: string) => ({
    traceId: trace.id,
    spanId: item.id,
    ...(parent ? { parentSpanId: parent } : {}),
    name: item.name,
    kind: 1,
    startTimeUnixNano: nanos(item.startMs),
    endTimeUnixNano: nanos(item.endMs),
    attributes: Object.entries(item.attrs).map(([key, value]) => attribute(key, value)),
    status: { code: item.failed ? 2 : 1 },
  });
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', 'kinbeat-api')] },
        scopeSpans: [{ scope: { name: 'kinbeat' }, spans: [span(trace.root), ...trace.calls.map((call) => span(call, trace.root.id))] }],
      },
    ],
  };
}

// Ends the trace and sends it, if tracing is on and the request called the model at least once. It never throws and
// never makes a request wait: a failed send is logged and dropped.
export async function finishTrace(trace: Trace): Promise<'off' | 'empty' | 'sent' | 'failed'> {
  if (trace.root.endMs) return 'empty';
  trace.root.endMs = Date.now();
  if (trace.calls.length === 0) return 'empty';
  const sum = (key: string) => trace.calls.reduce((total, call) => total + whole(call.attrs[key]), 0);
  const usage = { calls: trace.calls.length, inputTokens: sum('gen_ai.usage.input_tokens'), cachedTokens: sum('kinbeat.cached_tokens'), outputTokens: sum('gen_ai.usage.output_tokens') };
  const cost = costOf(usage);
  Object.assign(trace.root.attrs, { 'langfuse.trace.name': trace.root.name, 'kinbeat.model_calls': usage.calls, 'kinbeat.input_tokens': usage.inputTokens, 'kinbeat.cached_tokens': usage.cachedTokens, 'kinbeat.output_tokens': usage.outputTokens, ...(cost !== undefined ? { 'kinbeat.cost_usd': cost } : {}) });
  trace.root.failed = trace.calls.some((call) => call.failed);
  const to = target();
  if (!to) return 'off';
  try {
    const response = await fetch(to.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: to.auth }, body: JSON.stringify(toOtlp(trace)), signal: AbortSignal.timeout(5000) });
    if (response.ok) return 'sent';
    logger.warn(`trace not sent: HTTP ${response.status}`);
  } catch (error) {
    logger.warn(`trace not sent: ${(error as Error).name}`);
  }
  return 'failed';
}
