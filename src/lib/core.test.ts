import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl } from './actions';
import { Chunker, SAMPLE_RATE, encodeWav, type SpeechChunk } from './audio';
import type { Conversation } from './db';
import { ApiError, parseErrorBody, rateLimitListeners, request } from './http';
import { alternativeProviders, chat, parseJson, withProvider } from './llm';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { findByRef, searchConversations, tokenize } from './search';
import { matchWakePhrase } from './session';
import { GEMINI_FREE, geminiQuota, geminiUsage, nextPacificMidnight, paceDelay, pacificDay, resetPacing } from './quota';
import { isExpectedLanguage, keepConfidentSegments, parseSpeakerLines } from './stt';

function tone(seconds: number, amplitude: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
  return samples;
}

const silence = (seconds: number) => new Float32Array(Math.round(seconds * SAMPLE_RATE));

function runChunker(...parts: Float32Array[]): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const chunker = new Chunker((c) => chunks.push(c), 0);
  for (const part of parts) chunker.push(part);
  chunker.flush();
  return chunks;
}

describe('Chunker', () => {
  it('skips pure silence', () => {
    expect(runChunker(silence(10))).toHaveLength(0);
  });

  it('cuts speech at a long pause and keeps the timing', () => {
    const chunks = runChunker(silence(1), tone(3, 0.3), silence(3), tone(2, 0.3), silence(1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].start).toBeGreaterThanOrEqual(600);
    expect(chunks[0].start).toBeLessThanOrEqual(1000);
    expect(chunks[0].durationMs).toBeGreaterThan(3000);
    expect(chunks[0].durationMs).toBeLessThan(4200);
    expect(chunks[1].start).toBeGreaterThan(6500);
  });

  it('never exceeds the maximum chunk length', () => {
    const chunks = runChunker(tone(60, 0.3));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.durationMs).toBeLessThanOrEqual(25_000);
    const total = chunks.reduce((n, c) => n + c.durationMs, 0);
    expect(total).toBeGreaterThan(59_000);
  });

  it('drops blips too short to be speech', () => {
    expect(runChunker(silence(1), tone(0.2, 0.3), silence(3))).toHaveLength(0);
  });

  it('starts a chunk even when speech begins at the very first frame', () => {
    expect(runChunker(tone(2, 0.3), silence(3))).toHaveLength(1);
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit mono header', async () => {
    const wav = encodeWav(new Float32Array(1600));
    const view = new DataView(await wav.arrayBuffer());
    expect(wav.size).toBe(44 + 3200);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
  });
});

describe('parseSpeakerLines', () => {
  it('splits speaker turns and joins continuation lines', () => {
    expect(parseSpeakerLines('Speaker 1: नमस्ते, कैसे हो?\n**Speaker 2:** I am fine\nthanks\n')).toEqual([
      { speaker: 'Speaker 1', text: 'नमस्ते, कैसे हो?' },
      { speaker: 'Speaker 2', text: 'I am fine thanks' },
    ]);
  });

  it('keeps unlabeled text', () => {
    expect(parseSpeakerLines('just words')).toEqual([{ text: 'just words' }]);
  });
});

describe('matchWakePhrase', () => {
  it('extracts the command after the phrase', () => {
    expect(matchWakePhrase('Hey, assistant. Remind me to call Ravi at 6.', 'hey assistant')).toBe('Remind me to call Ravi at 6.');
    expect(matchWakePhrase('so anyway hey assistant what did Priya say', 'hey assistant')).toBe('what did Priya say');
  });

  it('returns empty string for a bare phrase and null when absent', () => {
    expect(matchWakePhrase('Hey assistant!', 'hey assistant')).toBe('');
    expect(matchWakePhrase('they assistant manager left', 'hey assistant')).toBeNull();
    expect(matchWakePhrase('hey assistants are great', 'hey assistant')).toBeNull();
  });
});

describe('search', () => {
  const conversation = (id: string, text: string, title?: string): Conversation => ({
    id,
    startedAt: 1000,
    endedAt: 2000,
    source: 'mic',
    status: 'analyzed',
    segments: [{ id: `${id}-s`, start: 1000, text }],
    analysis: title
      ? {
          discard: false,
          title,
          emoji: '',
          category: '',
          overview: '',
          keyPoints: [],
          decisions: [],
          events: [],
          followUps: [],
          people: [],
          tone: { overall: '', notes: '' },
          language: '',
          model: '',
          analyzedAt: 0,
        }
      : undefined,
  });

  it('tokenizes non-Latin scripts', () => {
    expect(tokenize('मीटिंग कल है')).toEqual(['मीटिंग', 'कल', 'है']);
  });

  it('ranks title matches above transcript matches', () => {
    const results = searchConversations(
      [conversation('aaaa1111', 'we discussed the budget briefly'), conversation('bbbb2222', 'hello', 'Budget review')],
      'budget',
    );
    expect(results.map((r) => r.conversation.id)).toEqual(['bbbb2222', 'aaaa1111']);
    expect(results[1].excerpts).toEqual(['we discussed the budget briefly']);
  });

  it('finds items by short ref', () => {
    expect(findByRef([{ id: 'abcdef12-3456' }], 'c:abcdef12')?.id).toBe('abcdef12-3456');
  });
});

