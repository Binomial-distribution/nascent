/** 通话连续听：浏览器 VAD 切句，PCM 只 POST 到 /v1/speech/transcribe。 */

import { speakDialogue, stopSpeech, unlockSpeechPlayback } from "./scenario-session.js";

export const VAD_DEFAULTS = {
  startRms: 0.025,
  holdRms: 0.014,
  bargeInRms: 0.07,
  bargeGraceMs: 800,
  bargeHoldMs: 220,
  hangoverMs: 480,
  minUtteranceMs: 320,
  maxUtteranceMs: 8000,
};

export function shouldBargeIn(now, rms, { playing = false, playbackStartedAt = 0, loudSince = 0 } = {}, opts = VAD_DEFAULTS) {
  if (!playing) return { bargeIn: false, loudSince: 0 };
  if (now - playbackStartedAt < opts.bargeGraceMs) return { bargeIn: false, loudSince: 0 };
  if (rms < opts.bargeInRms) return { bargeIn: false, loudSince: 0 };
  const started = loudSince || now;
  return { bargeIn: now - started >= opts.bargeHoldMs, loudSince: started };
}

export function createVadState() {
  return {
    speaking: false,
    startedAt: 0,
    silentSince: 0,
    chunks: [],
  };
}

export function frameRms(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function downsample(input, fromRate, toRate) {
  if (!input.length || fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))];
  }
  return out;
}

