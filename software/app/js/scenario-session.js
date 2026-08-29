/** 情景漫游会话：头像压缩、通话后的 9B 文字回合。麦克风 PCM 只走 /v1/speech；传感只发脱敏趋势。 */

import { personaPayload, speakOptionsForPersona, TTS_STYLE_TO_EMOTION, normalizeTtsStyle, cardForPersona } from "./persona-cards.js";
import { heartRate as defaultHeartRate } from "./hr.js";

export const THREAD_KEY = "nascent.scenario.threads";
export const DEMO_USER_ID = "local-demo";
const THREAD_KEEP = 40;
export const TURN_SEND = 12;
export const SUMMARY_DIALOGUE_MAX = 1600;
export const SUMMARY_TOTAL_MAX = 2000;

/** 进入情景聊天时：无记录直接打开；已勾选不再询问则套用上次选择；否则弹窗。 */
export function chatRestoreDecision({
  hasHistory = false,
  skipAsk = false,
  lastChoice = "restore",
  askedOnce = false,
} = {}) {
  const last = lastChoice === "fresh" ? "fresh" : "restore";
  if (!hasHistory) return { kind: "open", showNeverAsk: false };
  if (skipAsk) return { kind: last, showNeverAsk: false };
  return { kind: "ask", showNeverAsk: Boolean(askedOnce) };
}

const MAX_AVATAR_PX = 192;
const MAX_AVATAR_CHARS = 120_000;

export const EXPERIENCE_PHASES = ["approaching", "rising", "climax_window", "aftercare"];

/** 与人设文档示例对齐：C2 日常 → C3 暧昧（玩具启动）→ C4 正式使用 → 事后 */
export const PHASE_UI = {
  approaching: {
    label: "C2 日常",
    goal: "日常陪伴：生活锚点、短句、笨拙直白；不要主动把闲聊推向亲密。",
  },
  rising: {
    label: "C3 暧昧",
    goal: "已检测到玩具启动：可逐渐暧昧、含蓄确认，仍听她的节奏。",
  },
  climax_window: {
    label: "C4 亲密",
    goal: "她开口说接近、要到了、更近时才跟着走完，不要替她宣布。",
  },
  aftercare: {
    label: "事后",
    goal: "放慢、陪着、问要不要靠着或歇一会儿。",
  },
};

const pressWindow = [];
const tempWindow = [];

export function resetSensorWindow() {
  pressWindow.length = 0;
  tempWindow.length = 0;
}

export function ingestUplinkSample(uplink) {
  if (!uplink) return;
  const press = meanPress(uplink);
  if (press != null) {
    pressWindow.push(press);
    if (pressWindow.length > 8) pressWindow.shift();
  }
  const temp = contactOrEnvTemp(uplink);
  if (temp != null) {
    tempWindow.push(temp);
    if (tempWindow.length > 6) tempWindow.shift();
  }
}

export function buildSensorContext(uplink, { bandConnected = false, heartRate = defaultHeartRate } = {}) {
  const connected = Boolean(uplink);
  const temp = contactOrEnvTemp(uplink);
  const hasContact = uplink?.tempA != null && Number.isFinite(Number(uplink.tempA));
  const hr = heartRate.sensorFields({ bandConnected });
  return {
    temperature_state: temperatureState(temp),
    temperature_quality: !connected || temp == null ? "unknown" : hasContact ? "valid" : "partial",
    temperature_source: hasContact ? "contact" : temp != null ? "environment" : "none",
    pressure_rhythm: pressureRhythm(),
    pressure_quality: pressWindow.length >= 3 ? "partial" : connected ? "unknown" : "unknown",
    hr_trend: hr.hr_trend,
    hr_quality: hr.hr_quality,
    hr_source: hr.hr_source,
    insert_state: uplink?.insertState || "unknown",
    current_level: Number.isFinite(Number(uplink?.level)) ? Number(uplink.level) : 0,
    data_age_ms: connected && uplink?.ts != null ? 0 : null,
  };
}

