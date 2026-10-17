import { Clock, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BackupReminder, Empty, Tile, navigate, toneFor } from '../components';
import { useList, type Conversation } from '../lib/db';
import { searchConversations } from '../lib/search';
import { formatDuration, formatTime, localDay } from '../lib/time';

export const STATUS_PILLS: Record<Conversation['status'], { label: string; tone: string } | null> = {
  recording: { label: 'Recording', tone: 'rose' },
  transcribed: { label: 'Not summarized', tone: 'peach' },
  analyzing: { label: 'Summarizing…', tone: 'sky' },
  analyzed: null,
  error: { label: 'Needs attention', tone: 'rose' },
};

function dayLabel(ms: number): string {
  const day = localDay(new Date(ms));
  if (day === localDay()) return 'Today';
  if (day === localDay(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function conversationTitle(c: Conversation): string {
  return c.analysis?.title ?? c.fileName ?? c.segments[0]?.text.slice(0, 60) ?? 'Conversation';
}

export function ConversationsView() {
  const conversations = useList('conversations');
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  const visible = useMemo(() => {
    if (!conversations) return [];
    const base = showHidden ? conversations : conversations.filter((c) => !c.analysis?.discard);
    return query.trim() ? searchConversations(base, query, { limit: 100 }).map((h) => h.conversation) : base;
  }, [conversations, query, showHidden]);

  const hiddenCount = conversations?.filter((c) => c.analysis?.discard).length ?? 0;

  if (!conversations) return null;
  if (!conversations.length) {
    return (
      <Empty>
        No conversations yet. <a href="#/record">Start recording</a> or transcribe an audio file.
      </Empty>
    );
  }

  let lastDay = '';
  return (
    <div className="conversations">
      <BackupReminder count={conversations.length} />
      <div className="toolbar">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder="Search conversations…" aria-label="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {hiddenCount > 0 && (
        <label className="toggle">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show {hiddenCount} trivial snippet{hiddenCount > 1 ? 's' : ''}
        </label>
      )}
      {!visible.length && <Empty>No matches.</Empty>}
      {visible.map((c) => {
        const day = dayLabel(c.startedAt);
        const header = !query && day !== lastDay ? <h2 className="eyebrow day">{day}</h2> : null;
        lastDay = day;
        const pill = STATUS_PILLS[c.status];
        return (
          <div key={c.id}>
            {header}
            <button className={`card list-card ${c.analysis?.discard ? 'dim' : ''}`} onClick={() => navigate(`c/${c.id}`)}>
              <Tile tone={toneFor(c.analysis?.category ?? c.source)} size="lg">
                {c.analysis?.emoji ?? (c.source === 'upload' ? '📁' : '🎙️')}
              </Tile>
              <span className="list-body">
                <span className="list-title">
                  <strong>{conversationTitle(c)}</strong>
                  <span className="list-side">{formatDuration(c.endedAt - c.startedAt)}</span>
                </span>
                <span className="meta">
                  <Clock size={14} aria-hidden="true" />
                  {query ? `${day}, ` : ''}
                  {formatTime(c.startedAt)}
                  {c.analysis?.category && ` · ${c.analysis.category}`}
                </span>
                {c.analysis?.overview && <span className="overview">{c.analysis.overview}</span>}
                {pill && <span className={`pill pill-${pill.tone}`}>{pill.label}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
