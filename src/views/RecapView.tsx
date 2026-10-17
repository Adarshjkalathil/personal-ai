import { Sparkles, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { BusyChoice, Markdown, Notice, limitKind, useAction } from '../components';
import { speak } from '../lib/actions';
import { dailyRecap, savedRecap } from '../lib/assist';
import { useList } from '../lib/db';
import { llmProblem, useSettings } from '../lib/settings';
import { localDay } from '../lib/time';

export function RecapView() {
  const settings = useSettings();
  const conversations = useList('conversations');
  const [day, setDay] = useState(localDay());
  const [recap, setRecap] = useState<string | null>(() => savedRecap(localDay()));
  const { busy, error, cause, run } = useAction();
  const problem = llmProblem(settings);
  const count = conversations?.filter((c) => localDay(new Date(c.startedAt)) === day).length ?? 0;

  return (
    <div className="recap">
      <div className="card toolbar">
        <input
          aria-label="Day"
          type="date"
          value={day}
          max={localDay()}
          onChange={(e) => {
            setDay(e.target.value);
            setRecap(savedRecap(e.target.value));
          }}
        />
        <button disabled={busy || !count || !!problem} onClick={() => run(async () => setRecap(await dailyRecap(day)))}>
          <Sparkles size={18} />
          {busy ? 'Writing recap…' : recap ? 'Regenerate' : 'Generate recap'}
        </button>
        {recap && (
          <button className="secondary" onClick={() => speak(recap)}>
            <Volume2 size={18} /> Listen
          </button>
        )}
      </div>
      <p className="muted">
        {count} conversation{count === 1 ? '' : 's'} on this day.
      </p>
      {problem && <Notice kind="warn">{problem}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {error && !busy && <BusyChoice kind={limitKind(cause)} onRetry={(provider) => run(async () => setRecap(await dailyRecap(day, provider)))} />}
      {recap && (
        <div className="card">
          <Markdown text={recap} />
        </div>
      )}
    </div>
  );
}