/** 小玩具是否已启动（人设 C2→C3 门槛）。 */
export function toySessionStarted(sensor = {}) {
  const level = Number(sensor.current_level);
  if (Number.isFinite(level) && level >= 1) return true;
  const insert = String(sensor.insert_state || "").toLowerCase();
  if (insert === "inserted" || insert === "contact" || insert === "in") return true;
  return false;
}

export function nextExperiencePhase(phase, { sceneCtrl = "stay", userText = "", sensor = {} } = {}) {
  const current = EXPERIENCE_PHASES.includes(phase) ? phase : "approaching";
  const text = String(userText || "");
  if (/事后|抚慰|抱抱|歇|休息|累了|够了|结束吧|想停|不要了|结束/.test(text)) return "aftercare";
  if (sceneCtrl === "end") return "aftercare";
  // 高潮窗口只能由用户自己的话打开，不能靠传感器或模型的 next。
  if (userOpenedClimaxWindow(text) && current !== "aftercare") return "climax_window";
  // C2→C3：只有检测到玩具启动才进入暧昧期；闲聊与 scene_ctrl=next 都不能提前跳。
  if (current === "approaching" && toySessionStarted(sensor)) return "rising";
  return current;
}

function userOpenedClimaxWindow(text) {
  const t = String(text || "");
  if (/高潮|要到了|快到了|要去了|快去了/.test(t)) return true;
  if (/(不[想要]|别|没).{0,6}更近/.test(t)) return false;
  if (/想更近|再更近|更近[一一点些]|再近一点/.test(t)) return true;
  return false;
}

export async function fileToAvatarDataUrl(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_AVATAR_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > MAX_AVATAR_CHARS) {
    throw new Error("头像太大，请换一张更小的图");
  }
  return dataUrl;
}

export function personaAvatarHtml(persona, className = "avatar") {
  const name = persona?.name || "人";
  const initial = escapeHtml(String(name).slice(0, 1) || "人");
  if (persona?.avatar) {
    return `<span class="${className} has-photo"><img src="${escapeAttr(persona.avatar)}" alt=""></span>`;
  }
  return `<span class="${className}">${initial}</span>`;
}

export function speechRecognitionSupported() {
  return Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
}

let speechToken = 0;
let currentAudio = null;
let currentSource = null;
let playbackCtx = null;
let ringTimer = null;

function stopBufferSource() {
  if (!currentSource) return;
  try { currentSource.stop(); } catch { /* ignore */ }
  currentSource = null;
}

export function stopSpeech() {
  speechToken += 1;
  try {
    globalThis.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  stopBufferSource();
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio.src = "";
    currentAudio = null;
  }
}

export function stopRingtone() {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
}

function playRingBurst(ctx) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.03);
  gain.gain.setValueAtTime(0.07, now + 1.85);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 2);
  gain.connect(ctx.destination);
  for (const freq of [440, 480]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 2);
  }
}

export async function startRingtone() {
  stopRingtone();
  const ctx = await unlockSpeechPlayback();
  if (!ctx) return;
  playRingBurst(ctx);
  ringTimer = globalThis.setInterval(() => {
    if (ctx.state === "closed") {
      stopRingtone();
      return;
    }
    playRingBurst(ctx);
  }, 6000);
}

