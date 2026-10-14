// Drives a recording session: mic → speech chunks → transcription → conversations,
// plus the "agentic" extras (voice commands and live hints) while recording.

import { useSyncExternalStore } from 'react';
import { speak } from './actions';
import { runAgent, type AgentReply } from './agent';
import { analyzeConversation } from './analyze';
import { liveHints, type LiveHint } from './assist';
import { chunkFile, MicCapture, type SpeechChunk } from './audio';
import { get, newId, patch, put, remove, type Conversation, type Segment } from './db';
import { browserSpeechLanguage } from './providers';
import { getSettings, llmProblem, sttProblem } from './settings';
import { transcribe, type TranscribedLine } from './stt';

export interface CommandResult {
  command: string;
  reply?: AgentReply;
  error?: string;
  at: number;
}

export interface SessionState {
  mode: 'idle' | 'starting' | 'recording' | 'stopping' | 'uploading';
  level: number;
  conversationId?: string;
  /** Chunks waiting for transcription. */
  pending: number;
  /** Live, not-yet-final text from browser speech recognition. */
  interim: string;
  upload?: { name: string; done: number; total: number };
  hints: LiveHint[];
  command?: CommandResult;
  error?: string;
}

// Minimal Web Speech API typings (not in TypeScript's DOM lib everywhere).
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const HINT_INTERVAL_MS = 45_000;

