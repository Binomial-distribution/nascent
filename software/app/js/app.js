import { BleDownlink, NlCmd, NlConst, NlInsertState, NlKeyPress, NlLedState, NlMode } from "./protocol.js";
import { CHANNEL, CHANNEL_LABEL, currentShell } from "./transport.js";
import { bodyNotes } from "./body-notes.js";
import { parseHash, legacyNotesTarget, SCENARIO_FLOW } from "./routes.js";
import {
  PHASE_UI,
  buildSensorContext,
  fileToAvatarDataUrl,
  ingestUplinkSample,
  formatCaptionHtml,
  personaAvatarHtml,
  resetSensorWindow,
  scenarioChat,
  THREAD_KEY,
  speakDialogue,
  startRingtone,
  stopRingtone,
  stopSpeech,
  unlockSpeechPlayback,
} from "./scenario-session.js";
import { createHoldMic, createLiveCall } from "./live-call.js";
import {
  DEFAULT_CUSTOM_PERSONA,
  PERSONA_CARDS,
  PERSONA_PRESETS,
  PERSONA_QUIZ,
  PERSONA_VIBES,
  cardToDraft,
  cardToPromptText,
  draftToCard,
  emptyCardDraft,
  emptyQuizAnswers,
  personaOpeningLine,
  personaRejoinLine,
  quizAnswersToCard,
  savedPersonaToDraft,
  speakOptionsForPersona,
} from "./persona-cards.js";
import {
  connectDevice,
  disconnectDevice,
  getConnected,
  getConnectionState,
  getUplink,
  link,
  sendCommand,
  subscribe,
} from "./session.js";
import { patchLabDom, renderLab, saveCheck } from "./lab.js";
import { CardCategory, heart, MoodUi } from "./heart.js";
import { heartRate, hrChipText, nativeHeartRateAvailable, nightHeartLog } from "./hr.js";
import {
  buildSleepReport,
  collectRecentMoodKeys,
  emptySleepCopy,
  REST_LABEL,
} from "./sleep-summary.js";
import {
  COMPANION_TONES,
  isOnboardingDone,
  mountOnboarding,
  shouldForceOnboarding,
  fullGuidePages,
} from "./onboarding.js";

const LLM_OPTIONS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "claude-sonnet", label: "Claude Sonnet" },
  { id: "deepseek-chat", label: "DeepSeek Chat" },
  { id: "local", label: "本地小模型（占位）" },
];

const PERSONA_KEY = "nascent.persona.settings";
const DEVICE_KEY = "nascent.devices";

const root = document.getElementById("app");
let liveCall = null;
let holdMic = null;
let callClock = null;
let chatFromCallTimer = null;
let skipAnswerClick = false;
const SCENES = [
  ["留一点空间", "先不用急着做什么，感受一下此刻的呼吸。"],
  ["靠近一点", "如果感觉合适，就把注意力放回你们之间。"],
  ["听见回应", "每一次停顿和改变，都可以成为下一步的线索。"],
];

const LOCAL_USER = "local-demo";
const AUTO_CONTROL_INTERVAL_MS = 10_000;
const STYLE_TAGS = ["温柔", "强势", "SM 风格", "安静", "玩心"];
const TALK_FREQS = ["少说话", "适中", "多一些回应"];

const ui = {
  toastTimer: null,
  sheet: null,
  draftLevel: null,
  scenarioStarted: false,
  scene: 0,
  personas: [],
  templates: [],
  activePersona: null,
  selectedRecordId: null,
  olderOpen: false,
  savingPersona: false,
  deferredPrompt: null,
  onboarding: null,
  gateReady: false,
  labReject: "",
  labWildArmed: false,
  persona: loadPersonaSettings(),
  guideSheetIndex: 0,
  devices: loadDevices(),
  appLock: loadAppLock(),
  prefs: loadPrefs(),
  insightSending: false,
  scenarioHandoff: false,
  draftAvatar: null,
  draftPersonaCard: null,
  pendingCloneFile: null,
  cloneNeedsTranscript: false,
  quizAnswers: emptyQuizAnswers(),
  callTimer: null,
  voiceListening: false,
  pendingScenarioPersona: null,
  chatFromCall: false,
  scenarioAutomation: {
    active: false,
    authorized: false,
    sessionId: "",
    timer: null,
    pendingTimer: null,
    inFlight: false,
    modeSetting: false,
    lastSensorKey: "",
    generation: 0,
  },
};

const PREFS_KEY = "nascent.prefs";

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      safewords: raw.safewords || "红灯",
      storageMode: raw.storageMode === "cloud" ? "cloud" : "local",
      notifyEnabled: raw.notifyEnabled !== false,
      notifyVeiled: raw.notifyVeiled !== false,
      appearance: ["light", "dark", "default"].includes(raw.appearance)
        ? raw.appearance
        : "default",
      subscribed: Boolean(raw.subscribed),
      ttsProvider: raw.ttsProvider === "mimo" ? "mimo" : "minimax",
      cleanRemind: raw.cleanRemind !== false,
      privacyWants: Array.isArray(raw.privacyWants) ? raw.privacyWants : [],
      intent: raw.intent || "",
      companionPace: raw.companionPace || "",
    };
  } catch {
    return {
      safewords: "红灯",
      storageMode: "local",
      notifyEnabled: true,
      notifyVeiled: true,
      appearance: "default",
      subscribed: false,
      ttsProvider: "minimax",
      cleanRemind: true,
      privacyWants: [],
      intent: "",
      companionPace: "",
    };
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(ui.prefs));
  } catch {
    /* ignore */
  }
}

function loadAppLock() {
  try {
    return localStorage.getItem("nascent.appLock") === "1";
  } catch {
    return false;
  }
}

function saveAppLock() {
  try {
    localStorage.setItem("nascent.appLock", ui.appLock ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function loadDevices() {
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_KEY) || "{}");
    return {
      k10Serial: raw.k10Serial || "NL-TOY-7F2A",
      k10Battery: raw.k10Battery ?? 100,
      bandConnected: Boolean(raw.bandConnected),
      bandSerial: raw.bandSerial || "MI-WT-9C41",
      bandName: raw.bandName || "小米手环 7",
      bandBattery: raw.bandBattery ?? 100,
      productId: raw.productId || "",
    };
  } catch {
    return {
      k10Serial: "NL-TOY-7F2A",
      k10Battery: 100,
      bandConnected: false,
      bandSerial: "MI-WT-9C41",
      bandName: "小米手环 7",
      bandBattery: 100,
      productId: "",
    };
  }
}

function saveDevices() {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(ui.devices));
  } catch {
    /* ignore */
  }
}

function loadPersonaSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(PERSONA_KEY) || "{}");
    return {
      mode: raw.mode || null, // fixed | custom
      presetId: raw.presetId || "gentle",
      customText: raw.customText || "",
      model: raw.model || "gpt-4o-mini",
      customs: Array.isArray(raw.customs) ? raw.customs.map(normalizeCustomPersona) : [],
      activeCustomId: raw.activeCustomId || null,
      editingId: null, // session only
    };
  } catch {
    return {
      mode: null,
      presetId: "gentle",
      customText: "",
      model: "gpt-4o-mini",
      customs: [],
      activeCustomId: null,
      editingId: null,
    };
  }
}

function savePersonaSettings() {
  try {
    const { editingId, ...persistable } = ui.persona;
    localStorage.setItem(PERSONA_KEY, JSON.stringify(persistable));
  } catch {
    /* ignore */
  }
}

function personaSummary() {
  if (ui.persona.mode === "custom") {
    const active = ui.persona.customs.find((c) => c.id === ui.persona.activeCustomId);
    const model = LLM_OPTIONS.find((m) => m.id === (active?.model || ui.persona.model))?.label
      || active?.model
      || ui.persona.model;
    const n = ui.persona.customs.length;
    return active
      ? `自定义 · ${active.name || "未命名"} · ${model}`
      : n ? `自定义 · ${n} 个人设` : "自定义（尚未保存）";
  }
  if (ui.persona.mode === "fixed") {
    const p = PERSONA_PRESETS.find((x) => x.id === ui.persona.presetId);
    return p ? `固定 · ${p.name}` : "固定人设";
  }
  if (ui.personas.length) {
    return ui.personas.map((p) => `${p.name}（${p.tone}）`).join("、");
  }
  return "尚未设置";
}

function normalizeCustomPersona(item) {
  return {
    id: item.id,
    text: item.text || "",
    source: item.source === "quiz" ? "quiz" : "free",
    card: item.card && typeof item.card === "object" ? item.card : null,
    model: item.model || "gpt-4o-mini",
    name: item.name || "",
    avatar: typeof item.avatar === "string" ? item.avatar : "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function customPersonaTitle(item, index) {
  if (item?.name) return item.name;
  const cardName = item?.card?.assistant_name || item?.card?.name;
  if (cardName) return cardName;
  const text = String(item?.text || item || "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const named = lines.find((line) => line.startsWith("assistant_name:"));
  if (named) return named.replace("assistant_name:", "").replace(/#.*/, "").trim() || `自定义 ${index + 1}`;
  const line = lines.find((row) => !row.startsWith("#") && !row.endsWith(":")) || "未命名人设";
  return line.slice(0, 18) + (line.length > 18 ? "…" : "") || `自定义 ${index + 1}`;
}

function customCardSubtitle(item) {
  const card = item?.card;
  if (card?.subtitle) return String(card.subtitle);
  const first = Array.isArray(card?.profile) ? card.profile[0] : card?.profile;
  if (first) return String(first).split("\n")[0].slice(0, 22);
  return cardSubtitle(item?.text) || "自定义人设";
}

function customPersonaBlurb(item) {
  const card = item?.card;
  if (card?.subtitle) return String(card.subtitle);
  const first = Array.isArray(card?.profile) ? card.profile[0] : card?.profile;
  if (first) {
    const line = String(first).split("\n")[0];
    return line.slice(0, 40) + (line.length > 40 ? "…" : "");
  }
  const text = String(item?.text || "");
  if (!text) return "自定义陪伴";
  return text.slice(0, 40) + (text.length > 40 ? "…" : "");
}

function readPersonaCardDraftFromForm() {
  const value = (id) => root.querySelector(`#${id}`)?.value ?? "";
  const vibe = root.querySelector("[data-act=persona-vibe].on")?.dataset.vibe
    || ui.draftPersonaCard?.vibe
    || "";
  return {
    name: value("persona-assistant-name"),
    assistant_name: value("persona-assistant-name"),
    user_name: value("persona-user-name"),
    profile: value("persona-profile"),
    skills: value("persona-skills"),
    background: value("persona-background"),
    rules: value("persona-rules"),
    prologue: value("persona-prologue"),
    spoken: value("persona-spoken"),
    vibe,
    tts: ui.draftPersonaCard?.tts || {},
  };
}

function personaFormDraft(editing) {
  if (editing) {
    if (ui.draftPersonaCard && ui.persona.editingId === editing.id) {
      return { ...emptyCardDraft(), ...ui.draftPersonaCard };
    }
    return savedPersonaToDraft(editing);
  }
  return { ...emptyCardDraft(), ...(ui.draftPersonaCard || {}) };
}

function showPersonaCreatedNotice() {
  document.querySelector(".notice-banner")?.remove();
  const el = document.createElement("button");
  el.type = "button";
  el.className = "notice-banner";
  el.textContent = "新的伴侣人格已生成，点击查看";
  el.addEventListener("click", () => {
    el.remove();
    go("#/settings/persona/customs");
  });
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 8000);
}

function persistCustomPersonaRecord({ card, name, source = "free", activate = false, createdNotice = false, editingId = null } = {}) {
  const persistCard = {
    user_name: card.user_name,
    assistant_name: card.assistant_name,
    profile: card.profile,
    skills: card.skills,
    background: card.background,
    rules: card.rules,
    prologue: card.prologue,
    spoken: card.spoken,
    subtitle: card.subtitle,
    vibe: card.vibe || "",
    tts: card.tts || {},
  };
  const text = cardToPromptText(card);
  const model = ui.persona.model || "gpt-4o-mini";
  const now = new Date().toISOString();
  let createdNew = false;
  let id = editingId || ui.persona.editingId;
  const avatar = ui.draftAvatar
    || (id && ui.persona.customs.find((c) => c.id === id)?.avatar)
    || "";
  const displayName = name || persistCard.assistant_name;
  if (id) {
    const idx = ui.persona.customs.findIndex((c) => c.id === id);
    if (idx >= 0) {
      ui.persona.customs[idx] = {
        ...ui.persona.customs[idx],
        text,
        card: persistCard,
        source,
        model,
        avatar,
        name: displayName,
        updatedAt: now,
      };
      id = ui.persona.customs[idx].id;
    } else {
      id = null;
    }
  }
  if (!id) {
    id = `custom-${Date.now().toString(36)}`;
    ui.persona.customs.unshift({
      id,
      text,
      card: persistCard,
      source,
      model,
      avatar,
      name: displayName,
      createdAt: now,
      updatedAt: now,
    });
    createdNew = true;
  }
  ui.draftAvatar = null;
  ui.draftPersonaCard = null;
  ui.quizAnswers = emptyQuizAnswers();
  if (activate || createdNew) {
    ui.persona.activeCustomId = id;
    ui.persona.mode = "custom";
  }
  ui.persona.customText = text;
  ui.persona.model = model;
  ui.persona.editingId = null;
  savePersonaSettings();
  if (createdNotice && createdNew) {
    window.setTimeout(() => showPersonaCreatedNotice(), 120);
  }
  const item = ui.persona.customs.find((c) => c.id === id);
  return { ok: true, createdNew, id, item };
}

async function uploadCustomPersona(item) {
  if (!item?.card) return item;
  try {
    const response = await fetch("/v1/persona/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: LOCAL_USER,
        id: item.id,
        name: item.name || item.card.assistant_name,
        source: item.source === "quiz" ? "quiz" : "free",
        card: item.card,
        text: item.text || "",
      }),
    });
    if (!response.ok) return item;
    return await response.json();
  } catch {
    return item;
  }
}

function mergeRemoteCustoms(remote) {
  if (ui.skipRemoteCustoms) return;
  if (!Array.isArray(remote)) return;
  const localById = new Map(ui.persona.customs.map((item) => [item.id, item]));
  const merged = remote.map((item) => {
    const local = localById.get(item.id);
    localById.delete(item.id);
    return normalizeCustomPersona({
      ...item,
      createdAt: item.created_at || item.createdAt,
      updatedAt: item.updated_at || item.updatedAt,
      avatar: local?.avatar || item.avatar || "",
    });
  });
  for (const leftover of localById.values()) merged.push(leftover);
  ui.persona.customs = merged;
  savePersonaSettings();
}

/** @returns {Promise<{ ok: boolean, createdNew?: boolean, id?: string }>} */
async function saveCustomPersonaFromForm({ activate = false, createdNotice = false } = {}) {
  const draft = readPersonaCardDraftFromForm();
  const name = String(draft.assistant_name || draft.name || "").trim();
  const profile = String(draft.profile || "").trim();
  const spoken = String(draft.spoken || "").trim();
  if (!name && !profile && !spoken) {
    toast("先写他是谁，或点上面一种感觉");
    return { ok: false };
  }
  const result = persistCustomPersonaRecord({
    card: { ...draftToCard(draft), vibe: draft.vibe || "" },
    name,
    source: "free",
    activate,
    createdNotice,
    editingId: ui.persona.editingId,
  });
  await uploadCustomPersona(result.item);
  return result;
}

async function saveCustomPersonaFromQuiz({ activate = true, createdNotice = false } = {}) {
  stashQuizDraft();
  const answers = ui.quizAnswers || emptyQuizAnswers();
  if (!answers.vibe) {
    toast("先选你想被怎样陪着");
    return { ok: false };
  }
  if (!answers.profile) {
    toast("先选他是哪种男友");
    return { ok: false };
  }
  if (!answers.spoken) {
    toast("先选见面时他会说哪句");
    return { ok: false };
  }
  const card = quizAnswersToCard(answers);
  const result = persistCustomPersonaRecord({
    card,
    name: card.assistant_name,
    source: "quiz",
    activate,
    createdNotice,
  });
  await uploadCustomPersona(result.item);
  return result;
}

