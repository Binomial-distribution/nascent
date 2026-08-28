import { BleDownlink, NlCmd, NlConst, NlInsertState, NlMode } from "./protocol.js";
import { CHANNEL, CHANNEL_LABEL, currentShell } from "./transport.js";
import { bodyNotes } from "./body-notes.js";
import { getConnected, getUplink, link, sendCommand, subscribe } from "./session.js";
import { CardCategory, heart, MoodUi } from "./heart.js";
import {
  isOnboardingDone,
  mountOnboarding,
  shouldForceOnboarding,
  fullGuidePages,
} from "./onboarding.js";

const SHELL_LABEL = {
  website: "网站",
  pwa: "已安装的 App（PWA）",
  "android-app": "Nascent App",
};

const PERSONA_PRESETS = [
  { id: "gentle", name: "温和", tone: "缓慢、克制、多确认" },
  { id: "playful", name: "俏皮", tone: "轻快、有来有回" },
  { id: "calm", name: "沉静", tone: "低语、留白多" },
];

const LLM_OPTIONS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "claude-sonnet", label: "Claude Sonnet" },
  { id: "deepseek-chat", label: "DeepSeek Chat" },
  { id: "local", label: "本地小模型（占位）" },
];

const PERSONA_KEY = "nascent.persona.settings";
const DEVICE_KEY = "nascent.devices";

const root = document.getElementById("app");
const SCENES = [
  ["留一点空间", "先不用急着做什么，感受一下此刻的呼吸。"],
  ["靠近一点", "如果感觉合适，就把注意力放回你们之间。"],
  ["听见回应", "每一次停顿和改变，都可以成为下一步的线索。"],
];

