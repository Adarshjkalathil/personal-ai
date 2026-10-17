import { useSyncExternalStore } from 'react';
import type { ChunkPolicy } from './audio';
import {
  LLM_PROVIDERS,
  STT_PROVIDERS,
  type KeyId,
  type LlmProviderId,
  type SttProviderId,
} from './providers';

export interface Settings {
  keys: Record<KeyId, string>;
  stt: { provider: SttProviderId; model: string; language: string };
  llm: { provider: LlmProviderId; model: string; baseUrl: string };
  /** Language for summaries, tasks and answers. */
  outputLanguage: string;
  /** Start a new conversation after this much silence. */
  conversationGapMinutes: number;
  autoAnalyze: boolean;
  keepScreenOn: boolean;
  /** Say this, then a command, while recording ("hey assistant, remind me to…"). */
  wakePhrase: string;
  voiceCommands: boolean;
  speakReplies: boolean;
  /** Suggest follow-up questions and spot commitments while recording. */
  liveHints: boolean;
  /** Browser notifications when a task is due. */
  reminders: boolean;
  /** The Gemini key's project has billing (paid tier): skip the free-tier pacing and long chunks. */
  geminiBilling: boolean;
  /** The welcome guide was completed or skipped. */
  onboarded: boolean;
  /** Mix in a shared tab's or the computer's sound while recording (for calls). */
  deviceAudio: boolean;
  /** Colour theme; "system" follows the device. */
  theme: 'light' | 'dark' | 'system';
}

const STORAGE_KEY = 'personal-ai.settings';

export const DEFAULT_SETTINGS: Settings = {
  keys: { groq: '', gemini: '', sarvam: '', openrouter: '', mistral: '', custom: '' },
  stt: { provider: 'groq', model: STT_PROVIDERS.groq.defaultModel, language: '' },
  llm: { provider: 'groq', model: LLM_PROVIDERS.groq.defaultModel, baseUrl: LLM_PROVIDERS.groq.baseUrl },
  outputLanguage: 'English',
  conversationGapMinutes: 2,
  autoAnalyze: true,
  keepScreenOn: true,
  wakePhrase: 'hey assistant',
  voiceCommands: true,
  speakReplies: true,
  liveHints: false,
  reminders: false,
  geminiBilling: false,
  onboarded: false,
  theme: 'light',
  deviceAudio: false,
};

/** How recorded audio is split into requests for the chosen transcription provider. */
export function chunkPolicy(settings: Settings): ChunkPolicy {
  const provider = STT_PROVIDERS[settings.stt.provider];
  return provider.key === 'gemini' && settings.geminiBilling && provider.paidChunks ? provider.paidChunks : provider.chunks;
}

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      keys: { ...DEFAULT_SETTINGS.keys, ...saved.keys },
      stt: { ...DEFAULT_SETTINGS.stt, ...saved.stt },
      llm: { ...DEFAULT_SETTINGS.llm, ...saved.llm },
      // People who set up the app before the welcome guide existed don't need it.
      onboarded: saved.onboarded ?? (Object.values(saved.keys ?? {}).some(Boolean) || saved.stt?.provider === 'browser'),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}

export function sttKey(settings: Settings): string {
  const key = STT_PROVIDERS[settings.stt.provider].key;
  return key ? settings.keys[key] : '';
}

export function llmKey(settings: Settings): string {
  return settings.keys[LLM_PROVIDERS[settings.llm.provider].key];
}

/** Human-readable reason the current setup can't run, or null if it's ready. */
export function sttProblem(settings: Settings): string | null {
  const provider = STT_PROVIDERS[settings.stt.provider];
  if (provider.key && !settings.keys[provider.key]) return `Add a ${provider.label} key in Settings to transcribe.`;
  if (settings.stt.provider === 'browser' && !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    return 'This browser has no built-in speech recognition. Use Chrome or Edge, or pick a different transcription provider.';
  }
  return null;
}

export function llmProblem(settings: Settings): string | null {
  const provider = LLM_PROVIDERS[settings.llm.provider];
  if (settings.llm.provider !== 'custom' && !settings.keys[provider.key]) {
    return `Add a ${provider.label} key in Settings to use AI summaries and Ask.`;
  }
  if (!settings.llm.model) return 'Choose an AI model in Settings.';
  return null;
}