const ICONS = {
  heart: '<path d="M12 21s-7-4.4-9.5-8.2C.6 9.7 2.2 6 6 6c2 0 3.2 1.1 4 2.2C10.8 7.1 12 6 14 6c3.8 0 5.4 3.7 3.5 6.8C19 16.6 12 21 12 21z"/>',
  sliders: '<path d="M5 8h8"/><circle cx="16" cy="8" r="2.4"/><path d="M19 8h1"/><path d="M5 16h3"/><circle cx="11" cy="16" r="2.4"/><path d="M14 16h6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  bluetooth: '<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
  bookmark: '<path d="M6 4h12v17l-6-3-6 3z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 7l-4-4-4 4"/><path d="M12 3v13"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  stop: '<circle cx="12" cy="12" r="9"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6z"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 14h8l1-14"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  thermometer: '<path d="M14 14.8V5a4 4 0 0 0-8 0v9.8a6 6 0 1 0 8 0z"/><path d="M10 9v8"/>',
  activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  moon: '<path d="M15.2 3.2A8.8 8.8 0 1 0 20.8 14 7 7 0 0 1 15.2 3.2z"/>',
  phone: '<path d="M6.5 4h3l1.2 3.2-1.8 1.1a12 12 0 0 0 5.8 5.8l1.1-1.8L20 13.5v3A14.5 14.5 0 0 1 6.5 4z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/><path d="M9 21h6"/>',
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function route() {
  return parseHash(location.hash || "#/heart");
}

function go(path) {
  location.hash = path;
  requestAnimationFrame(() => {
    document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

function toast(text) {
  clearTimeout(ui.toastTimer);
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  ui.toastTimer = setTimeout(() => el.remove(), 2400);
}

function openSheet(html) {
  closeSheet();
  const wrap = document.createElement("div");
  wrap.className = "sheet-bg";
  wrap.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeSheet();
  });
  document.body.appendChild(wrap);
  ui.sheet = wrap;
  return wrap;
}

function closeSheet() {
  ui.sheet?.remove();
  ui.sheet = null;
}

/**
 * 原机的开机与关机是同一个长按取反动作。产品页和硬件调试页必须共用
 * 这条已经在实机验证过的指令，不能一个走 set_level、另一个走原按键。
 */
async function toggleOriginalPower(successCopy) {
  const reason = await emit(new BleDownlink({
    cmd: NlCmd.PRESS_KEY,
    key: NlKeyPress.HOLD,
    auth: "",
  }));
  if (!reason) toast(successCopy);
  return reason;
}

function deviceStatusText(connected, uplink, state = getConnectionState()) {
  if (!connected) {
    return {
      permission: "等待允许连接…",
      scanning: "正在寻找设备…",
      connecting: "正在连接…",
      initializing: "正在准备…",
      error: "暂时无法连接 · 点此重试",
    }[state?.phase] || "连接设备";
  }
  const bat = `电量 ${ui.devices.k10Battery}%`;
  if (uplink?.insertState === NlInsertState.INSERTED) {
    return `已连接 · 使用中 · ${bat}`;
  }
  return `已连接 · ${bat}`;
}

function bandStatusText() {
  const snap = heartRate.snapshot;
  if (snap.live && snap.bpm != null) {
    const trend = {
      unknown: snap.collectingBaseline ? "采集基线" : "趋势未知",
      steady: "平稳",
      increasing: "上升",
      decreasing: "回落",
    }[snap.trend] || "趋势未知";
    return `已连接：${snap.bpm} BPM · ${trend}`;
  }
  if (snap.quality === "stale") return "健康手环已失联";
  if (!ui.devices.bandConnected && !heartRate.hasEverSampled) return "健康手环未连接";
  return `已连接：${ui.devices.bandSerial}`;
}

/** 主设备状态条：心绪/亲密时刻悬浮，或设置页可点连接 */
function statusBar({
  clickable = false,
  floating = false,
  trailing = "chevron",
  connectable = false,
} = {}) {
  const connected = getConnected();
  const uplink = getUplink();
  const connection = getConnectionState();
  const tag = clickable || connectable ? "button" : "div";
  const act = connectable ? 'data-act="connect"' : clickable ? 'data-act="settings"' : "";
  const classes = [
    "status",
    floating ? "status-float" : "",
    connected ? "is-connected" : "",
  ].filter(Boolean).join(" ");
  return `<${tag} class="${classes}" data-status ${act}>
    ${icon("bluetooth")}
    <span class="status-copy">
      <span data-status-text>${deviceStatusText(connected, uplink, connection)}</span>
    </span>
    ${icon(trailing)}
  </${tag}>`;
}

function bandIsOn() {
  return heartRate.hasEverSampled || ui.devices.bandConnected;
}

function bandStatusBar({ connectable = true } = {}) {
  const on = bandIsOn() && heartRate.snapshot.quality !== "stale";
  const tag = connectable ? "button" : "div";
  return `<${tag} class="status ${on ? "is-connected" : ""}" ${connectable ? 'data-act="connect-band"' : ""}>
    ${icon("bluetooth")}
    <span class="status-copy">
      <span>${bandStatusText()}</span>
    </span>
    ${icon("chevron")}
  </${tag}>`;
}

function floatingDeviceBar(opts = {}) {
  return `<div class="status-float-slot">${statusBar({ floating: true, ...opts })}</div>`;
}

function topbar(title, { back = false, backTo = "", action = "" } = {}) {
  const backAttr = backTo ? ` data-to="${backTo}"` : "";
  return `<header class="topbar">
    ${back ? `<button class="icon-btn" data-act="back"${backAttr} aria-label="返回">${icon("back")}</button>` : ""}
    <h1>${title}</h1>
    ${action}
  </header>`;
}

function nav(tab) {
  const items = [
    ["heart", "heart", "心绪"],
    ["intimacy", "book", "亲密"],
    ["records", "activity", "记录"],
    ["settings", "person", "我的"],
  ];
  return `<nav class="nav">${items.map(([id, ico, label]) => `
    <button data-act="tab" data-tab="${id}" class="${tab === id ? "active" : ""}">${icon(ico)}<span>${label}</span></button>
  `).join("")}</nav>`;
}

function renderHeart() {
  const todayMood = heart.moodFor(new Date())?.mood;
  const favorites = heart.favoriteCardIds;
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
  return `${topbar("心绪", {
    action: `<button class="icon-btn" data-act="favorites" aria-label="收藏的内容">
      ${icon("bookmark")}${favorites.size ? `<span class="pill">${favorites.size}</span>` : ""}
    </button>`,
  })}
  ${floatingDeviceBar()}
  <main class="page page-with-float">
    <section class="hero">
      <div>
        <h2>你好，今天也来听听自己</h2>
        <p>一点点觉察，就足够成为和自己靠近的开始。</p>
      </div>
      <div class="streak"><strong>${heart.streak}</strong><span>连续记录</span></div>
    </section>
    <div class="section-head">
      <h3>此刻的心绪</h3>
      <span>${todayMood ? "今天已记录" : "今天还没有记录"}</span>
    </div>
    <div class="moods">
      ${NlMoodButtons(todayMood)}
    </div>
    <div class="section-head">
      <h3>今日身体小课</h3>
      <span data-card-counter>${heart.activeCardIndex + 1}/${heart.cards.length}</span>
    </div>
    <div class="cards" data-cards>
      ${heart.cards.map((card, index) => knowledgeCard(card, index)).join("")}
    </div>
    <div class="section-head"><h3>最近的心绪</h3></div>
    <div class="calendar">
      ${days.map((day) => {
        const entry = heart.moodFor(day);
        const color = entry ? MoodUi[entry.mood].color : "#3a3244";
        const label = `${day.getMonth() + 1}/${day.getDate()}${entry ? ` ${MoodUi[entry.mood].label}` : ""}`;
        return `<div class="cal-day" title="${label}" style="background:${color}"></div>`;
      }).join("")}
    </div>
    <p class="disclaimer">内容仅供参考，不能替代医生或专业人士建议。</p>
  </main>
  ${nav("heart")}`;
}

function NlMoodButtons(selected) {
  return Object.entries(MoodUi).map(([mood, meta]) => `
    <button class="mood ${selected === mood ? "selected" : ""}" data-act="mood" data-mood="${mood}" style="--mood:${meta.color}">
      <span>${meta.emoji}</span><small>${meta.label}</small>
    </button>
  `).join("");
}

function knowledgeCard(card, index) {
  const cat = CardCategory[card.category];
  return `<article class="card" data-act="open-card" data-index="${index}">
    <div style="display:flex;align-items:center">
      <span class="pill">${cat.label}</span>
      ${heart.isRead(card.id) ? `<span style="margin-left:auto;color:var(--comfort)">${icon("check")}</span>` : ""}
    </div>
    <h4>${card.title}</h4>
    <p>${card.summary}</p>
    <div class="card-actions">
      <span class="hint">点击展开</span>
      <button class="icon-btn" data-act="favorite" data-index="${index}" aria-label="${heart.isFavorite(card.id) ? "取消收藏" : "收藏"}">${icon("bookmark")}</button>
      <button class="icon-btn" data-act="share" data-index="${index}" aria-label="分享预览">${icon("share")}</button>
    </div>
  </article>`;
}

function renderIntimacy() {
  return `${topbar("亲密时刻")}
  <main class="page intimacy-home">
    ${statusBar({ connectable: true, trailing: "shield" })}
    <h2 class="lead">选择今天的靠近方式</h2>
    <p class="sub">想有人陪着说话，或快慢都自己来，选下面一种。</p>
    <div class="entry-stack">
      ${entry("scenario", "heart", "情景模式", "选一个人，他会打给你。")}
      ${entry("control", "sliders", "自我控制", "档位和节奏都自己来。")}
    </div>
    <div class="note">${icon("info")}<span>想停随时能停。用过的记录在「记录」里。</span></div>
  </main>
  ${nav("intimacy")}`;
}

function entry(page, ico, title, subtitle) {
  return `<button class="entry entry-${page}" data-act="sub" data-page="${page}">
    <div class="entry-ico">${icon(ico)}</div>
    <div class="entry-copy"><h3>${title}</h3><p>${subtitle}</p></div>
  </button>`;
}

function renderControl() {
  const connected = getConnected();
  const uplink = getUplink();
  const reported = uplink?.level ?? 0;
  if (ui.draftLevel === reported) ui.draftLevel = null;
  const level = ui.draftLevel ?? (reported > 0 ? reported : 1);
  const mode = uplink?.mode ?? NlMode.FREE;
  const disabled = connected ? "" : "disabled";
  return `${topbar("自我控制", { back: true })}
  <main class="page control-page">
    ${statusBar({ connectable: true, trailing: connected ? "check" : "chevron" })}
    <button class="stop" data-act="stop">${icon("stop")} 停 止</button>
    <div class="power-actions" aria-label="设备电源">
      <button class="power-on ${reported > 0 ? "active" : ""}" data-act="power-on" ${disabled}>开启</button>
      <button class="power-off ${reported === 0 ? "active" : ""}" data-act="power-off" ${disabled}>关闭</button>
    </div>
    <p class="power-hint">停止后，请在设备上确认恢复。</p>
    <div class="control-stage">
      <div class="level" data-level-label>${reported === 0 ? "启动" : "档位"} ${level} / ${NlConst.levelMax}</div>
      <input id="level-slider" type="range" min="1" max="${NlConst.levelMax}" step="1" value="${level}" ${disabled} />
    </div>
    <div class="modes">
      ${[
        [NlMode.FREE, "手动"],
        [NlMode.WILD, "失控"],
      ].map(([value, label]) => `
        <button data-act="mode" data-mode="${value}" class="${mode === value ? "active" : ""}" ${disabled}>${label}</button>
      `).join("")}
    </div>
    <p class="hint">健康提示：不适应立刻停。润滑不够先补上。胸闷、头晕或疼痛时请停止。</p>
  </main>`;
}

function scenarioCatalog() {
  const customs = ui.persona.customs.map((item, index) => ({
    key: `custom:${item.id}`,
    id: item.id,
    name: customPersonaTitle(item, index),
    subtitle: customCardSubtitle(item),
    text: item.text,
    card: item.card,
    avatar: item.avatar,
    kind: "custom",
  }));
  const personas = (ui.personas.length ? ui.personas : PERSONA_PRESETS).map((item) => {
    const card = PERSONA_CARDS[item.id];
    return {
      key: `persona:${item.id}`,
      id: item.id,
      name: card?.name || item.name,
      subtitle: card?.subtitle || item.tone,
      text: item.tone,
      card,
      kind: "preset",
    };
  });
  const templates = (ui.templates || [])
    .filter((item) => item.source === "custom" && item.status === "confirmed")
    .map((item) => ({
      key: `template:${item.template_id}`,
      id: item.template_id,
      name: item.name,
      subtitle: item.description || "自定义人设",
      text: item.description || "",
      kind: "template",
    }));
  return [...customs, ...personas, ...templates];
}

function cardSubtitle(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const profile = lines.find((line) => line.startsWith("- ") && !line.startsWith("- 你就是"));
  if (profile) return profile.replace(/^- /, "").slice(0, 22);
  return lines.find((line) => !line.startsWith("#") && !line.endsWith(":"))?.slice(0, 22) || "";
}

function findScenarioPersona(key) {
  return scenarioCatalog().find((item) => item.key === key) || null;
}

function renderScenario() {
  const { sessionId } = route();
  if (sessionId === "new") return renderPersonaForm();
  if (sessionId === "call") return renderScenarioCall();
  if (sessionId === "chat") return renderScenarioChat();
  if (sessionId === "play") return renderScenarioCall();
  return renderPersonaList();
}

function renderPersonaList() {
  const items = scenarioCatalog();
  return `${topbar("情景模式", {
    back: true,
    action: `<button class="icon-btn" data-act="persona-new" aria-label="新建人设">${icon("plus")}</button>`,
  })}
  <main class="page">
    <h2 class="lead">选择人设</h2>
    <p class="sub">注意事项：不舒服随时可以说停。想慢就慢。不要硬撑。</p>
    <button class="persona-row persona-new-row" data-act="persona-new">
      <div class="avatar">${icon("plus")}</div>
      <div><strong>自己写一个他</strong><small>名字、脾气、开场白都自己填。</small></div>
      <span class="chev">${icon("chevron")}</span>
    </button>
    <button class="persona-row persona-new-row" data-act="persona-quiz">
      <div class="avatar">${icon("book")}</div>
      <div><strong>不知道怎么填？做个小问卷</strong><small>点选就好，做完他会出现在下面。</small></div>
      <span class="chev">${icon("chevron")}</span>
    </button>
    ${items.map((item) => `
      <button class="persona-row ${ui.activePersona?.key === item.key ? "selected" : ""}" data-act="pick-persona" data-key="${escapeHtml(item.key)}">
        ${personaAvatarHtml(item)}
        <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.subtitle)}</small></div>
        <span class="chev">${icon("chevron")}</span>
      </button>
    `).join("")}
    ${items.length ? "" : `<p class="microcopy">还没有自己的人设时，可以用上面的自定义，或点选预置人设，他会打给你。</p>`}
  </main>`;
}

function renderScenarioCall() {
  const persona = ui.activePersona || { name: "当前人设", key: "none" };
  return `<main class="call-screen" data-call-stage="ringing">
    <section class="call-voice-layer" data-call-swipe>
      <div class="call-header-block">
        <p class="call-kicker">来电</p>
        <div class="call-stage">
          <div class="call-rings" aria-hidden="true"><i></i><i></i><i></i></div>
          ${personaAvatarHtml(persona, "avatar call-avatar")}
        </div>
        <h2>${escapeHtml(persona.name)}</h2>
        <p class="sub" data-call-status>正在呼叫你…</p>
        ${ui.scenarioAutomation.authorized ? `<p class="auto-control-badge">本次情景已开启设备自动调节</p>` : ""}
        <p class="call-duration" data-call-duration hidden>00:00</p>
      </div>
      <div class="call-live-block">
        <div class="call-subtitle-panel" data-call-captions>
          <div class="call-line assistant" data-call-assistant-row hidden>
            <span class="call-who">${escapeHtml(persona.name)}</span>
            <p data-call-assistant></p>
          </div>
          <div class="call-line user" data-call-user-row hidden>
            <span class="call-who">你</span>
            <p data-call-user></p>
          </div>
        </div>
        <div class="call-waveform" data-call-wave aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="call-connected-controls">
        <p class="call-up-hint">上滑进入文字聊天</p>
        <button type="button" class="ghost call-text" data-act="call-text" hidden>改用文字</button>
        <button type="button" class="call-hangup-btn" data-act="end-call" aria-label="挂断">${icon("stop")}</button>
      </div>
      <div class="call-answer-rail">
        <button type="button" class="call-rail-decline" data-act="end-call">拒绝</button>
        <div class="call-slider" data-call-slider>
          <span class="call-slider-hint">左滑接通</span>
          <button type="button" class="call-slider-knob" data-act="answer-call" data-call-knob aria-label="接通">${icon("phone")}</button>
        </div>
      </div>
    </section>
  </main>`;
}

function renderScenarioChat() {
  const persona = ui.activePersona || { name: "当前人设", key: "none" };
  const messages = scenarioChat.messages(persona.key);
  const phase = scenarioChat.phase(persona.key);
  const phaseUi = PHASE_UI[phase] || PHASE_UI.approaching;
  const sensors = buildSensorContext(getUplink(), { bandConnected: ui.devices.bandConnected });
  const opening = personaOpeningLine(persona, phase);
  const dayLabel = messages.some((message) => message.role === "user") ? "还在聊" : "刚开始";
  return `${topbar(escapeHtml(persona.name), {
    back: true,
    action: personaAvatarHtml(persona, "avatar top-avatar"),
  })}
  <main class="insight-page scenario-chat-page">
    <div class="scope-strip"><strong>${phaseUi.label}</strong><span>${ui.scenarioAutomation.authorized ? "设备自动调节中 · 想更近、想慢、想停，直接说" : "想更近、想慢、想停，直接说就好"}</span></div>
    <div class="source-strip">
      <span>温感 ${sensorLabel(sensors.temperature_state)}</span>
      <span>压力 ${sensorLabel(sensors.pressure_rhythm)}</span>
      <span>${hrChipText(sensors)}</span>
    </div>
    <div class="chat-tools">
      <button type="button" class="ghost chat-tool" data-act="scenario-voice">语音通话</button>
      <button type="button" class="ghost chat-tool" data-act="forget-persona-memory">忘掉他记得的事</button>
    </div>
    <div class="chat-thread im-thread">
      <div class="chat-day">${dayLabel} · ${phaseUi.label}</div>
      ${messages.length ? "" : `<div class="bubble-row assistant">${personaAvatarHtml(persona)}<div class="bubble">${formatCaptionHtml(opening)}</div></div>`}
      ${messages.map((message, index) => renderScenarioChatMessage(message, persona, index)).join("")}
      ${scenarioChat.sending ? `<div class="bubble-row assistant">${personaAvatarHtml(persona)}<div class="bubble typing-dots" aria-label="正在输入"><i></i><i></i><i></i></div></div>` : ""}
    </div>
  </main>
  <form class="chat-composer scenario-composer" id="scenario-chat-form">
    <button type="button" class="hold-mic${ui.voiceListening ? " listening" : ""}" data-act="hold-mic" aria-label="按住说话">${icon("mic")}</button>
    <textarea name="message" rows="1" maxlength="2000" placeholder="${phase === "aftercare" ? "想被抱一会儿，还是先歇一歇" : "按住说话，或用文字"}" aria-label="输入想说的话"></textarea>
    <button type="submit" aria-label="发送" ${scenarioChat.sending ? "disabled" : ""}>${icon("send")}</button>
  </form>`;
}

