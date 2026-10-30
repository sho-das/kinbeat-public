import type { ScanResult } from "./scan";

const CACHE_KEY = "kb_saved_results";
const CACHE_VERSION = "1";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 20;

interface Entry {
  at: number;
  result: ScanResult;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// A result is saved only when it is final. Errors, timeouts, limits and "still validating" would be frozen otherwise.
export function cacheable(result: ScanResult): boolean {
  const s = result.summary;
  return !s.errors && !s.timeouts && !s.limited && !s.unverified;
}

function load(storage: Store): Record<string, Entry> {
  try {
    const raw = storage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readSaved(storage: Store, key: string, now: number): Entry | null {
  const entry = load(storage)[key];
  if (!entry || typeof entry.at !== "number" || !entry.result || now - entry.at > CACHE_TTL_MS) return null;
  return entry;
}

export function save(storage: Store, key: string, result: ScanResult, now: number): void {
  if (!cacheable(result)) return;
  try {
    const all = load(storage);
    all[key] = { at: now, result };
    const newest = Object.entries(all)
      .filter(([, e]) => e && typeof e.at === "number" && now - e.at <= CACHE_TTL_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    storage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Storage can be full, blocked or private. The page works without it.
  }
}

export function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

async function sha256(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The same input gives the same key. A file is identified by its name, size and the hash of its bytes.
export async function inputKey(input: { sample?: string; text?: string; file?: File | null }): Promise<string> {
  if (input.sample) return sha256(`${CACHE_VERSION}|sample|${input.sample}`);
  if (input.text !== undefined) return sha256(`${CACHE_VERSION}|paste|${input.text}`);
  const f = input.file;
  return sha256(`${CACHE_VERSION}|file|${f ? `${f.name}:${f.size}:${await sha256(await f.arrayBuffer())}` : ""}`);
}
