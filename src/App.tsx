import { Brain, LayoutGrid, ListChecks, MessagesSquare, Mic, Newspaper, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { ErrorBoundary, PageHeader, Tile, useRoute, type Tone } from './components';
import { startReminderLoop } from './lib/reminders';
import { useSession } from './lib/session';
import { useSettings, type Settings as AppSettings } from './lib/settings';
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

interface Tab {
  path: string;
  label: string;
  title: string;
  icon: LucideIcon;
  /** Shown in the phone's bottom bar; the rest sit under "More". */
  main: boolean;
  tone: Tone;
  blurb?: string;
}

const TABS: Tab[] = [
  { path: 'record', label: 'Record', title: 'Record', icon: Mic, main: true, tone: 'mint' },
  { path: 'conversations', label: 'Conversations', title: 'Conversations', icon: MessagesSquare, main: true, tone: 'sky' },
  { path: 'ask', label: 'Ask', title: 'Ask', icon: Sparkles, main: true, tone: 'lavender' },
  { path: 'tasks', label: 'Tasks', title: 'Tasks', icon: ListChecks, main: true, tone: 'peach' },
  { path: 'memories', label: 'Memories', title: 'Memories', icon: Brain, main: false, tone: 'rose', blurb: 'Facts it has learned about you' },
  { path: 'recap', label: 'Recap', title: 'Daily recap', icon: Newspaper, main: false, tone: 'sky', blurb: 'A summary of any day' },
  { path: 'settings', label: 'Settings', title: 'Settings', icon: Settings, main: false, tone: 'lavender', blurb: 'Keys, providers, backups' },
];

function MoreView() {
  return (
    <div className="more">
      {TABS.filter((tab) => !tab.main).map((tab) => (
        <a key={tab.path} href={`#/${tab.path}`} className="card list-card more-link">
          <Tile tone={tab.tone}>
            <tab.icon size={24} />
          </Tile>
          <span className="list-body">
            <strong>{tab.label}</strong>
            <span className="muted small">{tab.blurb}</span>
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

/** Applies the light or dark theme, following the device when set to "system". */
function useTheme(theme: AppSettings['theme']) {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151d2e' : '#eef2f7');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  const [page = 'record', id] = useRoute();
  const { mode } = useSession();
  const { onboarded, theme } = useSettings();
  useTheme(theme);

  useEffect(() => startReminderLoop(), []);

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (mode === 'idle') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [mode]);

  const active = page === 'c' ? 'conversations' : page;
  const tab = TABS.find((t) => t.path === active);
  const inMore = active === 'more' || (tab && !tab.main);
  // Record and a single conversation draw their own headers.
  const title = page === 'more' ? 'More' : page !== 'record' && page !== 'c' ? tab?.title : undefined;

  if (!onboarded) {
    return (
      <div className="app onboarding">
        <main className="content">
          <ErrorBoundary resetKey="welcome">
            <WelcomeView />
          </ErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        <a href="#/record" className="brand">
          <img src="./icon-192.png" alt="" width={36} height={36} />
          Personal AI
        </a>
        {TABS.map((t) => (
          <a
            key={t.path}
            href={`#/${t.path}`}
            className={`nav-item ${t.main ? '' : 'extra'} ${active === t.path ? 'active' : ''}`}
            aria-current={active === t.path ? 'page' : undefined}
          >
            <t.icon size={22} aria-hidden="true" />
            <span className="nav-label">{t.label}</span>
          </a>
        ))}
        <a href="#/more" className={`nav-item more-item ${inMore ? 'active' : ''}`} aria-current={active === 'more' ? 'page' : undefined}>
          <LayoutGrid size={22} aria-hidden="true" />
          <span className="nav-label">More</span>
        </a>
      </nav>
      <main className="content">
        <UpdateBanner recording={mode !== 'idle'} />
        {title && (
          <PageHeader title={title} back={tab && !tab.main ? 'more' : undefined} backOnlyOnPhones>
            {mode === 'recording' && (
              <a href="#/record" className="rec-badge" role="status">
                ● REC
              </a>
            )}
          </PageHeader>
        )}
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
    </div>
  );
}
