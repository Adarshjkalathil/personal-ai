import type { Conversation } from './db';
import { transcriptText } from './db';

// Small keyword search over conversations. It works for any script (Hindi,
// Tamil, …) because tokens are Unicode letters, numbers and combining marks
// (Indic vowel signs are marks, not letters).

const STOPWORDS = new Set(
  'a an and are as at be but by did do does for from had has have he her his how i in is it its me my of on or our she so that the their them they this to was we were what when where which who why will with you your about did said tell'.split(' '),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface SearchHit {
  conversation: Conversation;
  score: number;
  excerpts: string[];
}

export interface SearchOptions {
  from?: number;
  to?: number;
  limit?: number;
}

function countMatches(haystack: string, term: string): number {
  let count = 0;
  for (let i = haystack.indexOf(term); i >= 0; i = haystack.indexOf(term, i + term.length)) count++;
  return count;
}

export function searchConversations(conversations: Conversation[], query: string, options: SearchOptions = {}): SearchHit[] {
  const terms = [...new Set(tokenize(query))];
  const inRange = conversations.filter(
    (c) => (options.from === undefined || c.endedAt >= options.from) && (options.to === undefined || c.startedAt <= options.to),
  );

  const hits = inRange.map((conversation) => {
    const a = conversation.analysis;
    const summary = [a?.title, a?.overview, a?.keyPoints.join(' '), a?.decisions.join(' '), a?.people.join(' ')]
      .join(' ')
      .toLowerCase();
    const lines = transcriptText(conversation).split('\n');
    const transcript = lines.join('\n').toLowerCase();

    let score = 0;
    for (const term of terms) {
      score += 3 * Math.log1p(countMatches(summary, term)) + Math.log1p(countMatches(transcript, term));
    }
    const excerpts = terms.length
      ? lines.filter((line) => terms.some((term) => line.toLowerCase().includes(term))).slice(0, 6)
      : [];
    return { conversation, score, excerpts };
  });

  const ranked = terms.length
    ? hits.filter((h) => h.score > 0).sort((x, y) => y.score - x.score || y.conversation.startedAt - x.conversation.startedAt)
    : hits.sort((x, y) => y.conversation.startedAt - x.conversation.startedAt);
  return ranked.slice(0, options.limit ?? 8);
}

/** Short, stable reference the AI can cite, e.g. [c:1a2b3c4d]. */
export function shortRef(id: string): string {
  return id.slice(0, 8);
}

export function findByRef<T extends { id: string }>(items: T[], ref: string): T | undefined {
  const clean = ref.replace(/^[a-z]:/i, '').trim();
  return items.find((item) => item.id === clean) ?? items.find((item) => item.id.startsWith(clean));
}