function sensorLabel(value) {
  return {
    unknown: "未知",
    too_cold: "偏凉",
    warming: "在升温",
    reaching_comfort: "接近舒适",
    comfortable: "舒适",
    increasing: "在增强",
    decreasing: "在回落",
    steady: "平稳",
  }[value] || "未知";
}

function renderScenarioChatMessage(message, persona, index, { compact = false } = {}) {
  if (message.role === "user") {
    return `<div class="bubble-row user"><div class="bubble">${escapeHtml(message.text)}</div></div>`;
  }
  return `<div class="bubble-row assistant">${personaAvatarHtml(persona)}<div class="bubble-stack">
    <div class="bubble">${formatCaptionHtml(message.text)}</div>
    ${compact ? "" : renderMemoryOffer(message, index)}
  </div></div>`;
}

function renderMemoryOffer(message, messageIndex) {
  const proposals = Array.isArray(message.proposals) ? message.proposals : [];
  if (!proposals.length) return "";
  return proposals.map((proposal, index) => {
    if (proposal.status === "kept") {
      return `<p class="memory-offer kept">已记住：${escapeHtml(proposal.text)}</p>`;
    }
    if (proposal.status === "skipped") return "";
    return `<div class="memory-offer">
      <p>要记住这件事吗？${escapeHtml(proposal.text)}</p>
      <div class="memory-offer-actions">
        <button type="button" data-act="remember-memory" data-msg="${messageIndex}" data-idx="${index}">记住</button>
        <button type="button" data-act="skip-memory" data-msg="${messageIndex}" data-idx="${index}">这次算了</button>
      </div>
    </div>`;
  }).join("");
}

