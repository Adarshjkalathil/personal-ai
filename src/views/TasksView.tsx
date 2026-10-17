import { ArrowUpRight, Bell, CalendarPlus, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Empty, Notice, Section } from '../components';
import { download, googleCalendarUrl, tasksToIcs } from '../lib/actions';
import { newId, patch, put, remove, useList, type Task } from '../lib/db';
import { enableReminders } from '../lib/reminders';
import { updateSettings, useSettings } from '../lib/settings';
import { formatDateTime, parseLocalDate, toDateTimeInput } from '../lib/time';

export function TaskRow({ task }: { task: Task }) {
  const due = parseLocalDate(task.due);
  const overdue = !task.done && due && due.getTime() < Date.now();
  return (
    <div className={`row task ${task.done ? 'done' : ''}`}>
      <label>
        <input type="checkbox" checked={task.done} onChange={() => patch('tasks', task.id, (t) => (t.done = !t.done))} />
        <span>
          {task.text}
          {task.owner === 'other' && <span className="tag">someone else</span>}
          {due && <span className={`due ${overdue ? 'overdue' : ''}`}>{formatDateTime(due.getTime())}</span>}
        </span>
      </label>
      <span className="row-actions">
        {task.conversationId && (
          <a className="icon-button" href={`#/c/${task.conversationId}`} title="Open source conversation" aria-label="Open source conversation">
            <ArrowUpRight size={18} />
          </a>
        )}
        {due && !task.done && (
          <a
            className="icon-button"
            href={googleCalendarUrl({ title: task.text, start: task.due, durationMinutes: 15 })}
            target="_blank"
            rel="noreferrer"
            title="Add to Google Calendar"
            aria-label="Add to Google Calendar"
          >
            <CalendarPlus size={18} />
          </a>
        )}
        <button className="icon-button" title="Delete" aria-label={`Delete task: ${task.text}`} onClick={() => remove('tasks', task.id)}>
          <X size={18} />
        </button>
      </span>
    </div>
  );
}

export function TasksView() {
  const settings = useSettings();
  const tasks = useList('tasks');
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  if (!tasks) return null;
  const byDue = (a: Task, b: Task) =>
    (parseLocalDate(a.due)?.getTime() ?? Infinity) - (parseLocalDate(b.due)?.getTime() ?? Infinity) || b.createdAt - a.createdAt;
  const open = tasks.filter((t) => !t.done).sort(byDue);
  const done = tasks.filter((t) => t.done);
  const withDue = open.filter((t) => parseLocalDate(t.due));

  return (
    <div className="tasks">
      <form
        className="card add-task"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!text.trim()) return;
          await put('tasks', { id: newId(), text: text.trim(), owner: 'me', due: due || null, done: false, createdAt: Date.now() });
          setText('');
          setDue('');
        }}
      >
        <input placeholder="Add a task…" aria-label="New task" value={text} onChange={(e) => setText(e.target.value)} />
        <input type="datetime-local" aria-label="Due (optional)" value={due} min={toDateTimeInput(new Date())} onChange={(e) => setDue(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>
          <Plus size={18} /> Add
        </button>
      </form>

      <div className="actions">
        {!settings.reminders && (
          <button
            className="secondary small"
            onClick={async () => {
              const granted = await enableReminders();
              if (granted) updateSettings({ reminders: true });
              setNotice(granted ? 'Reminders are on while this app is open.' : 'Notifications were blocked by the browser.');
            }}
          >
            <Bell size={16} /> Turn on reminders
          </button>
        )}
        {withDue.length > 0 && (
          <button className="secondary small" onClick={() => download('tasks.ics', tasksToIcs(withDue))}>
            <CalendarPlus size={16} /> Export {withDue.length} to calendar (.ics)
          </button>
        )}
      </div>
      {notice && <Notice>{notice}</Notice>}

      <Section title={`Open (${open.length})`}>
        {open.length ? open.map((task) => <TaskRow key={task.id} task={task} />) : <Empty>Nothing pending. 🎉</Empty>}
      </Section>
      {done.length > 0 && (
        <Section title={`Done (${done.length})`}>
          {done.slice(0, 50).map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </Section>
      )}
    </div>
  );
}
