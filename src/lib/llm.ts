import { request } from './http';
import { geminiQuota } from './quota';
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
  /** Don't wait out rate limits when another provider could be chosen instead. */
  failFast?: boolean;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  /** The model that actually answered (may be a fallback). */
  model: string;
}

const ALTERNATIVE_ORDER: LlmProviderId[] = ['groq', 'gemini', 'mistral', 'openrouter'];

/** Other AI providers the user has keys for, to offer when the chosen one is busy. */
export function alternativeProviders(settings: Settings): LlmProviderId[] {
  return ALTERNATIVE_ORDER.filter((id) => id !== settings.llm.provider && settings.keys[LLM_PROVIDERS[id].key]);
}

/** The same settings, but using another provider with its default model (for a one-off request). */
export function withProvider(settings: Settings, provider: LlmProviderId | undefined): Settings {
  if (!provider || provider === settings.llm.provider) return settings;
  const preset = LLM_PROVIDERS[provider];
  return { ...settings, llm: { provider, model: preset.defaultModel, baseUrl: preset.baseUrl } };
}

export function llmBaseUrl(settings: Settings): string {
  const base = settings.llm.provider === 'custom' ? settings.llm.baseUrl : LLM_PROVIDERS[settings.llm.provider].baseUrl;
  return base.replace(/\/+$/, '');
}

/**
 * Sends a chat request. With failFast (someone is waiting on the answer) and other
 * providers available, a rate limit fails at once so the user can choose what to do;
 * otherwise it waits the limit out.
 */
export async function chat(settings: Settings, messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const wait = !(options.failFast && alternativeProviders(settings).length);
  return chatOnce(settings, messages, options, wait);
}

async function chatOnce(settings: Settings, messages: ChatMessage[], options: ChatOptions, waitOnRateLimit: boolean): Promise<ChatResult> {
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
  }, { waitOnRateLimit, quota: settings.llm.provider === 'gemini' ? geminiQuota(settings.llm.model, settings.geminiBilling) : undefined });
  const json = (await response.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  };
  const message = json.choices?.[0]?.message;
  return {
    // Some reasoning models put their thinking inline.
    content: (message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
    toolCalls: message?.tool_calls ?? [],
    model: settings.llm.model,
  };
}

/** Asks for JSON and parses it, tolerating code fences and surrounding prose. */
export async function chatJson<T>(settings: Settings, messages: ChatMessage[], options: ChatOptions = {}): Promise<{ value: T; model: string }> {
  const { content, model } = await chat(settings, messages, { ...options, json: true });
  return { value: parseJson<T>(content), model };
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
