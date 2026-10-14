// Every provider here has a free option and accepts direct browser (CORS) requests,
// so the app needs no backend. Limits change often; the notes are a starting point.

export type KeyId = 'groq' | 'gemini' | 'sarvam' | 'openrouter' | 'mistral' | 'custom';
export type SttProviderId = 'browser' | 'groq' | 'gemini' | 'sarvam';
export type LlmProviderId = 'groq' | 'gemini' | 'openrouter' | 'mistral' | 'custom';

export interface KeyInfo {
  label: string;
  signupUrl?: string;
  free: string;
}

export const KEYS: Record<KeyId, KeyInfo> = {
  groq: {
    label: 'Groq',
    signupUrl: 'https://console.groq.com/keys',
    free: 'Free, no card. Whisper transcription (about 8 hours of audio a day) and fast chat models.',
  },
  gemini: {
    label: 'Google Gemini',
    signupUrl: 'https://aistudio.google.com/apikey',
    free: 'Free, no card. Transcription with speaker labels, plus chat. On the free tier Google may use your data to improve its products.',
  },
  sarvam: {
    label: 'Sarvam AI',
    signupUrl: 'https://dashboard.sarvam.ai',
    free: 'Most accurate for Indian languages. Small free credit on signup, then paid.',
  },
  openrouter: {
    label: 'OpenRouter',
    signupUrl: 'https://openrouter.ai/keys',
    free: 'Free models (ids ending in ":free", or "openrouter/free"). Low daily request cap.',
  },
  mistral: {
    label: 'Mistral',
    signupUrl: 'https://console.mistral.ai/api-keys',
    free: 'Free "Experiment" plan with low rate limits. Free-plan data may be used for training.',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    free: 'Any OpenAI-compatible server, e.g. Ollama or LM Studio on your computer (free and private). Key is optional.',
  },
};

export interface SttProvider {
  label: string;
  key?: KeyId;
  defaultModel: string;
  note: string;
}

export const STT_PROVIDERS: Record<SttProviderId, SttProvider> = {
  browser: {
    label: 'Browser speech recognition (no key)',
    defaultModel: '',
    note: 'Free with no key. Works best in Chrome/Edge. The browser vendor processes the audio. No speaker labels, and a language must be chosen.',
  },
  groq: {
    label: 'Groq Whisper',
    key: 'groq',
    defaultModel: 'whisper-large-v3-turbo',
    note: 'Fast and free. Good for English and Hindi, weaker for other Indian languages. No speaker labels.',
  },
  gemini: {
    label: 'Google Gemini',
    key: 'gemini',
    defaultModel: 'gemini-3.6-flash',
    note: 'Free. Labels speakers (Speaker 1, Speaker 2…). Good for Hindi and mixed Hindi-English.',
  },
  sarvam: {
    label: 'Sarvam AI',
    key: 'sarvam',
    defaultModel: 'saaras:v4',
    note: 'Best for Indian languages and code-mixed speech. Uses paid credits after the signup bonus.',
  },
};

export interface LlmProvider {
  label: string;
  key: KeyId;
  baseUrl: string;
  defaultModel: string;
  /** Supports response_format: { type: 'json_object' }. */
  jsonMode: boolean;
  /** Transcripts longer than this are summarized in parts first (free tiers have small per-minute token limits). */
  maxInputChars: number;
}

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProvider> = {
  groq: {
    label: 'Groq',
    key: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    jsonMode: true,
    maxInputChars: 20_000,
  },
  gemini: {
    label: 'Google Gemini',
    key: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.6-flash',
    jsonMode: true,
    maxInputChars: 400_000,
  },
  openrouter: {
    label: 'OpenRouter',
    key: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    jsonMode: false,
    maxInputChars: 60_000,
  },
  mistral: {
    label: 'Mistral',
    key: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    jsonMode: true,
    maxInputChars: 60_000,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    key: 'custom',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    jsonMode: false,
    maxInputChars: 20_000,
  },
};

export interface Language {
  code: string; // BCP-47; '' means auto-detect
  label: string;
}

export const LANGUAGES: Language[] = [
  { code: '', label: 'Auto-detect' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: 'od-IN', label: 'Odia' },
  { code: 'as-IN', label: 'Assamese' },
  { code: 'ur-IN', label: 'Urdu' },
];

/** Whisper takes ISO-639-1 codes and has no Odia model; undefined means "let it detect". */
export function whisperLanguage(code: string): string | undefined {
  const base = code.split('-')[0];
  return !base || base === 'od' ? undefined : base;
}

/** The Web Speech API needs an explicit language and uses "or-IN" for Odia. */
export function browserSpeechLanguage(code: string): string {
  if (!code) return navigator.language || 'en-IN';
  return code === 'od-IN' ? 'or-IN' : code;
}
