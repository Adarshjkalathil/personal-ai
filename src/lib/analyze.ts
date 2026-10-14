import { chat, chatJson, type ChatMessage } from './llm';
import { get, list, newId, patch, put, remove, transcriptText, type Analysis, type Conversation, type Task } from './db';
import { LLM_PROVIDERS } from './providers';
import { getSettings, llmProblem, type Settings } from './settings';
import { formatDateTime, formatDuration, nowForPrompt } from './time';

// Turns a transcript into structured notes, tasks and memories in one model call.
// The fields and the "discard trivial snippets" rule follow Omi's conversation processing.

const CATEGORIES = 'work, personal, health, finance, education, social, family, shopping, travel, entertainment, other';

interface RawAnalysis extends Partial<Omit<Analysis, 'model' | 'analyzedAt'>> {
  actionItems?: { text?: string; owner?: string; due?: string | null }[];
  facts?: string[];
}

function analysisPrompt(conversation: Conversation, transcript: string, settings: Settings): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You turn transcripts from a personal wearable recorder into structured notes for the person who recorded them (the user). ' +
        'The user may be any speaker. Be accurate: never invent names, dates, numbers or commitments that are not in the transcript. ' +
        'Transcripts may mix languages (e.g. Hindi and English) and contain recognition errors; infer meaning carefully.',
    },
    {
      role: 'user',
      content: `Current time: ${nowForPrompt()}
Recorded: ${formatDateTime(conversation.startedAt)} (${formatDuration(conversation.endedAt - conversation.startedAt)})
Write every text field in ${settings.outputLanguage}.

Return one JSON object with exactly these keys:
{
  "discard": true only if the content is trivial (greetings, filler, background TV/music, fragments) with no task, decision, plan, fact or meaningful moment,
  "title": "specific title, max 8 words",
  "emoji": "one emoji",
  "category": one of ${CATEGORIES},
  "overview": "2-4 sentence summary",
  "keyPoints": ["..."],
  "decisions": ["..."],
  "actionItems": [{"text": "imperative task", "owner": "me" | "other" | "unknown", "due": "YYYY-MM-DDTHH:mm local time, or null"}],
  "events": [{"title": "...", "start": "YYYY-MM-DDTHH:mm local time, or null", "durationMinutes": 30, "location": ""}],
  "followUps": [{"to": "name or email, or empty", "channel": "email" | "message", "subject": "...", "body": "ready-to-send draft written as the user"}],
  "people": ["names of people speaking or mentioned"],
  "facts": ["lasting facts about the user worth remembering later: preferences, relationships, plans, important personal details"],
  "tone": {"overall": "one or two words", "notes": "one sentence on mood and interpersonal dynamics"},
  "language": "main spoken language"
}

Rules: resolve relative dates ("tomorrow at 5") against the recording time. Only include action items someone actually committed to or requested. Only suggest follow-ups that are clearly useful. Use [] for empty lists.

Transcript:
"""
${transcript}
"""`,
    },
  ];
}

/** Free tiers cap tokens per request, so long transcripts are condensed in parts first. */
async function fitTranscript(transcript: string, settings: Settings): Promise<string> {
  const limit = LLM_PROVIDERS[settings.llm.provider].maxInputChars;
  if (transcript.length <= limit) return transcript;

  const parts: string[] = [];
  let current = '';
  for (const line of transcript.split('\n')) {
    if (current.length + line.length > limit * 0.8 && current) {
      parts.push(current);
      current = '';
    }
    current += `${line}\n`;
  }
  if (current) parts.push(current);

  const notes: string[] = [];
  for (const [i, part] of parts.entries()) {
    const { content } = await chat(settings, [
      {
        role: 'user',
        content: `This is part ${i + 1} of ${parts.length} of a long conversation transcript. Condense it into detailed notes that keep every name, number, date, decision, request and commitment, and who said what. Keep timestamps for major moments.\n\n${part}`,
      },
    ]);
    notes.push(content);
  }
  return notes.join('\n\n');
}

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []);

export async function analyzeConversation(id: string): Promise<void> {
  const settings = getSettings();
  const problem = llmProblem(settings);
  if (problem) throw new Error(problem);

  const conversation = await get('conversations', id);
  if (!conversation) return;
  if (!conversation.segments.length) throw new Error('This conversation has no transcript yet.');

  await patch('conversations', id, (c) => {
    c.status = 'analyzing';
    c.error = undefined;
  });

  try {
    const transcript = await fitTranscript(transcriptText(conversation, true), settings);
    const { value: raw, model } = await chatJson<RawAnalysis>(settings, analysisPrompt(conversation, transcript, settings));

    const analysis: Analysis = {
      discard: raw.discard === true,
      title: raw.title?.trim() || 'Untitled conversation',
      emoji: raw.emoji?.trim() || '💬',
      category: raw.category?.trim() || 'other',
      overview: raw.overview?.trim() ?? '',
      keyPoints: asStrings(raw.keyPoints),
      decisions: asStrings(raw.decisions),
      events: (Array.isArray(raw.events) ? raw.events : [])
        .filter((e) => e?.title)
        .map((e) => ({ title: e.title, start: e.start ?? null, durationMinutes: Number(e.durationMinutes) || 30, location: e.location ?? '' })),
      followUps: (Array.isArray(raw.followUps) ? raw.followUps : [])
        .filter((f) => f?.body)
        .map((f) => ({ to: f.to ?? '', channel: f.channel === 'email' ? 'email' : 'message', subject: f.subject ?? '', body: f.body })),
      people: asStrings(raw.people),
      tone: { overall: raw.tone?.overall ?? '', notes: raw.tone?.notes ?? '' },
      language: raw.language ?? '',
      model,
      analyzedAt: Date.now(),
    };

    await syncTasks(id, raw.actionItems ?? []);
    await syncMemories(id, asStrings(raw.facts));
    await patch('conversations', id, (c) => {
      c.analysis = analysis;
      c.status = 'analyzed';
    });
  } catch (error) {
    await patch('conversations', id, (c) => {
      c.status = 'error';
      c.error = error instanceof Error ? error.message : String(error);
    });
    throw error;
  }
}

/** Replaces this conversation's open tasks with the new ones, keeping anything already ticked off. */
async function syncTasks(conversationId: string, items: NonNullable<RawAnalysis['actionItems']>): Promise<void> {
  const existing = (await list('tasks')).filter((t) => t.conversationId === conversationId);
  const doneTexts = new Set(existing.filter((t) => t.done).map((t) => t.text.toLowerCase()));
  for (const task of existing.filter((t) => !t.done)) await remove('tasks', task.id);

  for (const item of items) {
    const text = item.text?.trim();
    if (!text || doneTexts.has(text.toLowerCase())) continue;
    const owner = item.owner === 'me' || item.owner === 'other' ? item.owner : 'unknown';
    const task: Task = { id: newId(), text, owner, due: item.due || null, done: false, createdAt: Date.now(), conversationId };
    await put('tasks', task);
  }
}

async function syncMemories(conversationId: string, facts: string[]): Promise<void> {
  const all = await list('memories');
  for (const memory of all.filter((m) => m.conversationId === conversationId)) await remove('memories', memory.id);
  const known = new Set(all.filter((m) => m.conversationId !== conversationId).map((m) => m.text.toLowerCase()));
  for (const text of facts) {
    if (known.has(text.toLowerCase())) continue;
    await put('memories', { id: newId(), text, createdAt: Date.now(), conversationId });
  }
}
