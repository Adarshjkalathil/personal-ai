import { Component, Fragment, useEffect, useState, type ReactNode } from 'react';

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
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
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
