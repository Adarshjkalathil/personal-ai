// Keeping the user's data safe: persistent storage, backup reminders, and app updates.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { download } from './actions';
import { exportAll } from './db';
import { localDay } from './time';

// ---- Persistent storage ----
//
// Without this, browsers may delete IndexedDB when the device is low on space,
// and Safari clears it after about a week without a visit (unless the app is on
// the Home Screen).

/** Asks the browser not to clear this site's data. Returns whether it agreed. */
export async function persistStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export interface StorageStatus {
  persisted: boolean;
  /** Bytes used by this site, if the browser says. */
  usage?: number;
  supported: boolean;
}

export async function storageStatus(): Promise<StorageStatus> {
  try {
    if (!navigator.storage?.persisted) return { persisted: false, supported: false };
    const [persisted, estimate] = await Promise.all([navigator.storage.persisted(), navigator.storage.estimate?.()]);
    return { persisted, usage: estimate?.usage, supported: true };
  } catch {
    return { persisted: false, supported: false };
  }
}

// ---- Backups ----

const LAST_BACKUP_KEY = 'personal-ai.lastBackup';
const SNOOZE_KEY = 'personal-ai.backupSnooze';
const DAY_MS = 86_400_000;
/** Remind after this many days without a backup... */
const BACKUP_EVERY_DAYS = 7;
/** ...once there are at least this many conversations worth losing. */
const BACKUP_MIN_CONVERSATIONS = 3;

const backupListeners = new Set<() => void>();
let backupVersion = 0;

function readNumber(key: string): number {
  return Number(localStorage.getItem(key)) || 0;
}

function writeNumber(key: string, value: number) {
  localStorage.setItem(key, String(value));
  backupVersion++;
  backupListeners.forEach((listener) => listener());
}

export function lastBackupAt(): number {
  return readNumber(LAST_BACKUP_KEY);
}

/** Downloads a backup of all conversations, tasks and memories. */
export async function downloadBackup(): Promise<void> {
  const backup = await exportAll();
  download(`personal-ai-backup-${localDay()}.json`, new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }));
  writeNumber(LAST_BACKUP_KEY, Date.now());
}

export function snoozeBackupReminder(days = 3): void {
  writeNumber(SNOOZE_KEY, Date.now() + days * DAY_MS);
}

/** Whether to remind the user to back up, given how many conversations they have. */
export function backupDue(conversationCount: number, now = Date.now()): boolean {
  if (conversationCount < BACKUP_MIN_CONVERSATIONS || now < readNumber(SNOOZE_KEY)) return false;
  return now - lastBackupAt() > BACKUP_EVERY_DAYS * DAY_MS;
}

/** Re-renders when a backup is made or the reminder is snoozed. */
export function useBackupState(): number {
  return useSyncExternalStore(
    (listener) => {
      backupListeners.add(listener);
      return () => backupListeners.delete(listener);
    },
    () => backupVersion,
  );
}

/** "today", "yesterday", "12 days ago" or "never". */
export function daysAgo(ms: number, now = Date.now()): string {
  if (!ms) return 'never';
  const days = Math.floor((now - ms) / DAY_MS);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

// ---- App updates ----

const UPDATE_CHECK_MS = 30 * 60_000;

/** True once a newer version of the app has been deployed than the one running. */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || available) return;
    const check = async () => {
      try {
        const response = await fetch('./version.json', { cache: 'no-store' });
        const { build } = (await response.json()) as { build?: string };
        if (build && build !== __BUILD__) setAvailable(true);
      } catch {
        // offline; try again later
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const timer = setInterval(check, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [available]);
  return available;
}
