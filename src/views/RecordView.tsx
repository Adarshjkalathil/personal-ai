import { useRef, type CSSProperties } from 'react';
import { BusyChoice, Notice, navigate } from '../components';
import { useList, speakerName } from '../lib/db';
import { LANGUAGES, LLM_PROVIDERS, STT_PROVIDERS } from '../lib/providers';
import { session, useSession } from '../lib/session';
import { llmProblem, sttProblem, updateSettings, useSettings } from '../lib/settings';
import { formatDuration, formatTime } from '../lib/time';
import { AgentActions } from './AskView';

// Whisper's accuracy is poor for these (it often outputs another language or invents text).
const WHISPER_WEAK = new Set(['ml-IN', 'ta-IN', 'te-IN', 'kn-IN', 'od-IN', 'as-IN', 'pa-IN', 'gu-IN', 'mr-IN', 'bn-IN']);

const HINT_ICONS = { question: '❓', commitment: '📌', fact: '💡', tip: '✨' } as const;

export function RecordView() {
  const settings = useSettings();
  const state = useSession();
  const conversations = useList('conversations');
  const fileInput = useRef<HTMLInputElement>(null);

  const current = conversations?.find((c) => c.id === state.conversationId);
  const recording = state.mode === 'recording';
  const busy = state.mode === 'starting' || state.mode === 'stopping';
  const sttIssue = sttProblem(settings);
  const llmIssue = llmProblem(settings);

  return (
    <div className="record">
      {sttIssue && (
        <Notice kind="warn">
          {sttIssue} <a href="#/settings">Open Settings</a>. Free option: a Groq or Gemini key takes about a minute to get, or choose browser speech recognition with no key at all.
        </Notice>
      )}
      {!sttIssue && llmIssue && <Notice>{llmIssue} Recording still works without one.</Notice>}

      <div className="record-main">
        <button
          className={`record-button ${recording ? 'on' : ''}`}
          disabled={busy || state.mode === 'uploading' || !!sttIssue}
          onClick={() => (recording ? session.stop() : session.start())}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          style={{ '--level': state.level } as CSSProperties}
        >
          <span>{recording ? '■' : '●'}</span>
        </button>
        <div className="record-status">
          <strong>
            {state.mode === 'starting' && 'Starting…'}
            {state.mode === 'recording' && 'Listening'}
            {state.mode === 'stopping' && 'Finishing up…'}
            {state.mode === 'idle' && 'Tap to start recording'}
            {state.mode === 'uploading' && 'Transcribing file…'}
          </strong>
          <span className="muted">
            {STT_PROVIDERS[settings.stt.provider].label}
            {settings.stt.model && ` · ${settings.stt.model}`}
            {!llmIssue && ` · AI: ${LLM_PROVIDERS[settings.llm.provider].label}`}
          </span>
          {state.pending > 0 && <span className="muted">Transcribing {state.pending} chunk{state.pending > 1 ? 's' : ''}…</span>}
          {recording && settings.stt.provider === 'gemini' && !settings.geminiBilling && (
            <span className="muted">Text appears every 2–5 minutes, so Gemini’s 20 free requests a day go further.</span>
          )}
          {recording && settings.voiceCommands && !llmIssue && (
            <span className="muted">Say “{settings.wakePhrase}, …” to give a command.</span>
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
      {!settings.stt.language && settings.stt.provider !== 'browser' && (
        <p className="muted small">Auto-detect can guess wrong. Choosing your language gives much better text.</p>
      )}
      {settings.stt.provider === 'groq' && WHISPER_WEAK.has(settings.stt.language) && (
        <Notice>
          Groq Whisper is weak at {LANGUAGES.find((l) => l.code === settings.stt.language)?.label}. Google Gemini or Sarvam AI
          transcribe it much better. You can switch in <a href="#/settings">Settings</a>.
        </Notice>
      )}

      {state.notice && <Notice>⏳ {state.notice}</Notice>}
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.held.count > 0 && (
        <Notice kind="warn">
          <div className="held">
            <span>
              {formatDuration(state.held.ms)} of audio is saved and waiting to be transcribed. Wait a minute or switch provider in{' '}
              <a href="#/settings">Settings</a>, then retry.
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
            <button className="link" onClick={() => session.dismissCommand()}>
              Dismiss
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
          <h3>Live hints</h3>
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
            <h3>Current conversation</h3>
            {current && (
              <button className="link" onClick={() => navigate(`c/${current.id}`)}>
                Open
              </button>
            )}
          </div>
          <div className="transcript">
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
        <button className="secondary" disabled={state.mode !== 'idle' || !!sttIssue} onClick={() => fileInput.current?.click()}>
          Transcribe an audio file
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
