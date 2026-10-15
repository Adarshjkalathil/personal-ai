import { noteExhausted, noteSent, noteSuccess, paceDelay, resetTime, type Quota } from './quota';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The provider's daily free allowance is used up; retrying today won't help. */
    readonly daily = false,
  ) {
    super(message);
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Longest we'll wait in-line for a rate limit before giving up on this request. */
const MAX_WAIT_MS = 90_000;

/** Notified while a request waits out a rate limit, so the UI can say so. */
export const rateLimitListeners = new Set<(provider: string, waitMs: number) => void>();

interface ErrorInfo {
  detail: string;
  retryAfterMs?: number;
  daily: boolean;
}

/** Parses "1m22.5s", "37s", "450ms" style durations used in provider error messages. */
function parseDuration(text: string): number | undefined {
  const match = /(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)\s*(ms|s))?/.exec(text.trim());
  if (!match || !match[0].trim()) return undefined;
  const [, h, m, value, unit] = match;
  const ms = (Number(h) || 0) * 3_600_000 + (Number(m) || 0) * 60_000 + (Number(value) || 0) * (unit === 'ms' ? 1 : 1000);
  return ms > 0 ? ms : undefined;
}

/**
 * Pulls the retry delay and limit type out of an error response. Handles Google's
 * RetryInfo/QuotaFailure details, Groq's "try again in 1m2s" messages and Retry-After.
 */
export function parseErrorBody(body: string, retryAfterHeader: string | null, statusText = ''): ErrorInfo {
  let json: { error?: unknown; message?: unknown; detail?: unknown } | null = null;
  try {
    json = JSON.parse(body);
  } catch {
    // not JSON
  }
  const error = (json?.error && typeof json.error === 'object' ? json.error : json) as
    | { message?: unknown; details?: unknown; detail?: unknown }
    | null;
  const rawDetail = error?.message ?? error?.detail ?? (typeof json?.error === 'string' ? json.error : undefined) ?? body ?? statusText;
  const detail = String(typeof rawDetail === 'object' ? JSON.stringify(rawDetail) : rawDetail || statusText).slice(0, 400);
  const details = Array.isArray(error?.details) ? (error.details as Record<string, unknown>[]) : [];

  let retryAfterMs: number | undefined;
  const header = Number(retryAfterHeader);
  if (header > 0) retryAfterMs = header * 1000;
  for (const d of details) {
    if (typeof d.retryDelay === 'string') retryAfterMs = parseDuration(d.retryDelay) ?? retryAfterMs;
  }
  const hint = /(?:retry|try again) in ([\dhms.\s]+)/i.exec(detail);
  if (retryAfterMs === undefined && hint) retryAfterMs = parseDuration(hint[1]);

  const daily = /per ?day|perday|daily|\bRPD\b|\bASPD\b|\bTPD\b/i.test(`${detail} ${JSON.stringify(details)}`);
  return { detail, retryAfterMs, daily };
}

function friendly(provider: string, status: number, info: ErrorInfo, quota?: Quota): string {
  if (status === 401 || status === 403) return `${provider} rejected the API key. Check it in Settings.`;
  if (status === 404) return `${provider} doesn't recognise that model or endpoint. Pick another model in Settings. (${info.detail})`;
  if (status === 413) return `${provider}: the request was too large.`;
  if (status === 429 && info.daily && quota) {
    const model = quota.id.split(':')[1];
    return `${provider}'s free daily limit for ${model} is used up. It resets at ${resetTime()} your time. Each Gemini model has its own daily limit, so another Gemini model in Settings may still work.`;
  }
  if (status === 429 && info.daily) {
    return `${provider}'s free daily limit is used up (it resets within a day). Use another provider in Settings to keep going.`;
  }
  if (status === 429) return `${provider} is getting too many requests per minute on the free tier. Wait a minute, or switch provider in Settings.`;
  return `${provider} error ${status}: ${info.detail}`;
}

export interface RequestOptions {
  retries?: number;
  /** false: fail at once on a rate limit (the caller can offer another provider). */
  waitOnRateLimit?: boolean;
  /** A known free-tier budget: requests are paced to fit it and counted. */
  quota?: Quota;
}

/**
 * fetch() that waits out rate limits for as long as the provider asks (up to 90 s),
 * retries server errors with backoff, gives up at once on daily limits, and turns
 * failures into readable messages. With a quota, requests are spaced so they never
 * exceed its per-minute limit in the first place.
 */
export async function request(provider: string, url: string, init: RequestInit, options: RequestOptions = {}): Promise<Response> {
  const { retries = 3, waitOnRateLimit = true, quota } = options;
  for (let attempt = 0; ; attempt++) {
    if (quota) {
      for (let delay = paceDelay(quota); delay > 0; delay = paceDelay(quota)) {
        if (!waitOnRateLimit) {
          throw new ApiError(`${provider} allows only ${quota.perMinute} requests a minute on the free tier, and they're used up for now.`, 429);
        }
        rateLimitListeners.forEach((listener) => listener(provider, delay));
        await sleep(delay);
      }
      noteSent(quota);
    }
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      if (attempt >= retries) throw new ApiError(`Couldn't reach ${provider}. Check your internet connection.`, 0);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) {
      if (quota) noteSuccess(quota);
      return response;
    }

    const info = parseErrorBody(await response.text().catch(() => ''), response.headers.get('retry-after'), response.statusText);
    if (quota && response.status === 429 && info.daily) noteExhausted(quota);
    if (response.status === 429 && !info.daily && waitOnRateLimit && attempt < retries) {
      const wait = (info.retryAfterMs ?? 5000 * 2 ** attempt) + 500;
      if (wait <= MAX_WAIT_MS) {
        rateLimitListeners.forEach((listener) => listener(provider, wait));
        await sleep(wait);
        continue;
      }
    }
    if (response.status >= 500 && attempt < retries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new ApiError(friendly(provider, response.status, info, quota), response.status, response.status === 429 && info.daily);
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
