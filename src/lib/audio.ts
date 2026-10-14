// Audio capture and speech chunking.
//
// Audio is resampled to 16 kHz mono. A simple energy-based voice detector cuts
// it into speech chunks at natural pauses, and silence is never uploaded. That
// keeps free-tier quotas going further and every chunk under the ~30 s
// limit of the strictest provider (Sarvam).

export const SAMPLE_RATE = 16_000;

const FRAME = 480; // 30 ms at 16 kHz
const FRAME_MS = 30;
const PRE_ROLL_FRAMES = 10; // keep 300 ms before speech starts
const HANGOVER_MS = 300; // treat brief dips as continued speech
const MIN_CHUNK_MS = 5_000; // prefer pauses after this length
const PAUSE_MS = 700; // a pause this long ends a chunk (once past MIN_CHUNK_MS)
const LONG_PAUSE_MS = 1_800; // always end a chunk after this much silence
const MAX_CHUNK_MS = 25_000;
const MIN_VOICED_MS = 600; // drop chunks with less speech than this (coughs, clicks)

export interface SpeechChunk {
  /** Epoch ms of the first sample. */
  start: number;
  samples: Float32Array;
  durationMs: number;
}

/** Splits a 16 kHz stream into speech chunks. */
export class Chunker {
  private noiseFloor = 0.003;
  private speakingUntil = 0;
  private preRoll: Float32Array[] = [];
  private chunk: Float32Array[] = [];
  private inChunk = false;
  private chunkStart = 0;
  private chunkMs = 0;
  private voicedMs = 0;
  private silenceMs = 0;
  private pending = new Float32Array(0);
  private clock = 0;

  /** Loudness of the latest frame (0..1), for a level meter. */
  level = 0;
  /** Epoch ms of the most recent detected speech. */
  lastSpeechAt = 0;

  constructor(
    private onChunk: (chunk: SpeechChunk) => void,
    startTime = Date.now(),
  ) {
    this.clock = startTime;
  }

  push(samples: Float32Array): void {
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    let offset = 0;
    for (; offset + FRAME <= joined.length; offset += FRAME) this.frame(joined.slice(offset, offset + FRAME));
    this.pending = joined.slice(offset);
  }

  flush(): void {
    if (this.inChunk) this.emit();
  }

  private frame(frame: Float32Array): void {
    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    const rms = Math.sqrt(sum / frame.length);
    this.level = Math.min(1, rms * 8);

    // Speech is anything clearly above the slowly-tracked background noise.
    const loud = rms > Math.max(0.006, this.noiseFloor * 3);
    if (loud) {
      this.speakingUntil = this.clock + HANGOVER_MS;
      this.lastSpeechAt = this.clock;
    } else {
      this.noiseFloor = this.noiseFloor * 0.99 + rms * 0.01;
    }
    const speaking = this.clock < this.speakingUntil;

    if (!this.inChunk) {
      if (speaking) {
        this.inChunk = true;
        this.chunkStart = this.clock - this.preRoll.length * FRAME_MS;
        this.chunk = [...this.preRoll];
        this.chunkMs = this.preRoll.length * FRAME_MS;
        this.voicedMs = 0;
        this.silenceMs = 0;
        this.preRoll = [];
      } else {
        this.preRoll.push(frame);
        if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
      }
    }

    if (this.inChunk) {
      this.chunk.push(frame);
      this.chunkMs += FRAME_MS;
      if (loud) this.voicedMs += FRAME_MS;
      this.silenceMs = speaking ? 0 : this.silenceMs + FRAME_MS;
      if (
        this.chunkMs + FRAME_MS > MAX_CHUNK_MS ||
        this.silenceMs >= LONG_PAUSE_MS ||
        (this.chunkMs >= MIN_CHUNK_MS && this.silenceMs >= PAUSE_MS)
      ) {
        this.emit();
      }
    }

    this.clock += FRAME_MS;
  }

  private emit(): void {
    // Trim trailing silence, keeping a short tail so words aren't clipped.
    const trailing = Math.max(0, Math.floor((this.silenceMs - HANGOVER_MS) / FRAME_MS));
    const frames = this.chunk.slice(0, this.chunk.length - trailing);
    const voiced = this.voicedMs;
    const start = this.chunkStart;
    this.chunk = [];
    this.inChunk = false;
    this.chunkMs = 0;
    this.silenceMs = 0;
    if (voiced < MIN_VOICED_MS) return;

    const samples = new Float32Array(frames.length * FRAME);
    frames.forEach((f, i) => samples.set(f, i * FRAME));
    this.onChunk({ start, samples, durationMs: frames.length * FRAME_MS });
  }
}

/** Streaming linear resampler (input rate → 16 kHz). Good enough for speech after the browser's own filtering. */
class Resampler {
  private position = 0;
  private last = 0;

  constructor(private ratio: number) {}

  process(input: Float32Array): Float32Array {
    const output: number[] = [];
    while (this.position < input.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const a = index === 0 ? this.last : input[index - 1];
      const b = input[index];
      output.push(a + (b - a) * fraction);
      this.position += this.ratio;
    }
    this.position -= input.length;
    this.last = input[input.length - 1] ?? this.last;
    return Float32Array.from(output);
  }
}

export class MicCapture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  readonly chunker: Chunker;

  constructor(onChunk: (chunk: SpeechChunk) => void) {
    this.chunker = new Chunker(onChunk);
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.context = new AudioContext();
    await this.context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'capture-processor');
    const resampler = new Resampler(this.context.sampleRate / SAMPLE_RATE);
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => this.chunker.push(resampler.process(event.data));
    source.connect(this.node);
  }

  async stop(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.chunker.flush();
  }
}

/** Decodes an audio/video file and splits it into speech chunks, timestamped from `startTime`. */
export async function chunkFile(file: File, startTime: number): Promise<SpeechChunk[]> {
  const decoder = new AudioContext();
  const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
  await decoder.close();

  // OfflineAudioContext mixes to mono and resamples to 16 kHz with proper filtering.
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const chunks: SpeechChunk[] = [];
  const chunker = new Chunker((chunk) => chunks.push(chunk), startTime);
  chunker.push(rendered.getChannelData(0));
  chunker.flush();
  return chunks;
}

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}
