// The "Ask" assistant. Models that support tool calling (Groq, Gemini, Mistral
// and most OpenRouter models) can search your history and act: manage tasks
// and memories, and prepare calendar events and messages. Models without tool
// support fall back to answering from retrieved context.

import { googleCalendarUrl, mailtoUrl, whatsappUrl } from './actions';
import { list, newId, patch, put, remove, transcriptText, type Conversation, type Task } from './db';
import { ApiError } from './http';
import { chat, type ChatMessage, type ToolDefinition } from './llm';
import { findByRef, searchConversations, shortRef } from './search';
import { getSettings, llmProblem, type Settings } from './settings';
import { formatDateTime, nowForPrompt, parseLocalDate } from './time';

export interface AgentAction {
  kind: 'calendar' | 'email' | 'message';
  label: string;
  url: string;
}

export interface AgentReply {
  text: string;
  actions: AgentAction[];
  /** Human-readable log of the tools that ran, e.g. "Added task: Call Ravi". */
  steps: string[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const tool = (name: string, description: string, properties: object = {}, required: string[] = []): ToolDefinition => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const TOOLS: ToolDefinition[] = [
  tool(
    'search_conversations',
    'Search recorded conversations by keywords and/or date range. Returns refs, dates, titles, summaries and matching transcript lines. Use an empty query to list recent conversations.',
    {
      query: { type: 'string', description: 'Keywords: names, topics, places. Can be empty.' },
      from: { type: 'string', description: 'Optional start date-time, YYYY-MM-DDTHH:mm' },
      to: { type: 'string', description: 'Optional end date-time, YYYY-MM-DDTHH:mm' },
    },
  ),
  tool('get_conversation', 'Get the full transcript and notes of one conversation.', { ref: { type: 'string' } }, ['ref']),
  tool('list_tasks', 'List the user\'s tasks.', { status: { type: 'string', enum: ['open', 'done', 'all'] } }),
  tool(
    'add_task',
    'Add a task or reminder for the user.',
    { text: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DDTHH:mm local time, if any' } },
    ['text'],
  ),
  tool('complete_task', 'Mark a task as done.', { ref: { type: 'string' } }, ['ref']),
  tool('delete_task', 'Delete a task.', { ref: { type: 'string' } }, ['ref']),
  tool('list_memories', 'List lasting facts remembered about the user.'),
  tool('remember', 'Save a lasting fact about the user.', { text: { type: 'string' } }, ['text']),
  tool('forget', 'Delete a remembered fact.', { ref: { type: 'string' } }, ['ref']),
  tool(
    'create_calendar_event',
    'Prepare a calendar event. The user gets a one-tap "Add to Google Calendar" button.',
    {
      title: { type: 'string' },
      start: { type: 'string', description: 'YYYY-MM-DDTHH:mm local time' },
      durationMinutes: { type: 'number' },
      location: { type: 'string' },
    },
    ['title', 'start'],
  ),
  tool(
    'draft_message',
    'Draft an email or WhatsApp message. The user gets a one-tap button to review and send it.',
    {
      channel: { type: 'string', enum: ['email', 'whatsapp'] },
      to: { type: 'string', description: 'Recipient name or email address' },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    ['channel', 'body'],
  ),
];

function describeConversation(c: Conversation, excerpts: string[] = []): string {
  const a = c.analysis;
  return [
    `[c:${shortRef(c.id)}] ${formatDateTime(c.startedAt)} — ${a ? `${a.emoji} ${a.title}` : 'Not yet summarized'}`,
    a?.overview && `Summary: ${a.overview}`,
    a?.people.length && `People: ${a.people.join(', ')}`,
    !a && `Transcript start: ${transcriptText(c).slice(0, 400)}`,
    excerpts.length && `Matching lines:\n${excerpts.map((e) => `  ${e}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const describeTask = (t: Task) =>
  `[t:${shortRef(t.id)}] ${t.done ? '✓' : '○'} ${t.text}${t.due ? ` (due ${t.due})` : ''}${t.owner === 'other' ? ' (someone else)' : ''}`;

type ToolArgs = Record<string, string | number | undefined>;

async function runTool(name: string, args: ToolArgs, reply: AgentReply): Promise<string> {
  const str = (key: string) => String(args[key] ?? '').trim();
  switch (name) {
    case 'search_conversations': {
      const hits = searchConversations(await list('conversations'), str('query'), {
        from: parseLocalDate(str('from'))?.getTime(),
        to: parseLocalDate(str('to'))?.getTime(),
        limit: 8,
      });
      return hits.length ? hits.map((h) => describeConversation(h.conversation, h.excerpts)).join('\n\n') : 'No matching conversations.';
    }
    case 'get_conversation': {
      const c = findByRef(await list('conversations'), str('ref'));
      if (!c) return 'Conversation not found.';
      const a = c.analysis;
      return `${describeConversation(c)}\n${a ? `Key points: ${a.keyPoints.join('; ')}\nDecisions: ${a.decisions.join('; ')}\n` : ''}Transcript:\n${transcriptText(c, true).slice(0, 15_000)}`;
    }
    case 'list_tasks': {
      const status = str('status') || 'open';
      const tasks = (await list('tasks')).filter((t) => status === 'all' || (status === 'done') === t.done);
      return tasks.length ? tasks.slice(0, 50).map(describeTask).join('\n') : 'No tasks.';
    }
    case 'add_task': {
      const task: Task = { id: newId(), text: str('text'), owner: 'me', due: str('due') || null, done: false, createdAt: Date.now() };
      await put('tasks', task);
      reply.steps.push(`Added task: ${task.text}${task.due ? ` (due ${task.due})` : ''}`);
      return `Added ${describeTask(task)}`;
    }
    case 'complete_task':
    case 'delete_task': {
      const task = findByRef(await list('tasks'), str('ref'));
      if (!task) return 'Task not found.';
      if (name === 'complete_task') {
        await patch('tasks', task.id, (t) => (t.done = true));
        reply.steps.push(`Completed task: ${task.text}`);
      } else {
        await remove('tasks', task.id);
        reply.steps.push(`Deleted task: ${task.text}`);
      }
      return 'Done.';
    }
    case 'list_memories': {
      const memories = await list('memories');
      return memories.length ? memories.slice(0, 100).map((m) => `[m:${shortRef(m.id)}] ${m.text}`).join('\n') : 'No memories yet.';
    }
    case 'remember': {
      await put('memories', { id: newId(), text: str('text'), createdAt: Date.now() });
      reply.steps.push(`Remembered: ${str('text')}`);
      return 'Saved.';
    }
    case 'forget': {
      const memory = findByRef(await list('memories'), str('ref'));
      if (!memory) return 'Memory not found.';
      await remove('memories', memory.id);
      reply.steps.push(`Forgot: ${memory.text}`);
      return 'Deleted.';
    }
    case 'create_calendar_event': {
      const event = { title: str('title'), start: str('start') || null, durationMinutes: Number(args.durationMinutes) || 30, location: str('location') };
      reply.actions.push({ kind: 'calendar', label: `Add "${event.title}" to Google Calendar`, url: googleCalendarUrl(event) });
      return 'Prepared. The user will see an "Add to Google Calendar" button.';
    }
    case 'draft_message': {
      const body = str('body');
      const email = str('channel') === 'email';
      reply.actions.push(
        email
          ? { kind: 'email', label: `Email ${str('to') || 'draft'}`, url: mailtoUrl(str('to'), str('subject'), body) }
          : { kind: 'message', label: `WhatsApp ${str('to') || 'message'}`, url: whatsappUrl(body) },
      );
      return 'Draft prepared. The user will see a button to review and send it.';
    }
    default:
      return `Unknown tool ${name}.`;
  }
}

function systemPrompt(settings: Settings, voice: boolean): string {
  return [
    'You are Personal AI, a memory assistant. You can look up the user\'s recorded conversations, tasks and remembered facts with tools, and act on their behalf.',
    `Current time: ${nowForPrompt()}.`,
    'Always search before answering questions about the past; never guess what was said. Cite the conversations you used as [c:ref].',
    'When the user asks you to remind them, schedule, remember, or message someone, use the matching tool. Resolve relative dates against the current time.',
    `Reply in ${settings.outputLanguage} unless the user writes in another language.`,
    voice
      ? 'This is a spoken voice command: reply in one or two short sentences, plain text, no markdown or citations.'
      : 'Be concise. Use short bullet lists where helpful.',
  ].join('\n');
}

const MAX_STEPS = 6;

export async function runAgent(question: string, history: ChatTurn[] = [], options: { voice?: boolean } = {}): Promise<AgentReply> {
  const settings = getSettings();
  const problem = llmProblem(settings);
  if (problem) throw new Error(problem);

  const reply: AgentReply = { text: '', actions: [], steps: [] };
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(settings, !!options.voice) },
    ...history.slice(-10),
    { role: 'user', content: question },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const result = await chat(settings, messages, { tools: TOOLS, temperature: 0.3 });
      if (!result.toolCalls.length) {
        reply.text = result.content;
        return reply;
      }
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        let args: ToolArgs = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as ToolArgs;
        } catch {
          // leave empty; the tool reports what's missing
        }
        const output = await runTool(call.function.name, args, reply).catch((e: Error) => `Error: ${e.message}`);
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }
    // Out of steps: ask for a final answer without tools.
    reply.text = (await chat(settings, messages)).content;
    return reply;
  } catch (error) {
    // Models without tool support usually answer 400. Fall back to retrieval.
    if (error instanceof ApiError && error.status === 400 && !reply.steps.length) {
      reply.text = await answerFromContext(settings, question, history, !!options.voice);
      return reply;
    }
    throw error;
  }
}

async function answerFromContext(settings: Settings, question: string, history: ChatTurn[], voice: boolean): Promise<string> {
  const conversations = await list('conversations');
  let hits = searchConversations(conversations, question, { limit: 6 });
  if (!hits.length) hits = searchConversations(conversations, '', { limit: 6 });
  const tasks = (await list('tasks')).filter((t) => !t.done).slice(0, 30);
  const memories = (await list('memories')).slice(0, 50);

  const context = [
    'Relevant conversations:',
    hits.map((h) => describeConversation(h.conversation, h.excerpts)).join('\n\n') || 'None.',
    'Open tasks:',
    tasks.map(describeTask).join('\n') || 'None.',
    'Things remembered about the user:',
    memories.map((m) => `- ${m.text}`).join('\n') || 'None.',
  ].join('\n');

  const { content } = await chat(settings, [
    { role: 'system', content: `${systemPrompt(settings, voice)}\nYou cannot take actions in this mode; only answer from the context below.\n\n${context}` },
    ...history.slice(-10),
    { role: 'user', content: question },
  ]);
  return content;
}
