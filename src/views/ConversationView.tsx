import { useState } from 'react';
import { BusyChoice, Empty, Notice, Section, copyText, limitKind, navigate, useAction } from '../components';
import { download, eventsToIcs, googleCalendarUrl, mailtoUrl, whatsappUrl } from '../lib/actions';
import { analyzeConversation } from '../lib/analyze';
import { patch, remove, speakerName, transcriptText, useList } from '../lib/db';
import { findByRef } from '../lib/search';
import { llmProblem, useSettings } from '../lib/settings';
import { formatDateTime, formatDuration, formatTime, parseLocalDate } from '../lib/time';
import { TaskRow } from './TasksView';

export function ConversationView({ id }: { id: string }) {
  const settings = useSettings();
  const conversations = useList('conversations');
  const tasks = useList('tasks');
  const memories = useList('memories');
  const { busy, error, cause, run } = useAction();
  const [renaming, setRenaming] = useState(false);

  if (!conversations) return null;
  const conversation = findByRef(conversations, id);
  if (!conversation) return <Empty>Conversation not found. <a href="#/conversations">Back to list</a></Empty>;

  const a = conversation.analysis;
  const ownTasks = tasks?.filter((t) => t.conversationId === conversation.id) ?? [];
  const ownMemories = memories?.filter((m) => m.conversationId === conversation.id) ?? [];
  const speakers = [...new Set(conversation.segments.map((s) => s.speaker).filter((s): s is string => !!s))];
  const llmIssue = llmProblem(settings);
  const title = a?.title ?? conversation.fileName ?? 'Conversation';

  return (
    <div className="conversation">
      <button className="link back" onClick={() => navigate('conversations')}>
        ← All conversations
      </button>
      <header className="conversation-header">
        <span className="emoji big">{a?.emoji ?? '🎙️'}</span>
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {formatDateTime(conversation.startedAt)} · {formatDuration(conversation.endedAt - conversation.startedAt)}
            {a?.category && ` · ${a.category}`}
            {a?.language && ` · ${a.language}`}
          </p>
        </div>
      </header>

      <div className="actions">
        <button
          disabled={busy || conversation.status === 'analyzing' || conversation.status === 'recording' || !!llmIssue}
          onClick={() => run(() => analyzeConversation(conversation.id, { interactive: true }))}
        >
          {conversation.status === 'analyzing' || busy ? 'Summarizing…' : a ? 'Summarize again' : 'Summarize'}
        </button>
        <button className="secondary" onClick={() => download(`${title}.txt`, new Blob([transcriptText(conversation, true)], { type: 'text/plain' }))}>
          Download transcript
        </button>
        <button
          className="secondary danger"
          onClick={async () => {
            if (!confirm('Delete this conversation and its tasks and memories?')) return;
            for (const t of ownTasks) await remove('tasks', t.id);
            for (const m of ownMemories) await remove('memories', m.id);
            await remove('conversations', conversation.id);
            navigate('conversations');
          }}
        >
          Delete
        </button>
      </div>

      {llmIssue && !a && <Notice>{llmIssue}</Notice>}
      {(error || conversation.error) && <Notice kind="error">{error ?? conversation.error}</Notice>}
      {!busy && conversation.status !== 'analyzing' && (
        <BusyChoice
          kind={error ? limitKind(cause) : conversation.errorKind}
          onRetry={(provider) => run(() => analyzeConversation(conversation.id, { provider, interactive: true }))}
        />
      )}
      {a?.discard && <Notice>This looked like a trivial snippet, so it’s hidden from the main list.</Notice>}

      {a && (
        <>
          {a.overview && (
            <Section title="Overview">
              <p>{a.overview}</p>
            </Section>
          )}
          {a.keyPoints.length > 0 && (
            <Section title="Key points">
              <ul>{a.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </Section>
          )}
          {a.decisions.length > 0 && (
            <Section title="Decisions">
              <ul>{a.decisions.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </Section>
          )}
          {ownTasks.length > 0 && (
            <Section title="Tasks">
              {ownTasks.map((task) => <TaskRow key={task.id} task={task} />)}
            </Section>
          )}
          {a.events.length > 0 && (
            <Section
              title="Events"
              actions={
                <button className="link" onClick={() => download('events.ics', eventsToIcs(a.events))}>
                  Download .ics
                </button>
              }
            >
              {a.events.map((event, i) => (
                <div key={i} className="row">
                  <span>
                    📅 <b>{event.title}</b>
                    <span className="muted">
                      {' '}
                      {parseLocalDate(event.start) ? formatDateTime(parseLocalDate(event.start)!.getTime()) : 'time not set'}
                      {event.location && ` · ${event.location}`}
                    </span>
                  </span>
                  <a className="button secondary small" href={googleCalendarUrl(event, a.overview)} target="_blank" rel="noreferrer">
                    Add to Google Calendar
                  </a>
                </div>
              ))}
            </Section>
          )}
          {a.followUps.length > 0 && (
            <Section title="Suggested follow-ups">
              {a.followUps.map((f, i) => (
                <div key={i} className="card followup">
                  <p className="muted">
                    {f.channel === 'email' ? '✉️ Email' : '💬 Message'}
                    {f.to && ` to ${f.to}`}
                    {f.subject && ` · ${f.subject}`}
                  </p>
                  <p className="prewrap">{f.body}</p>
                  <div className="actions">
                    {f.channel === 'email' ? (
                      <a className="button secondary small" href={mailtoUrl(f.to, f.subject, f.body)}>
                        Open in email
                      </a>
                    ) : (
                      <a className="button secondary small" href={whatsappUrl(f.body)} target="_blank" rel="noreferrer">
                        Send on WhatsApp
                      </a>
                    )}
                    <button className="secondary small" onClick={() => copyText(f.body)}>
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </Section>
          )}
          {(a.tone.overall || a.people.length > 0) && (
            <Section title="People & tone">
              {a.people.length > 0 && <p>👥 {a.people.join(', ')}</p>}
              {a.tone.overall && (
                <p>
                  🎭 <b>{a.tone.overall}</b>
                  {a.tone.notes && ` — ${a.tone.notes}`}
                </p>
              )}
            </Section>
          )}
          {ownMemories.length > 0 && (
            <Section title="Remembered">
              <ul>{ownMemories.map((m) => <li key={m.id}>{m.text}</li>)}</ul>
            </Section>
          )}
        </>
      )}

      <Section
        title="Transcript"
        actions={
          speakers.length > 0 && (
            <button className="link" onClick={() => setRenaming(!renaming)}>
              {renaming ? 'Done' : 'Name speakers'}
            </button>
          )
        }
      >
        {renaming && (
          <div className="speaker-names">
            {speakers.map((speaker) => (
              <label key={speaker}>
                {speaker}
                <input
                  defaultValue={conversation.speakerNames?.[speaker] ?? ''}
                  placeholder="Name"
                  onBlur={(e) =>
                    patch('conversations', conversation.id, (c) => {
                      c.speakerNames = { ...c.speakerNames, [speaker]: e.target.value.trim() || speaker };
                    })
                  }
                />
              </label>
            ))}
          </div>
        )}
        <div className="transcript">
          {conversation.segments.map((segment) => (
            <p key={segment.id}>
              <span className="time">{formatTime(segment.start)}</span>
              {segment.speaker && <b>{speakerName(conversation, segment.speaker)}: </b>}
              {segment.text}
            </p>
          ))}
          {!conversation.segments.length && <p className="muted">No speech transcribed yet.</p>}
        </div>
      </Section>
      {a && <p className="fineprint">Summarized by {a.model} on {formatDateTime(a.analyzedAt)}.</p>}
    </div>
  );
}
