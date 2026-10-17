import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import type { SpeechChunk } from './audio';
import type { LimitKind } from './http';

export interface Segment {
  id: string;
  /** Epoch ms when this piece of speech started. */
  start: number;
  text: string;
  speaker?: string;
}

export interface CalendarEvent {
  title: string;
  /** ISO date-time, or null if no time was mentioned. */
  start: string | null;
  durationMinutes: number;
  location?: string;
}

export interface FollowUp {
  /** Who to contact, if known. */
  to: string;
  channel: 'email' | 'message';
  subject: string;
  body: string;
}

export interface Analysis {
  discard: boolean;
  title: string;
  emoji: string;
  category: string;
  overview: string;
  keyPoints: string[];
  decisions: string[];
  events: CalendarEvent[];
  followUps: FollowUp[];
  people: string[];
  tone: { overall: string; notes: string };
  language: string;
  model: string;
  analyzedAt: number;
}

export type ConversationStatus = 'recording' | 'transcribed' | 'analyzing' | 'analyzed' | 'error';

export interface Conversation {
  id: string;
  startedAt: number;
  endedAt: number;
  source: 'mic' | 'browser' | 'upload';
  fileName?: string;
  status: ConversationStatus;
  segments: Segment[];
  /** Display names for diarized speakers, e.g. { "Speaker 1": "Ravi" }. */
  speakerNames?: Record<string, string>;
  analysis?: Analysis;
  error?: string;
  /** Set when the error was a provider's rate limit, so the UI can offer other providers. */
  errorKind?: LimitKind;
}

export interface Task {
  id: string;
  text: string;
  owner: 'me' | 'other' | 'unknown';
  /** ISO date-time, if a deadline was mentioned. */
  due: string | null;
  done: boolean;
  createdAt: number;
  conversationId?: string;
  /** Set once a due-date notification has been shown. */
  notified?: boolean;
}

/** A lasting fact about the user ("prefers morning meetings", "sister's name is Priya"). */
export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  conversationId?: string;
}

/** Recorded audio that hasn't been transcribed yet, kept so a reload or crash doesn't lose it. */
export interface PendingAudio {
  id: string;
  chunk: SpeechChunk;
  source: Conversation['source'];
  /** Unset if the app closed before the chunk was assigned to a conversation. */
  conversationId?: string;
}

type StoreName = 'conversations' | 'tasks' | 'memories';
type StoreValue = { conversations: Conversation; tasks: Task; memories: Memory };

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  dbPromise ??= openDB('personal-ai', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('conversations', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
        database.createObjectStore('tasks', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        database.createObjectStore('memories', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
      if (oldVersion < 2) database.createObjectStore('audio', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** All records, newest first. */
export async function list<S extends StoreName>(store: S): Promise<StoreValue[S][]> {
  const index = store === 'conversations' ? 'startedAt' : 'createdAt';
  const all = (await (await db()).getAllFromIndex(store, index)) as StoreValue[S][];
  return all.reverse();
}

export async function get<S extends StoreName>(store: S, id: string): Promise<StoreValue[S] | undefined> {
  return (await db()).get(store, id);
}

export async function put<S extends StoreName>(store: S, value: StoreValue[S]): Promise<void> {
  await (await db()).put(store, value);
  notify();
}

export async function remove(store: StoreName, id: string): Promise<void> {
  await (await db()).delete(store, id);
  notify();
}

export async function clearAll(): Promise<void> {
  const database = await db();
  await Promise.all((['conversations', 'tasks', 'memories', 'audio'] as const).map((store) => database.clear(store)));
  notify();
}

export async function saveAudio(audio: PendingAudio): Promise<void> {
  await (await db()).put('audio', audio);
}

export async function deleteAudio(id: string): Promise<void> {
  await (await db()).delete('audio', id);
}

export async function listAudio(): Promise<PendingAudio[]> {
  const all = (await (await db()).getAll('audio')) as PendingAudio[];
  return all.sort((a, b) => a.chunk.start - b.chunk.start);
}

/** Read-modify-write so concurrent updates (transcription vs. analysis) don't overwrite each other. */
export async function patch<S extends StoreName>(
  store: S,
  id: string,
  change: (value: StoreValue[S]) => void,
): Promise<StoreValue[S] | undefined> {
  const value = await get(store, id);
  if (!value) return undefined;
  change(value);
  await put(store, value);
  return value;
}

/** Live list that re-reads whenever anything in the database changes. */
export function useList<S extends StoreName>(store: S): StoreValue[S][] | null {
  const [items, setItems] = useState<StoreValue[S][] | null>(null);
  useEffect(() => {
    let active = true;
    const reload = () => list(store).then((result) => active && setItems(result));
    reload();
    listeners.add(reload);
    return () => {
      active = false;
      listeners.delete(reload);
    };
  }, [store]);
  return items;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function speakerName(conversation: Conversation, speaker?: string): string | undefined {
  return speaker ? (conversation.speakerNames?.[speaker] ?? speaker) : undefined;
}

export function transcriptText(conversation: Conversation, withTimes = false): string {
  return conversation.segments
    .map((segment) => {
      const time = withTimes ? `[${new Date(segment.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ` : '';
      const speaker = speakerName(conversation, segment.speaker);
      return `${time}${speaker ? `${speaker}: ` : ''}${segment.text}`;
    })
    .join('\n');
}

export interface Backup {
  app: 'personal-ai';
  version: 1;
  exportedAt: string;
  conversations: Conversation[];
  tasks: Task[];
  memories: Memory[];
}

export async function exportAll(): Promise<Backup> {
  return {
    app: 'personal-ai',
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations: await list('conversations'),
    tasks: await list('tasks'),
    memories: await list('memories'),
  };
}

export async function importAll(backup: Backup): Promise<void> {
  if (backup.app !== 'personal-ai') throw new Error('This file is not a Personal AI backup.');
  const database = await db();
  const tx = database.transaction(['conversations', 'tasks', 'memories'], 'readwrite');
  await Promise.all([
    ...(backup.conversations ?? []).map((c) => tx.objectStore('conversations').put(c)),
    ...(backup.tasks ?? []).map((t) => tx.objectStore('tasks').put(t)),
    ...(backup.memories ?? []).map((m) => tx.objectStore('memories').put(m)),
    tx.done,
  ]);
  notify();
}
