<img src="assets/icon.svg" width="64" height="64" alt="">

# Personal AI

An AI memory assistant that runs entirely in your browser. It records your conversations, transcribes
them, and turns them into summaries, tasks, calendar events and memories. You can ask it about anything you've
discussed and tell it to act for you.

It's a free alternative to AI wearables like NeoSapien Neo 1, Limitless or Bee. There's no server, no account and no
subscription. Bring your own free API keys.

Created in [T3 Code](https://t3.codes).

## Features

| | |
|---|---|
| 🎙️ **Record** | Records continuously from the microphone. Voice detection uploads only speech, never silence. A new conversation starts automatically after a pause. |
| 📁 **Transcribe files** | Drop in any audio or video file the browser can decode. |
| 🗣️ **Speaker labels** | Speaker 1, Speaker 2… (with Gemini). Rename them to real names. |
| 🌏 **Indian languages** | Hindi, Tamil, Telugu, Bengali, Marathi and 10 more, including mixed Hindi-English. |
| 📝 **Summaries** | Title, overview, key points, decisions, people, tone/mood. Trivial snippets are hidden automatically. |
| ✅ **Tasks & reminders** | Commitments become tasks with due dates. Get browser notifications, or export to any calendar (.ics). |
| 📅 **Events** | One tap to Google Calendar, or download an .ics file. |
| ✉️ **Follow-ups** | Ready-to-send email and WhatsApp drafts. |
| 🧠 **Memories** | Lasting facts about you, collected from your conversations. |
| ✨ **Ask (agent)** | Chat over everything you've recorded. The assistant searches, cites conversations, adds or completes tasks, remembers or forgets facts, schedules events and drafts messages. |
| 🗣️ **Voice commands** | While recording, say *“hey assistant, remind me to call Ravi at 6”*. It acts and replies out loud. |
| 💡 **Live hints** | Optional: suggested follow-up questions and commitments it notices while you talk. |
| 📰 **Daily recap** | A digest of your day: highlights, decisions, open loops, suggestions for tomorrow. |
| 📱 **Installable** | Works as a phone or desktop app (PWA). Backup and restore as JSON. |

## Free API keys

Every provider below has a free option, and the app calls it directly from your browser. Pick at least one.

| Provider | Used for | Free tier | Get a key |
|---|---|---|---|
| **Groq** | Transcription (Whisper) + AI | Free, no card. About 8 h of audio a day | [console.groq.com/keys](https://console.groq.com/keys) |
| **Google Gemini** | Transcription with speaker labels + AI | Free, no card. Free-tier data may be used by Google | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **OpenRouter** | AI (many free models) | Free models, low daily cap | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Mistral** | AI | Free “Experiment” plan | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| **Sarvam AI** | Best Indian-language transcription | Signup credit, then paid | [dashboard.sarvam.ai](https://dashboard.sarvam.ai) |
| **Custom** | Any OpenAI-compatible server (Ollama, LM Studio) | Free and fully private | – |
| **Browser** | Transcription with no key (Chrome/Edge) | Free | – |

**Quickest start:** get a Groq key, paste it in Settings, and press record.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # static site in dist/
```

### Publish it

Every push runs the tests. The built `dist/` folder is a plain static site, so any static host works.

- **GitHub Pages:** free for public repos only (private repos need a paid plan). Once the repo is public, set
  **Settings → Pages → Source** to **GitHub Actions**, and every push to `main` deploys to
  `https://<you>.github.io/<repo>/`.
- **While the repo is private:** Cloudflare Pages, Netlify and Vercel all host private repos for free. Use build
  command `npm run build` and output folder `dist`.

The microphone needs HTTPS (or `localhost`), and GitHub Pages provides HTTPS.

## Privacy

- Conversations, tasks and memories are stored only in your browser (IndexedDB). API keys are stored in
  `localStorage` and sent only to the provider they belong to.
- Audio leaves your device only for transcription, and only the parts where someone is speaking.
- The production build sets a strict Content-Security-Policy and loads no third-party scripts.
- For full privacy, use the Custom provider with a local model (for AI), and keep in mind that the free tiers of some
  cloud providers may use your data for training.
- **Tell people when you're recording.** Laws on recording conversations differ by country and state.

## Limitations

- **Keep the tab open.** Browsers pause background tabs, so the app keeps the screen awake while recording. A native
  app or a Bluetooth pendant (see below) is needed for all-day, screen-off capture.
- **Speaker labels can drift.** Gemini labels speakers chunk by chunk, so labels can occasionally swap.
- **Reminders fire only while the app is open.** Use the .ics export for reminders that always go off.

## How it works

```
mic ─► AudioWorklet ─► 16 kHz resample ─► voice detector ─► speech chunks (≤25 s)
     ─► transcription (Groq / Gemini / Sarvam / browser) ─► conversation (split on silence)
     ─► AI analysis (one JSON call) ─► summary · tasks · events · follow-ups · memories
     ─► Ask agent (tool calling) ─► search · tasks · memories · calendar · messages
```

| File | What it does |
|---|---|
| `src/lib/audio.ts` | Capture, resampling, voice-activity chunking, WAV encoding |
| `src/lib/stt.ts` | Transcription providers |
| `src/lib/llm.ts` | One OpenAI-compatible client for every AI provider |
| `src/lib/analyze.ts` | Conversation → structured notes, tasks, memories |
| `src/lib/agent.ts` | Ask assistant with tools |
| `src/lib/session.ts` | Recording session, voice commands, live hints |
| `src/lib/db.ts` | IndexedDB storage, backup/restore |

The conversation fields and the “discard trivial snippets” rule are modelled on
[Omi](https://github.com/BasedHardware/omi) (MIT), the open-source AI wearable project.

## Roadmap

- Bluetooth pendant support (Web Bluetooth, Omi-compatible firmware on a ~$25 XIAO nRF52840 Sense)
- Fully on-device transcription in the browser (Whisper via WebGPU)
- Android wrapper for background recording

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).
