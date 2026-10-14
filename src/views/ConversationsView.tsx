import { useMemo, useState } from 'react';
import { Empty, navigate } from '../components';
import { useList, type Conversation } from '../lib/db';
import { searchConversations } from '../lib/search';
import { formatDateTime, formatDuration, localDay } from '../lib/time';

const STATUS_LABELS: Record<Conversation['status'], string> = {
  recording: 'Recording',
  transcribed: 'Not summarized',
  analyzing: 'Summarizing…',
  analyzed: '',
  error: 'Needs attention',
};

function dayLabel(ms: number): string {
  const day = localDay(new Date(ms));
  if (day === localDay()) return 'Today';
  if (day === localDay(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
      <div className="toolbar">
        <input type="search" placeholder="Search conversations…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {hiddenCount > 0 && (
          <label className="toggle">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show {hiddenCount} trivial
          </label>
        )}
      </div>
      {!visible.length && <Empty>No matches.</Empty>}
      {visible.map((c) => {
        const day = dayLabel(c.startedAt);
        const header = !query && day !== lastDay ? <h4 className="day">{day}</h4> : null;
        lastDay = day;
        return (
          <div key={c.id}>
            {header}
            <button className={`card conversation-card ${c.analysis?.discard ? 'dim' : ''}`} onClick={() => navigate(`c/${c.id}`)}>
              <span className="emoji">{c.analysis?.emoji ?? (c.source === 'upload' ? '📁' : '🎙️')}</span>
              <span className="conversation-info">
                <strong>{c.analysis?.title ?? c.fileName ?? c.segments[0]?.text.slice(0, 60) ?? 'Conversation'}</strong>
                <span className="muted">
                  {formatDateTime(c.startedAt)} · {formatDuration(c.endedAt - c.startedAt)}
                  {c.analysis?.category && ` · ${c.analysis.category}`}
                  {STATUS_LABELS[c.status] && ` · ${STATUS_LABELS[c.status]}`}
                </span>
                {c.analysis?.overview && <span className="overview">{c.analysis.overview}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
