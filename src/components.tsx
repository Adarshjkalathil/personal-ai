import { Component, Fragment, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './lib/http';
import { alternativeProviders } from './lib/llm';
import { LLM_PROVIDERS, type LlmProviderId } from './lib/providers';
import { updateSettings, useSettings } from './lib/settings';

// ---- Hash routing (works on GitHub Pages without server rewrites) ----

export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  location.hash = `#/${path}`;
}

// ---- Minimal, safe markdown (no HTML injection): headings, bullets, bold, code, citations ----

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[c:[0-9a-f-]+\])/gi);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    const cite = /^\[c:([0-9a-f-]+)\]$/i.exec(part);
    if (cite) {
      return (
        <a key={i} className="cite" href={`#/c/${cite[1]}`} title="Open conversation">
          ↗
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets}</ul>);
    bullets = [];
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(<li key={i}>{inline(bullet[1])}</li>);
      return;
    }
    flush();
    if (heading) blocks.push(<h4 key={i}>{inline(heading[2])}</h4>);
    else if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="markdown">{blocks}</div>;
}

// ---- Small building blocks ----

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Runs an async action with a busy flag and error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cause, setCause] = useState<unknown>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setCause(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCause(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, cause, run, setError };
}

export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

/** Keeps one broken view from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Notice kind="error">
        Something went wrong on this page: {this.state.error.message}. Your data is safe. Try another tab or reload.
      </Notice>
    );
  }
}

export type LimitKind = 'rate-limit' | 'daily-limit';

/** Whether an error was an AI provider's free-tier limit. */
export function limitKind(error: unknown): LimitKind | undefined {
  if (!(error instanceof ApiError) || !error.rateLimited) return undefined;
  return error.daily ? 'daily-limit' : 'rate-limit';
}

/**
 * Asks the user what to do when the AI provider hit its free limit: use another
 * provider they have a key for (once, or from now on), or try the same one again.
 * Nothing switches without their say-so.
 */
export function BusyChoice({ kind, onRetry }: { kind: LimitKind | undefined; onRetry: (provider?: LlmProviderId) => void }) {
  const settings = useSettings();
  if (!kind) return null;
  const current = LLM_PROVIDERS[settings.llm.provider].label;
  const alternatives = alternativeProviders(settings);
  const makeDefault = (provider: LlmProviderId) => {
    const preset = LLM_PROVIDERS[provider];
    updateSettings({ llm: { provider, model: preset.defaultModel, baseUrl: preset.baseUrl } });
    onRetry();
  };
  return (
    <div className="card busy-choice">
      <p>
        <b>{current}</b> {kind === 'daily-limit' ? 'has used up its free requests for today.' : 'is busy right now (free-tier limit).'} What
        would you like to do?
      </p>
      <div className="actions">
        {alternatives.map((id) => (
          <button key={id} onClick={() => onRetry(id)}>
            Use {LLM_PROVIDERS[id].label} this time
          </button>
        ))}
        {kind === 'rate-limit' && (
          <button className="secondary" onClick={() => onRetry()}>
            Try {current} again
          </button>
        )}
      </div>
      {alternatives.length > 0 && (
        <p className="muted small">
          Or make it your default:{' '}
          {alternatives.map((id, i) => (
            <Fragment key={id}>
              {i > 0 && ' · '}
              <button className="link small" onClick={() => makeDefault(id)}>
                always use {LLM_PROVIDERS[id].label}
              </button>
            </Fragment>
          ))}
        </p>
      )}
      {!alternatives.length && (
        <p className="muted small">
          Tip: add a free key for another provider in <a href="#/settings">Settings</a> to have a backup.
        </p>
      )}
    </div>
  );
}
