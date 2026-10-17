// The Android app: the same web app inside a Capacitor WebView, plus a small native
// plugin (android/.../NativeRecorderPlugin.java) for background recording and speech.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** True inside the Android app, false in a browser. */
export const isNativeApp = Capacitor.isNativePlatform();

interface NativeRecorderPlugin {
  /** Starts recording in a foreground service (asks for the microphone first). */
  start(): Promise<void>;
  stop(): Promise<void>;
  speak(options: { text: string }): Promise<void>;
  /** 16 kHz mono 16-bit PCM, base64, in ~200 ms batches. */
  addListener(event: 'audio', listener: (event: { data: string }) => void): Promise<PluginListenerHandle>;
  /** Recording ended from the notification's Stop button, or because of an error. */
  addListener(event: 'ended', listener: (event: { error?: string }) => void): Promise<PluginListenerHandle>;
}

export const NativeRecorder = registerPlugin<NativeRecorderPlugin>('NativeRecorder');

/** Where the latest APK is published, and the API that says which version it is. */
export const APK_URL = 'https://github.com/Adarshjkalathil/personal-ai/releases/latest/download/personal-ai.apk';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/Adarshjkalathil/personal-ai/releases/latest';

/** An Android phone's browser, where the app would record better. */
export const onAndroidBrowser = !isNativeApp && /Android/i.test(navigator.userAgent);

/** Decodes a base64 PCM16 batch into samples in -1..1. */
export function decodePcm16(base64: string): Float32Array {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x8000;
  return samples;
}

/** "0.10.2" > "0.9.0" */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