function renderPersonaForm() {
  const saving = ui.savingPersona ? "disabled" : "";
  return `${topbar("新建人设", { back: true })}
  <main class="page">
    <form id="persona-form">
      <label class="form-label" for="persona-name">名称</label>
      <input class="form-input" id="persona-name" name="name" maxlength="40" required value="${escapeHtml(DEFAULT_CUSTOM_PERSONA.name)}" placeholder="例如：陆聿" />
      <span class="form-label">风格</span>
      <div class="chip-row">
        ${STYLE_TAGS.map((tag) => `<button type="button" class="chip" data-act="toggle-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
      </div>
      <span class="form-label">说话频率</span>
      <div class="chip-row">
        ${TALK_FREQS.map((item, index) => `<button type="button" class="chip ${index === 1 ? "on" : ""}" data-act="talk-freq" data-freq="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
      </div>
      <span class="form-label">允许的 Skill</span>
      <div class="chip-row">
        <button type="button" class="chip on" data-act="toggle-skill" data-skill="rhythm_segment">节奏段</button>
        <button type="button" class="chip" data-act="toggle-skill" data-skill="set_pattern">波形</button>
      </div>
      <p class="microcopy">Skill 只是建议白名单，不会直接控制设备。对话创建人设这一轮不做。</p>
      <div style="height:16px"></div>
      <button class="primary" type="submit" ${saving}>保存并回到列表</button>
    </form>
  </main>`;
}

const MODE_UI = Object.freeze({
  free: { label: "我的节奏", color: "var(--fog)" },
  scenario: { label: "情境漫游", color: "var(--coral)" },
  wild: { label: "定时失控", color: "var(--notice)" },
});

const QUALITY_UI = Object.freeze({
  complete: "数据完整",
  partial: "部分数据",
  limited: "数据有限",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatSessionDate(value, withTime = false) {
  const date = new Date(value);
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  return withTime ? `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}` : base;
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} 分钟`;
}

function selectedSession() {
  const sessions = bodyNotes.sessions;
  if (!sessions.length) return null;
  return bodyNotes.getSession(ui.selectedRecordId) || sessions[0];
}

function wellnessCopy(session, recentCount) {
  const quality = QUALITY_UI[session.data_quality] || "数据有限";
  const temp = session.temperature.direction === "rising"
    ? "温感缓慢上升"
    : session.temperature.direction === "falling"
      ? "温感略有回落"
      : "温感整体平稳";
  const pressure = session.pressure.direction === "varied"
    ? "压力节律变化较多"
    : session.pressure.direction === "rising"
      ? "压力节律后段更连续"
      : "压力节律整体平稳";
  const hrNote = heartRate.snapshot.live
    ? "本次心率只作为参考性生理趋势，不是健康检测。"
    : "本机暂无可用的小米手环心率与接触面温感。";
  return `${temp}，${pressure}。数据完整度：${quality}。这一段对照了 ${recentCount} 次近期记录。这是使用与传感趋势的身心参考，不是健康检测，也不能替代医生或专业人士建议。${hrNote}`;
}

function renderRecords() {
  const latest = selectedSession();
  if (!latest) {
    return `${topbar("身心记录")}
    <main class="page">
      <div class="empty">${icon("bookmark")}<p>还没有可回看的使用记录</p></div>
      <p class="disclaimer">这里只有历史回看，不提供恢复、调档或设备控制。</p>
      ${sleepEntryButton()}
    </main>
    ${nav("records")}`;
  }
  const recent = bodyNotes.recentComparisons(latest.session_id, 5);
  const older = bodyNotes.sessions.filter((item) => item.session_id !== latest.session_id);
  const mode = MODE_UI[latest.mode] || MODE_UI.free;
  return `${topbar("身心记录", {
    action: notesMutationsLocked()
      ? ""
      : `<button class="icon-btn danger-icon" data-act="delete-session" data-session="${escapeHtml(latest.session_id)}" aria-label="删除本次记录">${icon("trash")}</button>`,
  })}
  <main class="page records-page">
    <section class="record-section">
      <div class="section-head"><h3>这一次</h3><span>${QUALITY_UI[latest.data_quality]}</span></div>
      <span class="mode-mark" style="--mode:${mode.color}">${mode.label}</span>
      <h2 class="lead" style="margin-top:10px">${escapeHtml(latest.title)}</h2>
      <p class="sub">${formatSessionDate(latest.started_at, true)} · ${formatDuration(latest.duration_s)} · 最高 ${latest.max_level} 档</p>
      ${renderTimeline(latest.timeline)}
      <div class="trend-copy"><span>${icon("thermometer")}</span><p>${escapeHtml(latest.temperature.label)}</p></div>
      <div class="trend-copy"><span>${icon("activity")}</span><p>${escapeHtml(latest.pressure.label)}</p></div>
    </section>
    <section class="record-section">
      <div class="section-head"><h3>近期图谱</h3><span>${recent.length + 1} 次</span></div>
      <div class="dual-chart">
        ${[latest, ...recent].map((item) => `
          <div>
            <p class="microcopy">${formatSessionDate(item.started_at)} · ${(MODE_UI[item.mode] || MODE_UI.free).label}</p>
            ${renderTimeline(item.timeline)}
          </div>
        `).join("")}
      </div>
      ${sleepEntryButton()}
    </section>
    <section class="record-section">
      <div class="section-head"><h3>身心参考</h3></div>
      <div class="ref-card">
        <p>${escapeHtml(wellnessCopy(latest, recent.length + 1))}</p>
        <p class="microcopy">不把压力、温感或心率写成高潮、疾病或固定偏好。</p>
      </div>
    </section>
    ${latest.notes.length ? `<section class="record-section">
      <div class="section-head"><h3>我保存的发现</h3><span>${latest.notes.length} 条</span></div>
      ${latest.notes.map((note) => `
        <div class="saved-note"><p>${escapeHtml(note.text)}</p>${notesMutationsLocked() ? "" : `<button class="icon-btn" data-act="delete-note" data-note="${escapeHtml(note.note_id)}" aria-label="删除这条发现">${icon("trash")}</button>`}</div>
      `).join("")}
      ${notesMutationsLocked() ? "" : `<button class="inline-command" data-act="add-session-note" data-session="${escapeHtml(latest.session_id)}">${icon("plus")} 自己写一条</button>`}
    </section>` : `${notesMutationsLocked() ? "" : `<section class="record-section">
      <button class="inline-command" data-act="add-session-note" data-session="${escapeHtml(latest.session_id)}">${icon("plus")} 自己写一条</button>
    </section>`}`}
    ${older.length ? `<section class="record-section">
      <button class="inline-command" data-act="toggle-older">${ui.olderOpen ? "收起更早的记录" : `更早的记录 · ${older.length}`}</button>
      ${ui.olderOpen ? older.map((item) => `
        <button class="older-row" data-act="select-record" data-session="${escapeHtml(item.session_id)}">
          <span><strong>${formatSessionDate(item.started_at)}</strong><br><small>${escapeHtml(item.title)}</small></span>
          <small>${(MODE_UI[item.mode] || MODE_UI.free).label} · ${formatDuration(item.duration_s)}</small>
        </button>
      `).join("") : ""}
    </section>` : ""}
    <p class="disclaimer">内容仅供参考，不能替代医生或专业人士建议。</p>
  </main>
  <div class="records-ask">
    <button data-act="insight-self" data-session="${escapeHtml(latest.session_id)}">${icon("message")} 和 AI 聊聊自己</button>
  </div>
  ${nav("records")}`;
}

function sleepEntryButton() {
  return `<button class="inline-command" data-act="open-sleep">${icon("moon")} 近期睡眠</button>`;
}

function formatSleepClock(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSleepDuration(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours && rest) return `${hours}小时${rest}分`;
  if (hours) return `${hours}小时`;
  return `${rest}分钟`;
}

function formatNightDate(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  if (!year || !month || !day) return key;
  return `${month}月${day}日夜`;
}

function renderSleepBar(segments) {
  if (!segments?.length) {
    return `<div class="sleep-bar empty">夜间心率未接入</div>`;
  }
  return `<div class="sleep-bar" aria-label="休息分段">${segments.map((item) => (
    `<span class="sleep-seg sleep-seg-${item.kind}" style="flex:${Math.max(1, item.minutes)}"></span>`
  )).join("")}</div>
  <div class="sleep-legend">
    ${Object.entries(REST_LABEL).map(([kind, label]) => (
      `<span><i class="sleep-seg-${kind}"></i>${label}</span>`
    )).join("")}
  </div>`;
}

function renderSleepNightRow(row) {
  const duration = row.hasHr ? formatSleepDuration(row.durationMin) : "";
  const mood = row.moodId && MoodUi[row.moodId]
    ? `<span class="sleep-mood-dot" style="--mood:${MoodUi[row.moodId].color}"></span><small>${escapeHtml(MoodUi[row.moodId].label)}</small>`
    : "";
  const missing = [
    row.hasHr ? "" : "心率未接入",
    row.moodId ? "" : "未记心情",
  ].filter(Boolean).join(" · ");
  return `<div class="sleep-night-row">
    <span class="sleep-night-date">${escapeHtml(formatNightDate(row.key))}</span>
    <span class="sleep-night-meta">
      ${duration ? `<strong>${escapeHtml(duration)}</strong>` : ""}
      ${mood}
      ${missing && (!duration || !mood) ? `<small>${escapeHtml(missing)}</small>` : ""}
    </span>
  </div>`;
}

function renderSleepSummary() {
  const report = buildSleepReport({
    nights: nightHeartLog.nights(),
    moodKeys: collectRecentMoodKeys(heart.moods),
    moodFor: (key) => heart.moodFor(key),
  });
  const latest = report[0];
  const empty = !report.length;
  const hero = empty ? `
      <div class="empty">${icon("moon")}<p>${escapeHtml(emptySleepCopy())}</p></div>
    ` : `
      <section class="sleep-hero">
        <p class="microcopy">${escapeHtml(formatNightDate(latest.key))}</p>
        <p class="sleep-duration">${latest.hasHr ? escapeHtml(formatSleepDuration(latest.durationMin)) : "心率未接入"}</p>
        <p class="sub">${latest.hasHr
          ? `${formatSleepClock(latest.startTs)} – ${formatSleepClock(latest.endTs)}`
          : "休息条将在接入夜间心率后出现"}</p>
        ${renderSleepBar(latest.segments)}
        ${latest.contrast ? `<p class="sleep-contrast">${escapeHtml(latest.contrast)}</p>` : ""}
      </section>
      ${report.length > 1 ? `<section class="record-section">
        <div class="section-head"><h3>近几夜</h3></div>
        ${report.slice(1).map((row) => renderSleepNightRow(row)).join("")}
      </section>` : ""}
    `;
  return `${topbar("近期睡眠", { back: true, backTo: "#/records" })}
  <main class="page sleep-page">
    ${hero}
    <p class="disclaimer">这是参考性生理反馈，不是健康检测，也不能替代医生或专业人士建议。心情和心率都留在本机，不会发给 AI。</p>
  </main>
  ${nav("records")}`;
}

function renderNotesList() {
  const sessions = bodyNotes.sessions;
  return `${topbar("身体笔记", { back: true })}
  <main class="page notes-list-page">
    <h2 class="lead">每一次，都可以由你重新理解</h2>
    <p class="sub">记录描述当时发生了什么，不替你评分，也不形成医疗结论。</p>
    <div class="flow-note">
      <span>${icon("activity")}</span>
      <div><strong>数据走向</strong><small>设备聚合 → 单次记录 → 你选择读取范围 → Chat 9B</small></div>
    </div>
    <div class="section-head"><h3>使用记录</h3><span>${sessions.length} 次</span></div>
    ${sessions.length ? sessions.map((session) => renderSessionRow(session)).join("") : `
      <div class="empty">${icon("bookmark")}<p>还没有可回看的记录</p></div>`}
    <p class="disclaimer">这里只有历史回看，不提供恢复、调档或设备控制。</p>
  </main>`;
}

function renderSessionRow(session) {
  const mode = MODE_UI[session.mode] || MODE_UI.free;
  return `<button class="session-row" data-act="open-session" data-session="${escapeHtml(session.session_id)}">
    <span class="session-date"><strong>${formatSessionDate(session.started_at)}</strong><small>${pad(new Date(session.started_at).getHours())}:${pad(new Date(session.started_at).getMinutes())}</small></span>
    <span class="session-main">
      <strong>${escapeHtml(session.title)}</strong>
      <small>${mode.label} · ${formatDuration(session.duration_s)} · 最高 ${session.max_level} 档</small>
    </span>
    <span class="quality" style="--quality:${mode.color}">${QUALITY_UI[session.data_quality]}</span>
    <span class="chev">${icon("chevron")}</span>
  </button>`;
}

function notesMutationsLocked() {
  return bodyNotes.mutationsLocked;
}

function renderNoteDetail(sessionId) {
  const session = bodyNotes.getSession(sessionId);
  if (!session) return renderMissingSession();
  const mode = MODE_UI[session.mode] || MODE_UI.free;
  return `${topbar("单次记录", {
    back: true,
    action: notesMutationsLocked()
      ? ""
      : `<button class="icon-btn danger-icon" data-act="delete-session" data-session="${escapeHtml(sessionId)}" aria-label="删除本次记录">${icon("trash")}</button>`,
  })}
  <main class="page note-detail-page">
    <div class="record-title">
      <span class="mode-mark" style="--mode:${mode.color}">${mode.label}</span>
      <h2>${escapeHtml(session.title)}</h2>
      <p>${formatSessionDate(session.started_at, true)} · ${formatDuration(session.duration_s)} · ${QUALITY_UI[session.data_quality]}</p>
    </div>

    <section class="fact-grid" aria-label="本次事实摘要">
      <div><span>最高档位</span><strong>${session.max_level} / ${NlConst.levelMax}</strong></div>
      <div><span>使用时长</span><strong>${formatDuration(session.duration_s)}</strong></div>
      <div><span>温感趋势</span><strong>${escapeHtml(session.temperature.direction === "rising" ? "缓慢上升" : "整体平稳")}</strong></div>
      <div><span>压力节律</span><strong>${escapeHtml(session.pressure.direction === "varied" ? "变化较多" : session.pressure.direction === "rising" ? "后段连续" : "整体平稳")}</strong></div>
    </section>

    <section class="record-section">
      <div class="section-head"><h3>档位与传感趋势</h3><span>低频聚合</span></div>
      ${renderTimeline(session.timeline)}
      <div class="trend-copy"><span>${icon("thermometer")}</span><p>${escapeHtml(session.temperature.label)}</p></div>
      <div class="trend-copy"><span>${icon("activity")}</span><p>${escapeHtml(session.pressure.label)}</p></div>
      <p class="microcopy">图中不显示原始 12 Hz 数组；AI 只读取趋势、数据质量和你确认的文字。</p>
    </section>

    <section class="record-section">
      <h3>事实摘要</h3>
      <p>${escapeHtml(session.summary)}</p>
      ${session.user_feedback ? `<div class="feedback"><strong>我当时的感受</strong><p>${escapeHtml(session.user_feedback)}</p></div>` : ""}
    </section>

    <section class="record-section">
      <div class="section-head"><h3>我保存的发现</h3><span>${session.notes.length} 条</span></div>
      ${session.notes.length ? session.notes.map((note) => `
        <div class="saved-note"><p>${escapeHtml(note.text)}</p>${notesMutationsLocked() ? "" : `<button class="icon-btn" data-act="delete-note" data-note="${escapeHtml(note.note_id)}" aria-label="删除这条发现">${icon("trash")}</button>`}</div>
      `).join("") : `<p class="microcopy">对话默认不保存。只有你主动点击“保存这条发现”，它才会出现在这里。</p>`}
      <button class="inline-command" data-act="add-session-note" data-session="${escapeHtml(sessionId)}">${icon("plus")} 自己写一条</button>
    </section>

    <section class="data-path">
      <h3>这次数据会去哪里</h3>
      <ol><li>设备端先聚合温度与压力。</li><li>本页保存单次事实和你的反馈。</li><li>只有点击下方按钮，才把对应范围发给 Chat 9B。</li></ol>
    </section>
  </main>
  <div class="note-scope-actions">
    <button data-act="insight-current" data-session="${escapeHtml(sessionId)}"><strong>只看这一次</strong><small>仅授权当前记录</small></button>
    <button data-act="insight-recent" data-session="${escapeHtml(sessionId)}"><strong>参考近期记录</strong><small>先确认具体范围</small></button>
  </div>`;
}

function renderTimeline(points) {
  if (!points?.length) return `<div class="empty compact">没有足够的趋势数据</div>`;
  return `<div class="mini-chart" aria-label="本次档位和压力趋势">
    ${points.map((point) => `<div class="chart-col">
      <span class="pressure-bar" style="--pressure:${Math.round(point.pressure_index * 100)}%"></span>
      <span class="level-bar" style="--level:${Math.round(point.level / NlConst.levelMax * 100)}%"></span>
      <small>${point.minute}'</small>
    </div>`).join("")}
  </div>
  <div class="chart-legend"><span><i class="pressure-key"></i>压力指数</span><span><i class="level-key"></i>档位</span></div>`;
}

function renderMissingSession() {
  return `${topbar("身心记录", { back: true })}<main class="page"><div class="empty">这条记录已删除或不可用。</div></main>`;
}

function renderInsight(sessionId, query) {
  const session = bodyNotes.getSession(sessionId);
  if (!session) return renderMissingSession();
  const scope = query.get("scope") === "recent" ? "recent" : "current";
  const ids = scope === "recent" ? [...new Set((query.get("ids") || "").split(","))]
    .filter((id) => id && id !== sessionId && bodyNotes.getSession(id))
    .slice(0, 10) : [];
  const sources = [session, ...ids.map((id) => bodyNotes.getSession(id)).filter(Boolean)];
  const messages = bodyNotes.messages(sessionId, scope);
  const scopeLabel = scope === "recent" ? `近期对比 · ${sources.length} 次` : "只看本次";
  return `${topbar("了解自己", { back: true })}
  <main class="insight-page">
    <div class="scope-strip"><strong>${scopeLabel}</strong><span>不会控制设备</span></div>
    <div class="source-strip">${sources.map((item) => `<span>${formatSessionDate(item.started_at)} · ${(MODE_UI[item.mode] || MODE_UI.free).label}</span>`).join("")}</div>
    <div class="chat-thread">
      <div class="chat-day">本次对话临时保存</div>
      <div class="bubble-row assistant"><div class="avatar">N</div><div class="bubble">${scope === "recent" ? "我只会比较上方列出的记录。你想先从哪一点聊起？" : "我只会读取这一次的记录。你最想理解哪个片段？"}</div></div>
      ${messages.map((message, index) => renderChatMessage(message, index)).join("")}
      ${ui.insightSending ? `<div class="bubble-row assistant"><div class="avatar">N</div><div class="bubble typing">正在整理已授权的记录…</div></div>` : ""}
    </div>
  </main>
  <form class="chat-composer" id="insight-form" data-session="${escapeHtml(sessionId)}" data-scope="${scope}" data-ids="${escapeHtml(ids.join(","))}">
    <textarea name="message" rows="1" maxlength="2000" placeholder="问问这一次的自己" aria-label="输入想了解的问题"></textarea>
    <button type="submit" aria-label="发送" ${ui.insightSending ? "disabled" : ""}>${icon("send")}</button>
  </form>`;
}

function renderChatMessage(message, index) {
  if (message.role === "user") {
    return `<div class="bubble-row user"><div class="bubble">${escapeHtml(message.text)}</div></div>`;
  }
  const save = message.candidate ? `<button class="save-insight" data-act="save-insight" data-index="${index}">${icon("bookmark")} 保存这条发现</button>` : "";
  return `<div class="bubble-row assistant"><div class="avatar">N</div><div><div class="bubble">${escapeHtml(message.text)}</div>${save}</div></div>`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function renderSettings() {
  const channelRow = `<div class="list-row">
      <strong>连接方式</strong>
      <small>${Object.values(CHANNEL).map((c) => `
        <button class="chip${link.channel === c ? " active" : ""}" data-act="channel" data-channel="${c}">${CHANNEL_LABEL[c]}</button>
      `).join("")}</small>
    </div>`;
  const addressRow = link.channel === CHANNEL.WIFI
    ? `<div class="list-row">
        <strong>玩具地址</strong>
        <small>
          <input id="toy-address" type="text" inputmode="url" spellcheck="false"
                 placeholder="192.168.1.20 或 nascent.local" value="${escapeHtmlApp(link.address)}">
          仅在本次使用中保存。
        </small>
      </div>`
    : "";
  const provisionRow = `<div class="list-row">
      <strong>设置设备 WiFi</strong>
      <small>
        <input id="wifi-ssid" type="text" maxlength="32" autocomplete="off" spellcheck="false"
               placeholder="2.4 GHz 网络名称">
        <input id="wifi-psk" type="password" maxlength="63" autocomplete="off"
               placeholder="密码（开放网络可留空）">
        <button type="button" class="primary" data-act="provision-wifi">保存</button>
        请先连接设备。保存后稍等片刻，再选择 WiFi。
      </small>
    </div>`;

  return `${topbar("我的")}
  <main class="page">
    <div class="group">设备</div>
    <div class="device-block">
      <p class="device-section-label">主设备 · 玩具</p>
      ${statusBar({ connectable: true })}
      ${channelRow}
      ${addressRow}
      ${provisionRow}
    </div>
    <div class="device-block">
      <p class="device-section-label">健康手环 · 小米手环 7</p>
      ${bandStatusBar()}
    </div>
    <button class="list-row" data-act="reread-guide">
      <strong>重新阅读使用指南</strong>
      <small>与首次启动中的使用指南正文相同</small>
    </button>
    <div class="group">安全与隐私</div>
    <button class="list-row" data-act="safeword-manage">
      <strong>安全词管理</strong>
      <small>${safewordSummary()}</small>
    </button>
    <div class="list-row">
      <strong>停止后如何恢复</strong>
      <small>请在设备上长按恢复键两秒。</small>
    </div>
    <button class="list-row" data-act="toggle-app-lock">
      <strong>打开时需要输入锁屏密码</strong>
      <small>${ui.appLock ? "已开启" : "已关闭"} · 点击切换</small>
    </button>
    <button class="list-row" data-act="local-data">
      <strong>本地数据</strong>
      <small>管理心绪、身体笔记、AI自定义人设</small>
    </button>
    <div class="group">AI 伴侣人设</div>
    <button class="list-row" data-act="persona-settings">
      <strong>人设设置</strong>
      <small>${personaSummary()}</small>
    </button>
    <div class="group">通用</div>
    <button class="list-row" data-act="notify-settings">
      <strong>通知</strong>
      <small>${notifySummary()}</small>
    </button>
    <button class="list-row" data-act="appearance-settings">
      <strong>外观</strong>
      <small>${appearanceSummary()}</small>
    </button>
    <button class="list-row" data-act="tts-settings">
      <strong>语音合成</strong>
      <small>${ttsProviderSummary()}</small>
    </button>
    <button class="list-row" data-act="subscribe-settings">
      <strong>Nascent Love+</strong>
      <small>${ui.prefs.subscribed ? "已订阅" : "订阅与会员管理"}</small>
    </button>
    <div class="group">关于</div>
    <button class="list-row" data-act="lab">
      <strong>硬件调试</strong>
      <small>查看连接、传感器与设备状态</small>
    </button>
  </main>
  ${nav("settings")}`;
}

function safewordSummary() {
  const words = String(ui.prefs.safewords || "")
    .split(/[,，]/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (!words.length) return "尚未设置";
  if (words.length === 1) return words[0];
  return `${words[0]} 等 ${words.length} 个`;
}

function notifySummary() {
  if (!ui.prefs.notifyEnabled) return "已关闭";
  return ui.prefs.notifyVeiled ? "已开启 · 使用隐晦文案" : "已开启 · 使用普通文案";
}

function appearanceSummary() {
  return {
    light: "全部浅色",
    dark: "全部深色",
    default: "默认（亲密时刻深，心绪与我的浅）",
  }[ui.prefs.appearance] || "默认";
}

function ttsProviderSummary() {
  return ui.prefs.ttsProvider === "mimo" ? "小米 MiMo" : "MiniMax";
}

function renderLocalData() {
  return `${topbar("本地数据", { back: true, backTo: "#/settings" })}
  <main class="page">
    <p class="sub">心绪记录、身体笔记与 AI 自定义人设默认保存在本机。</p>
    <button class="list-row" data-act="view-persona-settings">
      <strong>查看目前的 AI 伴侣设置</strong>
      <small>${personaSummary()}</small>
    </button>
    <button class="list-row" data-act="export-data">
      <strong>数据导出</strong>
      <small>导出本机心绪、笔记与自定义人设（demo 复制为文本）</small>
    </button>
    <button class="list-row" data-act="storage-settings">
      <strong>查看（修改）存储位置</strong>
      <small>当前：${ui.prefs.storageMode === "cloud" ? "云同步" : "本地模式"}</small>
    </button>
    <button class="list-row danger-row" data-act="clear-all-local">
      <strong>清除所有本地数据</strong>
      <small>包括身体笔记、自定义伴侣人设等</small>
    </button>
  </main>`;
}

function confirmClearLocalData() {
  closeSheet();
  const sheet = openSheet(`
    <h2>清除所有本地数据？</h2>
    <p class="sub" style="margin:8px 0 18px">将删除本机上的心绪记录、身体笔记、自定义伴侣人设等数据。此操作不可撤销。</p>
    <div class="ob-actions">
      <button class="ghost" data-clear-cancel>取消</button>
      <button class="primary danger-btn" data-clear-confirm>确认清除</button>
    </div>
  `);
  sheet.querySelector("[data-clear-cancel]").onclick = () => closeSheet();
  sheet.querySelector("[data-clear-confirm]").onclick = async () => {
    heart.clearLocal();
    nightHeartLog.reset();
    bodyNotes.clearTemporaryChats();
    scenarioChat.clearAll();
    try { localStorage.removeItem(THREAD_KEY); } catch { /* ignore */ }
    try {
      await fetch(`/v1/persona/custom?user_id=${encodeURIComponent(LOCAL_USER)}`, { method: "DELETE" });
    } catch { /* ignore */ }
    ui.skipRemoteCustoms = true;
    ui.persona = {
      mode: null,
      presetId: "gentle",
      customText: "",
      model: "gpt-4o-mini",
      customs: [],
      activeCustomId: null,
      editingId: null,
    };
    savePersonaSettings();
    closeSheet();
    toast("已清除所有本地数据");
    go("#/settings");
  };
}

function renderPersonaHub() {
  const customCount = ui.persona.customs.length;
  return `${topbar("人设设置", { back: true, backTo: "#/settings" })}
  <main class="page">
    <p class="lead">选择人设方式</p>
    <p class="sub">人设只影响说什么，不决定灯色与强度。</p>
    <button class="ob-choice ${ui.persona.mode === "fixed" ? "selected" : ""}" data-act="persona-mode" data-mode="fixed">
      <strong>固定人设</strong>
      <span>从已审核的预设中选择</span>
    </button>
    <button class="ob-choice" data-act="persona-customs">
      <strong>查看自定义人设</strong>
      <span>${customCount ? `已保存 ${customCount} 个，点此查看或编辑` : "还没有自定义人设"}</span>
    </button>
    <button class="ob-choice ${ui.persona.mode === "custom" ? "selected" : ""}" data-act="persona-mode" data-mode="custom">
      <strong>新建自定义人设</strong>
      <span>写他是谁、怎么叫你，或做个小问卷。</span>
    </button>
  </main>`;
}

function renderPersonaFixed() {
  const list = ui.personas.length ? ui.personas : PERSONA_PRESETS;
  return `${topbar("固定人设", { back: true, backTo: "#/settings/persona" })}
  <main class="page">
    <p class="sub">点选一个人设作为当天陪伴风格。首选「${PERSONA_CARDS.gentle?.name || "陆聿"}」为固有人设 001。</p>
    ${list.map((p) => `
      <button class="ob-choice ${ui.persona.presetId === p.id ? "selected" : ""}" data-act="persona-pick" data-id="${p.id}">
        <strong>${p.name}${p.id === "gentle" ? " · 固有 001" : ""}</strong>
        <span>${p.tone}</span>
      </button>
    `).join("")}
    <button class="primary" data-act="persona-save-fixed" style="margin-top:16px">保存</button>
  </main>`;
}

function renderPersonaCustom(editId = null) {
  const editing = editId
    ? ui.persona.customs.find((c) => c.id === editId)
    : null;
  if (editing) {
    if (ui.persona.editingId !== editing.id) {
      ui.draftPersonaCard = savedPersonaToDraft(editing);
      ui.draftAvatar = editing.avatar || ui.draftAvatar;
    }
    ui.persona.editingId = editing.id;
  } else {
    ui.persona.editingId = null;
  }
  const draft = personaFormDraft(editing);
  const name = draft.assistant_name || draft.name || "";
  const avatar = ui.draftAvatar || editing?.avatar || "";
  const clonedVoice = String(draft.tts?.localClipName || draft.tts?.voice || "").trim();
  const selectedVibe = PERSONA_VIBES.find((item) => item.id === draft.vibe);
  const backTo = ui.scenarioHandoff
    ? "#/intimacy/scenario"
    : (editing ? "#/settings/persona/customs" : "#/settings/persona");
  return `${topbar(editing ? "编辑自定义人设" : "自己写一个他", { back: true, backTo })}
  <main class="page persona-guide">
    <p class="sub">他会怎么陪你，都写在这里。做完会保存到云端，出现在「选择人设」里。</p>
    <p class="quiz-link">不知道怎么填？<button type="button" class="text-link" data-act="persona-quiz">做个小问卷</button></p>
    <div class="persona-guide-thread">
      <div class="bubble-row assistant"><div class="bubble">先告诉我，你今天想被怎样陪着？</div></div>
      <div class="persona-vibe-row">
        ${PERSONA_VIBES.map((vibe) => `
          <button type="button" class="chip persona-vibe ${draft.vibe === vibe.id ? "on" : ""}" data-act="persona-vibe" data-vibe="${escapeHtmlApp(vibe.id)}">${escapeHtmlApp(vibe.reply)}</button>
        `).join("")}
      </div>
      ${selectedVibe
        ? `<div class="bubble-row user"><div class="bubble">${escapeHtmlApp(selectedVibe.reply)}</div></div>
           <div class="bubble-row assistant"><div class="bubble">${escapeHtmlApp(selectedVibe.hint)} 名字可以自己改。</div></div>`
        : `<div class="bubble-row assistant"><div class="bubble">点一种感觉，或者自己写他是谁、怎么叫你。</div></div>`}
    </div>
    <label class="ob-label">头像</label>
    <div class="avatar-edit">
      ${personaAvatarHtml({ name: name || "新", avatar }, "avatar avatar-preview")}
      <label class="ghost avatar-upload">上传头像
        <input id="persona-avatar-file" type="file" accept="image/*" hidden />
      </label>
      <label class="ghost avatar-upload">他的声音
        <input id="persona-voice-file" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,.mp3,.m4a,.wav" hidden />
      </label>
    </div>
    <p class="ob-hint">${clonedVoice ? `已经记下这段声音（演示，尚未送云端）${draft.tts?.localClipName ? `：${escapeHtmlApp(draft.tts.localClipName)}` : ""}。通话仍用人设系统音色。` : "单人、尽量安静、至少 10 秒。本轮只在本机记下，不会上传克隆。"}</p>
    <label class="ob-label" for="persona-assistant-name">他的名字</label>
    <input id="persona-assistant-name" class="ob-field" maxlength="40" value="${escapeHtmlApp(name)}" placeholder="想被怎么叫？比如陆聿" />
    <label class="ob-label" for="persona-user-name">他怎么叫你</label>
    <input id="persona-user-name" class="ob-field" maxlength="40" value="${escapeHtmlApp(draft.user_name)}" placeholder="宝贝、丫头，或你的名字" />
    <label class="ob-label" for="persona-profile">他是谁</label>
    <textarea id="persona-profile" class="ob-input" rows="3" placeholder="用一两句说说他是谁、什么脾气">${escapeHtmlApp(draft.profile)}</textarea>
    <label class="ob-label" for="persona-skills">他聊天时会做什么</label>
    <textarea id="persona-skills" class="ob-input" rows="3" placeholder="他会撒娇？会损你？会安静陪着？一行一件">${escapeHtmlApp(draft.skills)}</textarea>
    <label class="ob-label" for="persona-background">你们现在是什么关系</label>
    <textarea id="persona-background" class="ob-input" rows="2" placeholder="比如正在谈恋爱，他刚加完班">${escapeHtmlApp(draft.background)}</textarea>
    <label class="ob-label" for="persona-rules">他要记住的规矩</label>
    <textarea id="persona-rules" class="ob-input" rows="3" placeholder="比如不要自称 AI，每次只回一两句">${escapeHtmlApp(draft.rules)}</textarea>
    <label class="ob-label" for="persona-spoken">开场他会说什么</label>
    <textarea id="persona-spoken" class="ob-input" rows="2" placeholder="他开口第一句会说什么？">${escapeHtmlApp(draft.spoken)}</textarea>
    <label class="ob-label" for="persona-prologue">此刻是什么场面</label>
    <textarea id="persona-prologue" class="ob-input" rows="2" placeholder="比如晚上刚下班，他靠在沙发上">${escapeHtmlApp(draft.prologue)}</textarea>
    <div class="ob-actions" style="margin-top:16px">
      <button class="ghost" data-act="persona-save-custom">保存</button>
      ${ui.scenarioHandoff
        ? `<button class="primary" data-act="persona-start-chat">直接开始</button>`
        : `<button class="primary" data-act="persona-use-custom">使用</button>`}
    </div>
  </main>`;
}

function quizOptionOn(question, option) {
  const answers = ui.quizAnswers || emptyQuizAnswers();
  if (question.multiple) {
    return Array.isArray(answers.skills) && answers.skills.includes(option.id);
  }
  return answers[question.id] === option.id;
}

function renderPersonaQuiz() {
  const answers = ui.quizAnswers || emptyQuizAnswers();
  const backTo = ui.scenarioHandoff ? "#/intimacy/scenario" : "#/settings/persona/custom";
  return `${topbar("做个小问卷", { back: true, backTo })}
  <main class="page persona-quiz">
    <p class="sub">点选就好。做完会生成他，存到云端，并出现在「选择人设」里。</p>
    ${PERSONA_QUIZ.map((question) => `
      <section class="quiz-block">
        <h3>${escapeHtmlApp(question.prompt)}</h3>
        <div class="persona-vibe-row">
          ${question.options.map((option) => `
            <button type="button" class="chip persona-vibe ${quizOptionOn(question, option) ? "on" : ""}" data-act="${question.multiple ? "persona-quiz-toggle" : "persona-quiz-pick"}" data-q="${escapeHtmlApp(question.id)}" data-id="${escapeHtmlApp(option.id)}">${escapeHtmlApp(option.label)}</button>
          `).join("")}
        </div>
        ${question.custom && question.id === "name"
          ? `<input id="quiz-name-custom" class="ob-field" maxlength="40" value="${escapeHtmlApp(answers.nameCustom || "")}" placeholder="${escapeHtmlApp(question.placeholder)}" />`
          : ""}
        ${question.custom && question.id === "user_name"
          ? `<input id="quiz-user-custom" class="ob-field" maxlength="40" value="${escapeHtmlApp(answers.userCustom || "")}" placeholder="${escapeHtmlApp(question.placeholder)}" />`
          : ""}
      </section>
    `).join("")}
    <div class="ob-actions" style="margin-top:16px">
      <button class="ghost" data-act="persona-new">还是自己写</button>
      <button class="primary" data-act="persona-quiz-save">${ui.scenarioHandoff ? "生成并开始" : "生成他"}</button>
    </div>
  </main>`;
}

function renderCustomPersonaList() {
  const list = ui.persona.customs;
  return `${topbar("自定义人设", { back: true, backTo: "#/settings/persona" })}
  <main class="page">
    <p class="sub">点选可编辑已保存的自定义人设。</p>
    ${list.length === 0
      ? `<div class="empty">还没有自定义人设</div>
         <button class="primary" data-act="persona-mode" data-mode="custom">去创建</button>`
      : list.map((c, index) => {
        const active = ui.persona.activeCustomId === c.id;
        return `<button class="list-row" data-act="persona-edit" data-id="${c.id}">
          <strong>${escapeHtmlApp(c.name || customPersonaTitle(c, index))}${active ? " · 当前" : ""}</strong>
          <small>${escapeHtmlApp(customPersonaBlurb(c))}</small>
        </button>`;
      }).join("")}
  </main>`;
}

function escapeHtmlApp(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openUsageGuideSheet() {
  const pages = fullGuidePages();
  ui.guideSheetIndex = 0;

  const paintGuide = () => {
    const page = pages[ui.guideSheetIndex];
    const last = ui.guideSheetIndex >= pages.length - 1;
    const sheet = openSheet(`
      <p class="group" style="margin-top:0">使用指南 · ${ui.guideSheetIndex + 1}/${pages.length}</p>
      <h2>${page.title}</h2>
      <div class="ob-placeholder" style="min-height:140px;margin:12px 0 20px">${page.body}</div>
      <button class="primary" data-guide-next>${last ? "完成" : "下一页"}</button>
    `);
    sheet.querySelector("[data-guide-next]").onclick = () => {
      if (last) {
        closeSheet();
        return;
      }
      ui.guideSheetIndex += 1;
      paintGuide();
    };
  };
  paintGuide();
}

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function renderSafewordManage() {
  const canSpeak = speechSupported();
  return `${topbar("安全词管理", { back: true, backTo: "#/settings" })}
  <main class="page">
    <p class="sub">可设置多个安全词，用中文或英文逗号分隔。文字与语音任选。</p>
    <label class="ob-label">文字输入</label>
    <input id="safeword-input" class="ob-field" type="text" value="${escapeHtmlApp(ui.prefs.safewords)}" placeholder="例如：红灯，暂停，停下" />
    <label class="ob-label">语音输入</label>
    <div class="ob-voice-row">
      <button type="button" class="ghost ob-voice-btn" data-act="safeword-voice" ${canSpeak ? "" : "disabled"}>
        ${canSpeak ? "点击说出安全词" : "当前浏览器不支持语音"}
      </button>
      <span class="ob-hint" id="safeword-voice-hint">${canSpeak ? "说完会追加到上方输入框，可用逗号继续添加。" : "请用文字输入。"}</span>
    </div>
    <button class="primary" data-act="safeword-save" style="margin-top:16px">保存</button>
  </main>`;
}

function renderNotifySettings() {
  return `${topbar("通知", { back: true, backTo: "#/settings" })}
  <main class="page">
    <button class="ob-choice ${ui.prefs.notifyEnabled ? "selected" : ""}" data-act="notify-toggle">
      <strong>通知总开关</strong>
      <span>${ui.prefs.notifyEnabled ? "当前：开" : "当前：关"}</span>
    </button>
    <button class="ob-choice ${ui.prefs.notifyVeiled ? "selected" : ""}" data-act="notify-veiled" ${ui.prefs.notifyEnabled ? "" : "disabled"}>
      <strong>使用隐晦文案</strong>
      <span>${ui.prefs.notifyVeiled ? "推送措辞更含蓄" : "使用普通文案"}</span>
    </button>
  </main>`;
}

function renderAppearanceSettings() {
  const options = [
    ["light", "全部浅色", "心绪、亲密时刻、我的都用浅色"],
    ["dark", "全部深色", "三处 Tab 都用深色低光"],
    ["default", "默认", "亲密时刻深色；心绪与我的浅色"],
  ];
  return `${topbar("外观", { back: true, backTo: "#/settings" })}
  <main class="page">
    ${options.map(([id, title, hint]) => `
      <button class="ob-choice ${ui.prefs.appearance === id ? "selected" : ""}" data-act="appearance-set" data-mode="${id}">
        <strong>${title}</strong>
        <span>${hint}</span>
      </button>
    `).join("")}
  </main>`;
}

function renderTtsSettings() {
  const options = [
    ["minimax", "MiniMax", "默认。情感走 voice_setting.emotion，人设用系统音色。"],
    ["mimo", "小米 MiMo", "风格写在 user 消息里，台词只放 assistant。ASR 仍走硅基 SenseVoice。"],
  ];
  return `${topbar("语音合成", { back: true, backTo: "#/settings" })}
  <main class="page">
    <p class="sub">只换怎么念台词。听写还是同一条 ASR，不换成本地模型。</p>
    ${options.map(([id, title, hint]) => `
      <button class="ob-choice ${ui.prefs.ttsProvider === id ? "selected" : ""}" data-act="tts-set" data-provider="${id}">
        <strong>${title}</strong>
        <span>${hint}</span>
      </button>
    `).join("")}
  </main>`;
}

function renderSubscribeSettings() {
  return `${topbar("Nascent Love+", { back: true, backTo: "#/settings" })}
  <main class="page">
    <p class="lead">${ui.prefs.subscribed ? "会员有效" : "订阅管理"}</p>
    <p class="sub">安全词、基础笔记、卫生指南、数据导出与删除不会进入付费墙。</p>
    <button class="primary" data-act="subscribe-toggle">
      ${ui.prefs.subscribed ? "取消订阅（demo）" : "开通订阅（demo）"}
    </button>
  </main>`;
}

function renderStorageSettings() {
  return `${topbar("存储位置", { back: true, backTo: "#/settings/data" })}
  <main class="page">
    <p class="sub">默认本地。云同步需要再次确认授权。</p>
    <button class="ob-choice ${ui.prefs.storageMode === "local" ? "selected" : ""}" data-act="storage-set" data-mode="local">
      <strong>本地模式</strong>
      <span>记录留在这台设备上（推荐）</span>
    </button>
    <button class="ob-choice ${ui.prefs.storageMode === "cloud" ? "selected" : ""}" data-act="storage-set" data-mode="cloud">
      <strong>云同步</strong>
      <span>开启后仍可随时撤回与删除</span>
    </button>
  </main>`;
}

function exportLocalData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    moods: [...heart.moods.entries()].map(([k, v]) => ({ date: k, mood: v.mood, note: v.note })),
    bodyNotes: heart.bodyNotes,
    persona: {
      mode: ui.persona.mode,
      customs: ui.persona.customs,
      activeCustomId: ui.persona.activeCustomId,
    },
    prefs: {
      storageMode: ui.prefs.storageMode,
      safewords: ui.prefs.safewords,
    },
  };
  const text = JSON.stringify(payload, null, 2);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast("已复制导出内容到剪贴板"),
      () => openExportSheet(text),
    );
  } else {
    openExportSheet(text);
  }
}

function openExportSheet(text) {
  const sheet = openSheet(`
    <h2>数据导出</h2>
    <p class="sub">可复制以下内容自行保存。</p>
    <textarea class="ob-input" rows="10" readonly>${escapeHtmlApp(text)}</textarea>
    <button class="primary" data-export-close style="margin-top:12px">关闭</button>
  `);
  sheet.querySelector("[data-export-close]").onclick = () => closeSheet();
}

function startSafewordVoice() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return;
  const rec = new Speech();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  const btn = root.querySelector('[data-act="safeword-voice"]');
  const hint = root.querySelector("#safeword-voice-hint");
  if (btn) {
    btn.classList.add("listening");
    btn.textContent = "正在听…";
  }
  rec.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
    const word = transcript.replace(/[。．！!？?\s]/g, "");
    if (!word) return;
    const input = root.querySelector("#safeword-input");
    if (!input) return;
    const cur = input.value.trim();
    input.value = cur ? `${cur}，${word}` : word;
    if (hint) hint.textContent = `已追加：「${word}」`;
  };
  rec.onerror = () => {
    if (btn) {
      btn.classList.remove("listening");
      btn.textContent = "点击说出安全词";
    }
    if (hint) hint.textContent = "没听清，可以再试一次。";
  };
  rec.onend = () => {
    if (btn) {
      btn.classList.remove("listening");
      btn.textContent = "点击说出安全词";
    }
  };
  try {
    rec.start();
  } catch {
    /* ignore */
  }
}

function applyTheme(tab) {
  const pref = ui.prefs.appearance;
  let theme = "light";
  if (pref === "dark") theme = "dark";
  else if (pref === "light") theme = "light";
  else theme = tab === "intimacy" ? "dark" : "light";
  root.dataset.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#16121c" : "#f8f1f4";
}

function startOnboardingFlow() {
  ui.gateReady = false;
  ui.onboarding?.destroy?.();
  applyTheme("heart"); // 浅色引导
  ui.onboarding = mountOnboarding(root, {
    onComplete({ firstCard, draft }) {
      ui.onboarding = null;
      ui.gateReady = true;
      // 必须先离开 #/onboarding，再写会触发 heart.subscribe(render) 的完成礼。
      // 否则 render 仍视 hash 为强制引导 → 再次 mount，并把 gateReady 打回 false，
      // 随后 early-return 会把主界面永久挡住（表现为「第二次 onboarding」）。
      if (
        location.hash.startsWith("#/onboarding")
        || !location.hash
        || location.hash === "#"
      ) {
        location.hash = "#/heart";
      }
      if (draft?.productId) {
        ui.devices.productId = draft.productId;
        saveDevices();
      }
      if (draft?.bandPaired) {
        ui.devices.bandConnected = true;
        saveDevices();
      }
      if (draft?.companionTone) {
        const tone = COMPANION_TONES.find((item) => item.id === draft.companionTone);
        ui.persona.mode = "fixed";
        ui.persona.presetId = tone?.presetId || "gentle";
        if (draft.personaNote) ui.persona.customText = draft.personaNote;
        savePersonaSettings();
      }
      if (draft?.intent) ui.prefs.intent = draft.intent;
      if (draft?.companionPace) ui.prefs.companionPace = draft.companionPace;
      if (draft?.careRemind) {
        ui.prefs.cleanRemind = draft.careRemind === "yes";
        if (draft.careRemind === "yes") ui.prefs.notifyEnabled = true;
      }
      if (Array.isArray(draft?.privacyComfort) && draft.privacyComfort.length) {
        const wants = draft.privacyComfort.includes("both")
          ? ["app_lock", "data_delete"]
          : draft.privacyComfort.filter((id) => id !== "both");
        ui.prefs.privacyWants = wants;
        if (wants.includes("app_lock")) {
          ui.appLock = true;
          saveAppLock();
        }
      }
      if (draft?.notification) ui.prefs.notifyEnabled = true;
      if (draft?.safeword && !draft.safewordSkipped) {
        ui.prefs.safewords = String(draft.safeword).trim() || ui.prefs.safewords;
      }
      savePrefs();
      if (firstCard) heart.prependCard(firstCard);
      render();
      toast("欢迎来到 Nascent");
    },
  });
}

function maybeRedirectLegacyNotes() {
  const current = route();
  const target = legacyNotesTarget(current);
  if (!target) return false;
  if (current.sessionId && current.view !== "insight") ui.selectedRecordId = current.sessionId;
  go(target);
  return true;
}

function maybeRedirectScenario() {
  const current = route();
  if (current.tab !== "intimacy" || current.page !== "scenario") return false;
  if (current.sessionId === "play") {
    go(ui.activePersona ? "#/intimacy/scenario/call" : "#/intimacy/scenario");
    return true;
  }
  if ((current.sessionId === "call" || current.sessionId === "chat") && !ui.activePersona) {
    go("#/intimacy/scenario");
    return true;
  }
  return false;
}

function beginScenarioChat(persona) {
  if (!persona) {
    toast("请先选择一个人设");
    return;
  }
  ui.activePersona = persona;
  ui.scenarioHandoff = false;
  const existing = scenarioChat.messages(persona.key);
  if (!existing.length) {
    scenarioChat.setPhase(persona.key, "approaching");
    scenarioChat.ensureOpening(persona.key, personaOpeningLine(persona, "approaching"));
  }
  resetSensorWindow();
  ingestUplinkSample(getUplink());
  stopSpeech();
  stopRingtone();
  clearTimeout(ui.callTimer);
  delete root.dataset.sceneCall;
  go("#/intimacy/scenario/chat");
}

function beginScenarioCall(persona) {
  if (!persona) {
    toast("请先选择一个人设");
    return;
  }
  ui.pendingScenarioPersona = persona;
  openSheet(`
    <h2>这次是否开启设备自动调节？</h2>
    <p class="sub" style="text-align:left">开启后，会根据对话和身体状态温和调整。离开情景或连接中断时会自动关闭。</p>
    <button class="primary" data-act="scenario-start-auto">开启自动调节</button>
    <button class="ghost" data-act="scenario-start-manual">仅陪伴，不自动控制</button>
  `);
}

function startScenarioCall(persona, { automationAuthorized = false } = {}) {
  if (!persona) return;
  closeSheet();
  ui.pendingScenarioPersona = null;
  ui.activePersona = persona;
  ui.scenarioHandoff = false;
  if (!scenarioChat.messages(persona.key).length) {
    scenarioChat.setPhase(persona.key, "approaching");
  }
  resetSensorWindow();
  ingestUplinkSample(getUplink());
  stopSpeech();
  stopRingtone();
  clearTimeout(ui.callTimer);
  delete root.dataset.sceneCall;
  unlockSpeechPlayback();
  startScenarioAutomation(persona, automationAuthorized);
  go("#/intimacy/scenario/call");
}

function stopScenarioAutomation() {
  const auto = ui.scenarioAutomation;
  auto.generation += 1;
  clearInterval(auto.timer);
  clearTimeout(auto.pendingTimer);
  auto.active = false;
  auto.authorized = false;
  auto.sessionId = "";
  auto.timer = null;
  auto.pendingTimer = null;
  auto.inFlight = false;
  auto.modeSetting = false;
  auto.lastSensorKey = "";
}

function startScenarioAutomation(persona, authorized) {
  stopScenarioAutomation();
  const auto = ui.scenarioAutomation;
  auto.generation += 1;
  auto.active = true;
  auto.authorized = Boolean(authorized);
  auto.sessionId = `scenario-${Date.now().toString(36)}`;
  if (!auto.authorized) return;
  ensureScenarioMode();
  auto.timer = setInterval(() => requestAutomaticControl(), AUTO_CONTROL_INTERVAL_MS);
  auto.pendingTimer = setTimeout(() => requestAutomaticControl(), 800);
}

async function ensureScenarioMode() {
  const auto = ui.scenarioAutomation;
  if (!auto.active || !auto.authorized || !getConnected() || auto.modeSetting) return;
  if (getUplink()?.mode === NlMode.SCENARIO) return;
  auto.modeSetting = true;
  try {
    const reason = await sendCommand(
      new BleDownlink({ cmd: NlCmd.SET_MODE, mode: NlMode.SCENARIO, auth: "" }),
      { automatic: true },
    );
    if (reason) toast(reason);
  } finally {
    auto.modeSetting = false;
  }
}

function scenarioControlTemplate(persona) {
  const templateId = String(persona?.key || "local-scenario");
  const saved = templateId.startsWith("template:")
    ? ui.templates.find((item) => `template:${item.template_id}` === templateId)
    : null;
  const allowlist = saved?.skills?.map((item) => item.skill_id)
    .filter((id) => id === "rhythm_segment" || id === "set_pattern") || ["rhythm_segment"];
  return { templateId: saved?.template_id || templateId, allowlist };
}

async function requestAutomaticControl({ explicitSignal = "" } = {}) {
  const auto = ui.scenarioAutomation;
  if (!auto.active || !auto.authorized || auto.inFlight || !getConnected()) return;
  const uplink = getUplink();
  if (!uplink) return;
  const generation = auto.generation;
  await ensureScenarioMode();
  if (!auto.active || !auto.authorized || auto.generation !== generation) return;
  if (getUplink()?.mode !== NlMode.SCENARIO) return;
  const persona = ui.activePersona;
  const template = scenarioControlTemplate(persona);
  const sensor = buildSensorContext(uplink, { bandConnected: ui.devices.bandConnected });
  auto.inFlight = true;
  try {
    const response = await fetch("/v1/agent/control-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: LOCAL_USER,
        session_id: auto.sessionId,
        session_mode: "scenario",
        template_id: template.templateId,
        template_skill_allowlist: template.allowlist,
        current_level: Number(uplink.level) || 0,
        consent_state: "confirmed",
        automation_authorized: true,
        sensor_context: sensor,
        explicit_user_signal: String(explicitSignal || "").slice(0, 500),
        recent_feedback: /慢|轻|小一点/.test(explicitSignal)
          ? "slow_down"
          : /停|暂停|不要/.test(explicitSignal)
            ? "pause"
            : /继续|保持/.test(explicitSignal)
              ? "keep"
              : "unknown",
      }),
    });
    if (!response.ok) return;
    const decision = await response.json();
    if (!auto.active || !auto.authorized || auto.generation !== generation) return;
    const target = Number(decision?.recommended_level);
    if (decision?.decision !== "recommend" || decision?.requires_user_confirmation !== false) return;
    if (!Number.isInteger(target) || target < NlConst.levelMin || target > NlConst.levelMax) return;
    const reason = await sendCommand(
      new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: target, auth: "" }),
      { automatic: true },
    );
    if (reason) toast(reason);
    else toast(`情景自动调到第 ${target} 档`);
  } catch {
    // Control 不可用时保持当前档位；对话与手动控制继续可用。
  } finally {
    if (auto.generation === generation) auto.inFlight = false;
  }
}

function scheduleAutomaticControlForSensorChange() {
  const auto = ui.scenarioAutomation;
  if (!auto.active || !auto.authorized || !getConnected()) return;
  const sensor = buildSensorContext(getUplink(), { bandConnected: ui.devices.bandConnected });
  const key = JSON.stringify([
    sensor.insert_state,
    sensor.temperature_state,
    sensor.pressure_rhythm,
    getUplink()?.alert || "none",
    getUplink()?.mode || NlMode.FREE,
  ]);
  if (key === auto.lastSensorKey) return;
  auto.lastSensorKey = key;
  clearTimeout(auto.pendingTimer);
  auto.pendingTimer = setTimeout(() => requestAutomaticControl(), 300);
}

function startCallSequence() {
  clearTimeout(ui.callTimer);
  const screen = root.querySelector(".call-screen");
  if (!screen || screen.getAttribute("data-call-stage") === "connected") return;
  startRingtone();
}

function answerIncomingCall() {
  const screen = root.querySelector(".call-screen");
  if (!screen || screen.getAttribute("data-call-stage") === "connected") return;
  stopRingtone();
  unlockSpeechPlayback();
  const persona = ui.activePersona;
  const hadHistory = Boolean(persona && scenarioChat.messages(persona.key).length);
  if (persona && !hadHistory) {
    scenarioChat.setPhase(persona.key, "approaching");
    scenarioChat.ensureOpening(persona.key, personaOpeningLine(persona, "approaching"));
  }
  screen.classList.add("is-answering");
  screen.setAttribute("data-call-stage", "connected");
  const kicker = root.querySelector(".call-kicker");
  const status = root.querySelector("[data-call-status]");
  const duration = root.querySelector("[data-call-duration]");
  const knob = root.querySelector("[data-call-knob]");
  if (kicker) kicker.textContent = "通话中";
  if (status) status.textContent = "我在听";
  if (duration) duration.hidden = false;
  if (knob) knob.style.transform = "";
  startCallClock();
  bindCallSwipe();
  const textBtn = root.querySelector("[data-act=call-text]");
  if (textBtn) textBtn.hidden = false;
  prepareLiveCall();
  const greeting = hadHistory
    ? personaRejoinLine(persona)
    : personaOpeningLine(persona, "approaching");
  updateCallCaption("assistant", greeting);
  liveCall?.playReply(greeting);
}

function startCallClock() {
  stopCallClock();
  const el = root.querySelector("[data-call-duration]");
  if (!el) return;
  const started = Date.now();
  const tick = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    el.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  tick();
  callClock = setInterval(tick, 1000);
}

function stopCallClock() {
  if (callClock) clearInterval(callClock);
  callClock = null;
}

function declineIncomingCall() {
  leaveScenarioCall();
  go("#/intimacy/scenario");
}

function openScenarioTextFromCall() {
  const screen = root.querySelector(".call-screen");
  if (screen?.dataset.leaving === "1") return;
  stopRingtone();
  stopLiveCall();
  stopHoldMic();
  stopCallClock();
  ui.chatFromCall = true;
  if (!screen) {
    go("#/intimacy/scenario/chat");
    return;
  }
  screen.dataset.leaving = "1";
  screen.classList.add("call-to-chat");
  clearTimeout(chatFromCallTimer);
  chatFromCallTimer = window.setTimeout(() => {
    chatFromCallTimer = null;
    go("#/intimacy/scenario/chat");
  }, 300);
}

function bindCallSwipe() {
  bindAnswerSlider();
  bindConnectedSwipeUp();
}

function bindAnswerSlider() {
  const screen = root.querySelector(".call-screen");
  const slider = root.querySelector("[data-call-slider]");
  const knob = root.querySelector("[data-call-knob]");
  if (!screen || !slider || !knob || slider.dataset.boundSwipe === "1") return;
  slider.dataset.boundSwipe = "1";
  let startX = null;
  const travelMax = () => Math.max(1, slider.clientWidth - knob.offsetWidth - 12);
  slider.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button) return;
    if (screen.getAttribute("data-call-stage") !== "ringing") return;
    startX = event.clientX;
    slider.setPointerCapture(event.pointerId);
  });
  slider.addEventListener("pointermove", (event) => {
    if (startX == null) return;
    const left = Math.max(0, Math.min(travelMax(), startX - event.clientX));
    knob.style.transform = `translateX(${-left}px)`;
  });
  slider.addEventListener("pointerup", (event) => {
    if (startX == null) return;
    const dx = event.clientX - startX;
    const left = startX - event.clientX;
    const threshold = travelMax() * 0.4;
    startX = null;
    if (left >= threshold || Math.abs(dx) < 12) {
      skipAnswerClick = true;
      answerIncomingCall();
      window.setTimeout(() => { skipAnswerClick = false; }, 0);
      return;
    }
    skipAnswerClick = false;
    if (dx >= 64) {
      declineIncomingCall();
      return;
    }
    knob.style.transform = "";
  });
  slider.addEventListener("pointercancel", () => {
    startX = null;
    knob.style.transform = "";
  });
}

function bindConnectedSwipeUp() {
  const layer = root.querySelector("[data-call-swipe]");
  if (!layer || layer.dataset.boundUp === "1") return;
  layer.dataset.boundUp = "1";
  let startY = null;
  let startX = null;
  layer.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button) return;
    if (event.target.closest(".call-hangup-btn, [data-act=end-call], [data-call-slider], [data-act=call-text]")) return;
    if (event.target.closest("[data-call-captions]")) return;
    if (root.querySelector(".call-screen")?.getAttribute("data-call-stage") !== "connected") return;
    startY = event.clientY;
    startX = event.clientX;
  });
  layer.addEventListener("pointerup", (event) => {
    if (startY == null) return;
    const dy = event.clientY - startY;
    const dx = event.clientX - startX;
    startY = null;
    startX = null;
    if (Math.abs(dx) > Math.abs(dy)) return;
    if (dy < -64) openScenarioTextFromCall();
  });
  layer.addEventListener("pointercancel", () => {
    startY = null;
    startX = null;
  });
}

function prepareLiveCall() {
  stopLiveCall();
  liveCall = createLiveCall({
    tts: () => speakOptionsForPersona(ui.activePersona, { provider: ui.prefs.ttsProvider }),
    onUtterance: async (text) => {
      updateCallCaption("user", text);
      const turn = await sendScenarioLine(text, { speak: false, skipRender: true });
      if (turn?.dialogue) updateCallCaption("assistant", turn.dialogue);
      return turn?.dialogue
        ? { dialogue: turn.dialogue, tts_style: turn.tts_style }
        : "";
    },
    onStatus: (status) => {
      const labels = {
        listening: "我在听",
        hearing: "正在听你说",
        thinking: "正在转成文字…",
        speaking: "对方在说",
      };
      const el = root.querySelector("[data-call-status]");
      if (el) el.textContent = labels[status] || "我在听";
      const wave = root.querySelector("[data-call-wave]");
      if (wave) wave.dataset.wave = status || "listening";
      if (status === "hearing") updateCallCaption("user", "……", { pending: true });
      if (status === "thinking") updateCallCaption("user", "正在转成文字…", { pending: true });
    },
    onError: (message) => {
      toast(message);
      const user = root.querySelector("[data-call-user]");
      if (user?.dataset.pending === "1") updateCallCaption("user", "");
    },
  });
  liveCall.start().catch(() => {
    toast("需要麦克风才能实时通话，也可以改用文字");
    const status = root.querySelector("[data-call-status]");
    if (status) status.textContent = "麦克风不可用，可改用文字";
  });
}

function stopLiveCall() {
  liveCall?.stop();
  liveCall = null;
}

function stopHoldMic() {
  holdMic?.cancel();
  holdMic = null;
  ui.voiceListening = false;
}

function bindHoldMic() {
  const btn = root.querySelector("[data-act=hold-mic]");
  if (!btn) {
    if (!ui.voiceListening) stopHoldMic();
    return;
  }
  if (holdMic && ui.voiceListening) return;
  holdMic?.cancel();
  holdMic = createHoldMic({
    onText: async (text) => {
      const area = root.querySelector("#scenario-chat-form textarea");
      if (area) area.value = text;
      await sendScenarioLine(text);
    },
    onError: (message) => toast(message),
    onListening: (on) => {
      ui.voiceListening = on;
      btn.classList.toggle("listening", on);
    },
  });
  btn.addEventListener("pointerdown", (event) => {
    if (event.button) return;
    event.preventDefault();
    ui.voiceListening = true;
    btn.classList.add("listening");
    btn.setPointerCapture(event.pointerId);
    holdMic.start().catch(() => {
      ui.voiceListening = false;
      btn.classList.remove("listening");
      toast("需要麦克风才能说话");
    });
  });
  btn.addEventListener("pointerup", (event) => {
    event.preventDefault();
    holdMic.stop();
  });
  btn.addEventListener("pointercancel", () => holdMic.cancel());
  btn.addEventListener("contextmenu", (event) => event.preventDefault());
}

function updateCallCaption(role, text, { pending = false } = {}) {
  const captions = root.querySelector("[data-call-captions]");
  const el = root.querySelector(role === "user" ? "[data-call-user]" : "[data-call-assistant]");
  const row = root.querySelector(role === "user" ? "[data-call-user-row]" : "[data-call-assistant-row]");
  const clipped = String(text || "").trim();
  if (captions) captions.hidden = false;
  if (row) row.hidden = !clipped;
  if (el) {
    if (role === "assistant" && !pending) el.innerHTML = formatCaptionHtml(clipped);
    else el.textContent = clipped;
    if (pending) el.dataset.pending = "1";
    else delete el.dataset.pending;
  }
  if (captions) captions.scrollTop = captions.scrollHeight;
}

function leaveScenarioCall() {
  stopSpeech();
  stopRingtone();
  stopLiveCall();
  stopHoldMic();
  stopCallClock();
  clearTimeout(ui.callTimer);
  clearTimeout(chatFromCallTimer);
  chatFromCallTimer = null;
  delete root.dataset.sceneCall;
  ui.voiceListening = false;
  stopScenarioAutomation();
}

function stashQuizDraft() {
  const nameEl = root.querySelector("#quiz-name-custom");
  const userEl = root.querySelector("#quiz-user-custom");
  if (!nameEl && !userEl) return;
  ui.quizAnswers = {
    ...emptyQuizAnswers(),
    ...(ui.quizAnswers || {}),
    nameCustom: nameEl?.value || "",
    userCustom: userEl?.value || "",
  };
}

function stashPersonaDraft() {
  if (ui.suppressPersonaStash) {
    ui.suppressPersonaStash = false;
    return;
  }
  stashQuizDraft();
  if (!root.querySelector("#persona-assistant-name")) return;
  const { page, sub } = route();
  if (page === "persona" && (sub === "custom" || sub === "edit")) {
    ui.draftPersonaCard = readPersonaCardDraftFromForm();
  }
}

function resetPersonaDraft() {
  ui.draftAvatar = null;
  ui.draftPersonaCard = emptyCardDraft();
  ui.quizAnswers = emptyQuizAnswers();
  ui.pendingCloneFile = null;
  ui.cloneNeedsTranscript = false;
}

function render() {
  stashPersonaDraft();
  if (maybeRedirectLegacyNotes()) return;
  if (maybeRedirectScenario()) return;
  // Onboarding 进行中：忽略其它重绘，避免打断渐变流程。
  // 已标记完成时必须放行，否则完成礼触发的误挂载会把主界面永久挡住。
  if (root.classList.contains("onboarding") && !ui.gateReady && !isOnboardingDone()) return;

  const force = shouldForceOnboarding();
  if (force) {
    // Demo：#/onboarding 可反复进入。完成收尾须先改 hash，见 onComplete。
    startOnboardingFlow();
    return;
  }
  if (!isOnboardingDone() && !ui.gateReady) {
    startOnboardingFlow();
    return;
  }

  const { tab, page, sub, id, sessionId, view, query } = route();
  applyTheme(tab === "lab" ? "settings" : tab);
  const nested = (tab === "intimacy" && page !== "root")
    || (tab === "settings" && page !== "root")
    || (tab === "records" && (view === "insight" || view === "sleep"))
    || tab === "lab";
  const onCall = tab === "intimacy" && page === "scenario" && sessionId === "call";
  const onChat = tab === "intimacy" && page === "scenario" && sessionId === "chat";
  const fromCall = Boolean(ui.chatFromCall && onChat);
  if (onChat) ui.chatFromCall = false;
  root.classList.toggle("subpage", nested);
  root.classList.toggle("chat-view", view === "insight" || onChat);
  root.classList.toggle("call-view", onCall);
  root.classList.remove("onboarding");
  if (!fromCall) root.classList.remove("from-call");
  if (onCall && root.dataset.sceneCall === "1") return;
  if (onChat && ui.voiceListening) return;
  if (!onCall) {
    stopRingtone();
    stopLiveCall();
    stopCallClock();
    clearTimeout(ui.callTimer);
    delete root.dataset.sceneCall;
    if (!onChat) {
      clearTimeout(chatFromCallTimer);
      chatFromCallTimer = null;
      stopHoldMic();
      stopSpeech();
      ui.voiceListening = false;
      stopScenarioAutomation();
    }
  }

  if (tab === "lab") {
    root.innerHTML = renderLab({
      connected: getConnected(),
      uplink: getUplink(),
      channel: link.channel,
      token: link.token,
      connectionState: getConnectionState(),
      lastReject: ui.labReject,
      uplinkStats: link.uplinkStats,
    });
  }
  else if (tab === "heart") root.innerHTML = renderHeart();
  else if (tab === "settings") {
    if (page === "persona" && sub === "fixed") root.innerHTML = renderPersonaFixed();
    else if (page === "persona" && sub === "customs") root.innerHTML = renderCustomPersonaList();
    else if (page === "persona" && sub === "edit" && id) root.innerHTML = renderPersonaCustom(id);
    else if (page === "persona" && sub === "quiz") root.innerHTML = renderPersonaQuiz();
    else if (page === "persona" && sub === "custom") root.innerHTML = renderPersonaCustom(null);
    else if (page === "persona") root.innerHTML = renderPersonaHub();
    else if (page === "data") root.innerHTML = renderLocalData();
    else if (page === "safeword") root.innerHTML = renderSafewordManage();
    else if (page === "notify") root.innerHTML = renderNotifySettings();
    else if (page === "appearance") root.innerHTML = renderAppearanceSettings();
    else if (page === "tts") root.innerHTML = renderTtsSettings();
    else if (page === "subscribe") root.innerHTML = renderSubscribeSettings();
    else if (page === "storage") root.innerHTML = renderStorageSettings();
    else root.innerHTML = renderSettings();
  }
  else if (tab === "records" && view === "insight") {
    root.innerHTML = renderInsight(sessionId || query.get("session"), query);
  }
  else if (tab === "records" && view === "sleep") {
    root.innerHTML = renderSleepSummary();
  }
  else if (tab === "records") root.innerHTML = renderRecords();
  else if (page === "control") root.innerHTML = renderControl();
  else if (page === "scenario") root.innerHTML = renderScenario();
  else if (tab === "intimacy") root.innerHTML = renderIntimacy();
  else root.innerHTML = renderIntimacy();
  bind();
  restoreCardScroll();
  if (onCall) {
    root.dataset.sceneCall = "1";
    startCallSequence();
  }
  if (fromCall) requestAnimationFrame(() => root.classList.add("from-call"));
}

function restoreCardScroll() {
  const cards = root.querySelector("[data-cards]");
  const card = cards?.children[heart.activeCardIndex];
  if (!cards || !card) return;
  cards.scrollLeft = card.offsetLeft;
}

function bind() {
  root.onclick = onClick;
  const cards = root.querySelector("[data-cards]");
  if (cards) {
    cards.addEventListener("scroll", () => {
      const w = cards.firstElementChild?.getBoundingClientRect().width || 1;
      const index = Math.round(cards.scrollLeft / (w + 10));
      heart.selectCard(index);
      const counter = root.querySelector("[data-card-counter]");
      if (counter) counter.textContent = `${heart.activeCardIndex + 1}/${heart.cards.length}`;
    }, { passive: true });
  }
  const slider = root.querySelector("#level-slider");
  if (slider) {
    slider.addEventListener("input", () => {
      ui.draftLevel = Number(slider.value);
      const label = root.querySelector("[data-level-label]");
      if (label) label.textContent = `档位 ${ui.draftLevel} / ${NlConst.levelMax}`;
    });
    slider.addEventListener("change", () => onLevelCommit(Number(slider.value)));
  }
  const form = root.querySelector("#insight-form");
  if (form) form.addEventListener("submit", onInsightSubmit);
  const personaForm = root.querySelector("#persona-form");
  if (personaForm) personaForm.addEventListener("submit", onPersonaSubmit);
  const scenarioForm = root.querySelector("#scenario-chat-form");
  if (scenarioForm) scenarioForm.addEventListener("submit", onScenarioChatSubmit);
  const avatarInput = root.querySelector("#persona-avatar-file");
  if (avatarInput) avatarInput.addEventListener("change", onPersonaAvatarPicked);
  const voiceInput = root.querySelector("#persona-voice-file");
  if (voiceInput) voiceInput.addEventListener("change", onPersonaVoicePicked);
  bindHoldMic();
  bindCallSwipe();
  root.querySelectorAll("[data-act=lab-check]").forEach((el) => {
    el.addEventListener("change", () => saveCheck(el.dataset.id, el.checked));
  });
}

async function onInsightSubmit(event) {
  event.preventDefault();
  if (ui.insightSending) return;
  const form = event.currentTarget;
  const area = form.elements.message;
  const message = area.value.trim();
  if (!message) return;
  const ids = form.dataset.ids.split(",").filter(Boolean).slice(0, 10);
  ui.insightSending = true;
  area.value = "";
  render();
  await bodyNotes.sendInsight(form.dataset.session, ids, message);
  ui.insightSending = false;
  render();
  requestAnimationFrame(() => root.querySelector(".chat-thread")?.scrollTo(0, 99999));
}

async function onScenarioChatSubmit(event) {
  event.preventDefault();
  const area = event.currentTarget.elements.message;
  const text = area.value.trim();
  if (!text) return;
  area.value = "";
  await sendScenarioLine(text);
}

async function sendScenarioLine(text, { speak = false, skipRender = false } = {}) {
  const persona = ui.activePersona;
  if (!persona || scenarioChat.sending) return;
  stopSpeech();
  const pending = scenarioChat.send(persona, text, {
    sensor_context: buildSensorContext(getUplink(), { bandConnected: ui.devices.bandConnected }),
  });
  if (!skipRender) render();
  const turn = await pending;
  requestAutomaticControl({ explicitSignal: text });
  if (!skipRender) render();
  requestAnimationFrame(() => root.querySelector(".chat-thread")?.scrollTo(0, 99999));
  if (speak && turn?.dialogue) {
    const result = await speakDialogue(turn.dialogue, {
      ...speakOptionsForPersona(persona, { provider: ui.prefs.ttsProvider }),
      tts_style: turn.tts_style,
      provider: ui.prefs.ttsProvider,
    });
    if (!result?.played && !result?.interrupted) toast("这次没播出声音，看文字就好");
  }
  return turn;
}

async function onPersonaAvatarPicked(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    ui.draftAvatar = await fileToAvatarDataUrl(file);
    render();
    toast("头像已更新，保存后才会记下");
  } catch (error) {
    toast(error.message || "头像无法使用");
  }
}

async function onPersonaVoicePicked(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  rememberLocalVoiceClip(file);
}

function rememberLocalVoiceClip(file) {
  stashPersonaDraft();
  const current = readPersonaCardDraftFromForm();
  ui.draftPersonaCard = {
    ...current,
    tts: {
      ...(current.tts || {}),
      localClipName: file.name || "voice.mp3",
      localClipDemo: true,
    },
  };
  ui.pendingCloneFile = null;
  ui.cloneNeedsTranscript = false;
  render();
  toast("已经记下这段声音（演示，尚未送云端）");
}

async function clonePendingVoice() {
  const file = ui.pendingCloneFile;
  if (file) rememberLocalVoiceClip(file);
}

function selectedSkills(form) {
  const ids = [...form.querySelectorAll("[data-act=toggle-skill].on")].map((btn) => btn.dataset.skill);
  const skills = [];
  if (ids.includes("rhythm_segment")) {
    skills.push({
      skill_id: "rhythm_segment",
      level: 3,
      pattern: "soft",
      duration_s: 90,
      requires_confirmation: true,
    });
  }
  if (ids.includes("set_pattern")) {
    skills.push({
      skill_id: "set_pattern",
      pattern: "wave",
      duration_s: 90,
      requires_confirmation: true,
    });
  }
  return skills.length ? skills : [{
    skill_id: "rhythm_segment",
    level: 3,
    pattern: "soft",
    duration_s: 90,
    requires_confirmation: true,
  }];
}

async function onPersonaSubmit(event) {
  event.preventDefault();
  if (ui.savingPersona) return;
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  if (!name) return;
  const tags = [...form.querySelectorAll("[data-act=toggle-tag].on")].map((btn) => btn.dataset.tag);
  const talk = form.querySelector("[data-act=talk-freq].on")?.dataset.freq || TALK_FREQS[1];
  const skills = selectedSkills(form);
  const description = [tags.join("、"), talk].filter(Boolean).join(" · ").slice(0, 240);
  const conversation = [{
    role: "user",
    content: `请创建人设「${name}」。风格：${tags.join("、") || "未指定"}。说话频率：${talk}。允许 Skill：${skills.map((item) => item.skill_id).join("、")}。`,
  }];
  ui.savingPersona = true;
  form.querySelector("[type=submit]")?.setAttribute("disabled", "disabled");
  try {
    const draftRes = await fetch("/v1/agent/templates/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: LOCAL_USER,
        persona_id: "custom",
        conversation,
      }),
    });
    let draft = draftRes.ok ? (await draftRes.json()).template : null;
    if (!draft) {
      draft = {
        template_id: `tpl_${Date.now().toString(16)}`,
        source: "custom",
        name,
        description,
        persona_id: "custom",
        skills,
        status: "draft",
      };
    } else {
      draft = { ...draft, name, description, skills, source: "custom", status: "draft" };
    }
    const confirmRes = await fetch(`/v1/agent/templates/confirm?user_id=${encodeURIComponent(LOCAL_USER)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!confirmRes.ok) throw new Error("confirm failed");
    const saved = await confirmRes.json();
    ui.templates = [...(ui.templates || []).filter((item) => item.template_id !== saved.template_id), saved];
    ui.activePersona = { key: `template:${saved.template_id}`, name: saved.name };
    toast("人设已保存");
    go("#/intimacy/scenario");
  } catch {
    toast("保存失败，请检查连接后重试");
  } finally {
    ui.savingPersona = false;
    if (route().sessionId === "new") render();
  }
}

async function onLevelCommit(level) {
  ui.draftLevel = level;
  await emit(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level, auth: "" }));
}

