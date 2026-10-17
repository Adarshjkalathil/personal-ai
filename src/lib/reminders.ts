import { list, patch, type Task } from './db';
import { isNativeApp } from './native';
import { getSettings } from './settings';
import { parseLocalDate } from './time';

// Notifications for due tasks. In a browser they only fire while the app is open
// (a static site can't push in the background); the .ics export covers the rest.
// The Android app schedules them with the system, so they fire even when it's closed.

export async function enableReminders(): Promise<boolean> {
  if (isNativeApp) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return (await LocalNotifications.requestPermissions()).display === 'granted';
  }
  if (!('Notification' in window)) return false;
  return (await Notification.requestPermission()) === 'granted';
}

async function checkDueTasks() {
  if (!getSettings().reminders || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  for (const task of await list('tasks')) {
    const due = parseLocalDate(task.due);
    if (task.done || task.notified || !due || due.getTime() > now + 5 * 60_000) continue;
    const notification = new Notification('Reminder', { body: task.text, icon: './icon.svg', tag: task.id });
    notification.onclick = () => {
      window.focus();
      location.hash = '#/tasks';
    };
    await patch('tasks', task.id, (t) => (t.notified = true));
  }
}

/** Android notification ids are numbers; derive a stable one from the task id. */
function notificationId(taskId: string): number {
  let hash = 0;
  for (const char of taskId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2_000_000_000;
}

let scheduled = '';

/** Makes Android's scheduled notifications match the open tasks that are due in the future. */
async function syncNativeReminders() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const now = Date.now();
  const upcoming = getSettings().reminders
    ? (await list('tasks')).flatMap((task: Task) => {
        const due = parseLocalDate(task.due);
        return !task.done && due && due.getTime() > now ? [{ task, due }] : [];
      })
    : [];
  const signature = upcoming.map(({ task, due }) => `${task.id}@${due.getTime()}:${task.text}`).join('|');
  if (signature === scheduled) return;

  const { notifications: pending } = await LocalNotifications.getPending();
  if (pending.length) await LocalNotifications.cancel({ notifications: pending.map(({ id }) => ({ id })) });
  if (upcoming.length) {
    await LocalNotifications.schedule({
      notifications: upcoming.map(({ task, due }) => ({
        id: notificationId(task.id),
        title: 'Reminder',
        body: task.text,
        schedule: { at: due, allowWhileIdle: true },
        extra: { taskId: task.id },
      })),
    });
  }
  scheduled = signature;
}

export function startReminderLoop(): () => void {
  if (isNativeApp) {
    const sync = () => void syncNativeReminders().catch(() => undefined);
    const listener = import('@capacitor/local-notifications').then(({ LocalNotifications }) =>
      LocalNotifications.addListener('localNotificationActionPerformed', () => (location.hash = '#/tasks')),
    );
    sync();
    // Tasks change in many places; checking every few seconds is cheap since nothing is rescheduled unless they changed.
    const timer = window.setInterval(sync, 5_000);
    return () => {
      clearInterval(timer);
      void listener.then((handle) => handle.remove());
    };
  }
  void checkDueTasks();
  const timer = window.setInterval(checkDueTasks, 60_000);
  return () => clearInterval(timer);
}
