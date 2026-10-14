import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl } from './actions';
import { Chunker, SAMPLE_RATE, encodeWav, type SpeechChunk } from './audio';
import type { Conversation } from './db';
import { parseJson } from './llm';
import { findByRef, searchConversations, tokenize } from './search';
import { matchWakePhrase } from './session';
import { parseSpeakerLines } from './stt';

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