export function formatCaptionHtml(text) {
  const raw = String(text || "");
  const aside = /（[^）]{0,80}）|\([^)]{0,80}\)/g;
  let html = "";
  let last = 0;
  let match = aside.exec(raw);
  while (match) {
    if (match.index > last) html += escapeHtml(raw.slice(last, match.index));
    html += `<span class="aside">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
    match = aside.exec(raw);
  }
  if (last < raw.length) html += escapeHtml(raw.slice(last));
  return html;
}

export async function unlockSpeechPlayback() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  if (!playbackCtx || playbackCtx.state === "closed") playbackCtx = new AC();
  if (playbackCtx.state === "suspended") {
    try { await playbackCtx.resume(); } catch { /* ignore */ }
  }
  return playbackCtx;
}

export async function speakUtterance(text, fetchImpl = globalThis.fetch, tts = {}) {
  const clipped = String(text || "").trim().slice(0, 500);
  if (!clipped) throw new Error("empty tts text");
  const body = { text: clipped };
  const voice = String(tts?.voice || "").trim().slice(0, 256);
  const fallbackVoice = String(tts?.fallbackVoice || "").trim().slice(0, 256);
  const emotion = String(tts?.emotion || "").trim().slice(0, 32);
  if (voice) body.voice = voice;
  if (fallbackVoice) body.fallback_voice = fallbackVoice;
  if (emotion) body.emotion = emotion;
  const ttsStyle = String(tts?.tts_style || "").trim().slice(0, 16);
  const provider = String(tts?.provider || "").trim().slice(0, 16);
  if (ttsStyle) body.tts_style = ttsStyle;
  if (provider === "minimax" || provider === "mimo") body.provider = provider;
  const response = await fetchImpl("/v1/speech/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("speak failed");
  const blob = await response.blob();
  const type = String(blob.type || "");
  if (!blob.size || type.includes("json")) throw new Error("speak failed");
  return blob;
}

async function playThroughContext(blob, token, ctx, onStart) {
  const raw = await blob.arrayBuffer();
  if (token !== speechToken) return false;
  const decoded = await ctx.decodeAudioData(raw.slice(0));
  if (token !== speechToken) return false;
  await new Promise((resolve, reject) => {
    const source = ctx.createBufferSource();
    currentSource = source;
    source.buffer = decoded;
    source.connect(ctx.destination);
    source.onended = () => {
      if (currentSource === source) currentSource = null;
      resolve();
    };
    try {
      onStart?.();
      source.start();
    } catch (error) {
      currentSource = null;
      reject(error);
    }
  });
  return token === speechToken;
}

async function playThroughElement(blob, token, onStart) {
  const url = URL.createObjectURL(blob);
  currentAudio = new Audio(url);
  currentAudio.setAttribute("playsinline", "");
  try {
    await new Promise((resolve, reject) => {
      currentAudio.onended = resolve;
      currentAudio.onerror = () => reject(new Error("play failed"));
      onStart?.();
      currentAudio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
    if (currentAudio) currentAudio = null;
  }
  return token === speechToken;
}

export async function speakDialogue(text, {
  fetchImpl = globalThis.fetch,
  onStart,
  voice = "",
  fallbackVoice = "",
  emotion = "",
  tts_style = "",
  provider = "",
  persona = null,
} = {}) {
  const clipped = String(text || "").trim();
  if (!clipped) return { played: false, interrupted: false };
  stopSpeech();
  const token = speechToken;
  const style = tts_style ? normalizeTtsStyle(tts_style) : "";
  const tts = {
    ...(persona ? speakOptionsForPersona(persona, { provider }) : { voice, fallbackVoice, emotion, provider }),
    ...(style ? { tts_style: style, emotion: TTS_STYLE_TO_EMOTION[style] || "calm" } : {}),
    ...(provider ? { provider } : {}),
  };
  try {
    const blob = await speakUtterance(clipped, fetchImpl, tts);
    if (token !== speechToken) return { played: false, interrupted: true };
    const ctx = await unlockSpeechPlayback();
    if (ctx) {
      try {
        const played = await playThroughContext(blob, token, ctx, onStart);
        return { played, interrupted: !played && token !== speechToken };
      } catch {
        if (token !== speechToken) return { played: false, interrupted: true };
      }
    }
    if (token !== speechToken) return { played: false, interrupted: true };
    const played = await playThroughElement(blob, token, onStart);
    return { played, interrupted: !played && token !== speechToken };
  } catch {
    return { played: false, interrupted: token !== speechToken };
  }
}

export class ScenarioChatState {
  constructor({ fetchImpl = globalThis.fetch, storage = globalThis.localStorage } = {}) {
    this._fetch = fetchImpl;
    this._storage = storage;
    this._threads = new Map();
    this._phases = new Map();
    this.sending = false;
    this._hydrate();
  }

  phase(personaKey) {
    return this._phases.get(personaKey) || "approaching";
  }

  setPhase(personaKey, phase) {
    this._phases.set(personaKey, EXPERIENCE_PHASES.includes(phase) ? phase : "approaching");
    this._persist();
  }

  messages(personaKey) {
    return [...(this._threads.get(personaKey) || [])];
  }

  ensureOpening(personaKey, text) {
    const items = this._threads.get(personaKey) || [];
    const opening = String(text || "").trim();
    if (items.length || !opening) return false;
    this._threads.set(personaKey, [{
      role: "assistant",
      text: opening,
      phase: this.phase(personaKey),
    }]);
    this._persist();
    return true;
  }

  async confirmMemory(persona, messageIndex, proposalIndex) {
    const items = this._threads.get(persona.key) || [];
    const proposal = items[messageIndex]?.proposals?.[proposalIndex];
    if (!proposal || proposal.status !== "pending") return false;
    const personaId = String(persona.id || persona.key || "scenario").slice(0, 128);
    if (this._fetch) {
      const response = await this._fetch("/v1/agent/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: DEMO_USER_ID,
          persona_id: personaId,
          text: String(proposal.text || "").slice(0, 240),
        }),
      });
      if (!response.ok) throw new Error("memory write failed");
    }
    proposal.status = "kept";
    this._persist();
    return true;
  }

  skipMemory(persona, messageIndex, proposalIndex) {
    const items = this._threads.get(persona.key) || [];
    const proposal = items[messageIndex]?.proposals?.[proposalIndex];
    if (!proposal || proposal.status !== "pending") return false;
    proposal.status = "skipped";
    this._persist();
    return true;
  }

  async forgetMemories(persona) {
    const personaId = String(persona.id || persona.key || "scenario").slice(0, 128);
    if (this._fetch) {
      const response = await this._fetch(
        `/v1/agent/memory?user_id=${encodeURIComponent(DEMO_USER_ID)}&persona_id=${encodeURIComponent(personaId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("memory delete failed");
    }
    const key = persona.key;
    const items = this._threads.get(key) || [];
    this._threads.set(key, items.map((item) => {
      if (item?.role !== "assistant" || !item.proposals?.length) return item;
      return {
        ...item,
        proposals: item.proposals.map((proposal) => ({ ...proposal, status: "skipped" })),
      };
    }));
    this._persist();
    return true;
  }

  clear(personaKey) {
    this._threads.delete(personaKey);
    this._phases.delete(personaKey);
    this._persist();
  }

  clearAll() {
    this._threads.clear();
    this._phases.clear();
    this._persist();
  }

  async send(persona, text, extras = {}) {
    const trimmed = String(text || "").trim();
    if (!trimmed || this.sending) return null;
    const key = persona.key;
    const items = this._threads.get(key) || [];
    items.push({ role: "user", text: trimmed });
    this._threads.set(key, items.slice(-THREAD_KEEP));
    this.sending = true;
    const phase = this.phase(key);
    try {
      const turn = await this._requestTurn(persona, trimmed, this._threads.get(key) || items, extras, phase);
      const next = nextExperiencePhase(phase, {
        sceneCtrl: turn.scene_ctrl,
        userText: trimmed,
        sensor: extras.sensor_context || {},
      });
      this.setPhase(key, next);
      const thread = this._threads.get(key) || items;
      thread.push({
        role: "assistant",
        text: turn.dialogue,
        sceneCtrl: turn.scene_ctrl,
        phase: next,
        proposals: turn.memory_proposals || [],
      });
      this._threads.set(key, thread.slice(-THREAD_KEEP));
      this._persist();
      return {
        dialogue: turn.dialogue,
        sceneCtrl: turn.scene_ctrl,
        phase: next,
        tts_style: turn.tts_style || stubTtsStyle(trimmed, next),
        memory_proposals: turn.memory_proposals || [],
        stub: Boolean(turn.stub),
      };
    } finally {
      this.sending = false;
    }
  }

  async _requestTurn(persona, text, items, extras, phase) {
    const recent = items.slice(-TURN_SEND).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.text,
    }));
    const sensor = extras.sensor_context || {};
    const payload = {
      user_id: DEMO_USER_ID,
      persona_id: String(persona.id || persona.key || "scenario").slice(0, 128),
      persona: personaPayload(persona),
      session_mode: "scenario",
      scene_id: phase,
      session_state: phase === "aftercare" ? "running" : "running",
      memory_policy: "ask_each_time",
      consent_state: "confirmed",
      sensor_context: sensor,
      conversation_summary: buildConversationSummary(items, phase, sensor),
      user_input: text.slice(0, 2000),
      recent_turns: recent,
    };
    if (!this._fetch) {
      return { ...stubTurn(persona, text, phase), stub: true };
    }
    try {
      const response = await this._fetch("/v1/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        return { ...stubTurn(persona, text, phase), stub: true };
      }
      const body = await response.json();
      const dialogue = String(body?.dialogue || "").trim();
      const proposals = normalizeMemoryProposals(body?.memory_proposals);
      if (!dialogue) {
        return { ...stubTurn(persona, text, phase), stub: true };
      }
      const isStub = body?.fallback === "stub" || body?.stub === true;
      return {
        dialogue,
        scene_ctrl: ["stay", "next", "end"].includes(body?.scene_ctrl) ? body.scene_ctrl : "stay",
        tts_style: body?.tts_style ? normalizeTtsStyle(body.tts_style) : stubTtsStyle(text, phase),
        memory_proposals: proposals,
        stub: isStub,
      };
    } catch {
      return { ...stubTurn(persona, text, phase), stub: true };
    }
  }

  _hydrate() {
    const raw = this._readStore();
    const threads = raw.threads || {};
    const phases = raw.phases || {};
    for (const [key, items] of Object.entries(threads)) {
      if (!Array.isArray(items)) continue;
      this._threads.set(key, items.slice(-THREAD_KEEP).map((item) => {
        if (!item || item.role !== "assistant" || !item.proposals) return item;
        return { ...item, proposals: normalizeMemoryProposals(item.proposals) };
      }));
    }
    for (const [key, phase] of Object.entries(phases)) {
      if (EXPERIENCE_PHASES.includes(phase)) this._phases.set(key, phase);
    }
  }

  _persist() {
    if (!this._storage) return;
    const threads = {};
    for (const [key, items] of this._threads) threads[key] = items.slice(-THREAD_KEEP);
    const phases = Object.fromEntries(this._phases);
    try {
      this._storage.setItem(THREAD_KEY, JSON.stringify({ threads, phases }));
    } catch {
      /* ignore quota */
    }
  }

  _readStore() {
    try {
      return JSON.parse(this._storage?.getItem(THREAD_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }
}

export const scenarioChat = new ScenarioChatState();

export function createHoldRecognizer({ onText, onError, onEnd } = {}) {
  const Speech = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Speech) return null;
  const rec = new Speech();
  rec.lang = "zh-CN";
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = (event) => {
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i];
      if (piece.isFinal) finalText += piece[0]?.transcript || "";
    }
    const trimmed = finalText.trim();
    if (trimmed) onText?.(trimmed);
  };
  rec.onerror = () => onError?.();
  rec.onend = () => onEnd?.();
  return rec;
}

