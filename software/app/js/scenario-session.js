/** 情景漫游会话：头像压缩、通话后的 9B 文字回合。麦克风 PCM 只走 /v1/speech；传感只发脱敏趋势。 */

const MAX_AVATAR_PX = 192;
const MAX_AVATAR_CHARS = 120_000;

export const EXPERIENCE_PHASES = ["approaching", "rising", "climax_window", "aftercare"];

export const PHASE_UI = {
  approaching: { label: "慢慢靠近", goal: "先确认节奏和边界，不催促，让用户决定要不要更近。" },
  rising: { label: "一起往前", goal: "跟着用户更投入，持续确认快慢，不要替用户宣布高潮。" },
  climax_window: { label: "高潮窗口", goal: "用户说接近或想要高潮时陪着走完，快慢仍由用户决定。" },
  aftercare: { label: "事后抚慰", goal: "放慢、陪伴、询问身体感受，像完整亲密之后那样安顿；不要再往高潮推。" },
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

export function buildSensorContext(uplink, { bandConnected = false } = {}) {
  const connected = Boolean(uplink);
  const temp = contactOrEnvTemp(uplink);
  const hasContact = uplink?.tempA != null && Number.isFinite(Number(uplink.tempA));
  return {
    temperature_state: temperatureState(temp),
    temperature_quality: !connected || temp == null ? "unknown" : hasContact ? "valid" : "partial",
    temperature_source: hasContact ? "contact" : temp != null ? "environment" : "none",
    pressure_rhythm: pressureRhythm(),
    pressure_quality: pressWindow.length >= 3 ? "partial" : connected ? "unknown" : "unknown",
    hr_trend: "unknown",
    hr_quality: bandConnected ? "unknown" : "unknown",
    hr_source: bandConnected ? "wearable_connected_no_health_connect" : "none",
    insert_state: uplink?.insertState || "unknown",
    current_level: Number.isFinite(Number(uplink?.level)) ? Number(uplink.level) : 0,
    data_age_ms: connected && uplink?.ts != null ? 0 : null,
  };
}

export function nextExperiencePhase(phase, { sceneCtrl = "stay", userText = "" } = {}) {
  const current = EXPERIENCE_PHASES.includes(phase) ? phase : "approaching";
  const text = String(userText || "");
  if (/事后|抚慰|抱抱|歇|休息|累了|够了|结束吧|想停|不要了/.test(text)) return "aftercare";
  if (/高潮|要到了|快到了|去了|到了/.test(text) && current !== "aftercare") return "climax_window";
  if (sceneCtrl === "end") return "aftercare";
  if (sceneCtrl !== "next") return current;
  const index = EXPERIENCE_PHASES.indexOf(current);
  return EXPERIENCE_PHASES[Math.min(index + 1, EXPERIENCE_PHASES.length - 1)];
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

export function stopSpeech() {
  speechToken += 1;
  try {
    globalThis.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio.src = "";
    currentAudio = null;
  }
}

export async function speakUtterance(text, fetchImpl = globalThis.fetch) {
  const clipped = String(text || "").trim().slice(0, 500);
  if (!clipped) throw new Error("empty tts text");
  const response = await fetchImpl("/v1/speech/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clipped }),
  });
  if (!response.ok) throw new Error("speak failed");
  const blob = await response.blob();
  const type = String(blob.type || "");
  if (!blob.size || type.includes("json")) throw new Error("speak failed");
  return blob;
}

function speakLocal(text) {
  if (!text || !globalThis.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.96;
  globalThis.speechSynthesis.speak(utterance);
}

export async function speakDialogue(text, { fetchImpl = globalThis.fetch } = {}) {
  const clipped = String(text || "").trim();
  if (!clipped) return;
  stopSpeech();
  const token = speechToken;
  try {
    const blob = await speakUtterance(clipped, fetchImpl);
    if (token !== speechToken) return;
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    await new Promise((resolve, reject) => {
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudio) currentAudio = null;
        resolve();
      };
      currentAudio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        reject(new Error("play failed"));
      };
      currentAudio.play().catch(reject);
    });
  } catch {
    if (token !== speechToken) return;
    speakLocal(clipped);
  }
}

