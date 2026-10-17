import { ArrowUpRight, Plus, X } from 'lucide-react';
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
        className="card add-task single"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!text.trim()) return;
          await put('memories', { id: newId(), text: text.trim(), createdAt: Date.now() });
          setText('');
        }}
      >
        <input placeholder="Add something to remember…" aria-label="New memory" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>
          <Plus size={18} /> Save
        </button>
      </form>
      {memories.length > 8 && <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      {!memories.length && <Empty>No memories yet. They appear after conversations are summarized.</Empty>}
      {visible.length > 0 && (
        <div className="card list">
          {visible.map((memory) => (
            <div key={memory.id} className="row">
              <span>
                {memory.text}
                <span className="row-meta">
                  {formatDateTime(memory.createdAt)}
                  {memory.conversationId && (
                    <a className="cite" href={`#/c/${memory.conversationId}`} title="Open source conversation" aria-label="Open source conversation">
                      <ArrowUpRight size={15} />
                    </a>
                  )}
                </span>
              </span>
              <button className="icon-button" title="Delete" aria-label={`Delete memory: ${memory.text}`} onClick={() => remove('memories', memory.id)}>
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
