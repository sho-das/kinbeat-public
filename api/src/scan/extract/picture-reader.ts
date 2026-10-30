import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { MuseClient } from '../muse.client';
import { numberEnv } from '../limits';
import { prepareForModel } from './image';
import { ExtractCancelled } from './types';

export type PictureRead = { status: 'ok'; text: string } | { status: 'not-read'; reason: string };

const PROMPT_VERSION = '1';
const CACHE_ENTRIES = 200;
const CACHE_MS = 60 * 60 * 1000;

// How many pictures one scan may send to the model. Pictures cost model calls, so a zip of pictures cannot multiply them.
export class PictureBudget {
  readonly max: number;
  used = 0;

  constructor(max = numberEnv('MUSE_MAX_PICTURES', 30)) {
    this.max = max;
  }

  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

// Reads text out of a picture or a scanned page with the Muse model. The text stays in memory only, for an hour,
// and is never written to disk or to the logs.
@Injectable()
export class PictureReader {
  private readonly cache = new Map<string, { text: string; at: number }>();

  constructor(private readonly muse: MuseClient) {}

  async read(image: Buffer, signal?: AbortSignal, owner?: string): Promise<PictureRead> {
    if (signal?.aborted) throw new ExtractCancelled();
    let prepared: Buffer;
    try {
      prepared = await prepareForModel(image);
    } catch (error) {
      return { status: 'not-read', reason: (error as Error).message };
    }
    const key = createHash('sha256').update(prepared).update(`${this.muse.model}|${PROMPT_VERSION}`).digest('hex');
    const saved = this.cache.get(key);
    if (saved && Date.now() - saved.at < CACHE_MS) return { status: 'ok', text: saved.text };

    let out;
    try {
      out = await this.muse.readImage(prepared, { signal, owner });
    } catch {
      out = { status: 'error' as const, error: 'The picture request failed' };
    }
    if (signal?.aborted) throw new ExtractCancelled();
    if (out.status === 'ok') {
      this.cache.delete(key);
      this.cache.set(key, { text: out.text, at: Date.now() });
      while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
      return { status: 'ok', text: out.text };
    }
    const reason =
      out.status === 'unavailable'
        ? 'Pictures are read by the Muse model, and this server has no model key.'
        : out.status === 'timeout'
          ? 'Muse took too long to read this picture.'
          : out.status === 'limit'
            ? 'The model-call limit was reached.'
            : 'Muse could not read this picture.';
    return { status: 'not-read', reason };
  }
}