class Session {
  state: SessionState = { mode: 'idle', level: 0, pending: 0, interim: '', hints: [] };
  private listeners = new Set<() => void>();
  private mic?: MicCapture;
  private recognition?: Recognition;
  private queue: Promise<void> = Promise.resolve();
  private lastSpeechAt = 0;
  private timers: number[] = [];
  private wakeLock?: WakeLockSentinel;
  private awaitingCommand = false;
  private hintsBusy = false;
  private lastHintAt = 0;
  private wordsSinceHint = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patchState: Partial<SessionState>) {
    this.state = { ...this.state, ...patchState };
    this.listeners.forEach((listener) => listener());
  }

  async start(): Promise<void> {
    if (this.state.mode !== 'idle') return;
    const settings = getSettings();
    const problem = sttProblem(settings);
    if (problem) {
      this.set({ error: problem });
      return;
    }
    this.set({ mode: 'starting', error: undefined, hints: [], command: undefined, interim: '' });
    try {
      if (settings.stt.provider === 'browser') this.startBrowserSpeech();
      else {
        this.mic = new MicCapture((chunk) => this.enqueue(chunk, 'mic'));
        await this.mic.start();
        this.timers.push(window.setInterval(() => this.set({ level: this.mic?.chunker.level ?? 0 }), 100));
      }
      this.timers.push(window.setInterval(() => this.checkConversationGap(), 10_000));
      if (settings.keepScreenOn) this.wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined);
      this.set({ mode: 'recording' });
    } catch (error) {
      await this.cleanup();
      this.set({ mode: 'idle', error: micError(error) });
    }
  }

  async stop(): Promise<void> {
    if (this.state.mode !== 'recording') return;
    this.set({ mode: 'stopping' });
    await this.cleanup();
    await this.queue;
    if (this.state.conversationId) await this.finish(this.state.conversationId);
    this.set({ mode: 'idle', level: 0, interim: '' });
  }

  private async cleanup() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    const recognition = this.recognition;
    this.recognition = undefined; // stops the auto-restart in onend
    recognition?.stop();
    await this.mic?.stop(); // flushes the last chunk into the queue
    this.mic = undefined;
    await this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = undefined;
  }

  // ---- Chunk pipeline (sequential, so transcripts stay in order) ----

  private enqueue(chunk: SpeechChunk, source: Conversation['source']) {
    this.set({ pending: this.state.pending + 1 });
    this.queue = this.queue
      .then(() => this.handleChunk(chunk, source))
      .catch((error: Error) => this.set({ error: error.message }))
      .finally(() => this.set({ pending: this.state.pending - 1 }));
  }

  private async handleChunk(chunk: SpeechChunk, source: Conversation['source']) {
    const id = await this.conversationFor(chunk.start, source);
    const conversation = await get('conversations', id);
    const previousText = conversation?.segments.slice(-6).map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n') ?? '';
    const lines = await transcribe(chunk, getSettings(), { previousText });
    if (lines.length) this.set({ error: undefined });
    await this.addLines(id, lines, chunk.start, chunk.start + chunk.durationMs);
  }

  private async addLines(id: string, lines: TranscribedLine[], start: number, end: number) {
    if (!lines.length) return;
    const segments: Segment[] = lines.map((line, i) => ({ id: newId(), start: start + i, text: line.text, speaker: line.speaker }));
    await patch('conversations', id, (c) => {
      c.segments.push(...segments);
      c.endedAt = Math.max(c.endedAt, end);
    });
    this.lastSpeechAt = Math.max(this.lastSpeechAt, end);
    if (this.state.mode === 'recording' || this.state.mode === 'stopping') this.afterSegments(id, segments);
  }

  /** Returns the current conversation, starting a new one after a long enough silence. */
  private async conversationFor(start: number, source: Conversation['source']): Promise<string> {
    const gap = getSettings().conversationGapMinutes * 60_000;
    const current = this.state.conversationId;
    if (current && start - this.lastSpeechAt > gap) await this.finish(current);
    if (this.state.conversationId) return this.state.conversationId;

    const conversation: Conversation = { id: newId(), startedAt: start, endedAt: start, source, status: 'recording', segments: [] };
    await put('conversations', conversation);
    this.lastSpeechAt = start;
    this.set({ conversationId: conversation.id, hints: [] });
    return conversation.id;
  }

  private checkConversationGap() {
    const id = this.state.conversationId;
    const lastSpeech = Math.max(this.lastSpeechAt, this.mic?.chunker.lastSpeechAt ?? 0);
    if (id && this.state.pending === 0 && Date.now() - lastSpeech > getSettings().conversationGapMinutes * 60_000) {
      this.queue = this.queue.then(() => this.finish(id));
    }
  }

  /** Closes a conversation and (optionally) summarizes it in the background. */
  private async finish(id: string) {
    if (this.state.conversationId === id) this.set({ conversationId: undefined });
    const conversation = await get('conversations', id);
    if (!conversation || conversation.status !== 'recording') return; // already finished
    if (!conversation.segments.length) {
      await remove('conversations', id);
      return;
    }
    await patch('conversations', id, (c) => (c.status = 'transcribed'));
    const settings = getSettings();
    if (settings.autoAnalyze && !llmProblem(settings)) analyzeConversation(id).catch(() => undefined); // error is saved on the conversation
  }

  // ---- Browser speech recognition (no key) ----

  private startBrowserSpeech() {
    const Ctor = (window as unknown as Record<string, new () => Recognition>).SpeechRecognition ??
      (window as unknown as Record<string, new () => Recognition>).webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.lang = browserSpeechLanguage(getSettings().stt.language);
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!result.isFinal) interim += `${text} `;
        else if (text) {
          const now = Date.now();
          this.queue = this.queue
            .then(async () => this.addLines(await this.conversationFor(now, 'browser'), [{ text }], now, now))
            .catch((error: Error) => this.set({ error: error.message }));
        }
      }
      this.set({ interim: interim.trim(), level: interim ? 0.5 : 0 });
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.set({ error: 'Microphone or speech recognition permission was denied.' });
        void this.stop();
      }
    };
    // Chrome ends recognition after a pause or about a minute; restart while recording.
    recognition.onend = () => {
      if (this.recognition === recognition) setTimeout(() => this.recognition === recognition && recognition.start(), 250);
    };
    recognition.start();
    this.recognition = recognition;
  }

  // ---- Agentic extras: voice commands and live hints ----

  private afterSegments(id: string, segments: Segment[]) {
    const settings = getSettings();
    if (settings.voiceCommands && settings.wakePhrase.trim()) {
      for (const segment of segments) {
        const command = this.extractCommand(segment.text, settings.wakePhrase);
        if (command !== null) void this.runCommand(command);
      }
    }
    if (settings.liveHints) {
      this.wordsSinceHint += segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
      if (!this.hintsBusy && this.wordsSinceHint >= 40 && Date.now() - this.lastHintAt > HINT_INTERVAL_MS) void this.refreshHints(id);
    }
  }

  /** The command in this segment, or null. A bare wake phrase makes the next segment the command. */
  private extractCommand(text: string, wakePhrase: string): string | null {
    if (this.awaitingCommand) {
      this.awaitingCommand = false;
      return text;
    }
    const command = matchWakePhrase(text, wakePhrase);
    if (command === '') this.awaitingCommand = true;
    return command || null;
  }

  private async runCommand(command: string) {
    const at = Date.now();
    this.set({ command: { command, at } });
    try {
      const reply = await runAgent(command, [], { voice: true });
      this.set({ command: { command, reply, at } });
      if (getSettings().speakReplies && reply.text) speak(reply.text);
    } catch (error) {
      this.set({ command: { command, error: (error as Error).message, at } });
    }
  }

  private async refreshHints(id: string) {
    this.hintsBusy = true;
    this.lastHintAt = Date.now();
    this.wordsSinceHint = 0;
    try {
      const conversation = await get('conversations', id);
      if (!conversation) return;
      const recent = conversation.segments.slice(-30).map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n');
      const hints = await liveHints(recent.slice(-3000));
      if (hints.length && this.state.conversationId === id) this.set({ hints: [...hints, ...this.state.hints].slice(0, 6) });
    } catch {
      // Hints are best-effort; never interrupt recording for them.
    } finally {
      this.hintsBusy = false;
    }
  }

  // ---- Uploaded files ----

  async transcribeFile(file: File): Promise<string | undefined> {
    if (this.state.mode !== 'idle') return;
    const settings = getSettings();
    const problem = sttProblem(settings) ?? (settings.stt.provider === 'browser' ? 'Browser speech recognition can\'t transcribe files. Pick another transcription provider in Settings.' : null);
    if (problem) {
      this.set({ error: problem });
      return;
    }
    this.set({ mode: 'uploading', error: undefined, upload: { name: file.name, done: 0, total: 0 } });
    const startedAt = file.lastModified || Date.now();
    const conversation: Conversation = { id: newId(), startedAt, endedAt: startedAt, source: 'upload', fileName: file.name, status: 'recording', segments: [] };
    try {
      const chunks = await chunkFile(file, startedAt);
      if (!chunks.length) throw new Error('No speech was found in that file.');
      await put('conversations', conversation);
      this.set({ upload: { name: file.name, done: 0, total: chunks.length } });
      for (const [i, chunk] of chunks.entries()) {
        const previous = (await get('conversations', conversation.id))?.segments.slice(-6).map((s) => s.text).join('\n') ?? '';
        const lines = await transcribe(chunk, settings, { previousText: previous });
        await this.addLines(conversation.id, lines, chunk.start, chunk.start + chunk.durationMs);
        this.set({ upload: { name: file.name, done: i + 1, total: chunks.length } });
      }
      await this.finish(conversation.id);
      return conversation.id;
    } catch (error) {
      const message = (error as Error).message.includes('decod') ? 'This file format couldn\'t be decoded by the browser.' : (error as Error).message;
      const saved = await get('conversations', conversation.id);
      if (saved?.segments.length) await patch('conversations', conversation.id, (c) => ((c.status = 'error'), (c.error = message)));
      else if (saved) await remove('conversations', conversation.id);
      this.set({ error: message });
    } finally {
      this.set({ mode: 'idle', upload: undefined });
    }
  }

  dismissCommand() {
    this.set({ command: undefined });
  }
}

/**
 * Text after the wake phrase ('' if nothing follows it), or null if the phrase isn't present.
 * Tolerates punctuation that transcribers insert ("Hey, assistant.").
 */
export function matchWakePhrase(text: string, wakePhrase: string): string | null {
  const words = wakePhrase.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return null;
  const match = new RegExp(`(?:^|[\\s,.!?])${words.join('[\\s,.!?]+')}(?=$|[\\s,.!?:])[\\s,.!?:]*(.*)$`, 'iu').exec(text);
  return match ? match[1].trim() : null;
}

function micError(error: unknown): string {
  const name = (error as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Microphone permission was denied. Allow it in your browser\'s site settings.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  return (error as Error)?.message ?? String(error);
}

export const session = new Session();

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, () => session.state);
}
