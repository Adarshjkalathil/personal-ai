import { useState } from 'react';
import { Markdown, Notice, useAction } from '../components';
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
  const { busy, error, run } = useAction();
  const problem = llmProblem(settings);
  const count = conversations?.filter((c) => localDay(new Date(c.startedAt)) === day).length ?? 0;

  return (
    <div className="recap">
      <div className="toolbar">
        <input
          type="date"
          value={day}
          max={localDay()}
          onChange={(e) => {
            setDay(e.target.value);
            setRecap(savedRecap(e.target.value));
          }}
        />
        <button disabled={busy || !count || !!problem} onClick={() => run(async () => setRecap(await dailyRecap(day)))}>
          {busy ? 'Writing recap…' : recap ? 'Regenerate' : 'Generate recap'}
        </button>
        {recap && (
          <button className="secondary" onClick={() => speak(recap)}>
            🔊 Listen
          </button>
        )}
      </div>
      <p className="muted">
        {count} conversation{count === 1 ? '' : 's'} on this day.
      </p>
      {problem && <Notice kind="warn">{problem}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {recap && (
        <div className="card">
          <Markdown text={recap} />
        </div>
      )}
    </div>
  );
}
