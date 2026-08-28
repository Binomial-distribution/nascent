import { BleDownlink, NlCmd, NlConst, NlInsertState, NlMode } from "./protocol.js";
import { currentShell } from "./ble.js";
import { ble, getConnected, getUplink, sendCommand, subscribe } from "./session.js";
import { CardCategory, heart, MoodUi } from "./heart.js";

const SHELL_LABEL = {
  website: "网站",
  pwa: "已安装的 App（PWA）",
  "android-app": "Nascent App",
};

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
};

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
};

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function route() {
  const hash = (location.hash || "#/heart").replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  const tab = parts[0] || "heart";
  return { tab, page: parts[1] || "root" };
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
  if (uplink?.insertState === NlInsertState.INSERTED) return "设备已连接 · 在使用中";
  if (uplink?.insertState === NlInsertState.NOT_INSERTED) return "设备已连接 · 未在使用";
  return "设备已连接 · 状态同步中";
}

function statusBar({ clickable = false, trailing = "chevron" } = {}) {
  const connected = getConnected();
  const uplink = getUplink();
  const tag = clickable ? "button" : "div";
  return `<${tag} class="status" data-status ${clickable ? 'data-act="settings"' : ""}>
    ${icon("bluetooth")}
    <span data-status-text>${deviceStatusText(connected, uplink)}</span>
    ${icon(trailing)}
  </${tag}>`;
}