async function emit(cmd) {
  const reason = await sendCommand(cmd);
  if (reason) toast(reason);
  return reason;
}

async function onClick(event) {
  const t = event.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "hold-mic") return;
  if (act === "tab") {
    if (t.dataset.tab !== "intimacy") ui.scenarioHandoff = false;
    if (t.dataset.tab !== "intimacy") leaveScenarioCall();
    go(`#/${t.dataset.tab}`);
  }
  else if (act === "back") {
    if (t.dataset.to) {
      if (ui.scenarioHandoff) ui.scenarioHandoff = false;
      go(t.dataset.to);
      return;
    }
    const current = route();
    if (current.tab === "records" && (current.view === "insight" || current.view === "sleep")) go("#/records");
    else if (current.tab === "intimacy" && current.page === "scenario" && SCENARIO_FLOW.includes(current.sessionId)) {
      leaveScenarioCall();
      go("#/intimacy/scenario");
    } else if (current.tab === "intimacy" && current.page === "scenario" && current.sessionId) {
      go("#/intimacy/scenario");
    } else {
      go("#/intimacy");
    }
  }
  else if (act === "sub") {
    if (t.dataset.page === "control" && getConnected() && getUplink()?.mode !== NlMode.FREE) {
      await emit(new BleDownlink({ cmd: NlCmd.SET_MODE, mode: NlMode.FREE, auth: "" }));
    }
    go(`#/intimacy/${t.dataset.page}`);
  }
  else if (act === "settings") go("#/settings");
  else if (act === "persona-settings") go("#/settings/persona");
  else if (act === "view-persona-settings") go("#/settings/persona");
  else if (act === "persona-customs") go("#/settings/persona/customs");
  else if (act === "persona-edit") {
    const item = ui.persona.customs.find((c) => c.id === t.dataset.id);
    ui.draftPersonaCard = item ? savedPersonaToDraft(item) : emptyCardDraft();
    ui.draftAvatar = item?.avatar || null;
    go(`#/settings/persona/edit/${t.dataset.id}`);
  }
  else if (act === "persona-mode") {
    ui.persona.mode = t.dataset.mode;
    ui.persona.editingId = null;
    savePersonaSettings();
    if (t.dataset.mode === "custom") resetPersonaDraft();
    go(t.dataset.mode === "custom" ? "#/settings/persona/custom" : "#/settings/persona/fixed");
  }
  else if (act === "persona-pick") {
    ui.persona.presetId = t.dataset.id;
    savePersonaSettings();
    render();
  }
  else if (act === "persona-save-fixed") {
    ui.persona.mode = "fixed";
    savePersonaSettings();
    toast("已保存固定人设");
    go("#/settings");
  }
  else if (act === "persona-save-custom") {
    const result = await saveCustomPersonaFromForm({
      activate: false,
      createdNotice: !ui.scenarioHandoff,
    });
    if (!result.ok) return;
    if (ui.scenarioHandoff) {
      toast("人设已保存，可以直接开始");
      render();
      return;
    }
    if (result.createdNew) go("#/settings");
    else {
      toast("已保存");
      go("#/settings/persona/customs");
    }
  }
  else if (act === "persona-use-custom" || act === "persona-start-chat") {
    const result = await saveCustomPersonaFromForm({ activate: true, createdNotice: false });
    if (!result.ok) return;
    if (act === "persona-start-chat") {
      beginScenarioCall(findScenarioPersona(`custom:${result.id}`));
      return;
    }
    toast("已设为当前使用的自定义人设");
    go("#/settings/persona/customs");
  }
  else if (act === "local-data") go("#/settings/data");
  else if (act === "safeword-manage") go("#/settings/safeword");
  else if (act === "safeword-voice") startSafewordVoice();
  else if (act === "safeword-save") {
    const value = (root.querySelector("#safeword-input")?.value || "").trim();
    const words = value.split(/[,，]/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) {
      toast("请至少填写一个安全词");
      return;
    }
    ui.prefs.safewords = words.join("，");
    savePrefs();
    toast("安全词已保存");
    go("#/settings");
  }
  else if (act === "export-data") exportLocalData();
  else if (act === "storage-settings") go("#/settings/storage");
  else if (act === "storage-set") {
    ui.prefs.storageMode = t.dataset.mode === "cloud" ? "cloud" : "local";
    savePrefs();
    toast(ui.prefs.storageMode === "cloud" ? "已切换为云同步（demo）" : "已切换为本地模式");
    render();
  }
  else if (act === "notify-settings") go("#/settings/notify");
  else if (act === "notify-toggle") {
    ui.prefs.notifyEnabled = !ui.prefs.notifyEnabled;
    savePrefs();
    toast(ui.prefs.notifyEnabled ? "已开启通知" : "已关闭通知");
    render();
  }
  else if (act === "notify-veiled") {
    if (!ui.prefs.notifyEnabled) return;
    ui.prefs.notifyVeiled = !ui.prefs.notifyVeiled;
    savePrefs();
    toast(ui.prefs.notifyVeiled ? "已使用隐晦文案" : "已使用普通文案");
    render();
  }
  else if (act === "appearance-settings") go("#/settings/appearance");
  else if (act === "appearance-set") {
    ui.prefs.appearance = t.dataset.mode;
    savePrefs();
    toast("外观已更新");
    render();
  }
  else if (act === "tts-settings") go("#/settings/tts");
  else if (act === "tts-set") {
    ui.prefs.ttsProvider = t.dataset.provider === "mimo" ? "mimo" : "minimax";
    savePrefs();
    toast(ui.prefs.ttsProvider === "mimo" ? "已切换为小米 MiMo" : "已切换为 MiniMax");
    render();
  }
  else if (act === "subscribe-settings") go("#/settings/subscribe");
  else if (act === "subscribe-toggle") {
    ui.prefs.subscribed = !ui.prefs.subscribed;
    savePrefs();
    toast(ui.prefs.subscribed ? "已开通 Nascent Love+（demo）" : "已取消订阅（demo）");
    render();
  }
  else if (act === "toggle-app-lock") {
    ui.appLock = !ui.appLock;
    saveAppLock();
    toast(ui.appLock ? "已开启锁屏密码要求" : "已关闭锁屏密码要求");
    render();
  }
  else if (act === "clear-all-local") confirmClearLocalData();
  else if (act === "reread-guide") openUsageGuideSheet();
  else if (act === "mood") {
    heart.recordMood(t.dataset.mood);
    toast(`今天的心绪已记为${MoodUi[t.dataset.mood].label} ${MoodUi[t.dataset.mood].emoji}`);
  }
  else if (act === "open-card") openCard(Number(t.dataset.index));
  else if (act === "favorite") {
    event.stopPropagation();
    heart.toggleFavorite(heart.cards[Number(t.dataset.index)]);
  }
  else if (act === "share") {
    event.stopPropagation();
    shareCard(heart.cards[Number(t.dataset.index)]);
  }
  else if (act === "favorites") showFavorites();
  else if (act === "stop") {
    ui.draftLevel = null;
    stopScenarioAutomation();
    await emit(new BleDownlink({ cmd: NlCmd.STOP, auth: "" }));
    render();
  }
  else if (act === "scenario-start-auto") {
    startScenarioCall(ui.pendingScenarioPersona, { automationAuthorized: true });
  }
  else if (act === "scenario-start-manual") {
    startScenarioCall(ui.pendingScenarioPersona, { automationAuthorized: false });
  }
  else if (act === "power-on") {
    await toggleOriginalPower("正在开启设备");
  }
  else if (act === "power-off") {
    await toggleOriginalPower("正在关闭设备");
  }
  else if (act === "mode") {
    await emit(new BleDownlink({ cmd: NlCmd.SET_MODE, mode: t.dataset.mode, auth: "" }));
  }
  else if (act === "scene-next") {
    if (ui.scenarioStarted) ui.scene = (ui.scene + 1) % SCENES.length;
    else ui.scenarioStarted = true;
    render();
  }
  else if (act === "persona-new") {
    ui.scenarioHandoff = route().page === "scenario" || ui.scenarioHandoff;
    ui.persona.editingId = null;
    resetPersonaDraft();
    go("#/settings/persona/custom");
  }
  else if (act === "persona-quiz") {
    stashPersonaDraft();
    if (route().page === "scenario") ui.scenarioHandoff = true;
    ui.persona.editingId = null;
    const next = emptyQuizAnswers();
    if (ui.draftPersonaCard?.vibe) next.vibe = ui.draftPersonaCard.vibe;
    ui.quizAnswers = next;
    go("#/settings/persona/quiz");
  }
  else if (act === "persona-quiz-pick") {
    stashQuizDraft();
    ui.quizAnswers = { ...emptyQuizAnswers(), ...(ui.quizAnswers || {}), [t.dataset.q]: t.dataset.id };
    ui.suppressPersonaStash = true;
    render();
  }
  else if (act === "persona-quiz-toggle") {
    stashQuizDraft();
    const current = new Set(ui.quizAnswers?.skills || []);
    if (current.has(t.dataset.id)) current.delete(t.dataset.id);
    else current.add(t.dataset.id);
    ui.quizAnswers = { ...emptyQuizAnswers(), ...(ui.quizAnswers || {}), skills: [...current] };
    ui.suppressPersonaStash = true;
    render();
  }
  else if (act === "persona-quiz-save") {
    const result = await saveCustomPersonaFromQuiz({
      activate: true,
      createdNotice: !ui.scenarioHandoff,
    });
    if (!result.ok) return;
    if (ui.scenarioHandoff) {
      beginScenarioCall(findScenarioPersona(`custom:${result.id}`));
      return;
    }
    toast("他已经在选择人设里了");
    go("#/intimacy/scenario");
  }
  else if (act === "persona-vibe") {
    stashPersonaDraft();
    const preset = PERSONA_CARDS[t.dataset.vibe];
    if (!preset) return;
    const current = { ...emptyCardDraft(), ...(ui.draftPersonaCard || {}) };
    const filled = cardToDraft(preset);
    const keepName = String(current.assistant_name || current.name || "").trim();
    const keepUser = String(current.user_name || "").trim();
    if (keepName) {
      filled.name = keepName;
      filled.assistant_name = keepName;
    }
    if (keepUser) filled.user_name = keepUser;
    filled.vibe = t.dataset.vibe;
    if (current.tts?.voice || current.tts?.localClipDemo || current.tts?.localClipName) {
      filled.tts = { ...(filled.tts || {}), ...current.tts };
    }
    ui.draftPersonaCard = filled;
    ui.suppressPersonaStash = true;
    render();
  }
  else if (act === "pick-persona") {
    beginScenarioCall(findScenarioPersona(t.dataset.key));
  }
  else if (act === "answer-call") {
    if (skipAnswerClick) {
      skipAnswerClick = false;
      return;
    }
    answerIncomingCall();
  }
  else if (act === "persona-clone-retry") {
    await clonePendingVoice();
  }
  else if (act === "end-call") {
    declineIncomingCall();
  }
  else if (act === "call-text") {
    openScenarioTextFromCall();
  }
  else if (act === "scenario-voice") {
    beginScenarioCall(ui.activePersona);
  }
  else if (act === "remember-memory") {
    try {
      await scenarioChat.confirmMemory(ui.activePersona, Number(t.dataset.msg), Number(t.dataset.idx));
      toast("记下了");
      render();
    } catch {
      toast("这次没记下，等会儿再试");
    }
  }
  else if (act === "skip-memory") {
    scenarioChat.skipMemory(ui.activePersona, Number(t.dataset.msg), Number(t.dataset.idx));
    render();
  }
  else if (act === "forget-persona-memory") {
    try {
      await scenarioChat.forgetMemories(ui.activePersona);
      toast("已忘掉这个人设记得的事");
      render();
    } catch {
      toast("这次没忘掉，等会儿再试");
    }
  }
  else if (act === "toggle-tag" || act === "toggle-skill") t.classList.toggle("on");
  else if (act === "talk-freq") {
    root.querySelectorAll("[data-act=talk-freq]").forEach((btn) => {
      btn.classList.toggle("on", btn === t);
    });
  }
  else if (act === "toggle-older") {
    ui.olderOpen = !ui.olderOpen;
    render();
  }
  else if (act === "select-record") {
    ui.selectedRecordId = t.dataset.session;
    render();
  }
  else if (act === "open-sleep") go("#/records/sleep");
  else if (act === "insight-self") openInsightSelf(t.dataset.session);
  else if (act === "open-session") {
    ui.selectedRecordId = t.dataset.session;
    go("#/records");
  }
  else if (act === "insight-current") go(`#/records/${t.dataset.session}/insight?scope=current`);
  else if (act === "insight-recent") openRecentScope(t.dataset.session);
  else if (act === "add-session-note") composeSessionNote(t.dataset.session);
  else if (act === "delete-note") confirmDeleteNote(t.dataset.note);
  else if (act === "delete-session") confirmDeleteSession(t.dataset.session);
  else if (act === "save-insight") saveInsight(Number(t.dataset.index));
  else if (act === "lab") go("#/lab");
  else if (act === "lab-mode") {
    const mode = t.dataset.mode;
    if (mode === NlMode.WILD && !ui.labWildArmed) {
      ui.labWildArmed = true;
      toast("再点一次确认进入失控模式（15 分钟后自动退回手动）");
      return;
    }
    ui.labWildArmed = false;
    await emit(new BleDownlink({ cmd: NlCmd.SET_MODE, mode, auth: "" }));
  }
  else if (act === "lab-led") {
    await emit(new BleDownlink({ cmd: NlCmd.SET_LED, led: t.dataset.led, auth: "" }));
  }
  else if (act === "lab-power-on" || act === "lab-power-off") {
    await toggleOriginalPower(
      act === "lab-power-on"
        ? "长按开机：GPIO7 拉高约 1.2 秒"
        : "长按关机：同样是 1.2 秒取反",
    );
  }
  else if (act === "lab-tap") {
    toast("点按调档：GPIO7 短接约 120ms");
    await emit(new BleDownlink({ cmd: NlCmd.PRESS_KEY, key: NlKeyPress.TAP, auth: "" }));
  }
  else if (act === "lab-resume") {
    const reason = await sendCommand(new BleDownlink({ cmd: NlCmd.RESUME, auth: "" }));
    ui.labReject = reason || "意外：总督没有拒绝 resume";
    toast(ui.labReject);
    render();
  }
  else if (act === "lab-check") {
    return;
  }
  else if (act === "lab-connection-settings") {
    window.NascentShell?.openConnectionSettings?.();
  }
  else if (act === "connect") connectOrDisconnect();
  else if (act === "connect-band") connectOrDisconnectBand();
  else if (act === "channel") {
    // 切通道前先把输入框里的地址收下来，否则用户填完直接点「蓝牙」再回来会丢。
    readToyAddress();
    await link.setChannel(t.dataset.channel);
    render();
  }
  else if (act === "provision-wifi") await provisionWifi();
  else if (act === "install-pwa") installPwa();
  else if (act === "clear-local") {
    go("#/settings/data");
  }
}

