import { Lock, Mic, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Notice, Tile, navigate } from '../components';
import { ApiError } from '../lib/http';
import { listModels } from '../lib/llm';
import { LANGUAGES, LLM_PROVIDERS, STT_PROVIDERS } from '../lib/providers';
import { updateSettings, useSettings } from '../lib/settings';
import { persistStorage } from '../lib/storage';

type Step = 'intro' | 'key' | 'ready';
type KeyChoice = 'groq' | 'gemini';

const KEY_GUIDE: Record<KeyChoice, { label: string; url: string; site: string; prefix: string; steps: string[]; note?: string }> = {
  groq: {
    label: 'Groq',
    url: 'https://console.groq.com/keys',
    site: 'console.groq.com',
    prefix: 'gsk_',
    steps: ['Sign in with Google, GitHub or email.', 'Tap Create API Key and type any name, e.g. “personal-ai”.', 'Copy the key and paste it below.'],
  },
  gemini: {
    label: 'Google Gemini',
    url: 'https://aistudio.google.com/apikey',
    site: 'aistudio.google.com',
    prefix: 'AIza',
    steps: ['Sign in with your Google account.', 'Tap Create API key.', 'Copy the key and paste it below.'],
    note: 'Gemini labels who said what and is better at Indian languages, but its free tier allows only about 20 requests a day per model, so text appears every few minutes.',
  },
};

const hasBrowserSpeech = () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

