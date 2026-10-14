import { useEffect, useRef, useState } from 'react';
import { BusyChoice, Markdown, Notice, limitKind, useAction } from '../components';
import { speak } from '../lib/actions';
import { runAgent, type AgentAction, type AgentReply, type ChatTurn } from '../lib/agent';
import type { LlmProviderId } from '../lib/providers';
import { llmProblem, useSettings } from '../lib/settings';

const SUGGESTIONS = [
  'What did I promise to do this week?',
  'Summarize my conversations from yesterday',
  'Who did I talk to today and about what?',
  'Remind me tomorrow at 9am to call the bank',
  'What do you remember about me?',
];

const ACTION_ICONS: Record<AgentAction['kind'], string> = { calendar: '📅', email: '✉️', message: '💬' };

export function AgentActions({ actions }: { actions: AgentAction[] }) {
  if (!actions.length) return null;
  return (
    <div className="actions">
      {actions.map((action, i) => (
        <a key={i} className="button secondary" href={action.url} target="_blank" rel="noreferrer">
          {ACTION_ICONS[action.kind]} {action.label}
        </a>
      ))}
    </div>
  );
}

interface Message extends ChatTurn {
  reply?: AgentReply;
}

export function AskView() {
  const settings = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const { busy, error, cause, run } = useAction();
  const [failed, setFailed] = useState<{ text: string; history: ChatTurn[] } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const problem = llmProblem(settings);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    send(text, history);
  };

  const send = (text: string, history: ChatTurn[], provider?: LlmProviderId) => {
    setFailed(null);
    void run(async () => {
      try {
        const reply = await runAgent(text, history, { provider });
        setMessages((m) => [...m, { role: 'assistant', content: reply.text, reply }]);
      } catch (e) {
        setFailed({ text, history });
        throw e;
      }
    });
  };

  return (
    <div className="ask">
      {problem && (
        <Notice kind="warn">
          {problem} <a href="#/settings">Open Settings</a>
        </Notice>
      )}

      {!messages.length && (
        <div className="ask-intro">
          <h2>Ask about your conversations</h2>
          <p className="muted">
            The assistant searches your recordings, and can add tasks, remember facts, schedule events and draft messages.
          </p>
          <div className="chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => ask(s)} disabled={!!problem}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="messages">
        {messages.map((message, i) => (
          <div key={i} className={`message ${message.role}`}>
            {message.role === 'user' ? (
              <p>{message.content}</p>
            ) : (
              <>
                {message.reply?.steps.map((step) => (
                  <p key={step} className="step">
                    ✓ {step}
                  </p>
                ))}
                <Markdown text={message.content || '(no answer)'} />
                <AgentActions actions={message.reply?.actions ?? []} />
                <button className="link small" onClick={() => speak(message.content)}>
                  🔊 Read aloud
                </button>
              </>
            )}
          </div>
        ))}
        {busy && <div className="message assistant muted">Thinking…</div>}
        {error && <Notice kind="error">{error}</Notice>}
        {failed && !busy && <BusyChoice kind={limitKind(cause)} onRetry={(provider) => send(failed.text, failed.history, provider)} />}
        <div ref={bottom} />
      </div>

      <form
        className="ask-input"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything, or tell it what to do…" disabled={!!problem} />
        <button type="submit" disabled={busy || !input.trim() || !!problem}>
          Send
        </button>
      </form>
    </div>
  );
}
