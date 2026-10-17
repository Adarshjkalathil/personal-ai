<img src="assets/icon.svg" width="64" height="64" alt="">

# Personal AI

**Your conversations, remembered.** Press record, talk normally, and Personal AI writes down what was said. It
summarizes each conversation, makes a to-do list from the promises people made, and lets you ask questions later,
like *“What did Ravi say about the budget?”*

- ✅ **Free.** No subscription, nothing to buy.
- ✅ **Nothing to install.** It runs in your web browser, on a phone or a computer.
- ✅ **Private.** Your recordings stay on your own device.
- ✅ **Speaks your language.** English, Hindi, Tamil, Telugu, Bengali, Marathi and more, including mixed Hindi-English.

## 👉 [Open Personal AI](https://adarshjkalathil.github.io/personal-ai/)

---

## Try it in 3 minutes

You need one free “API key”. Think of it as a password that lets the app use a free AI service. Getting one takes
about a minute, and you don't need a credit card.

### Step 1: Get a free key from Groq

1. Go to **[console.groq.com/keys](https://console.groq.com/keys)**.
2. Sign up with your Google account, GitHub account or email.
3. Click **Create API Key**, type any name (for example `personal-ai`) and confirm.
4. **Copy the key.** It's a long code starting with `gsk_`. Groq shows it only once, so paste it somewhere safe.

### Step 2: Paste the key into the app

1. Open **[Personal AI](https://adarshjkalathil.github.io/personal-ai/)**. The first time, a short welcome guide opens.
2. Tap **Set up**, paste your key into the box, and wait for **✓ The key works**.
3. Pick the language you mostly speak, tap **Test your microphone** if you like, then **Start using Personal AI**.

Later you can change keys in **⚙️ Settings** (under **More** on a phone, at the top on a computer).

### Step 3: Record

1. Tap **🎙️ Record** and choose your **Spoken language** (for example Hindi or Malayalam). Auto-detect works, but
   picking your language is much more accurate.
2. Tap the big round button.
3. When the browser asks for **microphone permission**, tap **Allow**.
4. Talk! Your words appear on screen after a few seconds.
5. Tap the button again to stop. After a moment, open **💬 Conversations** to see the summary and to-dos.

**That's it.** 🎉

> **No key at all?** In the welcome guide, tap **Try it first without a key** (or later, in **Settings → Transcription →
> Provider**, choose **Browser speech recognition (no key)**). Recording then works in Chrome or Edge with no sign-up. You still need a key for summaries and the Ask feature.

---

## What you can do

| Tab | What it does |
|---|---|
| 🎙️ **Record** | Records and writes down what's said. A pause of a couple of minutes starts a new conversation. You can also upload an audio file (a voice note or meeting recording). |
| 💬 **Conversations** | Each conversation gets a title, a short summary, key points, decisions, who was there, and the mood. Tap **Name speakers** to change “Speaker 1” into a real name. |
| ✨ **Ask** | Ask about anything you've recorded: *“What did I promise to do this week?”* It can also do things: *“Remind me tomorrow at 9 to call the bank.”* |
| ✅ **Tasks** | To-dos found in your conversations, plus your own. Turn on reminders, or add them to your calendar. |
| 🧠 **Memories** (under More on a phone) | Facts it has learned about you, such as people's names, preferences and plans. Delete anything you don't want kept. |
| 📰 **Recap** (under More on a phone) | A summary of any day: highlights, decisions, and what's still open. |

**Voice commands:** while recording, say *“Hey assistant, remind me to buy milk at 6”*. It adds the task and answers out loud.

**Install it like an app:** on your phone, open the menu in Chrome and tap **Add to Home screen**. On iPhone, use the
Share button in Safari, then **Add to Home Screen**.

---

## Better results (optional)

All of these are free. Add the key in **Settings** and choose the provider there. **Tip:** add two keys (for example Groq
and Gemini). When one provider hits its free limit, the app asks whether to use the other one instead.

| If you want… | Use | Get a free key |
|---|---|---|
| Speaker labels (who said what) and better Indian languages | **Google Gemini** (only about 20 requests a day per model) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| The best accuracy for Indian languages | **Sarvam AI** (small free credit, then paid) | [dashboard.sarvam.ai](https://dashboard.sarvam.ai) |
| More AI model choices | **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Another free AI option | **Mistral** | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| Total privacy, nothing leaves your computer | **Ollama** on your own computer, as the *Custom* provider | [ollama.com](https://ollama.com) |

> **About Gemini's free limits:** Google allows about **5 requests a minute and 20 a day for each model**. The app
> paces itself and sends 2–5 minutes of speech per request, so Gemini transcription covers roughly 40–100 minutes of
> talk a day. To make it last: use **Groq for the AI** (summaries and Ask) so all of Gemini's requests go to
> transcription, or pick a *different* Gemini model for each (every model has its own 20). **Settings** shows how many
> you've used today; [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit) shows Google's exact count.

> **Have Google AI Pro, or happy to pay a little?** AI Pro itself doesn't raise these limits, but it includes about
> $10 a month of Google Cloud credit. To use it, open AI Studio, tap **Set up billing** for your key's project, and set
> a **monthly spend cap** on the **Spend** page (or use prepay for a hard stop). Then, in this app's **Settings**, under
> Google Gemini, turn on **Billing is enabled for this key**. The app stops pacing itself and shows text every 10–60
> seconds.

> **Speaking an Indian language?** In **Settings → Transcription → Language**, pick your language instead of
> *Auto-detect*. Accuracy improves.

---

## Common problems

| Problem | Fix |
|---|---|
| The record button is greyed out | You haven't added a key yet. Go to **Settings** and paste your Groq key. |
| “Microphone permission was denied” | Click the 🔒 lock icon next to the web address, allow the **Microphone**, and reload the page. |
| “Rejected the API key” | The key was copied wrong. Copy it again (no spaces) or create a new one. |
| “Free-tier limit” or “daily limit is used up” | Free plans allow only so many requests per minute and per day. Your audio isn't lost: it's saved, and a **Retry** button appears on the Record tab. Wait a minute, or for a daily limit until it resets (Gemini resets at midnight US Pacific time, about 12:30 PM in India, 1:30 PM in winter). Or add a second free key (for example Groq) in Settings, switch to it, and tap **Retry**. |
| Gemini text appears slowly | That's on purpose. Gemini's free plan allows only about 20 requests a day, so the app sends 2–5 minutes of speech at a time. Groq is faster. |
| The text is gibberish or in the wrong language | Choose your **Spoken language** on the Record tab instead of Auto-detect. Groq's Whisper is weak at Malayalam, Tamil, Telugu, Kannada and some other Indian languages. For those, switch transcription to **Google Gemini** or **Sarvam AI** in Settings. |
| Recording stops on my phone | Keep the app open on screen. Phones pause web pages in the background. If the app closes mid-recording, the audio that wasn't written down yet is kept: open the app again and tap **Retry** on the Record tab. |
| “A new version is ready” | Tap **Reload** to get the latest version. Your data isn't affected. |
| Nothing is summarized | Summaries need a key for the AI too. A Groq key covers both. |
| I want my data on another device | **Settings → Your data → Export backup**, then **Import backup** on the other device. |

---

## Privacy, in plain words

- Your recordings, notes and to-dos are saved **only in your browser** on this device. There's no account and no
  company server.
- Only the parts where someone is speaking are sent to the service you picked (for example Groq) to be written down.
  Silence is never sent.
- Your keys are saved only in your browser and sent only to their own service.
- Free plans of some services (Google, Mistral) may use what you send to improve their AI. For complete privacy, use
  Ollama on your own computer.
- **Always tell people when you're recording.** In many places it's required by law.
- Clearing your browser's data deletes your recordings. The app reminds you about once a week to download a backup.
  **Settings → Your data** also shows whether the browser has agreed to keep your data. Installing the app (**Add to Home
  Screen**) usually makes it agree.

---

## For developers

<details>
<summary>Run it on your own computer, project structure, and how it works</summary>

### Run locally

Install [Node.js](https://nodejs.org) 22 or newer, then:

```bash
git clone https://github.com/Adarshjkalathil/personal-ai.git
cd personal-ai
npm install
npm run dev      # open http://localhost:5173
npm test         # unit tests
npm run build    # static site in dist/
```

The microphone only works on `https://` or `localhost`.

### Deploy

Every push to `main` runs the tests and deploys to GitHub Pages (**Settings → Pages → Source: GitHub Actions**).
The deploy step is skipped while the repo is private. `dist/` is a plain static site, so Cloudflare Pages, Netlify or
Vercel also work (build command `npm run build`, output folder `dist`).

### How it works

There's no backend. Every provider accepts direct browser requests (CORS).

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
| `src/lib/storage.ts` | Persistent storage, backup reminders, update check |
| `src/views/WelcomeView.tsx` | First-run guide |

The production build sets a strict Content-Security-Policy and loads no third-party scripts. The conversation fields
and the “discard trivial snippets” rule are modelled on [Omi](https://github.com/BasedHardware/omi) (MIT).

### Known limitations

- Browsers pause background tabs, so recording needs the app on screen (it keeps the screen awake).
- Gemini labels speakers chunk by chunk, so labels can occasionally swap.
- Reminder notifications fire only while the app is open. The .ics export covers the rest.

### Roadmap

- Bluetooth pendant support (Web Bluetooth, Omi-compatible firmware on a ~$25 XIAO nRF52840 Sense)
- Fully on-device transcription in the browser (Whisper via WebGPU)
- Android wrapper for background recording

</details>

---

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE). You're welcome to use the
[hosted app](https://adarshjkalathil.github.io/personal-ai/), but the source code may not be copied or reused without
permission.

Created in [T3 Code](https://t3.codes).
