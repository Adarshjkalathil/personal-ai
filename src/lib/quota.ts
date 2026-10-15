// Free-tier request budgets, tracked on this device.
//
// Gemini's free tier allows about 5 requests a minute and 20 a day *per model*, counted
// per Google Cloud project (all keys and devices together), resetting at midnight
// Pacific time. The app paces itself to stay under the per-minute limit and counts
// requests so Settings can show what's left today.

export interface Quota {
  /** Provider and model, e.g. "gemini:gemini-3.6-flash". */
  id: string;
  perMinute: number;
  perDay: number;
}

export const GEMINI_FREE = { perMinute: 5, perDay: 20 };

/** With billing enabled the limits are far higher, so requests are only counted, not paced. */
export function geminiQuota(model: string, billing = false): Quota {
  const limits = billing ? { perMinute: Infinity, perDay: Infinity } : GEMINI_FREE;
  return { id: `gemini:${model.replace(/^models\//, '')}`, ...limits };
}

const PACIFIC = 'America/Los_Angeles';
const STORAGE_KEY = 'personal-ai.usage';

/** The current day in Pacific time (YYYY-MM-DD), the day Google's daily quotas count in. */
export function pacificDay(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Epoch ms of the next midnight in Pacific time, when daily quotas reset. */
export function nextPacificMidnight(now = Date.now()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = wallClock - Math.floor(now / 1000) * 1000;
  return Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offset;
}

/** When daily quotas reset, in the user's local time, e.g. "12:30 PM". */
export function resetTime(now = Date.now()): string {
  return new Date(nextPacificMidnight(now)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface Usage {
  day: string;
  counts: Record<string, number>;
  /** Quotas Google reported as used up today. */
  exhausted: string[];
}

function load(now = Date.now()): Usage {
  const day = pacificDay(now);
  try {
    const usage = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Usage;
    if (usage.day === day) return { day, counts: usage.counts ?? {}, exhausted: usage.exhausted ?? [] };
  } catch {
    // missing or corrupt
  }
  return { day, counts: {}, exhausted: [] };
}

function save(usage: Usage) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // storage full or unavailable; the counts are only informational
  }
  usageListeners.forEach((listener) => listener());
}

export const usageListeners = new Set<() => void>();

const recent = new Map<string, number[]>();

/** How long to wait before another request fits in the per-minute limit (0 = send now). */
export function paceDelay(quota: Quota, now = Date.now()): number {
  const times = (recent.get(quota.id) ?? []).filter((t) => now - t < 60_000);
  recent.set(quota.id, times);
  return times.length < quota.perMinute ? 0 : times[0] + 60_000 - now + 250;
}

/** Notes a request being sent, for per-minute pacing. */
export function noteSent(quota: Quota, now = Date.now()): void {
  recent.set(quota.id, [...(recent.get(quota.id) ?? []), now]);
}

/** Counts a request that succeeded (only those count towards Google's daily limit). */
export function noteSuccess(quota: Quota, now = Date.now()): void {
  const usage = load(now);
  usage.counts[quota.id] = (usage.counts[quota.id] ?? 0) + 1;
  save(usage);
}

/** Remembers that Google said a daily quota is used up. */
export function noteExhausted(quota: Quota, now = Date.now()): void {
  const usage = load(now);
  if (!usage.exhausted.includes(quota.id)) usage.exhausted.push(quota.id);
  save(usage);
}

export interface QuotaUsage {
  model: string;
  used: number;
  limit: number;
  exhausted: boolean;
}

/** Today's Gemini usage on this device, per model. */
export function geminiUsage(now = Date.now()): QuotaUsage[] {
  const usage = load(now);
  const ids = new Set([...Object.keys(usage.counts), ...usage.exhausted].filter((id) => id.startsWith('gemini:')));
  return [...ids].sort().map((id) => ({
    model: id.slice('gemini:'.length),
    used: usage.counts[id] ?? 0,
    limit: GEMINI_FREE.perDay,
    exhausted: usage.exhausted.includes(id),
  }));
}

/** For tests. */
export function resetPacing(): void {
  recent.clear();
}