function openCard(index) {
  const card = heart.cards[index];
  heart.readCard(card);
  openSheet(`
    <p class="group" style="margin-top:0">${CardCategory[card.category].label}</p>
    <h2>${card.title}</h2>
    <p style="line-height:1.6">${card.body}</p>
    <p class="hint" style="text-align:left">${card.source}</p>
  `);
}

function shareCard(card) {
  const preview = `${card.title}\n\n${card.summary}\n\nNascent · 心绪`;
  const sheet = openSheet(`
    <h2>分享预览</h2>
    <article class="card" style="min-width:0;min-height:0;margin:12px 0">${preview.replaceAll("\n", "<br>")}</article>
    <button class="primary" data-copy>复制内容</button>
  `);
  sheet.querySelector("[data-copy]").onclick = async () => {
    await navigator.clipboard.writeText(preview);
    closeSheet();
    toast("内容已复制");
  };
}

function showFavorites() {
  const favorites = heart.cards.filter((c) => heart.isFavorite(c.id));
  openSheet(favorites.length === 0
    ? `<div class="empty">${icon("bookmark")}<p>还没有收藏的内容</p></div>`
    : favorites.map((c) => `<div class="list-row"><strong>${c.title}</strong><small>${CardCategory[c.category].label}</small></div>`).join(""));
}