export class ScenarioChatState {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this._fetch = fetchImpl;
    this._threads = new Map();
    this._phases = new Map();
    this.sending = false;
  }

  phase(personaKey) {
    return this._phases.get(personaKey) || "approaching";
  }

  setPhase(personaKey, phase) {
    this._phases.set(personaKey, EXPERIENCE_PHASES.includes(phase) ? phase : "approaching");
  }

  messages(personaKey) {
    return [...(this._threads.get(personaKey) || [])];
  }

  clear(personaKey) {
    this._threads.delete(personaKey);
    this._phases.delete(personaKey);
  }

  async send(persona, text, extras = {}) {
    const trimmed = String(text || "").trim();
    if (!trimmed || this.sending) return null;
    const key = persona.key;
    const items = this._threads.get(key) || [];
    items.push({ role: "user", text: trimmed });
    this._threads.set(key, items);
    this.sending = true;
    const phase = this.phase(key);
    try {
      const turn = await this._requestTurn(persona, trimmed, items, extras, phase);
      const next = nextExperiencePhase(phase, {
        sceneCtrl: turn.scene_ctrl,
        userText: trimmed,
      });
      this.setPhase(key, next);
      items.push({
        role: "assistant",
        text: turn.dialogue,
        sceneCtrl: turn.scene_ctrl,
        phase: next,
      });
      return { dialogue: turn.dialogue, sceneCtrl: turn.scene_ctrl, phase: next };
    } finally {
      this.sending = false;
    }
  }

  async _requestTurn(persona, text, items, extras, phase) {
    const recent = items.slice(-6).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.text,
    }));
    const sensor = extras.sensor_context || {};
    const payload = {
      user_id: "local-demo",
      persona_id: String(persona.id || persona.key || "scenario").slice(0, 128),
      persona: {
        name: persona.name || "",
        tone: persona.text || persona.subtitle || "",
      },
      session_mode: "scenario",
      scene_id: phase,
      session_state: phase === "aftercare" ? "running" : "running",
      memory_policy: "off",
      consent_state: "confirmed",
      sensor_context: sensor,
      conversation_summary: experienceSummary(phase, sensor),
      user_input: text.slice(0, 2000),
      recent_turns: recent.slice(0, 6),
    };
    if (!this._fetch) {
      return { dialogue: stubDialogue(persona, text, phase), scene_ctrl: stubSceneCtrl(text, phase) };
    }
    try {
      const response = await this._fetch("/v1/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        return { dialogue: stubDialogue(persona, text, phase), scene_ctrl: stubSceneCtrl(text, phase) };
      }
      const body = await response.json();
      const dialogue = String(body?.dialogue || "").trim();
      return {
        dialogue: dialogue || stubDialogue(persona, text, phase),
        scene_ctrl: ["stay", "next", "end"].includes(body?.scene_ctrl) ? body.scene_ctrl : "stay",
      };
    } catch {
      return { dialogue: stubDialogue(persona, text, phase), scene_ctrl: stubSceneCtrl(text, phase) };
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
  return [
    `当前阶段：${meta.label}。${meta.goal}`,
    "传感器只提供温感、压力节律、心率趋势，不能单独判断高潮、同意或健康。",
    `温感 ${sensor.temperature_state || "unknown"}，压力 ${sensor.pressure_rhythm || "unknown"}，心率 ${sensor.hr_trend || "unknown"}。`,
    phase === "aftercare" ? "这一段必须事后抚慰，像真人完整亲密之后那样安顿对方。" : "",
  ].filter(Boolean).join(" ");
}

function stubDialogue(persona, text, phase) {
  const name = persona?.name || "我";
  if (phase === "aftercare" || /事后|抚慰|抱抱|歇|休息|累了/.test(text)) {
    return `${name}还在。先慢慢停下来，我陪着你。要不要喝一口水，或者让我抱一会儿？`;
  }
  if (/高潮|要到了|快到了/.test(text)) {
    return "我跟着你。快或慢都说一声，结束后我会陪你缓一缓，不会丢下你。";
  }
  if (/停|慢|等/.test(text)) {
    return `${name}在。我们可以先停在这里，你想慢一点就慢一点。`;
  }
  if (phase === "rising") {
    return "如果还想再近一点就告诉我；不想也完全可以。我只跟着你的感觉走。";
  }
  return `我是${name}。先按你的节奏靠近。温感、压力和心率只是趋势，你说的才算。`;
}

function stubSceneCtrl(text, phase) {
  if (/事后|抚慰|抱抱|歇|休息|累了|结束/.test(text) || phase === "aftercare") return "end";
  if (/高潮|要到了|再近|继续|更近/.test(text)) return "next";
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
