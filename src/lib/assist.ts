import { list, transcriptText } from './db';
import { chat, chatJson, withProvider } from './llm';
import type { LlmProviderId } from './providers';
import { getSettings, llmProblem } from './settings';
import { formatTime, localDay, nowForPrompt, parseLocalDate } from './time';

export interface LiveHint {
  kind: 'question' | 'commitment' | 'fact' | 'tip';
  text: string;
}

/** Suggestions while a conversation is happening (inspired by Omi's follow-up and proactive prompts). */
export async function liveHints(recentTranscript: string): Promise<LiveHint[]> {
  const settings = getSettings();
  if (llmProblem(settings)) return [];
  const { value: result } = await chatJson<{ hints?: LiveHint[] }>(settings, [
    {
      role: 'user',
      content: `You are a discreet assistant listening to an in-progress conversation through the user's wearable. Current time: ${nowForPrompt()}.
Return JSON {"hints": [...]} with at most 3 short, genuinely useful items, each {"kind": "question" | "commitment" | "fact" | "tip", "text": "..."}:
- question: a good follow-up question the user could ask next
- commitment: a promise or deadline someone just made that the user should not forget
- fact: a quick, well-known fact that clarifies something being discussed (only if you are certain)
- tip: a brief, practical suggestion
Return {"hints": []} if nothing is worth interrupting for. Write in ${settings.outputLanguage}.

Latest transcript:
"""
${recentTranscript}
"""`,
    },
  ]);
  return (result.hints ?? []).filter((h) => h?.text).slice(0, 3);
}

const RECAP_KEY = (day: string) => `personal-ai.recap.${day}`;

export function savedRecap(day: string): string | null {
  return localStorage.getItem(RECAP_KEY(day));
}

/** A digest of one day: what happened, decisions, open loops and suggestions for tomorrow. */
export async function dailyRecap(day: string, provider?: LlmProviderId): Promise<string> {
  const settings = withProvider(getSettings(), provider);
  const problem = llmProblem(settings);
  if (problem) throw new Error(problem);

  const conversations = (await list('conversations'))
    .filter((c) => localDay(new Date(c.startedAt)) === day)
    .reverse();
  if (!conversations.length) throw new Error('No conversations were recorded on this day.');

  const tasks = await list('tasks');
  const ids = new Set(conversations.map((c) => c.id));
  const dayTasks = tasks.filter((t) => (t.conversationId && ids.has(t.conversationId)) || localDay(new Date(t.createdAt)) === day);
  const dueSoon = tasks.filter((t) => {
    const due = parseLocalDate(t.due);
    return !t.done && due && due.getTime() < Date.now() + 3 * 86_400_000;
  });

  const material = conversations
    .map((c) => {
      const a = c.analysis;
      return a && !a.discard
        ? `${formatTime(c.startedAt)} ${a.emoji} ${a.title}\n${a.overview}\nKey points: ${a.keyPoints.join('; ')}\nDecisions: ${a.decisions.join('; ')}\nTone: ${a.tone.overall}`
        : a?.discard
          ? ''
          : `${formatTime(c.startedAt)} (not summarized)\n${transcriptText(c).slice(0, 3000)}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const { content } = await chat(settings, [
    {
      role: 'user',
      content: `Write the user's daily recap for ${day}. Current time: ${nowForPrompt()}. Write in ${settings.outputLanguage}, in simple markdown (## headings and - bullets).
Sections: "## Summary" (3-5 sentences), "## Highlights", "## Decisions", "## Open loops" (tasks and follow-ups still pending), "## People", "## Suggestions for tomorrow". Omit empty sections. Do not invent anything.

Conversations:
${material}

Tasks from this day:
${dayTasks.map((t) => `- ${t.done ? '[done] ' : ''}${t.text}${t.due ? ` (due ${t.due})` : ''}`).join('\n') || 'None'}

Open tasks due within 3 days:
${dueSoon.map((t) => `- ${t.text} (due ${t.due})`).join('\n') || 'None'}`,
    },
  ], { failFast: true });
  localStorage.setItem(RECAP_KEY(day), content);
  return content;
}
