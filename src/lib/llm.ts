import { request } from './http';
import { LLM_PROVIDERS, type KeyId, type LlmProviderId } from './providers';
import { llmKey, type Settings } from './settings';

// One client for every provider: they all speak the OpenAI chat-completions format.

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

export interface ChatOptions {
  json?: boolean;
  tools?: ToolDefinition[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export function llmBaseUrl(settings: Settings): string {
  const base = settings.llm.provider === 'custom' ? settings.llm.baseUrl : LLM_PROVIDERS[settings.llm.provider].baseUrl;
  return base.replace(/\/+$/, '');
}

export async function chat(settings: Settings, messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const provider = LLM_PROVIDERS[settings.llm.provider];
  const key = llmKey(settings);
  const body: Record<string, unknown> = {
    model: settings.llm.model,
    messages,
    temperature: options.temperature ?? 0.2,
  };
  if (options.json && provider.jsonMode) body.response_format = { type: 'json_object' };
  if (options.tools?.length) body.tools = options.tools;

  const response = await request(provider.label, `${llmBaseUrl(settings)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(settings.llm.provider === 'openrouter' ? { 'X-Title': 'Personal AI' } : {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const json = (await response.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  };
  const message = json.choices?.[0]?.message;
  return {
    // Some reasoning models put their thinking inline.
    content: (message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
    toolCalls: message?.tool_calls ?? [],
  };
}

/** Asks for JSON and parses it, tolerating code fences and surrounding prose. */
export async function chatJson<T>(settings: Settings, messages: ChatMessage[], signal?: AbortSignal): Promise<T> {
  const { content } = await chat(settings, messages, { json: true, signal });
  return parseJson<T>(content);
}

export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The AI model did not return valid JSON. Try again or pick another model.');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/** Lists model ids from an OpenAI-compatible /models endpoint. */
export async function listModels(provider: LlmProviderId, keys: Record<KeyId, string>, customBaseUrl = ''): Promise<string[]> {
  const preset = LLM_PROVIDERS[provider];
  const base = (provider === 'custom' ? customBaseUrl : preset.baseUrl).replace(/\/+$/, '');
  const key = keys[preset.key];
  const response = await request(preset.label, `${base}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  const json = (await response.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id.replace(/^models\//, '')).sort();
}