describe('parseJson', () => {
  it('tolerates code fences and prose', () => {
    expect(parseJson<{ a: number }>('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
});

describe('calendar actions', () => {
  it('builds a Google Calendar link with local times', () => {
    const url = new URL(googleCalendarUrl({ title: 'Lunch', start: '2026-10-15T13:00', durationMinutes: 60 }));
    expect(url.searchParams.get('dates')).toBe('20261015T130000/20261015T140000');
  });

  it('builds an .ics file with escaped text', async () => {
    const text = await buildIcs([{ uid: 'x', title: 'Call; Ravi, now', start: new Date(Date.UTC(2026, 9, 15, 7, 30)), durationMinutes: 15, alarm: 10 }]).text();
    expect(text).toContain('SUMMARY:Call\\; Ravi\\, now');
    expect(text).toContain('DTSTART:20261015T073000Z');
    expect(text).toContain('TRIGGER:-PT10M');
  });
});

describe('chunk policy', () => {
  it('makes long chunks for request-limited providers', () => {
    const chunks: SpeechChunk[] = [];
    const chunker = new Chunker((c) => chunks.push(c), 0, { minMs: 30_000, maxMs: 120_000, longPauseMs: 8_000 });
    // 50 s of speech with 2 s pauses every 10 s: cut at the first pause after 30 s,
    // so 2 requests instead of 5 with the default policy.
    for (let i = 0; i < 5; i++) {
      chunker.push(tone(10, 0.3));
      chunker.push(silence(2));
    }
    chunker.push(silence(10));
    chunker.flush();
    expect(chunks).toHaveLength(2);
    expect(chunks[0].durationMs).toBeGreaterThanOrEqual(30_000);
    expect(runChunker(...Array.from({ length: 5 }, () => [tone(10, 0.3), silence(2)]).flat())).toHaveLength(5);
  });
});

describe('parseErrorBody', () => {
  it('reads Gemini per-minute retry info', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'You exceeded your current quota. Please retry in 37.5s.',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
        ],
      },
    });
    expect(parseErrorBody(body, null)).toMatchObject({ retryAfterMs: 37_000, daily: false });
  });

  it('detects Gemini daily quota', () => {
    const body = JSON.stringify({
      error: { code: 429, message: 'Quota exceeded', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] },
    });
    expect(parseErrorBody(body, null).daily).toBe(true);
  });

  it('reads Groq "try again in" messages', () => {
    const body = JSON.stringify({
      error: { message: 'Rate limit reached for model `whisper-large-v3-turbo` on requests per minute (RPM): Limit 20, Used 20. Please try again in 1m2.5s.' },
    });
    expect(parseErrorBody(body, null)).toMatchObject({ retryAfterMs: 62_500, daily: false });
    expect(parseErrorBody(JSON.stringify({ error: { message: 'Limit reached on audio seconds per day (ASPD). Please try again in 7m3s.' } }), null).daily).toBe(true);
  });

  it('prefers Retry-After and handles non-JSON bodies', () => {
    expect(parseErrorBody('Too Many Requests', '12')).toMatchObject({ retryAfterMs: 12_000, detail: 'Too Many Requests' });
  });
});

describe('request rate-limit handling', () => {
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status });

  it('waits out a per-minute limit, then succeeds', async () => {
    const calls: number[] = [];
    const waits: number[] = [];
    const listener = (_: string, ms: number) => waits.push(ms);
    rateLimitListeners.add(listener);
    globalThis.fetch = (async () => {
      calls.push(Date.now());
      return calls.length === 1
        ? reply(429, { error: { message: 'quota', details: [{ retryDelay: '0.05s' }] } })
        : reply(200, { ok: true });
    }) as typeof fetch;
    const response = await request('Gemini', 'https://example.test', {});
    rateLimitListeners.delete(listener);
    expect(response.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(50);
  });

  it('gives up immediately on a daily limit', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return reply(429, { error: { message: 'Quota exceeded', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
    }) as typeof fetch;
    const error = await request('Gemini', 'https://example.test', {}).catch((e: ApiError) => e);
    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).daily).toBe(true);
    expect((error as ApiError).message).toContain('daily limit');
  });
});