function topbar(title, { back = false, action = "" } = {}) {
  return `<header class="topbar">
    ${back ? `<button class="icon-btn" data-act="back" aria-label="返回">${icon("back")}</button>` : ""}
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
  <main class="page">
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
    ${statusBar()}
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

function renderNotes() {
  const latest = heart.latestBodyNote;
  const when = latest
    ? `记录于 ${latest.createdAt.getMonth() + 1}/${latest.createdAt.getDate()} ${pad(latest.createdAt.getHours())}:${pad(latest.createdAt.getMinutes())} · 当前仅保存在本次运行内`
    : "完成一次亲密时刻后，可以从这里开始记录。";
  return `${topbar("身体笔记", { back: true })}
  <main class="page">
    <h2 class="lead">把感受留给未来的自己</h2>
    <p class="sub">记录当下的感觉、节奏和想法，不需要评分，也不需要得出结论。</p>
    <article class="card" style="min-width:0;min-height:0">
      <h3 style="margin:0 0 14px">最近一次</h3>
      <p>${latest?.text ?? "还没有可回看的笔记"}</p>
      <p class="hint" style="text-align:left;margin-top:8px">${when}</p>
    </article>
    <div style="height:12px"></div>
    <button class="ghost" data-act="compose-note">写一条笔记</button>
    <h3 style="margin:20px 0 8px">记录原则</h3>
    <div class="list-row"><span>以自己的感受为准</span></div>
    <div class="list-row"><span>不舒服时可以停下</span></div>
    <div class="list-row"><span>内容优先保存在本地</span></div>
  </main>`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function connectHint() {
  const shell = currentShell();
  if (shell === "android-app") {
    return "App 会用系统蓝牙直连行空板 K10。WebView 没有 Web Bluetooth，这是刻意走原生桥。";
  }
  if (ble.available) {
    return "网站通过 Web Bluetooth 直连行空板 K10。请用 Chrome / Edge，并打开 localhost 或 HTTPS。";
  }
  return "当前浏览器不能直连行空板。请改用 Chrome / Edge，或安装 Nascent App。";
}

function renderSettings() {
  const connected = getConnected();
  const shell = currentShell();
  const personas = ui.personas.length
    ? ui.personas.map((p) => `${p.name}（${p.tone}）`).join("、")
    : "人设只影响说什么，不影响灯与强度";
  const installRow = shell === "website"
    ? `<button class="list-row" data-act="install-pwa">
        <strong>安装为 App</strong>
        <small>与网站同一套 Web UI，装到主屏幕后仍直连行空板。</small>
      </button>`
    : "";
  return `${topbar("设置")}
  <main class="page">
    <div class="group">入口</div>
    <div class="list-row">
      <strong>当前是${SHELL_LABEL[shell]}</strong>
      <small>网站和 App 共用这一份页面。连的都是行空板 K10，不是玩具侧那块板。</small>
    </div>
    ${installRow}
    <div class="group">设备</div>
    ${statusBar()}
    <button class="list-row" data-act="connect">
      <strong>${connected ? "已连接，点击断开" : "连接行空板 K10"}</strong>
      <small>${connectHint()}</small>
    </button>
    <div class="group">安全</div>
    <div class="list-row">
      <strong>强度上限</strong>
      <small>当前 ${NlConst.levelMax} 档封顶，对应原产品九档中的第 ${NlConst.levelMax} 档</small>
    </div>
    <div class="list-row">
      <strong>停止后如何恢复</strong>
      <small>只能在设备上同时长按 K10 的 A、B 两键两秒。网站和 App 都无法远程恢复，这是刻意的。</small>
    </div>
    <div class="group">人设</div>
    <div class="list-row">
      <strong>当前人设</strong>
      <small>${personas}</small>
    </div>
    <div class="group">隐私</div>
    <button class="list-row" data-act="clear-local">
      <strong>本地数据</strong>
      <small>清除本次运行中的心绪、收藏和身体笔记</small>
    </button>
    <div class="group">关于</div>
    <div class="list-row">
      <strong>协议版本</strong>
      <small>${NlConst.protoVersion}</small>
    </div>
  </main>
  ${nav("settings")}`;
}

function render() {
  const { tab, page } = route();
  const nested = tab === "intimacy" && page !== "root";
  root.classList.toggle("subpage", nested);
  if (tab === "heart") root.innerHTML = renderHeart();
  else if (tab === "settings") root.innerHTML = renderSettings();
  else if (page === "control") root.innerHTML = renderControl();
  else if (page === "scenario") root.innerHTML = renderScenario();
  else if (page === "notes") root.innerHTML = renderNotes();
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
    ui.scenarioStarted = false;
    ui.scene = 0;
    go("#/intimacy");
  }
  else if (act === "sub") go(`#/intimacy/${t.dataset.page}`);
  else if (act === "settings") go("#/settings");
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
  else if (act === "compose-note") composeNote();
  else if (act === "connect") connectOrDisconnect();
  else if (act === "install-pwa") installPwa();
  else if (act === "clear-local") {
    heart.clearLocal();
    toast("本次运行中的本地记录已清除");
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

function composeNote() {
  const sheet = openSheet(`
    <h2>写下此刻</h2>
    <textarea id="note-text" placeholder="今天有什么值得记住？"></textarea>
    <div style="height:12px"></div>
    <button class="primary" data-save>保存到本次运行</button>
  `);
  const area = sheet.querySelector("#note-text");
  area.focus();
  sheet.querySelector("[data-save]").onclick = () => {
    const text = area.value;
    closeSheet();
    if (!text.trim()) return;
    heart.addBodyNote(text);
    toast("笔记已保存到本次运行");
  };
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

async function connectOrDisconnect() {
  if (getConnected()) {
    await ble.disconnect();
    toast("已断开设备");
    render();
    return;
  }
  try {
    await ble.connect();
    toast("已连接");
    render();
  } catch (err) {
    if (err?.name === "NotFoundError") return;
    toast(err.message || String(err));
  }
}

function patchTelemetry() {
  const { tab, page } = route();
  const text = root.querySelector("[data-status-text]");
  if (text) text.textContent = deviceStatusText(getConnected(), getUplink());
  if (tab === "intimacy" && page === "control") {
    const slider = root.querySelector("#level-slider");
    if (slider && document.activeElement !== slider) {
      const reported = getUplink()?.level ?? 0;
      if (ui.draftLevel == null || ui.draftLevel === reported) {
        ui.draftLevel = null;
        slider.value = String(reported);
        const label = root.querySelector("[data-level-label]");
        if (label) label.textContent = `档位 ${reported} / ${NlConst.levelMax}`;
      }
    }
    const mode = getUplink()?.mode ?? NlMode.FREE;
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

if (!location.hash) location.hash = "#/heart";
else render();
loadPersonas();

if ("wakeLock" in navigator) {
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && route().page === "control") {
      try { await navigator.wakeLock.request("screen"); } catch { /* ignore */ }
    }
  });
}
