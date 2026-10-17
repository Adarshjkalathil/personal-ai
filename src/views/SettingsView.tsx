import { useEffect, useRef, useState } from 'react';
import { Notice, Section } from '../components';
import { clearAll, importAll, type Backup } from '../lib/db';
import { listModels } from '../lib/llm';
import { KEYS, LANGUAGES, LLM_PROVIDERS, STT_PROVIDERS, type KeyId, type LlmProviderId, type SttProviderId } from '../lib/providers';
import { geminiUsage, resetTime, usageListeners } from '../lib/quota';
import { enableReminders } from '../lib/reminders';
import { updateSettings, useSettings, type Settings } from '../lib/settings';
import { daysAgo, downloadBackup, lastBackupAt, persistStorage, storageStatus, useBackupState, type StorageStatus } from '../lib/storage';

// Groq and Gemini cover almost everyone; the rest are folded away unless in use.
const MAIN_KEYS: KeyId[] = ['groq', 'gemini'];

// Model lists include speech, safety and TTS models; keep the relevant ones per use.
const isSpeechModel = (id: string) => /whisper|transcribe/i.test(id);
const isChatModel = (id: string) => !/whisper|guard|tts|orpheus|embed|image|imagen|veo|aqa|live|native-audio/i.test(id);

function ModelPicker({ value, onChange, load }: { value: string; onChange: (model: string) => void; load?: () => Promise<string[]> }) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const listId = useRef(`models-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="model-picker">
      <input list={listId} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="Model id" />
      <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      {load && (
        <button
          type="button"
          className="secondary small"
          onClick={async () => {
            setStatus('Loading…');
            try {
              const result = await load();
              setModels(result);
              setStatus(`${result.length} models available. Pick one from the list.`);
            } catch (e) {
              setStatus((e as Error).message);
            }
          }}
        >
          Load models
        </button>
      )}
      {status && <span className="muted small">{status}</span>}
    </div>
  );
}

/** Today's Gemini requests per model, counted on this device. */
function GeminiUsage({ billing }: { billing: boolean }) {
  const [usage, setUsage] = useState(() => geminiUsage());
  useEffect(() => {
    const update = () => setUsage(geminiUsage());
    usageListeners.add(update);
    return () => {
      usageListeners.delete(update);
    };
  }, []);
  if (!usage.length) return null;
  return (
    <p className="muted small">
      Used today on this device:{' '}
      {usage.map((u) => `${u.model} ${u.exhausted ? 'used up' : billing ? `${u.used} requests` : `${u.used} of ${u.limit}`}`).join(' · ')}.{' '}
      {!billing && `Resets at ${resetTime()}. `}Google counts all your devices and keys together, so check{' '}
      <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer">
        your exact usage ↗
      </a>
      .
    </p>
  );
}

function KeyField({ id, settings }: { id: KeyId; settings: Settings }) {
  const info = KEYS[id];
  const [status, setStatus] = useState('');
  // Sarvam has no model-list endpoint; the custom URL is only configured once Custom is the AI provider.
  const testable = id !== 'sarvam' && (id !== 'custom' || settings.llm.provider === 'custom');
  return (
    <div className="key-field">
      <div className="key-head">
        <b>{info.label}</b>
        {info.signupUrl && (
          <a href={info.signupUrl} target="_blank" rel="noreferrer">
            Get a free key ↗
          </a>
        )}
      </div>
      <p className="muted small">{info.free}</p>
      <div className="model-picker">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={id === 'custom' ? 'Optional' : 'Paste API key'}
          value={settings.keys[id]}
          onChange={(e) => updateSettings({ keys: { ...settings.keys, [id]: e.target.value.trim() } })}
        />
        {testable && (settings.keys[id] || id === 'custom') && (
          <button
            type="button"
            className="secondary small"
            onClick={async () => {
              setStatus('Testing…');
              try {
                const models = await listModels(id as LlmProviderId, settings.keys, settings.llm.baseUrl);
                setStatus(`✓ Works (${models.length} models)`);
              } catch (e) {
                setStatus(`✕ ${(e as Error).message}`);
              }
            }}
          >
            Test
          </button>
        )}
      </div>
      {status && <span className="small">{status}</span>}
      {id === 'gemini' && (
        <>
          <GeminiUsage billing={settings.geminiBilling} />
          <Toggle
            label="Billing is enabled for this key (paid tier, e.g. Google AI Pro credits)"
            checked={settings.geminiBilling}
            onChange={(v) => updateSettings({ geminiBilling: v })}
          />
          {settings.geminiBilling && (
            <p className="muted small">
              No more free-tier pacing, and transcription text appears every 10–60 seconds. Usage is charged to your Google account, so set
              a monthly spend cap on the <b>Spend</b> page in{' '}
              <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">
                AI Studio ↗
              </a>{' '}
              (or use prepay for a hard stop).
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Whether the browser has promised to keep this app's data, and how much is stored. */
function StorageInfo() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    void storageStatus().then(setStatus);
  }, [asked]);
  if (!status?.supported) return null;
  const used = status.usage ? ` (${(status.usage / 1_048_576).toFixed(1)} MB used)` : '';
  return status.persisted ? (
    <p className="small">✓ This browser has agreed to keep your data{used}.</p>
  ) : (
    <div className="small">
      <p>
        ⚠ The browser may delete your data if the device runs low on space{used}.{' '}
        <button
          className="link small"
          onClick={async () => {
            await persistStorage();
            setAsked(true);
          }}
        >
          Ask it to keep the data
        </button>
      </p>
      {asked && (
        <p className="muted">
          The browser didn’t agree yet. It usually does once the app is installed: use <b>Add to Home Screen</b> (on iPhone, from
          Safari’s Share button) or <b>Install app</b> in Chrome’s menu.
        </p>
      )}
    </div>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const importInput = useRef<HTMLInputElement>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  useBackupState();
  const extraKeys = (Object.keys(KEYS) as KeyId[]).filter((id) => !MAIN_KEYS.includes(id));
  const extraInUse = extraKeys.some(
    (id) => settings.keys[id] || STT_PROVIDERS[settings.stt.provider].key === id || LLM_PROVIDERS[settings.llm.provider].key === id,
  );
  const stt = STT_PROVIDERS[settings.stt.provider];
  const llm = LLM_PROVIDERS[settings.llm.provider];

  const loadSttModels =
    settings.stt.provider === 'groq' || settings.stt.provider === 'gemini'
      ? async () => {
          const models = await listModels(settings.stt.provider as LlmProviderId, settings.keys);
          return settings.stt.provider === 'groq' ? models.filter(isSpeechModel) : models.filter(isChatModel);
        }
      : settings.stt.provider === 'sarvam'
        ? async () => ['saaras:v4', 'saaras:v3']
        : undefined;

  return (
    <div className="settings">
      <Notice>
        <b>Everything here is free to start.</b> The quickest setup is a <b>Groq</b> key (transcription and AI), or a <b>Gemini</b>{' '}
        key if you want speaker labels and better Hindi. Add more than one key and, when one provider hits its free limit, the app
        offers to use another one. Keys are stored only in this browser and sent only to the provider they belong to.
      </Notice>

      <Section title="API keys">
        {MAIN_KEYS.map((id) => (
          <KeyField key={id} id={id} settings={settings} />
        ))}
        <details className="advanced" open={extraInUse}>
          <summary>More providers: Sarvam AI, OpenRouter, Mistral, your own server</summary>
          {extraKeys.map((id) => (
            <KeyField key={id} id={id} settings={settings} />
          ))}
        </details>
      </Section>

      <Section title="Transcription">
        <label>
          Provider
          <select
            value={settings.stt.provider}
            onChange={(e) => {
              const provider = e.target.value as SttProviderId;
              updateSettings({ stt: { ...settings.stt, provider, model: STT_PROVIDERS[provider].defaultModel } });
            }}
          >
            {(Object.keys(STT_PROVIDERS) as SttProviderId[]).map((id) => (
              <option key={id} value={id}>
                {STT_PROVIDERS[id].label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">{stt.note}</p>
        {settings.stt.provider !== 'browser' && (
          <details className="advanced">
            <summary>Model: {settings.stt.model || 'default'}</summary>
            <label>
              Transcription model
              <ModelPicker value={settings.stt.model} onChange={(model) => updateSettings({ stt: { ...settings.stt, model } })} load={loadSttModels} />
            </label>
          </details>
        )}
        <label>
          Language
          <select value={settings.stt.language} onChange={(e) => updateSettings({ stt: { ...settings.stt, language: e.target.value } })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="AI model (summaries, Ask, recaps)">
        <label>
          Provider
          <select
            value={settings.llm.provider}
            onChange={(e) => {
              const provider = e.target.value as LlmProviderId;
              const preset = LLM_PROVIDERS[provider];
              updateSettings({ llm: { provider, model: preset.defaultModel, baseUrl: preset.baseUrl } });
            }}
          >
            {(Object.keys(LLM_PROVIDERS) as LlmProviderId[]).map((id) => (
              <option key={id} value={id}>
                {LLM_PROVIDERS[id].label}
              </option>
            ))}
          </select>
        </label>
        {settings.llm.provider === 'custom' && (
          <label>
            Base URL
            <input value={settings.llm.baseUrl} onChange={(e) => updateSettings({ llm: { ...settings.llm, baseUrl: e.target.value.trim() } })} />
            <span className="muted small">
              For Ollama, start it with <code>OLLAMA_ORIGINS=*</code> so the browser is allowed to connect.
            </span>
          </label>
        )}
        <details className="advanced" open={!settings.llm.model}>
          <summary>Model: {settings.llm.model || 'none chosen'}</summary>
          <label>
            AI model
            <ModelPicker
              value={settings.llm.model}
              onChange={(model) => updateSettings({ llm: { ...settings.llm, model } })}
              load={async () => (await listModels(settings.llm.provider, settings.keys, settings.llm.baseUrl)).filter(isChatModel)}
            />
            {settings.llm.provider === 'openrouter' && <span className="muted small">Free models end in “:free”. “openrouter/free” picks one for you.</span>}
            {!llm.jsonMode && <span className="muted small">Tip: pick a model that supports tool calling so Ask can take actions.</span>}
          </label>
        </details>
        {!settings.geminiBilling && settings.llm.provider === 'gemini' && settings.stt.provider === 'gemini' && settings.llm.model === settings.stt.model && (
          <p className="muted small">
            Transcription uses this model too, so they share its 20 free requests a day. Pick a different Gemini model under
            Model above (each model has its own limit), or use Groq for the AI.
          </p>
        )}
        <label>
          Write summaries and answers in
          <input value={settings.outputLanguage} onChange={(e) => updateSettings({ outputLanguage: e.target.value })} placeholder="English" />
        </label>
      </Section>

      <Section title="Behaviour">
        <label>
          Start a new conversation after this many minutes of silence
          <input
            type="number"
            min={0.5}
            max={60}
            step={0.5}
            value={settings.conversationGapMinutes}
            onChange={(e) => updateSettings({ conversationGapMinutes: Math.max(0.5, Number(e.target.value) || 2) })}
          />
        </label>
        <Toggle label="Summarize conversations automatically" checked={settings.autoAnalyze} onChange={(v) => updateSettings({ autoAnalyze: v })} />
        <Toggle label="Keep the screen awake while recording" checked={settings.keepScreenOn} onChange={(v) => updateSettings({ keepScreenOn: v })} />
        <Toggle label="Voice commands while recording" checked={settings.voiceCommands} onChange={(v) => updateSettings({ voiceCommands: v })} />
        {settings.voiceCommands && (
          <label>
            Wake phrase
            <input value={settings.wakePhrase} onChange={(e) => updateSettings({ wakePhrase: e.target.value })} />
            <span className="muted small">Say it and then your request, e.g. “{settings.wakePhrase}, remind me to call Ravi at 6”.</span>
          </label>
        )}
        <Toggle label="Speak replies to voice commands" checked={settings.speakReplies} onChange={(v) => updateSettings({ speakReplies: v })} />
        <Toggle
          label="Live hints while recording (follow-up questions, commitments; uses extra AI requests)"
          checked={settings.liveHints}
          onChange={(v) => updateSettings({ liveHints: v })}
        />
        <Toggle
          label="Reminder notifications for due tasks (while the app is open)"
          checked={settings.reminders}
          onChange={async (v) => updateSettings({ reminders: v && (await enableReminders()) })}
        />
      </Section>

      <Section title="Your data">
        <p className="muted small">
          Conversations, tasks and memories are stored only in this browser. Clearing site data deletes them, so download a backup
          now and then. Backups don’t include API keys. Last backup: {daysAgo(lastBackupAt())}.
        </p>
        <StorageInfo />
        <div className="actions">
          <button className="secondary" onClick={() => downloadBackup().catch((e: Error) => setDataNotice(`Backup failed: ${e.message}`))}>
            Export backup
          </button>
          <button className="secondary" onClick={() => importInput.current?.click()}>
            Import backup
          </button>
          <button
            className="secondary danger"
            onClick={async () => {
              if (confirm('Delete ALL conversations, tasks and memories from this browser?')) {
                await clearAll();
                setDataNotice('All data deleted.');
              }
            }}
          >
            Delete all data
          </button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              await importAll(JSON.parse(await file.text()) as Backup);
              setDataNotice('Backup imported.');
            } catch (error) {
              setDataNotice(`Import failed: ${(error as Error).message}`);
            }
          }}
        />
        {dataNotice && <Notice>{dataNotice}</Notice>}
      </Section>

      <p className="fineprint">
        Personal AI {__APP_VERSION__} (build {__BUILD__}) ·{' '}
        <button className="link small" onClick={() => updateSettings({ onboarded: false })}>
          Show the welcome guide again
        </button>
      </p>

      <p className="fineprint">
        Audio is sent only to the transcription provider you choose, and only while someone is
        speaking. Free tiers of some providers (e.g. Google, Mistral) may use your data to improve their models. Use a local
        model via the Custom provider for full privacy.
      </p>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