export function experienceSummary(phase, sensor) {
  const meta = PHASE_UI[phase] || PHASE_UI.approaching;
  const toyOn = toySessionStarted(sensor);
  return [
    `人设阶段：${meta.label}。${meta.goal}`,
    toyOn
      ? "已检测到玩具启动（可进入 C3 暧昧语气），仍按宏观趋势反应，禁止念传感器字段名。"
      : "玩具未启动：保持 C2 日常交流，禁止主动把对话推向亲密或暧昧。",
    "传感器只是背景，不要在台词里汇报。",
    `温感 ${sensor.temperature_state || "unknown"}，压力 ${sensor.pressure_rhythm || "unknown"}，心率 ${sensor.hr_trend || "unknown"}，档位 ${sensor.current_level ?? 0}。`,
    phase === "aftercare" ? "这一段放慢陪伴，不要再往高潮推。" : "",
  ].filter(Boolean).join(" ");
}

export function foldOldTurns(items, keep = TURN_SEND) {
  const older = Array.isArray(items) ? items.slice(0, Math.max(0, items.length - keep)) : [];
  if (!older.length) return "";
  const lines = older.map((item) => {
    const who = item?.role === "assistant" ? "他" : "她";
    const text = String(item?.text || "").replace(/\s+/g, " ").trim();
    return text ? `${who}：${text}` : "";
  }).filter(Boolean);
  if (!lines.length) return "";
  let text = `更早的对话：${lines.join(" / ")}`;
  if (text.length > SUMMARY_DIALOGUE_MAX) {
    text = `${text.slice(0, SUMMARY_DIALOGUE_MAX - 1)}…`;
  }
  return text;
}