function composeSessionNote(sessionId, initial = "") {
  const sheet = openSheet(`
    <h2>写下自己的发现</h2>
    <p class="sub">这条内容会保存到当前单次记录中，并且可以随时删除。</p>
    <textarea id="note-text" placeholder="什么对这一次最重要？">${escapeHtml(initial)}</textarea>
    <div style="height:12px"></div>
    <button class="primary" data-save>保存到这次记录</button>
  `);
  const area = sheet.querySelector("#note-text");
  area.focus();
  sheet.querySelector("[data-save]").onclick = async () => {
    const text = area.value;
    if (!text.trim()) return;
    const note = await bodyNotes.addNote(sessionId, text);
    if (!note) {
      toast("保存失败，请检查连接后重试");
      return;
    }
    closeSheet();
    toast("发现已保存，可在本页删除");
  };
}

function openRecentScope(sessionId) {
  const recent = bodyNotes.recentComparisons(sessionId, 5);
  if (!recent.length) {
    toast("暂时没有其他可用记录，先只看这一次");
    return;
  }
  const sheet = openSheet(`
    <h2>确认读取范围</h2>
    <p class="sub">Chat 9B 只会读取当前记录和下面列出的记录。默认选择最近 5 次，最多 10 次。</p>
    <div class="scope-list">
      ${recent.map((item) => `<div><strong>${formatSessionDate(item.started_at)}</strong><span>${(MODE_UI[item.mode] || MODE_UI.free).label} · ${formatDuration(item.duration_s)}</span></div>`).join("")}
    </div>
    <div class="flow-note compact-flow"><span>${icon("shield")}</span><div><strong>不会发送</strong><small>原始 12 Hz 数组、音频、设备地址、安全词或控制字段</small></div></div>
    <button class="primary" data-confirm>确认并进入对话</button>
  `);
  sheet.querySelector("[data-confirm]").onclick = () => {
    closeSheet();
    const ids = recent.map((item) => item.session_id).join(",");
    go(`#/records/${sessionId}/insight?scope=recent&ids=${encodeURIComponent(ids)}`);
  };
}

