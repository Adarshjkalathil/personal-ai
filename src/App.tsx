import { useEffect } from 'react';
import { ErrorBoundary, useRoute } from './components';
import { startReminderLoop } from './lib/reminders';
import { useSession } from './lib/session';
import { AskView } from './views/AskView';
import { ConversationView } from './views/ConversationView';
import { ConversationsView } from './views/ConversationsView';
import { MemoriesView } from './views/MemoriesView';
import { RecapView } from './views/RecapView';
import { RecordView } from './views/RecordView';
import { SettingsView } from './views/SettingsView';
import { TasksView } from './views/TasksView';

const TABS = [
  { path: 'record', label: 'Record', icon: '🎙️' },
  { path: 'conversations', label: 'Conversations', icon: '💬' },
  { path: 'ask', label: 'Ask', icon: '✨' },
  { path: 'tasks', label: 'Tasks', icon: '✅' },
  { path: 'memories', label: 'Memories', icon: '🧠' },
  { path: 'recap', label: 'Recap', icon: '📰' },
  { path: 'settings', label: 'Settings', icon: '⚙️' },
];

export function App() {
  const [page = 'record', id] = useRoute();
  const { mode } = useSession();

  useEffect(() => startReminderLoop(), []);

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (mode === 'idle') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [mode]);

  const active = page === 'c' ? 'conversations' : page;

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/record" className="brand">
          <img src="./icon.svg" alt="" width={28} height={28} />
          Personal AI
        </a>
        {mode === 'recording' && <span className="rec-badge">● REC</span>}
      </header>
      <nav className="tabs">
        {TABS.map((tab) => (
          <a key={tab.path} href={`#/${tab.path}`} className={active === tab.path ? 'active' : ''}>
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </a>
        ))}
      </nav>
      <main>
        <ErrorBoundary resetKey={location.hash}>
          {page === 'record' && <RecordView />}
          {page === 'conversations' && <ConversationsView />}
          {page === 'c' && id && <ConversationView id={id} />}
          {page === 'ask' && <AskView />}
          {page === 'tasks' && <TasksView />}
          {page === 'memories' && <MemoriesView />}
          {page === 'recap' && <RecapView />}
          {page === 'settings' && <SettingsView />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