export function buildConversationSummary(items, phase, sensor) {
  const folded = foldOldTurns(items, TURN_SEND);
  const experience = experienceSummary(phase, sensor);
  return [folded, experience].filter(Boolean).join("\n").slice(0, SUMMARY_TOTAL_MAX);
}

export function normalizeMemoryProposals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      text: String(item?.text || "").trim().slice(0, 240),
      reason: String(item?.reason || "").trim().slice(0, 120),
      status: item?.status === "kept" || item?.status === "skipped" ? item.status : "pending",
    }))
    .filter((item) => item.text);
}

function stubMemoryProposals(text) {
  const clipped = String(text || "").replace(/\s+/g, " ").trim();
  if (!/(记住|我喜欢|我不喜欢|以后别|下次不要|以后不要)/.test(clipped)) return [];
  return [{
    text: clipped.slice(0, 80) || "她说的这件事",
    reason: "她说了想记住的偏好",
    status: "pending",
  }];
}

function stubTurn(persona, text, phase) {
  return {
    dialogue: stubDialogue(persona, text, phase),
    scene_ctrl: stubSceneCtrl(text, phase),
    tts_style: stubTtsStyle(text, phase),
    memory_proposals: stubMemoryProposals(text),
  };
}

function stubDialogue(persona, text, phase) {
  const card = cardForPersona(persona);
  const name = card.assistant_name || persona?.name || "Natsu";
  if (phase === "aftercare" || /事后|抚慰|抱抱|歇|休息|累了/.test(text)) {
    return "嗯，我在。你先歇着就好。";
  }
  if (/停|慢|等/.test(text)) {
    return "好好，先这样。";
  }
  if (phase === "rising" || phase === "climax_window" || /高潮|要到了|快到了/.test(text)) {
    return "我听你的。";
  }
  // 本地/无 LLM：极简回应，禁止旧版亲密套话，也不要重复开场 spoken
  return `${name}在。`;
}

