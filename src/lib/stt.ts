import { encodeWav, type SpeechChunk } from './audio';
import { blobToBase64, request } from './http';
import { LANGUAGES, whisperLanguage } from './providers';
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

async function groq(wav: Blob, settings: Settings, context: TranscribeContext): Promise<TranscribedLine[]> {
  const form = new FormData();
  form.append('file', wav, 'chunk.wav');
  form.append('model', settings.stt.model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const language = whisperLanguage(settings.stt.language);
  if (language) form.append('language', language);
  // Whisper uses the prompt as preceding context (it keeps roughly the last 224 tokens).
  if (context.previousText) form.append('prompt', context.previousText.slice(-400));

  const response = await request('Groq', 'https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sttKey(settings)}` },
    body: form,
  });
  const { text } = (await response.json()) as { text: string };
  return isHallucination(text) ? [] : [{ text: text.trim() }];
}

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
  });
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
