import { Logger } from '@nestjs/common';
import { recordModelCall } from './trace';
import { Gate, numberEnv } from './limits';
import { CODES } from './reasons';

// The small open model on our own Cloud Run service, served by Ollama. It costs nothing per call, sleeps when idle and
// wakes slowly, and it only ever gets masked text: a real value never leaves the API for it (see MuseClient.row).

// The first answer after a wake took 40 seconds in the speed test; a sleeping service adds about 70 seconds more.
const TIMEOUT_MS = 150_000;
// Google's identity tokens last an hour. One is kept and reused for most of that.
const TOKEN_TTL_MS = 50 * 60_000;
// Inside Cloud Run this address hands out a signed token for the service account the API runs as.
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
// The service answers one call at a time (Cloud Run concurrency 1, one instance) and turns away a second with 429.
// So calls queue here, one at a time, and a 429 or 503 is tried again after a pause.
const RETRY_STATUSES = [429, 503];
const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Letters, digits, dots, dashes and underscores only, so the name also fits in a trace label.
const MODEL_NAME = /^[A-Za-z0-9._-]{1,64}$/;

// Ollama is told the exact shape of the answer, so a reply cannot drift into prose: one object per row, and the code
// must be one of our 13 (without the list the model wrote REAL and EXAMPLE, which the parser rejects).
// The judge's parser reads the array inside, the same as a bare array from Muse.
export const ANSWER_SHAPE = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, code: { type: 'string', enum: Object.keys(CODES) }, quote: { type: ['string', 'null'] } },
        required: ['id', 'code', 'quote'],
      },
    },
  },
  required: ['answers'],
};

export type ModelOut = { status: 'ok'; text: string; model: string } | { status: 'timeout' | 'error'; error: string; model: string };

export class SmallModel {
  private readonly logger = new Logger(SmallModel.name);
  readonly url: string;
  readonly model: string;
  private token: { value: string; until: number } | null = null;
  // Calls that start together share one token request.
  private fetching: Promise<string | null> | null = null;
  private readonly queue = new Gate(1);
  backoffMs = 2_000;

  constructor() {
    // No default address: without SMALL_MODEL_URL nothing is sent.
    this.url = (process.env.SMALL_MODEL_URL || '').replace(/\/+$/, '');
    this.model = process.env.SMALL_MODEL_NAME || 'phi4-mini';
    if (!MODEL_NAME.test(this.model)) throw new Error('SMALL_MODEL_NAME may hold only letters, digits, dots, dashes and underscores');
    if (this.url) this.logger.log(`small model ready model=${this.model}`);
  }

  get ready(): boolean {
    return this.url !== '';
  }

  // The service is private, so every call carries a signed-in token: a fixed one from the settings for local runs, else a
  // short-lived identity token from Google's metadata server, which only exists inside Cloud Run.
  private async bearer(): Promise<string | null> {
    if (process.env.SMALL_MODEL_TOKEN) return process.env.SMALL_MODEL_TOKEN;
    if (this.token && Date.now() < this.token.until) return this.token.value;
    this.fetching ??= this.freshToken().finally(() => (this.fetching = null));
    return this.fetching;
  }

  private async freshToken(): Promise<string | null> {
    const response = await fetch(`${METADATA}?audience=${encodeURIComponent(this.url)}`, { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(5_000) }).catch(() => null);
    if (!response?.ok) return null;
    const value = (await response.text()).trim();
    if (!value) return null;
    this.token = { value, until: Date.now() + TOKEN_TTL_MS };
    return value;
  }

  // One judge prompt in, the model's text out. Each call is one trace span: timing, status and token counts, no text.
  async post(prompt: string, signal?: AbortSignal): Promise<ModelOut> {
    const startedAt = Date.now();
    let attempts = 0;
    const done = (result: ModelOut, httpStatus?: number, usage?: unknown): ModelOut => {
      recordModelCall(startedAt, { model: this.model, status: result.status, attempts, httpStatus, usage });
      return result;
    };
    if (!this.ready) return done({ status: 'error', error: 'No small model address set', model: this.model });
    const token = await this.bearer();
    if (!token) return done({ status: 'error', error: 'No token for the small model', model: this.model });
    const body = JSON.stringify({
      model: this.model,
      stream: false,
      format: ANSWER_SHAPE,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0, num_predict: numberEnv('SMALL_MODEL_MAX_TOKENS', 2_000) },
    });
    let response: Response | undefined;
    try {
      response = await this.queue.run(async () => {
        for (;;) {
          attempts++;
          const reply = await fetch(`${this.url}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body,
            signal: signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]) : AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!RETRY_STATUSES.includes(reply.status) || attempts > MAX_RETRIES) return reply;
          await sleep(this.backoffMs * 2 ** (attempts - 1));
        }
      }, signal);
    } catch (error) {
      const name = signal?.aborted ? 'Cancelled' : (error as Error).name;
      return done({ status: name === 'TimeoutError' ? 'timeout' : 'error', error: `Request failed: ${name}`, model: this.model });
    }
    if (!response.ok) return done({ status: 'error', error: `HTTP ${response.status}`, model: this.model }, response.status);
    let payload: { message?: { content?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown } | null;
    try {
      payload = await response.json();
    } catch {
      return done({ status: 'error', error: 'Response was not JSON', model: this.model }, response.status);
    }
    const text = typeof payload?.message?.content === 'string' ? payload.message.content : '';
    // Token counts in the shape the tracer reads. They go to the trace only, never to the month's spend: this model has no price per token.
    const usage = { input_tokens: payload?.prompt_eval_count, output_tokens: payload?.eval_count };
    return done({ status: 'ok', text, model: this.model }, response.status, usage);
  }
}