function stubTtsStyle(text, phase) {
  if (phase === "aftercare" || /事后|抚慰|抱抱|歇|休息|累了/.test(text)) return "温柔";
  if (/高潮|要到了|快到了|要去了/.test(text)) return "着急";
  if (phase === "rising") return "俏皮";
  return "平静";
}

function stubSceneCtrl(text, phase) {
  if (/事后|抚慰|抱抱|歇|休息|累了|够了|结束/.test(text) || phase === "aftercare") return "end";
  // 本地 stub 永不自行推进 C2→C3；阶段只由 toySessionStarted 决定
  return "stay";
}

function meanPress(uplink) {
  const left = Number(uplink.pressL);
  const right = Number(uplink.pressR);
  const values = [left, right].filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return mean > 1 ? mean / 4095 : mean;
}

function contactOrEnvTemp(uplink) {
  const contact = Number(uplink?.tempA);
  if (Number.isFinite(contact)) return contact;
  const env = Number(uplink?.envTemp);
  return Number.isFinite(env) ? env : null;
}

function temperatureState(temp) {
  if (temp == null) return "unknown";
  if (temp < 18) return "too_cold";
  if (temp < 24) return "warming";
  if (temp < 28) return "reaching_comfort";
  return "comfortable";
}

function pressureRhythm() {
  if (pressWindow.length < 3) return "unknown";
  const first = pressWindow[0];
  const last = pressWindow[pressWindow.length - 1];
  const delta = last - first;
  if (delta > 0.08) return "increasing";
  if (delta < -0.08) return "decreasing";
  return "steady";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#039;");
}
