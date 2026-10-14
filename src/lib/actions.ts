// One-tap actions that need no OAuth or backend: prefilled links into the
// user's own apps, plus downloadable .ics calendar files.

import type { CalendarEvent, Task } from './db';
import { parseLocalDate, timeZone } from './time';

function compactLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function compactUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(event: CalendarEvent, details = ''): string {
  const start = parseLocalDate(event.start) ?? new Date();
  const end = new Date(start.getTime() + (event.durationMinutes || 30) * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compactLocal(start)}/${compactLocal(end)}`,
    ctz: timeZone,
    details,
    location: event.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  const address = /\S+@\S+/.test(to) ? to : '';
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function whatsappUrl(body: string): string {
  return `https://wa.me/?text=${encodeURIComponent(body)}`;
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
}

interface IcsItem {
  uid: string;
  title: string;
  start: Date;
  durationMinutes: number;
  description?: string;
  location?: string;
  /** Minutes before start to alert. */
  alarm?: number;
}

export function buildIcs(items: IcsItem[]): Blob {
  const now = compactUtc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Personal AI//EN', 'CALSCALE:GREGORIAN'];
  for (const item of items) {
    const end = new Date(item.start.getTime() + item.durationMinutes * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.uid}@personal-ai`,
      `DTSTAMP:${now}`,
      `DTSTART:${compactUtc(item.start)}`,
      `DTEND:${compactUtc(end)}`,
      `SUMMARY:${escapeIcs(item.title)}`,
    );
    if (item.description) lines.push(`DESCRIPTION:${escapeIcs(item.description)}`);
    if (item.location) lines.push(`LOCATION:${escapeIcs(item.location)}`);
    if (item.alarm !== undefined) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(item.title)}`, `TRIGGER:-PT${item.alarm}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}

export function eventsToIcs(events: CalendarEvent[]): Blob {
  return buildIcs(
    events.map((event, i) => ({
      uid: `${Date.now()}-${i}`,
      title: event.title,
      start: parseLocalDate(event.start) ?? new Date(),
      durationMinutes: event.durationMinutes || 30,
      location: event.location,
      alarm: 15,
    })),
  );
}

/** Tasks with a due date become 15-minute calendar entries with an alarm. */
export function tasksToIcs(tasks: Task[]): Blob {
  return buildIcs(
    tasks
      .filter((task) => parseLocalDate(task.due))
      .map((task) => ({
        uid: task.id,
        title: task.text,
        start: parseLocalDate(task.due)!,
        durationMinutes: 15,
        alarm: 10,
      })),
  );
}

export function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/[*_#`]|\[c:[^\]]+\]/g, '')));
}