export function concatFloat32(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function encodeWav(float32, sampleRate) {
  const count = float32.length;
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, count * 2, true);
  let offset = 44;
  for (let i = 0; i < count; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

export function pushVadFrame(state, rms, samples, now, opts = VAD_DEFAULTS) {
  const next = {
    speaking: state.speaking,
    startedAt: state.startedAt,
    silentSince: state.silentSince,
    chunks: state.chunks,
  };
  let utterance = null;
  let bargeIn = false;

  if (!next.speaking && rms >= opts.startRms) {
    next.speaking = true;
    next.startedAt = now;
    next.silentSince = 0;
    next.chunks = [samples];
    bargeIn = true;
    return { state: next, utterance, bargeIn, speaking: true };
  }

  if (!next.speaking) {
    return { state: next, utterance, bargeIn, speaking: false };
  }

  next.chunks = [...next.chunks, samples];
  if (rms >= opts.holdRms) {
    next.silentSince = 0;
  } else if (!next.silentSince) {
    next.silentSince = now;
  }

  const duration = now - next.startedAt;
  const silentFor = next.silentSince ? now - next.silentSince : 0;
  const shouldFlush = duration >= opts.maxUtteranceMs
    || (silentFor >= opts.hangoverMs && duration >= opts.minUtteranceMs);
  if (shouldFlush) {
    utterance = concatFloat32(next.chunks);
    next.speaking = false;
    next.startedAt = 0;
    next.silentSince = 0;
    next.chunks = [];
  }
  return { state: next, utterance, bargeIn: false, speaking: next.speaking };
}

export async function transcribeWav(blob, fetchImpl = globalThis.fetch) {
  const body = new FormData();
  body.append("file", blob, "utterance.wav");
  const response = await fetchImpl("/v1/speech/transcribe", { method: "POST", body });
  if (!response.ok) throw new Error("transcribe failed");
  const json = await response.json();
  const text = String(json?.text || "").trim();
  if (!text) throw new Error("empty transcript");
  return text;
}

export function createLiveCall({
  onUtterance,
  onStatus,
  onError,
  onPlayback,
  fetchImpl = globalThis.fetch,
} = {}) {
  let closed = false;
  let playing = false;
  let busy = false;
  let playbackStartedAt = 0;
  let bargeLoudSince = 0;
  let vad = createVadState();
  let context = null;
  let stream = null;
  let processor = null;
  let source = null;
  const targetRate = 16000;

  function setStatus(status) {
    if (!closed) onStatus?.(status);
  }

  function stopPlayback() {
    playing = false;
    playbackStartedAt = 0;
    bargeLoudSince = 0;
    onPlayback?.(false);
    stopSpeech();
  }

  async function playReply(text) {
    if (!text || closed) return;
    stopPlayback();
    setStatus("speaking");
    playing = true;
    playbackStartedAt = Date.now();
    bargeLoudSince = 0;
    onPlayback?.(true);
    try {
      const result = await speakDialogue(text, {
        fetchImpl,
        onStart() { playbackStartedAt = Date.now(); },
      });
      if (!result?.played && !result?.interrupted && !closed) {
        onError?.("这次没播出声音，看字幕就好");
      }
    } finally {
      playing = false;
      playbackStartedAt = 0;
      bargeLoudSince = 0;
      onPlayback?.(false);
      if (!closed) setStatus("listening");
    }
  }

  async function handleUtterance(samples, sampleRate) {
    if (busy || closed) return;
    busy = true;
    setStatus("thinking");
    try {
      const pcm = downsample(samples, sampleRate, targetRate);
      const blob = encodeWav(pcm, targetRate);
      const text = await transcribeWav(blob, fetchImpl);
      if (closed) return;
      const reply = await onUtterance?.(text);
      if (reply) await playReply(reply);
      else if (!closed) setStatus("listening");
    } catch {
      onError?.("没听清，再说一次就好");
      if (!closed) setStatus("listening");
    } finally {
      busy = false;
    }
  }

  function onAudio(event) {
    if (closed) return;
    const samples = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(samples);
    const rms = frameRms(copy);
    const now = Date.now();
    const barge = shouldBargeIn(now, rms, { playing, playbackStartedAt, loudSince: bargeLoudSince });
    bargeLoudSince = barge.loudSince;
    if (barge.bargeIn) {
      stopPlayback();
      vad = createVadState();
      setStatus("listening");
    }
    if (playing || busy) return;
    const wasSpeaking = vad.speaking;
    const result = pushVadFrame(vad, rms, copy, now);
    vad = result.state;
    if (result.speaking && !wasSpeaking) setStatus("hearing");
    if (result.utterance) {
      handleUtterance(result.utterance, event.inputBuffer.sampleRate);
    }
  }

  async function start() {
    if (closed) return;
    setStatus("listening");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (closed) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      return;
    }
    await unlockSpeechPlayback();
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = onAudio;
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    if (context.state === "suspended") await context.resume();
  }

  function stop() {
    closed = true;
    stopPlayback();
    try { processor?.disconnect(); } catch { /* ignore */ }
    try { source?.disconnect(); } catch { /* ignore */ }
    try { context?.close(); } catch { /* ignore */ }
    stream?.getTracks().forEach((track) => track.stop());
    processor = null;
    source = null;
    context = null;
    stream = null;
  }

  return { start, stop, playReply };
}

export function createHoldMic({
  onText,
  onError,
  onListening,
  fetchImpl = globalThis.fetch,
} = {}) {
  let session = 0;
  let context = null;
  let stream = null;
  let processor = null;
  let source = null;
  let chunks = [];
  let sampleRate = 16000;
  const targetRate = 16000;

  function cleanup() {
    try { processor?.disconnect(); } catch { /* ignore */ }
    try { source?.disconnect(); } catch { /* ignore */ }
    try { context?.close(); } catch { /* ignore */ }
    stream?.getTracks().forEach((track) => track.stop());
    processor = null;
    source = null;
    context = null;
    stream = null;
    chunks = [];
  }

  async function start() {
    const mine = ++session;
    cleanup();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (mine !== session) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(2048, 1, 1);
    sampleRate = context.sampleRate;
    processor.onaudioprocess = (event) => {
      if (mine !== session) return;
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    if (context.state === "suspended") await context.resume();
    if (mine !== session) {
      cleanup();
      return;
    }
    onListening?.(true);
  }

  async function stop() {
    const mine = session;
    session += 1;
    onListening?.(false);
    const captured = chunks;
    const rate = sampleRate;
    cleanup();
    if (!captured.length) return;
    try {
      const pcm = downsample(concatFloat32(captured), rate, targetRate);
      if (pcm.length < targetRate * 0.25) throw new Error("empty transcript");
      const text = await transcribeWav(encodeWav(pcm, targetRate), fetchImpl);
      if (mine + 1 !== session) return;
      await onText?.(text);
    } catch {
      onError?.("没听清，再说一次就好");
    }
  }

  function cancel() {
    session += 1;
    onListening?.(false);
    cleanup();
  }

  return { start, stop, cancel };
}
