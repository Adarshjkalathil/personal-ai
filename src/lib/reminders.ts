import { list, patch } from './db';
import { getSettings } from './settings';
import { parseLocalDate } from './time';

// Browser notifications for due tasks. They only fire while the app is open
// (a static site can't push in the background); the .ics export covers the rest.

export async function enableReminders(): Promise<boolean> {
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

export function startReminderLoop(): () => void {
  void checkDueTasks();
  const timer = window.setInterval(checkDueTasks, 60_000);
  return () => clearInterval(timer);
}
