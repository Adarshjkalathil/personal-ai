import { encodeWav, type SpeechChunk } from './audio';
import { blobToBase64, request } from './http';
import { LANGUAGES, whisperLanguage } from './providers';
import { geminiQuota } from './quota';
import { sttKey, type Settings } from './settings';

export interface TranscribedLine {
  text: string;
  speaker?: string;
}

export interface TranscribeContext {
  /** Recent transcript, to keep spelling and speaker labels consistent across chunks. */
  previousText: string;
}

/** Transcribes one speech chunk with the configured provider. Returns [] if nothing was said. */
export async function transcribe(chunk: SpeechChunk, settings: Settings, context: TranscribeContext): Promise<TranscribedLine[]> {
  const wav = encodeWav(chunk.samples);
  switch (settings.stt.provider) {
    case 'groq':
      return groq(wav, settings, context);
    case 'gemini':
      return gemini(wav, settings, context);
    case 'sarvam':
      return sarvam(wav, settings);
    case 'browser':
      throw new Error('Browser speech recognition works live only, so it can\'t transcribe recorded audio or uploaded files. Pick another provider in Settings.');
  }
}

interface WhisperSegment {
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  compression_ratio?: number;
}

/** Thrown when auto-detect picks a language the user almost certainly isn't speaking. */
export class LanguageError extends Error {}

async function groq(wav: Blob, settings: Settings, context: TranscribeContext): Promise<TranscribedLine[]> {
  const form = new FormData();
  form.append('file', wav, 'chunk.wav');
  form.append('model', settings.stt.model);
  // verbose_json adds per-segment confidence and the detected language, used to drop hallucinations.
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  const language = whisperLanguage(settings.stt.language);
  if (language) form.append('language', language);
  // Whisper uses the prompt as preceding context; keep it short so one bad line can't snowball.
  if (context.previousText) form.append('prompt', context.previousText.slice(-200));

  const response = await request('Groq', 'https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sttKey(settings)}` },
    body: form,
  });
  const result = (await response.json()) as { text: string; language?: string; segments?: WhisperSegment[] };

  if (!settings.stt.language && result.language && !isExpectedLanguage(result.language)) {
    throw new LanguageError(
      `Auto-detect thought this was ${capitalize(result.language)}, which is probably wrong, so the audio was kept instead of saved as text. Choose your language above, then tap Retry.`,
    );
  }
  const text = result.segments ? keepConfidentSegments(result.segments).map((s) => s.text.trim()).join(' ') : result.text;
  return !text.trim() || isHallucination(text) ? [] : [{ text: text.trim() }];
}

/**
 * Drops segments Whisper likely made up, using OpenAI's own thresholds: very low
 * confidence, repetitive output, or silence it "heard" words in.
 */
export function keepConfidentSegments(segments: WhisperSegment[]): WhisperSegment[] {
  return segments.filter((s) => {
    const logprob = s.avg_logprob ?? 0;
    if (logprob < -1) return false;
    if ((s.compression_ratio ?? 0) > 2.4) return false;
    if ((s.no_speech_prob ?? 0) > 0.6 && logprob < -0.5) return false;
    return !isHallucination(s.text);
  });
}

/**
 * True if a detected language is plausible for this user: one of the app's languages
 * or one of the browser's languages. Whisper often "detects" Icelandic, Welsh, Maori…
 * for noise or accents it doesn't know.
 */
export function isExpectedLanguage(detected: string, browserLanguages: readonly string[] = globalThis.navigator?.languages ?? []): boolean {
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  const codes = new Set(['en', 'od', 'or', 'ne', ...LANGUAGES.map((l) => l.code), ...browserLanguages].map((c) => c.split('-')[0].toLowerCase()).filter(Boolean));
  const allowed = new Set<string>();
  for (const code of codes) {
    allowed.add(code);
    const name = names.of(code)?.toLowerCase();
    if (name) allowed.add(name);
  }
  const value = detected.trim().toLowerCase();
  return allowed.has(value) || allowed.has(value.split('-')[0]);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

async function gemini(wav: Blob, settings: Settings, context: TranscribeContext): Promise<TranscribedLine[]> {
  const language = LANGUAGES.find((l) => l.code === settings.stt.language && l.code);
  const prompt = [
    'Transcribe this audio verbatim.',
    language
      ? `The speech is mostly ${language.label}; keep any other languages as spoken.`
      : 'Keep every language exactly as spoken, including mixed Hindi-English.',
    'Write each language in its own native script.',
    'Put each speaker turn on its own line as "Speaker N: text". Number speakers by voice, and reuse the labels from the previous context when the same voice continues.',
    'Output only the transcript. If there is no intelligible speech, output nothing.',
    context.previousText ? `\nPrevious context (do not repeat it):\n${context.previousText.slice(-800)}` : '',
  ].join('\n');

  const model = settings.stt.model.replace(/^models\//, '');
  const response = await request('Gemini', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': sttKey(settings) },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'audio/wav', data: await blobToBase64(wav) } }, { text: prompt }] }],
      generationConfig: { temperature: 0 },
    }),
  }, { quota: geminiQuota(model) });
  const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return parseSpeakerLines(text);
}

async function sarvam(wav: Blob, settings: Settings): Promise<TranscribedLine[]> {
  const form = new FormData();
  form.append('file', wav, 'chunk.wav');
  form.append('model', settings.stt.model);
  form.append('language_code', settings.stt.language || 'unknown');
  const response = await request('Sarvam', 'https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': sttKey(settings) },
    body: form,
  });
  const { transcript } = (await response.json()) as { transcript: string };
  return transcript?.trim() ? [{ text: transcript.trim() }] : [];
}

export function parseSpeakerLines(text: string): TranscribedLine[] {
  const lines: TranscribedLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Accepts "Speaker 1: …", "**Speaker 1**: …" and "**Speaker 1:** …".
    const match = /^\**\s*(Speaker\s*\d+)\s*\**\s*:\s*\**\s*(.*)$/i.exec(line);
    if (match) {
      const speaker = match[1].replace(/\s+/g, ' ').replace(/^speaker/i, 'Speaker');
      if (match[2]) lines.push({ speaker, text: match[2] });
    } else if (lines.length) {
      lines[lines.length - 1].text += ` ${line}`;
    } else {
      lines.push({ text: line });
    }
  }
  return lines;
}

// Whisper invents these on silence or noise.
const HALLUCINATIONS = [
  /^\W*$/,
  /^(thank you|thanks)( for watching| for listening)?[.!]*$/i,
  /^(please )?subscribe/i,
  /^(you|bye)[.!]*$/i,
];

function isHallucination(text: string): boolean {
  const trimmed = text.trim();
  return HALLUCINATIONS.some((pattern) => pattern.test(trimmed));
}
