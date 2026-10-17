import { useEffect } from 'react';
import { ErrorBoundary, useRoute } from './components';
import { startReminderLoop } from './lib/reminders';
import { useSession } from './lib/session';
import { useSettings } from './lib/settings';
import { useUpdateAvailable } from './lib/storage';
import { AskView } from './views/AskView';
import { ConversationView } from './views/ConversationView';
import { ConversationsView } from './views/ConversationsView';
import { MemoriesView } from './views/MemoriesView';
import { RecapView } from './views/RecapView';
import { RecordView } from './views/RecordView';
import { SettingsView } from './views/SettingsView';
import { TasksView } from './views/TasksView';
import { WelcomeView } from './views/WelcomeView';

// On phones only the main tabs fit in the bottom bar; the rest sit under "More".
const TABS = [
  { path: 'record', label: 'Record', icon: '🎙️', main: true },
  { path: 'conversations', label: 'Conversations', icon: '💬', main: true },
  { path: 'ask', label: 'Ask', icon: '✨', main: true },
  { path: 'tasks', label: 'Tasks', icon: '✅', main: true },
  { path: 'memories', label: 'Memories', icon: '🧠', main: false },
  { path: 'recap', label: 'Recap', icon: '📰', main: false },
  { path: 'settings', label: 'Settings', icon: '⚙️', main: false },
];

const MORE_TEXT: Record<string, string> = {
  memories: 'Facts it has learned about you',
  recap: 'A summary of any day',
  settings: 'Keys, providers, backups',
};

function MoreView() {
  return (
    <div className="more">
      {TABS.filter((tab) => !tab.main).map((tab) => (
        <a key={tab.path} href={`#/${tab.path}`} className="card more-link">
          <span className="more-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span>
            <b>{tab.label}</b>
            <span className="muted small">{MORE_TEXT[tab.path]}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

function UpdateBanner({ recording }: { recording: boolean }) {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of Personal AI is ready.{recording && ' Reload after you stop recording.'}</span>
      <button className="small" disabled={recording} onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}

export function App() {
  const [page = 'record', id] = useRoute();
  const { mode } = useSession();
  const { onboarded } = useSettings();

  useEffect(() => startReminderLoop(), []);

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (mode === 'idle') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [mode]);

  const active = page === 'c' ? 'conversations' : page;
  const inMore = active === 'more' || TABS.some((tab) => tab.path === active && !tab.main);

  return (
    <div className={`app ${onboarded ? '' : 'onboarding'}`}>
      <header className="topbar">
        <a href="#/record" className="brand">
          <img src="./icon.svg" alt="" width={28} height={28} />
          Personal AI
        </a>
        {mode === 'recording' && (
          <span className="rec-badge" role="status">
            ● REC
          </span>
        )}
      </header>
      <UpdateBanner recording={mode !== 'idle'} />
      {onboarded ? (
        <>
          <nav className="tabs" aria-label="Main">
            {TABS.map((tab) => (
              <a
                key={tab.path}
                href={`#/${tab.path}`}
                className={`${tab.main ? '' : 'extra-tab'} ${active === tab.path ? 'active' : ''}`}
                aria-current={active === tab.path ? 'page' : undefined}
              >
                <span className="tab-icon" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="tab-label">{tab.label}</span>
              </a>
            ))}
            <a href="#/more" className={`more-tab ${inMore ? 'active' : ''}`} aria-current={active === 'more' ? 'page' : undefined}>
              <span className="tab-icon" aria-hidden="true">
                ☰
              </span>
              <span className="tab-label">More</span>
            </a>
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
              {page === 'more' && <MoreView />}
            </ErrorBoundary>
          </main>
        </>
      ) : (
        <main>
          <ErrorBoundary resetKey="welcome">
            <WelcomeView />
          </ErrorBoundary>
        </main>
      )}
    </div>
  );
}