const ui = {
  toastTimer: null,
  sheet: null,
  draftLevel: null,
  scenarioStarted: false,
  scene: 0,
  personas: [],
  deferredPrompt: null,
  onboarding: null,
  gateReady: false,
  persona: loadPersonaSettings(),
  guideSheetIndex: 0,
  devices: loadDevices(),
  appLock: loadAppLock(),
  prefs: loadPrefs(),
  insightSending: false,
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
    };
  } catch {
    return {
      safewords: "红灯",
      storageMode: "local",
      notifyEnabled: true,
      notifyVeiled: true,
      appearance: "default",
      subscribed: false,
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
      bandName: raw.bandName || "小米手表",
      bandBattery: raw.bandBattery ?? 100,
      productId: raw.productId || "",
    };
  } catch {
    return {
      k10Serial: "NL-TOY-7F2A",
      k10Battery: 100,
      bandConnected: false,
      bandSerial: "MI-WT-9C41",
      bandName: "小米手表",
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
      customs: Array.isArray(raw.customs) ? raw.customs : [],
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

function customPersonaTitle(text, index) {
  const line = String(text || "").trim().split(/\n/)[0] || "未命名人设";
  return line.slice(0, 18) + (line.length > 18 ? "…" : "") || `自定义 ${index + 1}`;
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

/** @returns {{ ok: boolean, createdNew?: boolean, id?: string }} */
function saveCustomPersonaFromForm({ activate = false, createdNotice = false } = {}) {
  const text = (root.querySelector("#persona-custom-text")?.value || "").trim();
  const model = root.querySelector("#persona-model")?.value || ui.persona.model;
  if (!text) {
    toast("请先填写人设描述");
    return { ok: false };
  }
  const now = new Date().toISOString();
  let createdNew = false;
  let id = ui.persona.editingId;
  if (ui.persona.editingId) {
    const idx = ui.persona.customs.findIndex((c) => c.id === ui.persona.editingId);
    if (idx >= 0) {
      ui.persona.customs[idx] = {
        ...ui.persona.customs[idx],
        text,
        model,
        name: customPersonaTitle(text, idx),
        updatedAt: now,
      };
      id = ui.persona.customs[idx].id;
    }
  } else {
    id = `custom-${Date.now().toString(36)}`;
    ui.persona.customs.unshift({
      id,
      text,
      model,
      name: customPersonaTitle(text, 0),
      createdAt: now,
      updatedAt: now,
    });
    createdNew = true;
  }
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
  return { ok: true, createdNew, id };
}

const ICONS = {
  heart: '<path d="M12 21s-7-4.4-9.5-8.2C.6 9.7 2.2 6 6 6c2 0 3.2 1.1 4 2.2C10.8 7.1 12 6 14 6c3.8 0 5.4 3.7 3.5 6.8C19 16.6 12 21 12 21z"/>',
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
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function route() {
  const hash = (location.hash || "#/heart").replace(/^#/, "");
  const [path, search = ""] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  const tab = parts[0] || "heart";
  return {
    tab,
    page: parts[1] || "root",
    sub: parts[2] || null,
    id: parts[3] || null,
    sessionId: parts[2] || null,
    view: parts[3] || null,
    query: new URLSearchParams(search),
  };
}

function go(path) {
  location.hash = path;
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

function deviceStatusText(connected, uplink) {
  if (!connected) return "设备未连接";
  const serial = ui.devices.k10Serial;
  const bat = `电量 ${ui.devices.k10Battery}%`;
  if (uplink?.insertState === NlInsertState.INSERTED) {
    return `已连接：${serial} · ${bat} · 在使用中`;
  }
  return `已连接：${serial} · ${bat}`;
}

function bandStatusText() {
  if (!ui.devices.bandConnected) return "健康手环未连接";
  return `已连接：${ui.devices.bandSerial} · 电量 ${ui.devices.bandBattery}%`;
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
      <span data-status-text>${deviceStatusText(connected, uplink)}</span>
      ${connectable ? `<small class="status-hint">${connectHint()}</small>` : ""}
    </span>
    ${icon(trailing)}
  </${tag}>`;
}

function bandStatusBar({ connectable = true } = {}) {
  const on = ui.devices.bandConnected;
  const tag = connectable ? "button" : "div";
  return `<${tag} class="status ${on ? "is-connected" : ""}" ${connectable ? 'data-act="connect-band"' : ""}>
    ${icon("bluetooth")}
    <span class="status-copy">
      <span>${bandStatusText()}</span>
      <small class="status-hint">${on ? `${ui.devices.bandName} · 点击断开` : `默认 ${ui.devices.bandName} · 通过蓝牙连接`}</small>
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
    ["intimacy", "book", "亲密时刻"],
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
  <main class="page">
    ${statusBar({ clickable: true, trailing: "shield" })}
    <h2 class="lead">选择今天的靠近方式</h2>
    <p class="sub">慢一点也好，跟着你们的节奏来。</p>
    ${entry("scenario", "book", "情境漫游", "让 TA 带你进入一段故事", "var(--coral)")}
    ${entry("control", "share", "我的节奏", "快慢轻重都由你决定", "var(--fog)")}
    ${entry("notes", "bookmark", "身体笔记", "每一次都值得被温柔记住", "var(--comfort)")}
    <div class="note">${icon("info")}<span>停止按钮会一直在控制页可见。任何不舒服或想暂停的时刻，都可以立即停止。</span></div>
  </main>
  ${nav("intimacy")}`;
}

function entry(page, ico, title, subtitle, color) {
  return `<button class="entry" data-act="sub" data-page="${page}">
    <div class="entry-ico" style="background:color-mix(in srgb, ${color} 18%, transparent);color:${color}">${icon(ico)}</div>
    <div><h3>${title}</h3><p>${subtitle}</p></div>
    <span class="chev">${icon("chevron")}</span>
  </button>`;
}

function renderControl() {
  const uplink = getUplink();
  const reported = uplink?.level ?? 0;
  if (ui.draftLevel === reported) ui.draftLevel = null;
  const level = ui.draftLevel ?? reported;
  const mode = uplink?.mode ?? NlMode.FREE;
  return `${topbar("我的节奏", { back: true })}
  <main class="page">
    <button class="stop" data-act="stop">${icon("stop")} 停 止</button>
    <div class="level" data-level-label>档位 ${level} / ${NlConst.levelMax}</div>
    <input id="level-slider" type="range" min="0" max="${NlConst.levelMax}" step="1" value="${level}" />
    <div class="modes">
      ${[
        [NlMode.FREE, "手动"],
        [NlMode.SCENARIO, "情景"],
        [NlMode.WILD, "失控"],
      ].map(([value, label]) => `
        <button data-act="mode" data-mode="${value}" class="${mode === value ? "active" : ""}">${label}</button>
      `).join("")}
    </div>
    <p class="hint">换模式才换色，换人不换灯。</p>
  </main>`;
}

function renderScenario() {
  const [title, body] = SCENES[ui.scene];
  return `${topbar("情境漫游", { back: true })}
  <main class="page scene">
    <div class="grow">
      <div>
        <div style="color:var(--coral);margin-bottom:24px">${icon("book")}</div>
        <h2>${title}</h2>
        <p class="sub">${body}</p>
        <div class="dots">${SCENES.map((_, i) => `<i class="${i === ui.scene ? "on" : ""}"></i>`).join("")}</div>
      </div>
    </div>
    <button class="primary" data-act="scene-next">${ui.scenarioStarted ? "下一段" : "开始漫游"}</button>
    <div style="height:10px"></div>
    <button class="ghost" data-act="back">${icon("stop")} 结束</button>
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

function renderNoteDetail(sessionId) {
  const session = bodyNotes.getSession(sessionId);
  if (!session) return renderMissingSession();
  const mode = MODE_UI[session.mode] || MODE_UI.free;
  return `${topbar("单次记录", {
    back: true,
    action: `<button class="icon-btn danger-icon" data-act="delete-session" data-session="${escapeHtml(sessionId)}" aria-label="删除本次记录">${icon("trash")}</button>`,
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
        <div class="saved-note"><p>${escapeHtml(note.text)}</p><button class="icon-btn" data-act="delete-note" data-note="${escapeHtml(note.note_id)}" aria-label="删除这条发现">${icon("trash")}</button></div>
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
  return `${topbar("身体笔记", { back: true })}<main class="page"><div class="empty">这条记录已删除或不可用。</div></main>`;
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
    <div class="source-strip">${sources.map((item) => `<span>${formatSessionDate(item.started_at)} · ${MODE_UI[item.mode].label}</span>`).join("")}</div>
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

function connectHint() {
  const reason = link.unavailableReason;
  if (reason) return reason;

  if (link.channel === CHANNEL.WIFI) {
    return link.address
      ? `将连接 ${link.address}，玩具需要和你在同一个 2.4GHz 局域网内。`
      : "请先在下面填写玩具的地址。WiFi 是备用通道，平时用蓝牙就好。";
  }
  if (currentShell() === "android-app") {
    return "App 用系统蓝牙直连玩具。WebView 没有 Web Bluetooth，这是刻意走原生桥。";
  }
  return "网站通过 Web Bluetooth 直连玩具。请用 Chrome / Edge，并从 localhost 或 HTTPS 打开。";
}

function renderSettings() {
  const shell = currentShell();
  const installRow = shell === "website"
    ? `<button class="list-row" data-act="install-pwa">
        <strong>安装为 App</strong>
        <small>与网站同一套 Web UI，装到主屏幕后仍直连玩具。</small>
      </button>`
    : "";
  const channelRow = `<div class="list-row">
      <strong>通道</strong>
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
          只保存在本次运行内，刷新页面需要重填。
        </small>
      </div>`
    : "";

  // —— 入口（Web UI demo 暂隐，保留勿删）——
  // const entrySection = `
  //   <div class="group">入口</div>
  //   <div class="list-row">
  //     <strong>当前是${SHELL_LABEL[shell]}</strong>
  //     <small>网站和 App 共用这一份页面，连的都是玩具本身——中间已经没有别的板子了。</small>
  //   </div>
  //   ${installRow}
  // `;

  return `${topbar("我的")}
  <main class="page">
    <div class="group">设备</div>
    <div class="device-block">
      <p class="device-section-label">主设备 · 玩具</p>
      ${statusBar({ connectable: true })}
      ${channelRow}
      ${addressRow}
    </div>
    <div class="device-block">
      <p class="device-section-label">健康手环 · 默认小米手表</p>
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
      <small>只能长按玩具上的 BOOT 键两秒。网站和 App 都无法远程恢复，这是刻意的——
      设备固件里根本没有「远程恢复」这条路径，不是我们没做入口。</small>
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
    <button class="list-row" data-act="subscribe-settings">
      <strong>Nascent Love+</strong>
      <small>${ui.prefs.subscribed ? "已订阅" : "订阅与会员管理"}</small>
    </button>
    <div class="group">关于</div>
    <div class="list-row">
      <strong>协议版本</strong>
      <small>${NlConst.protoVersion}</small>
    </div>
    <p class="demo-note">当前为 Web UI demo · 入口 shell：${SHELL_LABEL[shell]}</p>
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
  sheet.querySelector("[data-clear-confirm]").onclick = () => {
    heart.clearLocal();
    bodyNotes.clearTemporaryChats();
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
      <span>用文字描述陪伴风格，并选择语言模型</span>
    </button>
  </main>`;
}

function renderPersonaFixed() {
  const list = ui.personas.length ? ui.personas : PERSONA_PRESETS;
  return `${topbar("固定人设", { back: true, backTo: "#/settings/persona" })}
  <main class="page">
    <p class="sub">点选一个人设作为当天陪伴风格。</p>
    ${list.map((p) => `
      <button class="ob-choice ${ui.persona.presetId === p.id ? "selected" : ""}" data-act="persona-pick" data-id="${p.id}">
        <strong>${p.name}</strong>
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
  const text = editing?.text ?? "";
  const model = editing?.model ?? ui.persona.model;
  ui.persona.editingId = editing?.id || null;
  return `${topbar(editing ? "编辑自定义人设" : "自定义人设", { back: true, backTo: editing ? "#/settings/persona/customs" : "#/settings/persona" })}
  <main class="page">
    <p class="sub">${editing ? "修改后保存，会更新这一条自定义人设。" : "描述你希望 AI 如何陪伴你。"}</p>
    <label class="ob-label">人设描述</label>
    <textarea id="persona-custom-text" class="ob-input" rows="5" placeholder="例如：话少一点，先听我说，不要急着给建议……">${escapeHtmlApp(text)}</textarea>
    <label class="ob-label">语言模型</label>
    <select id="persona-model" class="ob-field">
      ${LLM_OPTIONS.map((m) => `
        <option value="${m.id}" ${model === m.id ? "selected" : ""}>${m.label}</option>
      `).join("")}
    </select>
    <div class="ob-actions" style="margin-top:16px">
      <button class="ghost" data-act="persona-save-custom">保存</button>
      <button class="primary" data-act="persona-use-custom">使用</button>
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
        const model = LLM_OPTIONS.find((m) => m.id === c.model)?.label || c.model;
        const active = ui.persona.activeCustomId === c.id;
        return `<button class="list-row" data-act="persona-edit" data-id="${c.id}">
          <strong>${escapeHtmlApp(c.name || customPersonaTitle(c.text, index))}${active ? " · 当前" : ""}</strong>
          <small>${model} · ${escapeHtmlApp((c.text || "").slice(0, 40))}${(c.text || "").length > 40 ? "…" : ""}</small>
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
      if (draft?.productId) {
        ui.devices.productId = draft.productId;
        saveDevices();
      }
      if (draft?.safeword && !draft.safewordSkipped) {
        ui.prefs.safewords = String(draft.safeword).trim() || ui.prefs.safewords;
        savePrefs();
      }
      if (firstCard) heart.prependCard(firstCard);
      if (location.hash.startsWith("#/onboarding")) location.hash = "#/heart";
      else if (!location.hash) location.hash = "#/heart";
      render();
      toast("欢迎来到 Nascent");
    },
  });
}

function render() {
  // Onboarding 进行中：忽略其它重绘，避免打断渐变流程。
  if (root.classList.contains("onboarding") && !ui.gateReady) return;

  const force = shouldForceOnboarding();
  if (force || !isOnboardingDone()) {
    if (!ui.gateReady) {
      startOnboardingFlow();
      return;
    }
  }

  const { tab, page, sub, id, sessionId, view, query } = route();
  applyTheme(tab);
  const nested = (tab === "intimacy" && page !== "root")
    || (tab === "settings" && page !== "root");
  root.classList.toggle("subpage", nested);
  root.classList.toggle("chat-view", view === "insight");
  root.classList.remove("onboarding");
  if (tab === "heart") root.innerHTML = renderHeart();
  else if (tab === "settings") {
    if (page === "persona" && sub === "fixed") root.innerHTML = renderPersonaFixed();
    else if (page === "persona" && sub === "customs") root.innerHTML = renderCustomPersonaList();
    else if (page === "persona" && sub === "edit" && id) root.innerHTML = renderPersonaCustom(id);
    else if (page === "persona" && sub === "custom") root.innerHTML = renderPersonaCustom(null);
    else if (page === "persona") root.innerHTML = renderPersonaHub();
    else if (page === "data") root.innerHTML = renderLocalData();
    else if (page === "safeword") root.innerHTML = renderSafewordManage();
    else if (page === "notify") root.innerHTML = renderNotifySettings();
    else if (page === "appearance") root.innerHTML = renderAppearanceSettings();
    else if (page === "subscribe") root.innerHTML = renderSubscribeSettings();
    else if (page === "storage") root.innerHTML = renderStorageSettings();
    else root.innerHTML = renderSettings();
  }
  else if (page === "control") root.innerHTML = renderControl();
  else if (page === "scenario") root.innerHTML = renderScenario();
  else if (page === "notes" && view === "insight") root.innerHTML = renderInsight(sessionId, query);
  else if (page === "notes" && sessionId) root.innerHTML = renderNoteDetail(sessionId);
  else if (page === "notes") root.innerHTML = renderNotesList();
  else root.innerHTML = renderIntimacy();
  bind();
  restoreCardScroll();
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

async function onLevelCommit(level) {
  if (level === 0) {
    ui.draftLevel = null;
    await emit(new BleDownlink({ cmd: NlCmd.STOP, auth: "" }));
    return;
  }
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
  if (act === "tab") go(`#/${t.dataset.tab}`);
  else if (act === "back") {
    if (t.dataset.to) {
      go(t.dataset.to);
      return;
    }
    const current = route();
    if (current.page === "notes" && current.view === "insight") go(`#/intimacy/notes/${current.sessionId}`);
    else if (current.page === "notes" && current.sessionId) go("#/intimacy/notes");
    else {
      ui.scenarioStarted = false;
      ui.scene = 0;
      go("#/intimacy");
    }
  }
  else if (act === "sub") go(`#/intimacy/${t.dataset.page}`);
  else if (act === "settings") go("#/settings");
  else if (act === "persona-settings") go("#/settings/persona");
  else if (act === "view-persona-settings") go("#/settings/persona");
  else if (act === "persona-customs") go("#/settings/persona/customs");
  else if (act === "persona-edit") go(`#/settings/persona/edit/${t.dataset.id}`);
  else if (act === "persona-mode") {
    ui.persona.mode = t.dataset.mode;
    ui.persona.editingId = null;
    savePersonaSettings();
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
    const result = saveCustomPersonaFromForm({ activate: false, createdNotice: true });
    if (!result.ok) return;
    if (result.createdNew) {
      go("#/settings");
    } else {
      toast("已保存");
      go("#/settings/persona/customs");
    }
  }
  else if (act === "persona-use-custom") {
    const result = saveCustomPersonaFromForm({ activate: true, createdNotice: false });
    if (!result.ok) return;
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
    await emit(new BleDownlink({ cmd: NlCmd.STOP, auth: "" }));
    render();
  }
  else if (act === "mode") {
    await emit(new BleDownlink({ cmd: NlCmd.SET_MODE, mode: t.dataset.mode, auth: "" }));
  }
  else if (act === "scene-next") {
    if (ui.scenarioStarted) ui.scene = (ui.scene + 1) % SCENES.length;
    else ui.scenarioStarted = true;
    render();
  }
  else if (act === "open-session") go(`#/intimacy/notes/${t.dataset.session}`);
  else if (act === "insight-current") go(`#/intimacy/notes/${t.dataset.session}/insight?scope=current`);
  else if (act === "insight-recent") openRecentScope(t.dataset.session);
  else if (act === "add-session-note") composeSessionNote(t.dataset.session);
  else if (act === "delete-note") confirmDeleteNote(t.dataset.note);
  else if (act === "delete-session") confirmDeleteSession(t.dataset.session);
  else if (act === "save-insight") saveInsight(Number(t.dataset.index));
  else if (act === "connect") connectOrDisconnect();
  else if (act === "connect-band") connectOrDisconnectBand();
  else if (act === "channel") {
    // 切通道前先把输入框里的地址收下来，否则用户填完直接点「蓝牙」再回来会丢。
    readToyAddress();
    await link.setChannel(t.dataset.channel);
    render();
  }
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
      ${recent.map((item) => `<div><strong>${formatSessionDate(item.started_at)}</strong><span>${MODE_UI[item.mode].label} · ${formatDuration(item.duration_s)}</span></div>`).join("")}
    </div>
    <div class="flow-note compact-flow"><span>${icon("shield")}</span><div><strong>不会发送</strong><small>原始 12 Hz 数组、音频、设备地址、安全词或控制字段</small></div></div>
    <button class="primary" data-confirm>确认并进入对话</button>
  `);
  sheet.querySelector("[data-confirm]").onclick = () => {
    closeSheet();
    const ids = recent.map((item) => item.session_id).join(",");
    go(`#/intimacy/notes/${sessionId}/insight?scope=recent&ids=${encodeURIComponent(ids)}`);
  };
}

function confirmDeleteSession(sessionId) {
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
    go("#/intimacy/notes");
    toast("这次记录已删除");
  };
}

function confirmDeleteNote(noteId) {
  const sheet = openSheet(`
    <h2>删除这条发现？</h2>
    <p class="sub">删除后它不会再出现在身体笔记或 Agent 的可读范围里。</p>
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

async function connectOrDisconnect() {
  if (getConnected()) {
    await link.disconnect();
    toast("已断开主设备");
    render();
    return;
  }
  readToyAddress();
  try {
    await link.connect();
    if (!ui.devices.k10Serial) ui.devices.k10Serial = "NL-TOY-7F2A";
    saveDevices();
    toast(`已连接：${ui.devices.k10Serial}`);
    render();
  } catch (err) {
    // 用户在系统蓝牙选择器里点了取消，不是错误，不要弹提示。
    if (err?.name === "NotFoundError") return;
    toast(err.message || String(err));
  }
}

function connectOrDisconnectBand() {
  ui.devices.bandConnected = !ui.devices.bandConnected;
  saveDevices();
  toast(ui.devices.bandConnected
    ? `已连接：${ui.devices.bandSerial}`
    : "已断开健康手环");
  render();
}

function patchTelemetry() {
  const connected = getConnected();
  const uplink = getUplink();
  const { tab, page } = route();
  root.querySelectorAll("[data-status]").forEach((el) => {
    el.classList.toggle("is-connected", connected);
    const text = el.querySelector("[data-status-text]");
    if (text) text.textContent = deviceStatusText(connected, uplink);
  });
  if (tab === "intimacy" && page === "control") {
    const slider = root.querySelector("#level-slider");
    if (slider && document.activeElement !== slider) {
      const reported = uplink?.level ?? 0;
      if (ui.draftLevel == null || ui.draftLevel === reported) {
        ui.draftLevel = null;
        slider.value = String(reported);
        const label = root.querySelector("[data-level-label]");
        if (label) label.textContent = `档位 ${reported} / ${NlConst.levelMax}`;
      }
    }
    const mode = uplink?.mode ?? NlMode.FREE;
    root.querySelectorAll("[data-act=mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
  }
}

let lastConnected = getConnected();
subscribe(({ connected }) => {
  if (connected !== lastConnected) {
    lastConnected = connected;
    render();
    return;
  }
  patchTelemetry();
});

heart.subscribe(render);
bodyNotes.subscribe(render);
window.addEventListener("hashchange", render);

async function loadPersonas() {
  try {
    const res = await fetch("/v1/persona");
    if (!res.ok) return;
    ui.personas = await res.json();
    if (route().tab === "settings") render();
  } catch {
    // 云端不可达时设置页仍可用。
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
bodyNotes.load();

if ("wakeLock" in navigator) {
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && route().page === "control") {
      try { await navigator.wakeLock.request("screen"); } catch { /* ignore */ }
    }
  });
}