function openInsightSelf(sessionId) {
  const recent = bodyNotes.recentComparisons(sessionId, 5);
  if (!recent.length) {
    go(`#/records/${sessionId}/insight?scope=current`);
    return;
  }
  const ids = recent.map((item) => item.session_id).join(",");
  go(`#/records/${sessionId}/insight?scope=recent&ids=${encodeURIComponent(ids)}`);
}

function confirmDeleteSession(sessionId) {
  if (notesMutationsLocked()) {
    toast("记录还在同步，请稍后再删除");
    return;
  }
  const sheet = openSheet(`
    <h2>删除这次记录？</h2>
    <p class="sub">记录、保存的发现和临时对话会一起删除。删除后 Agent 不能再读取，当前演示版本无法恢复。</p>
    <button class="danger" data-confirm>删除记录</button>
    <div style="height:10px"></div>
    <button class="ghost" data-cancel>取消</button>
  `);
  sheet.querySelector("[data-cancel]").onclick = closeSheet;
  sheet.querySelector("[data-confirm]").onclick = async () => {
    const deleted = await bodyNotes.deleteSession(sessionId);
    if (!deleted) {
      toast("删除失败，记录仍保留在后端，请稍后重试");
      return;
    }
    closeSheet();
    if (ui.selectedRecordId === sessionId) ui.selectedRecordId = null;
    go("#/records");
    toast("这次记录已删除");
  };
}

function confirmDeleteNote(noteId) {
  if (notesMutationsLocked()) {
    toast("记录还在同步，请稍后再删除");
    return;
  }
  const sheet = openSheet(`
    <h2>删除这条发现？</h2>
    <p class="sub">删除后它不会再出现在身心记录或 Agent 的可读范围里。</p>
    <button class="danger" data-confirm>删除</button>
    <div style="height:10px"></div>
    <button class="ghost" data-cancel>取消</button>
  `);
  sheet.querySelector("[data-cancel]").onclick = closeSheet;
  sheet.querySelector("[data-confirm]").onclick = async () => {
    const deleted = await bodyNotes.deleteNote(noteId);
    if (!deleted) {
      toast("删除失败，这条发现仍然保留");
      return;
    }
    closeSheet();
    toast("这条发现已删除");
  };
}

function saveInsight(index) {
  const current = route();
  const scope = current.query.get("scope") === "recent" ? "recent" : "current";
  const message = bodyNotes.messages(current.sessionId, scope)[index];
  if (!message?.candidate) return;
  composeSessionNote(current.sessionId, message.candidate);
}

async function installPwa() {
  if (ui.deferredPrompt) {
    ui.deferredPrompt.prompt();
    const choice = await ui.deferredPrompt.userChoice;
    ui.deferredPrompt = null;
    toast(choice.outcome === "accepted" ? "已安装为 App" : "已取消安装");
    render();
    return;
  }
  toast("用浏览器菜单里的「添加到主屏幕」，即可得到同一套 Web UI 的 App。");
}

/** 设置页的地址输入框只在 WiFi 通道下存在，读不到就什么都不做。 */
function readToyAddress() {
  const input = root.querySelector("#toy-address");
  if (input) link.address = input.value;
}

async function provisionWifi() {
  const ssid = String(root.querySelector("#wifi-ssid")?.value ?? "").trim();
  const psk = String(root.querySelector("#wifi-psk")?.value ?? "");
  if (!getConnected()) {
    toast("请先连上玩具，再写入 WiFi。");
    return;
  }
  const reason = await emit(new BleDownlink({
    cmd: NlCmd.SET_WIFI,
    wifiSsid: ssid,
    wifiPsk: psk,
    auth: "",
  }));
  if (reason) return;
  const pskEl = root.querySelector("#wifi-psk");
  if (pskEl) pskEl.value = "";
  toast("已保存。稍等片刻后即可选择 WiFi");
}

async function connectOrDisconnect() {
  if (getConnected()) {
    await disconnectDevice();
    toast("已断开主设备");
    render();
    return;
  }
  const state = getConnectionState();
  if (["permission", "scanning", "connecting", "initializing"].includes(state.phase)) return;
  readToyAddress();
  try {
    await connectDevice();
    if (!ui.devices.k10Serial) ui.devices.k10Serial = "NL-TOY-7F2A";
    saveDevices();
    toast("设备已连接");
    render();
  } catch (err) {
    // 用户在系统蓝牙选择器里点了取消，不是错误，不要弹提示。
    if (err?.name === "NotFoundError") return;
    if (route().tab === "lab") toast(err.message || String(err));
    else toast("暂时无法连接，请稍后重试");
  }
}

function connectOrDisconnectBand() {
  if (nativeHeartRateAvailable()) {
    toast(heartRate.snapshot.live
      ? "健康手环正在同步"
      : "请先连接健康手环并开启实时心率");
    return;
  }
  ui.devices.bandConnected = !ui.devices.bandConnected;
  saveDevices();
  toast(ui.devices.bandConnected
    ? "健康手环已连接"
    : "已断开健康手环");
  render();
}

function patchTelemetry() {
  const connected = getConnected();
  const uplink = getUplink();
  const connection = getConnectionState();
  ingestUplinkSample(uplink);
  scheduleAutomaticControlForSensorChange();
  const { tab, page, sessionId } = route();
  root.querySelectorAll("[data-status]").forEach((el) => {
    el.classList.toggle("is-connected", connected);
    const text = el.querySelector("[data-status-text]");
    if (text) text.textContent = deviceStatusText(connected, uplink, connection);
  });
  if (tab === "intimacy" && page === "control") {
    const slider = root.querySelector("#level-slider");
    if (slider && document.activeElement !== slider) {
      const reported = uplink?.level ?? 0;
      if (ui.draftLevel == null || ui.draftLevel === reported) {
        if (reported > 0) ui.draftLevel = null;
        const shown = reported > 0 ? reported : (ui.draftLevel ?? 1);
        slider.value = String(shown);
        const label = root.querySelector("[data-level-label]");
        if (label) label.textContent = `${reported > 0 ? "档位" : "启动"} ${shown} / ${NlConst.levelMax}`;
      }
    }
    const mode = uplink?.mode ?? NlMode.FREE;
    root.querySelectorAll("[data-act=mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
  }
  if (tab === "intimacy" && page === "scenario" && sessionId === "chat") {
    const sensors = buildSensorContext(uplink, { bandConnected: ui.devices.bandConnected });
    const chips = root.querySelectorAll(".scenario-chat-page .source-strip span");
    if (chips[0]) chips[0].textContent = `温感 ${sensorLabel(sensors.temperature_state)}`;
    if (chips[1]) chips[1].textContent = `压力 ${sensorLabel(sensors.pressure_rhythm)}`;
    if (chips[2]) chips[2].textContent = hrChipText(sensors);
  }
  if (tab === "lab") {
    patchLabDom(root, {
      connected,
      uplink,
      token: link.token,
      connectionState: connection,
      uplinkStats: link.uplinkStats,
    });
  }
}

let lastConnected = getConnected();
let lastConnectionPhase = getConnectionState().phase;
subscribe(({ connected, connectionState }) => {
  if (connected !== lastConnected || connectionState.phase !== lastConnectionPhase) {
    lastConnected = connected;
    lastConnectionPhase = connectionState.phase;
    if (!connected && ui.scenarioAutomation.authorized) stopScenarioAutomation();
    if (connected && ui.scenarioAutomation.authorized) ensureScenarioMode();
    render();
    return;
  }
  patchTelemetry();
});

heart.subscribe(render);
bodyNotes.subscribe(render);
heartRate.subscribe((snap) => {
  if (snap.live && !ui.devices.bandConnected) {
    ui.devices.bandConnected = true;
    saveDevices();
  }
  const bar = root.querySelector('[data-act="connect-band"]');
  if (bar) {
    bar.classList.toggle("is-connected", bandIsOn() && heartRate.snapshot.quality !== "stale");
    const text = bar.querySelector(".status-copy span");
    if (text) text.textContent = bandStatusText();
  }
  const { tab, page, sessionId } = route();
  if (tab === "intimacy" && page === "scenario" && sessionId === "chat") {
    patchTelemetry();
  }
});
window.addEventListener("hashchange", render);

async function loadPersonas() {
  try {
    const [personaRes, templateRes, customRes] = await Promise.all([
      fetch("/v1/persona"),
      fetch(`/v1/agent/templates?user_id=${encodeURIComponent(LOCAL_USER)}`),
      fetch(`/v1/persona/custom?user_id=${encodeURIComponent(LOCAL_USER)}`),
    ]);
    if (personaRes.ok) ui.personas = await personaRes.json();
    if (templateRes.ok) ui.templates = await templateRes.json();
    if (customRes.ok) mergeRemoteCustoms(await customRes.json());
    if (!ui.activePersona && ui.personas[0]) {
      ui.activePersona = { key: `persona:${ui.personas[0].id}`, name: ui.personas[0].name };
    }
    if (route().tab === "settings" || route().page === "scenario") render();
  } catch {
    // 云端不可达时设置页和情景列表仍可用。
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  ui.deferredPrompt = event;
  if (route().tab === "settings") render();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // 安装失败不影响网站本身。
  });
}

if (!location.hash) location.hash = isOnboardingDone() ? "#/heart" : "#/onboarding";
else render();
loadPersonas();
bodyNotes.load().then(() => render());

if ("wakeLock" in navigator) {
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" && ui.scenarioAutomation.authorized) {
      stopScenarioAutomation();
    }
    if (document.visibilityState === "visible" && route().page === "control") {
      try { await navigator.wakeLock.request("screen"); } catch { /* ignore */ }
    }
  });
} else {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" && ui.scenarioAutomation.authorized) {
      stopScenarioAutomation();
    }
  });
}