describe('Whisper hallucination filters', () => {
  it('drops low-confidence, repetitive and no-speech segments', () => {
    const kept = keepConfidentSegments([
      { text: 'Let us meet at five.', avg_logprob: -0.3, no_speech_prob: 0.01, compression_ratio: 1.2 },
      { text: 'Enn álenda þarfísa, er ekki aðra', avg_logprob: -1.4, no_speech_prob: 0.2, compression_ratio: 1.3 },
      { text: 'okay okay okay okay okay okay okay', avg_logprob: -0.4, no_speech_prob: 0.1, compression_ratio: 3.1 },
      { text: 'Thank you.', avg_logprob: -0.7, no_speech_prob: 0.8, compression_ratio: 0.9 },
    ]);
    expect(kept.map((s) => s.text)).toEqual(['Let us meet at five.']);
  });

  it('accepts app and browser languages, rejects unlikely detections', () => {
    expect(isExpectedLanguage('malayalam', [])).toBe(true);
    expect(isExpectedLanguage('English', [])).toBe(true);
    expect(isExpectedLanguage('ta', [])).toBe(true);
    expect(isExpectedLanguage('icelandic', [])).toBe(false);
    expect(isExpectedLanguage('faroese', ['en-IN'])).toBe(false);
    expect(isExpectedLanguage('french', ['fr-FR'])).toBe(true);
  });
});

describe('busy AI provider', () => {
  const settingsWith = (keys: Partial<Settings['keys']>): Settings => ({
    ...DEFAULT_SETTINGS,
    keys: { ...DEFAULT_SETTINGS.keys, ...keys },
    llm: { provider: 'gemini', model: 'gemini-3.8-flash', baseUrl: '' },
  });
  const busyGemini = () => {
    const hosts: string[] = [];
    globalThis.fetch = (async (url: string) => {
      hosts.push(new URL(url).host);
      return url.includes('googleapis')
        ? new Response(JSON.stringify({ error: { message: 'Please retry in 30s.', details: [{ retryDelay: '30s' }] } }), { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
    }) as typeof fetch;
    return hosts;
  };

  it('never switches provider by itself; fails fast so the user can choose', async () => {
    const hosts = busyGemini();
    const started = Date.now();
    const error = await chat(settingsWith({ gemini: 'g', groq: 'q' }), [{ role: 'user', content: 'hello' }], { failFast: true }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).rateLimited).toBe(true);
    expect(hosts).toEqual(['generativelanguage.googleapis.com']); // Groq was not called
    expect(Date.now() - started).toBeLessThan(2000); // and it didn't sit waiting 30 s
  });

  it('uses another provider only when the user picks it', async () => {
    const hosts = busyGemini();
    const result = await chat(withProvider(settingsWith({ gemini: 'g', groq: 'q' }), 'groq'), [{ role: 'user', content: 'hello' }], { failFast: true });
    expect(result).toMatchObject({ content: 'hi', model: 'openai/gpt-oss-120b' });
    expect(hosts).toEqual(['api.groq.com']);
  });

  it('offers only providers the user has keys for', () => {
    expect(alternativeProviders(settingsWith({ gemini: 'g' }))).toEqual([]);
    expect(alternativeProviders(settingsWith({ gemini: 'g', mistral: 'm', groq: 'q' }))).toEqual(['groq', 'mistral']);
  });
});

describe('Gemini free-tier budget', () => {
  it('finds when daily quotas reset (midnight Pacific)', () => {
    // 8:38 PM IST on 15 Oct = 8:08 AM Pacific (PDT): resets 16 Oct 07:00 UTC.
    const october = Date.UTC(2026, 9, 15, 15, 8);
    expect(pacificDay(october)).toBe('2026-10-15');
    expect(nextPacificMidnight(october)).toBe(Date.UTC(2026, 9, 16, 7));
    // Winter (PST): 04:00 Pacific on 10 Jan resets 11 Jan 08:00 UTC.
    expect(nextPacificMidnight(Date.UTC(2026, 0, 10, 12))).toBe(Date.UTC(2026, 0, 11, 8));
  });

  it('paces requests to the per-minute limit and counts successes per model', async () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;
    resetPacing();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const quota = geminiQuota('models/gemini-test');
    for (let i = 0; i < GEMINI_FREE.perMinute; i++) await request('Gemini', 'https://example.test', {}, { quota });
    expect(paceDelay(quota)).toBeGreaterThan(0);
    const error = await request('Gemini', 'https://example.test', {}, { quota, waitOnRateLimit: false }).catch((e: ApiError) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).rateLimited).toBe(true);
    expect(calls).toBe(GEMINI_FREE.perMinute);
    expect(geminiUsage()).toEqual([{ model: 'gemini-test', used: GEMINI_FREE.perMinute, limit: GEMINI_FREE.perDay, exhausted: false }]);
    // Another model has its own budget.
    expect(paceDelay(geminiQuota('gemini-other'))).toBe(0);
    resetPacing();
  });
});
