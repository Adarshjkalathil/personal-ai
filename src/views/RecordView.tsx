import { AudioLines, Mic, MonitorSpeaker, Square, Upload, X } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { BackupReminder, BusyChoice, Notice, Stats, navigate } from '../components';
import { supportsDeviceAudio } from '../lib/audio';
import { useList, speakerName } from '../lib/db';
import { APK_URL, isNativeApp, onAndroidBrowser } from '../lib/native';
import { LANGUAGES, LLM_PROVIDERS, STT_PROVIDERS } from '../lib/providers';
import { session, useSession } from '../lib/session';
import { llmProblem, sttProblem, updateSettings, useSettings } from '../lib/settings';
import { formatDuration, formatTime, localDay } from '../lib/time';
import { AgentActions } from './AskView';

// Whisper's accuracy is poor for these (it often outputs another language or invents text).
const WHISPER_WEAK = new Set(['ml-IN', 'ta-IN', 'te-IN', 'kn-IN', 'od-IN', 'as-IN', 'pa-IN', 'gu-IN', 'mr-IN', 'bn-IN']);

const HINT_ICONS = { question: '❓', commitment: '📌', fact: '💡', tip: '✨' } as const;

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function RecordView() {
  const settings = useSettings();
  const state = useSession();
  const conversations = useList('conversations');
  const tasks = useList('tasks');
  const fileInput = useRef<HTMLInputElement>(null);

  const current = conversations?.find((c) => c.id === state.conversationId);
  const recording = state.mode === 'recording';
  const busy = state.mode === 'starting' || state.mode === 'stopping';
  const sttIssue = sttProblem(settings);
  // Browser speech recognition only ever listens to the microphone.
  const canShareAudio = supportsDeviceAudio() && settings.stt.provider !== 'browser';
  const llmIssue = llmProblem(settings);

  const today = conversations?.filter((c) => localDay(new Date(c.startedAt)) === localDay()) ?? [];
  const minutesToday = Math.round(today.reduce((ms, c) => ms + (c.endedAt - c.startedAt), 0) / 60_000);
  const openTasks = tasks?.filter((t) => !t.done).length ?? 0;

  return (
    <div className="record">
      <section className="hero">
        <div className="hero-text">
          <p className="hero-kicker">{greeting()}</p>
          <h1>{recording ? 'Listening…' : 'Record'}</h1>
        </div>
        <div className="hero-art" aria-hidden="true">
          <AudioLines size={46} strokeWidth={2.2} />
        </div>
      </section>

      <div className="card record-card">
        <div className="record-main">
          <button
            className={`record-button ${recording ? 'on' : ''}`}
            disabled={busy || state.mode === 'uploading' || !!sttIssue}
            onClick={() => (recording ? session.stop() : session.start())}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            aria-pressed={recording}
            style={{ '--level': state.level } as CSSProperties}
          >
            {recording ? <Square size={30} fill="currentColor" /> : <Mic size={38} />}
          </button>
          <div className="record-status">
            <strong>
              {state.mode === 'starting' && 'Starting…'}
              {state.mode === 'recording' && 'Listening'}
              {state.mode === 'stopping' && 'Finishing up…'}
              {state.mode === 'idle' && 'Tap to start'}
              {state.mode === 'uploading' && 'Transcribing file…'}
            </strong>
            <span className="muted small">
              {STT_PROVIDERS[settings.stt.provider].label}
              {!llmIssue && ` · AI: ${LLM_PROVIDERS[settings.llm.provider].label}`}
            </span>
            {state.deviceAudio === 'on' && (
              <span className="pill pill-mint">
                <MonitorSpeaker size={13} /> Computer audio included
              </span>
            )}
            {state.pending > 0 && (
              <span className="pill pill-sky">
                Transcribing {state.pending} chunk{state.pending > 1 ? 's' : ''}…
              </span>
            )}
          </div>
        </div>

        <label className="language-row">
          <span>Spoken language</span>
          <select value={settings.stt.language} onChange={(e) => updateSettings({ stt: { ...settings.stt, language: e.target.value } })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {canShareAudio ? (
          <label className="toggle device-audio">
            <input
              type="checkbox"
              checked={settings.deviceAudio}
              disabled={state.mode !== 'idle'}
              onChange={(e) => updateSettings({ deviceAudio: e.target.checked })}
            />
            <span>
              Include computer audio
              <span className="muted small"> (Meet, WhatsApp, Zoom calls)</span>
            </span>
          </label>
        ) : (
          !supportsDeviceAudio() && (
            <p className="muted small">
              Recording a call? Put it on speaker. {isNativeApp ? 'Android doesn’t let apps record other apps’ call audio.' : 'Phones don’t let web apps record other apps’ sound.'}
            </p>
          )
        )}
        {canShareAudio && settings.deviceAudio && state.mode === 'idle' && (
          <p className="muted small share-help">
            After you tap record, choose what to share: the <b>Meet tab</b> with <b>Share tab audio</b> on, or <b>Entire screen</b> with{' '}
            <b>Share system audio</b> on (Windows; needed for the WhatsApp and Zoom apps). Wear headphones so the other side isn’t
            recorded twice.
          </p>
        )}
        {!settings.stt.language && settings.stt.provider !== 'browser' && (
          <p className="muted small">Auto-detect can guess wrong. Choosing your language gives much better text.</p>
        )}
        {recording && settings.stt.provider === 'gemini' && !settings.geminiBilling && (
          <p className="muted small">Text appears every 2–5 minutes, so Gemini’s 20 free requests a day go further.</p>
        )}
        {recording && isNativeApp && (
          <p className="muted small">You can lock the phone or switch apps; recording carries on. Stop it here or from the notification.</p>
        )}
        {onAndroidBrowser && !recording && (
          <p className="muted small">
            <a href={APK_URL}>Get the Android app</a>: it keeps recording with the screen off.
          </p>
        )}
        {recording && settings.voiceCommands && !llmIssue && (
          <p className="muted small">Say “{settings.wakePhrase}, …” to give a command.</p>
        )}

        <Stats
          items={[
            { value: today.length, label: 'Today' },
            { value: minutesToday, label: 'Minutes' },
            { value: openTasks, label: 'Open tasks' },
          ]}
        />
      </div>

      {sttIssue && (
        <Notice kind="warn">
          {sttIssue} <a href="#/settings">Open Settings</a>. Free option: a Groq or Gemini key takes about a minute to get{isNativeApp ? '.' : ', or choose browser speech recognition with no key at all.'}
        </Notice>
      )}
      {!sttIssue && llmIssue && <Notice>{llmIssue} Recording still works without one.</Notice>}
      {settings.stt.provider === 'groq' && WHISPER_WEAK.has(settings.stt.language) && (
        <Notice>
          Groq Whisper is weak at {LANGUAGES.find((l) => l.code === settings.stt.language)?.label}. Google Gemini or Sarvam AI
          transcribe it much better. You can switch in <a href="#/settings">Settings</a>.
        </Notice>
      )}

      {state.deviceAudio === 'stopped' && recording && (
        <Notice kind="warn">Computer audio sharing was stopped. Still recording your microphone; stop and start again to share the call’s sound.</Notice>
      )}
      {state.notice && <Notice>⏳ {state.notice}</Notice>}
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.held.count > 0 && (
        <Notice kind="warn">
          <div className="held">
            <span>
              {formatDuration(state.held.ms)} of audio is saved and waiting to be transcribed.{' '}
              {state.error ? (
                <>
                  Wait a minute or switch provider in <a href="#/settings">Settings</a>, then retry.
                </>
              ) : (
                'It was recorded before the app last closed. Tap Retry to transcribe it.'
              )}
            </span>
            <button className="small" disabled={state.mode === 'uploading'} onClick={() => session.retryHeld()}>
              Retry
            </button>
          </div>
        </Notice>
      )}

      {state.command && (
        <div className="card command">
          <div className="command-head">
            <span>🗣️ “{state.command.command}”</span>
            <button className="icon-button" aria-label="Dismiss" onClick={() => session.dismissCommand()}>
              <X size={18} />
            </button>
          </div>
          {!state.command.reply && !state.command.error && <p className="muted">Working on it…</p>}
          {state.command.error && <p className="error-text">{state.command.error}</p>}
          {state.command.error && (
            <BusyChoice kind={state.command.limit} onRetry={(provider) => session.runCommand(state.command!.command, provider)} />
          )}
          {state.command.reply && (
            <>
              <p>{state.command.reply.text}</p>
              {state.command.reply.steps.map((step) => (
                <p key={step} className="step">
                  ✓ {step}
                </p>
              ))}
              <AgentActions actions={state.command.reply.actions} />
            </>
          )}
        </div>
      )}

      {state.hints.length > 0 && (
        <div className="card hints">
          <h3 className="eyebrow">Live hints</h3>
          {state.hints.map((hint, i) => (
            <p key={i}>
              {HINT_ICONS[hint.kind] ?? '•'} {hint.text}
            </p>
          ))}
        </div>
      )}

      {(current || state.interim) && (
        <div className="card live">
          <div className="section-head">
            <h3 className="eyebrow">Current conversation</h3>
            {current && (
              <button className="link" onClick={() => navigate(`c/${current.id}`)}>
                Open
              </button>
            )}
          </div>
          <div className="transcript" aria-live="polite">
            {current?.segments.slice(-12).map((segment) => (
              <p key={segment.id}>
                <span className="time">{formatTime(segment.start)}</span>
                {segment.speaker && <b>{speakerName(current, segment.speaker)}: </b>}
                {segment.text}
              </p>
            ))}
            {state.interim && <p className="interim">{state.interim}</p>}
          </div>
        </div>
      )}

      {state.upload && (
        <Notice>
          Transcribing <b>{state.upload.name}</b>
          {state.upload.total > 0 ? `: ${state.upload.done} of ${state.upload.total} parts` : ': decoding audio…'}
        </Notice>
      )}

      {state.mode === 'idle' && conversations && <BackupReminder count={conversations.length} />}

      <div className="record-extra">
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const id = await session.transcribeFile(file);
            if (id) navigate(`c/${id}`);
          }}
        />
        <button className="peach" disabled={state.mode !== 'idle' || !!sttIssue} onClick={() => fileInput.current?.click()}>
          <Upload size={18} /> Transcribe an audio file
        </button>
      </div>

      <p className="fineprint">
        Keep this tab open while recording. On phones, the screen is kept awake so the browser doesn’t pause the microphone.
        Silence is never uploaded. Recordings and transcripts are stored only in this browser. Let people know when you’re
        recording. Laws on recording conversations vary by place.
      </p>
    </div>
  );
}
