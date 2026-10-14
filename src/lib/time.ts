export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Tuesday, 14 October 2026, 21:40 (Asia/Kolkata)" for prompts, so models can resolve "tomorrow at 5". */
export function nowForPrompt(date = new Date()): string {
  const text = date.toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${text} (${timeZone})`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Parses a model-provided date ("2026-10-15T17:00" or "2026-10-15"); local time when no offset is given. */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T09:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** YYYY-MM-DD in local time. */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Value for <input type="datetime-local">. */
export function toDateTimeInput(date: Date | null): string {
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
