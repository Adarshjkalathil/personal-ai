import { useState } from 'react';
import { Empty } from '../components';
import { newId, put, remove, useList } from '../lib/db';
import { formatDateTime } from '../lib/time';

export function MemoriesView() {
  const memories = useList('memories');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('');

  if (!memories) return null;
  const visible = memories.filter((m) => m.text.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="memories">
      <p className="muted">
        Lasting facts picked up from your conversations: preferences, people, plans. The assistant uses them to answer
        questions. You can add or delete them yourself.
      </p>
      <form
        className="add-task"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!text.trim()) return;
          await put('memories', { id: newId(), text: text.trim(), createdAt: Date.now() });
          setText('');
        }}
      >
        <input placeholder="Add something to remember…" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>
          Save
        </button>
      </form>
      {memories.length > 8 && <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      {!memories.length && <Empty>No memories yet. They appear after conversations are summarized.</Empty>}
      {visible.map((memory) => (
        <div key={memory.id} className="row">
          <span>
            {memory.text}
            <span className="muted small"> · {formatDateTime(memory.createdAt)}</span>
            {memory.conversationId && (
              <a className="link small" href={`#/c/${memory.conversationId}`} title="Open source conversation" aria-label="Open source conversation">
                {' '}
                ↗
              </a>
            )}
          </span>
          <button className="link small" title="Delete" aria-label={`Delete memory: ${memory.text}`} onClick={() => remove('memories', memory.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