/** First-run guide: what the app does, a free key (checked as it's pasted), language and microphone. */
export function WelcomeView() {
  const settings = useSettings();
  const [step, setStep] = useState<Step>('intro');
  const [choice, setChoice] = useState<KeyChoice>('groq');
  const noKey = settings.stt.provider === 'browser';

  const finish = () => {
    updateSettings({ onboarded: true });
    void persistStorage();
    navigate('record');
  };

  return (
    <div className={`welcome ${step === 'intro' ? 'welcome-intro' : ''}`}>
      <div className="welcome-top">
        <span className="muted small">{step === 'intro' ? 'Welcome' : `Step ${step === 'key' ? 1 : 2} of 2`}</span>
        <button className="link small" onClick={finish}>
          Skip setup
        </button>
      </div>

      {step === 'intro' && (
        <>
          <section className="hero hero-center">
            <img src="./icon-192.png" alt="" width={76} height={76} className="welcome-icon" />
            <h1>Your conversations, remembered.</h1>
          </section>
          <div className="welcome-step card overlap">
            <ul className="welcome-points">
              <li>
                <Tile tone="mint" size="sm">
                  <Mic size={20} />
                </Tile>
                Records and writes down what’s said, in English, Hindi, Malayalam and more.
              </li>
              <li>
                <Tile tone="lavender" size="sm">
                  <Sparkles size={20} />
                </Tile>
                Summaries, to-dos, and answers to questions like “What did Ravi say about the budget?”
              </li>
              <li>
                <Tile tone="peach" size="sm">
                  <Lock size={20} />
                </Tile>
                Everything stays in this browser. No account, no company server.
              </li>
            </ul>
            <button className="big" onClick={() => setStep('key')}>
              Set up (about a minute)
            </button>
            {hasBrowserSpeech() ? (
              <button
                className="link"
                onClick={() => {
                  updateSettings({ stt: { ...settings.stt, provider: 'browser', model: '' } });
                  setStep('ready');
                }}
              >
                Try it first without a key
              </button>
            ) : (
              <p className="muted small">Trying without a key needs Chrome or Edge. Setup with a free key works in any browser.</p>
            )}
          </div>
        </>
      )}

      {step === 'key' && <KeyStep choice={choice} setChoice={setChoice} onDone={() => setStep('ready')} />}

      {step === 'ready' && (
        <div className="welcome-step card">
          <h2>Almost done</h2>
          {noKey && (
            <Notice>
              You’re using your browser’s free speech recognition. Add a free key in Settings later for summaries, to-dos and Ask.
            </Notice>
          )}
          <label>
            What language do you mostly speak?
            <select value={settings.stt.language} onChange={(e) => updateSettings({ stt: { ...settings.stt, language: e.target.value } })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <span className="muted small">Picking your language gives much better text than Auto-detect. You can change it on the Record tab.</span>
          </label>
          <MicTest />
          <p className="muted small">Please tell people when you’re recording them. In many places it’s required by law.</p>
          <button className="big" onClick={finish}>
            Start using Personal AI
          </button>
        </div>
      )}
    </div>
  );
}

function KeyStep({ choice, setChoice, onDone }: { choice: KeyChoice; setChoice: (c: KeyChoice) => void; onDone: () => void }) {
  const settings = useSettings();
  const guide = KEY_GUIDE[choice];
  const key = settings.keys[choice];
  const [check, setCheck] = useState<{ key: string; ok: boolean; message: string } | null>(null);

  // Check the key as soon as it's pasted.
  useEffect(() => {
    if (key.length < 20) return;
    let active = true;
    const timer = setTimeout(async () => {
      setCheck({ key, ok: false, message: 'Checking…' });
      try {
        await listModels(choice, settings.keys);
        if (active) setCheck({ key, ok: true, message: '✓ The key works.' });
      } catch (error) {
        const rejected = error instanceof ApiError && (error.status === 401 || error.status === 403);
        const message = rejected ? 'That key didn’t work. Copy it again (the whole key, no spaces) or create a new one.' : (error as Error).message;
        if (active) setCheck({ key, ok: false, message: `✕ ${message}` });
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, choice]);

  const status = check?.key === key ? check : null;

  const useKey = () => {
    updateSettings({
      stt: { ...settings.stt, provider: choice, model: STT_PROVIDERS[choice].defaultModel },
      llm: { provider: choice, model: LLM_PROVIDERS[choice].defaultModel, baseUrl: LLM_PROVIDERS[choice].baseUrl },
    });
    onDone();
  };

  return (
    <div className="welcome-step card">
      <h2>Get a free key</h2>
      <p className="muted">
        A key is like a password that lets this app use a free AI service. No credit card needed.
      </p>
      <div className="segmented" role="radiogroup" aria-label="Service">
        {(Object.keys(KEY_GUIDE) as KeyChoice[]).map((id) => (
          <button key={id} role="radio" aria-checked={choice === id} className={choice === id ? 'active' : ''} onClick={() => setChoice(id)}>
            {KEY_GUIDE[id].label}
            {id === 'groq' && <span className="muted small"> (recommended)</span>}
          </button>
        ))}
      </div>
      {guide.note && <p className="muted small">{guide.note}</p>}
      <ol className="welcome-steps">
        <li>
          Open{' '}
          <a href={guide.url} target="_blank" rel="noreferrer">
            {guide.site} ↗
          </a>
        </li>
        {guide.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <label>
        Your {guide.label} key
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Starts with ${guide.prefix}`}
          value={key}
          onChange={(e) => updateSettings({ keys: { ...settings.keys, [choice]: e.target.value.trim() } })}
        />
      </label>
      {status && (
        <p className={status.ok ? 'ok-text' : status.message === 'Checking…' ? 'muted' : 'error-text'} role="status">
          {status.message}
        </p>
      )}
      <button className="big" disabled={!status?.ok} onClick={useKey}>
        Continue
      </button>
    </div>
  );
}

/** Shows a live level so people can see the app hears them before they rely on it. */
function MicTest() {
  const [state, setState] = useState<'idle' | 'listening' | 'heard' | 'error'>('idle');
  const [error, setError] = useState('');
  const bar = useRef<HTMLDivElement>(null);
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => () => stopRef.current(), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let frame = 0;
      let heard = false;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
        const level = Math.min(1, rms * 12);
        if (bar.current) bar.current.style.width = `${level * 100}%`;
        if (level > 0.25 && !heard) {
          heard = true;
          setState('heard');
        }
        frame = requestAnimationFrame(tick);
      };
      stopRef.current = () => {
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
      };
      setState('listening');
      tick();
      setTimeout(() => stopRef.current(), 15_000);
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Microphone permission was denied. Tap the lock icon next to the web address, allow the microphone, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : (e as Error).message,
      );
      setState('error');
    }
  };

  return (
    <div className="mic-test">
      {state === 'idle' || state === 'error' ? (
        <button className="secondary" onClick={start}>
          🎤 Test your microphone
        </button>
      ) : (
        <>
          <div className="meter" aria-hidden="true">
            <div ref={bar} />
          </div>
          <span className={state === 'heard' ? 'ok-text' : 'muted'} role="status">
            {state === 'heard' ? '✓ We can hear you.' : 'Say something…'}
          </span>
        </>
      )}
      {state === 'error' && <p className="error-text small">{error}</p>}
    </div>
  );
}
