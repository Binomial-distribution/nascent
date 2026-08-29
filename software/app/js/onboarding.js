/**
 * 首次启动 Onboarding（文档 4.3）
 * 新用户只出现一次；demo 可通过 reset / #/onboarding 反复进入。
 *
 * 问卷与既有步骤的合并关系见 docs/architecture/Web-UI-改动笔记.md。
 */

const STORAGE_KEY = "nascent.onboarding.done";
const DRAFT_KEY = "nascent.onboarding.draft";

export const FIRST_CARD = {
  id: "onboard-first",
  category: "body",
  title: "第一次，这些感觉都正常",
  summary: "陌生、紧张、想慢一点，都是正常的开始。",
  body: "第一次靠近自己的身体时，没有标准节奏。你可以停下来，也可以只待一会儿。这份卡片会留在「心绪」里，随时可以再读。",
  source: "Nascent · AI 伴侣完成礼",
};

/** 使用意图（Q1） */
export const INTENTS = [
  { id: "relax", label: "好好放松、卸下一天的紧绷" },
  { id: "body", label: "更懂自己的身体和喜好" },
  { id: "company", label: "有人陪着，有回应的感觉" },
  { id: "curious", label: "纯粹好奇想玩一玩" },
];

/**
 * 与玩具的熟悉程度（Q2）← 合并原「使用经验」
 * id 仍驱动使用指南渐进披露。
 */
export const EXPERIENCE = {
  never: {
    id: "never",
    label: "第一次",
    hint: "你们才刚认识，后面会多留一点基础提醒。",
    guides: ["clean", "store", "boundary"],
  },
  aware: {
    id: "aware",
    label: "有一些经验",
    hint: "保留清洁要点与使用边界。",
    guides: ["clean", "boundary"],
  },
  experienced: {
    id: "experienced",
    label: "算老朋友了",
    hint: "只保留一页安全边界提醒。",
    guides: ["boundary"],
  },
};

/** TA 性格（Q3）← 合并原自由填写人设；映射到固定人设 preset */
export const COMPANION_TONES = [
  { id: "gentle", label: "温柔耐心", presetId: "gentle" },
  { id: "playful", label: "俏皮活泼", presetId: "playful" },
  { id: "direct", label: "直接主导", presetId: "playful", note: "直接、有主导感，但始终尊重边界与安全词。" },
  { id: "calm", label: "安静少话", presetId: "calm" },
];

/** 节奏偏好（Q4） */
export const COMPANION_PACING = [
  { id: "slow", label: "慢慢来、喜欢铺垫" },
  { id: "mood", label: "看心情" },
  { id: "direct", label: "直接来" },
];

/** 保养提醒（Q5）← 与通知偏好衔接 */
export const CARE_REMIND = [
  { id: "yes", label: "好呀，帮我记着" },
  { id: "no", label: "我自己会注意" },
];

/** 隐私安心项（Q6）← 与应用锁 / 本地数据能力衔接；可多选 */
export const PRIVACY_COMFORT = [
  { id: "app_lock", label: "App 锁 / 隐藏图标" },
  { id: "data_delete", label: "数据能随时删除" },
  { id: "both", label: "都想要" },
];

export const GUIDE_META = {
  clean: { title: "清洁", body: "内容稍后补充" },
  store: { title: "收纳", body: "内容稍后补充" },
  boundary: { title: "使用边界", body: "内容稍后补充" },
};

/** 重新阅读时展示完整使用指南（不按经验裁剪） */
export function fullGuidePages() {
  return ["clean", "store", "boundary"].map((id) => ({ id, ...GUIDE_META[id] }));
}

export function guidePagesForExperience(experienceId) {
  const ids = EXPERIENCE[experienceId]?.guides ?? EXPERIENCE.never.guides;
  return ids.map((id) => ({ id, ...GUIDE_META[id] }));
}

export function isOnboardingDone() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function shouldForceOnboarding() {
  const hash = (location.hash || "").replace(/^#/, "");
  return hash === "/onboarding" || hash.startsWith("/onboarding/");
}

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

function buildSteps(experienceId) {
  const guides = (EXPERIENCE[experienceId]?.guides ?? EXPERIENCE.never.guides)
    .map((id) => `guide:${id}`);
  return [
    "welcome",
    "age",
    "intent",
    "experience",
    "product",
    "companion-intro",
    "companion-tone",
    "companion-pace",
    "care-remind",
    "privacy-comfort",
    "permissions",
    "pairing",
    "pairing-band",
    ...guides,
    "safeword",
    "complete",
  ];
}

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function renderSingleChoices(items, selectedId, act, dataKey) {
  return items.map((item) => `
    <button class="ob-choice ${selectedId === item.id ? "selected" : ""}" data-ob="${act}" data-${dataKey}="${item.id}">
      <strong>${item.label}</strong>
      ${item.hint ? `<span>${item.hint}</span>` : ""}
    </button>
  `).join("");
}

/**
 * @param {HTMLElement} root
 * @param {{ onComplete: (payload: object) => void }} options
 */
export function mountOnboarding(root, { onComplete }) {
  const state = {
    stepIndex: 0,
    fading: false,
    listening: false,
    recognition: null,
    draft: {
      age: 18,
      intent: "",
      experience: "",
      productId: "",
      companionTone: "",
      companionPace: "",
      careRemind: "",
      privacyComfort: [],
      personaNote: "",
      personaSkipped: false,
      bluetooth: false,
      notification: false,
      storage: "local",
      paired: false,
      bandPaired: false,
      safeword: "红灯",
      safewordSkipped: false,
      ...loadDraft(),
    },
  };

  if (!Array.isArray(state.draft.privacyComfort)) {
    state.draft.privacyComfort = [];
  }

  let steps = buildSteps(state.draft.experience || "never");
  const stepId = () => steps[state.stepIndex];

  function persist() {
    saveDraft(state.draft);
  }

  function stopListening() {
    try {
      state.recognition?.stop();
    } catch {
      /* ignore */
    }
    state.listening = false;
    state.recognition = null;
  }

  function goNext() {
    if (state.stepIndex >= steps.length - 1) return;
    fadeTo(() => {
      state.stepIndex += 1;
    });
  }

  function jumpTo(id) {
    const idx = steps.indexOf(id);
    if (idx < 0) return;
    fadeTo(() => {
      state.stepIndex = idx;
    });
  }

  function fadeTo(mutate) {
    if (state.fading) return;
    state.fading = true;
    stopListening();
    const panel = root.querySelector(".ob-panel");
    if (!panel) {
      mutate();
      state.fading = false;
      paint();
      return;
    }
    panel.classList.remove("ob-in");
    panel.classList.add("ob-out");
    window.setTimeout(() => {
      mutate();
      paint();
      state.fading = false;
    }, 380);
  }

  function paint() {
    root.classList.add("onboarding", "subpage");
    root.dataset.theme = "light";
    document.documentElement.dataset.theme = "light";
    document.body.dataset.theme = "light";
    root.innerHTML = `<div class="ob-shell"><div class="ob-panel ob-in">${renderStep()}</div></div>`;
    bind();
    requestAnimationFrame(() => {
      root.querySelector(".ob-panel")?.classList.add("ob-in");
    });
  }

  function renderStep() {
    switch (stepId()) {
      case "welcome":
        return `
          <div class="ob-center">
            <p class="ob-kicker">Nascent Love</p>
            <h1 class="ob-welcome">慢慢来。<br>这里没有标准答案</h1>
          </div>`;
      case "age":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">年龄确认</p>
            <h2>你已经成年了吗？</h2>
            <p class="ob-sub">轻轻滑动确认。我们只需要知道你已满 18 岁。</p>
            <div class="ob-age">
              <strong id="ob-age-val">${state.draft.age}</strong>
              <span>岁</span>
            </div>
            <input id="ob-age" class="ob-range" type="range" min="16" max="80" value="${state.draft.age}" />
            <button class="primary ob-cta" data-ob="age-next" ${state.draft.age < 18 ? "disabled" : ""}>
              ${state.draft.age < 18 ? "需满 18 岁才能继续" : "确认并继续"}
            </button>
          </div>`;
      case "intent":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">此刻</p>
            <h2>在这里，你可以只探索自己，不必取悦任何人。</h2>
            <p class="ob-sub">你最想为自己做到哪一件？</p>
            ${renderSingleChoices(INTENTS, state.draft.intent, "pick-intent", "intent")}
            <button class="primary ob-cta" data-ob="intent-next" ${state.draft.intent ? "" : "disabled"}>继续</button>
          </div>`;
      case "experience":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">熟悉程度</p>
            <h2>你和它，是第一次见面，还是老朋友了？</h2>
            <p class="ob-sub">我们会据此调整后面使用指南的篇幅。</p>
            ${renderSingleChoices(Object.values(EXPERIENCE), state.draft.experience, "exp", "exp")}
            <button class="primary ob-cta" data-ob="exp-next" ${state.draft.experience ? "" : "disabled"}>继续</button>
          </div>`;
      case "product":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">产品</p>
            <h2>你这次购买的是哪种产品？</h2>
            <p class="ob-sub">先认准手上的这一台，后续指南会按型号展开。</p>
            <button class="ob-choice ${state.draft.productId === "fitme" ? "selected" : ""}" data-ob="product" data-product="fitme">
              <strong>Fit me!听我的</strong>
              <span>入体小玩具</span>
            </button>
            <button class="primary ob-cta" data-ob="product-next" ${state.draft.productId ? "" : "disabled"}>
              继续
            </button>
          </div>`;
      case "companion-intro":
        return `
          <div class="ob-center">
            <p class="ob-kicker">陪伴者</p>
            <h1 class="ob-welcome" style="font-size:1.55rem;line-height:1.45">接下来几个小问题，<br>帮你找到最合拍的陪伴者（TA）</h1>
            <div class="ob-actions" style="margin-top:28px">
              <button class="ghost ob-cta" data-ob="companion-later">稍后设置</button>
              <button class="primary ob-cta" data-ob="next">开始</button>
            </div>
          </div>`;
      case "companion-tone":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">TA · 性格</p>
            <h2>你希望陪你的 TA 是什么样的性格？</h2>
            <p class="ob-sub">先选一个基调，之后仍可在「我的」里调整。</p>
            ${renderSingleChoices(COMPANION_TONES, state.draft.companionTone, "pick-tone", "tone")}
            <div class="ob-actions">
              <button class="ghost ob-cta" data-ob="companion-later">稍后设置</button>
              <button class="primary ob-cta" data-ob="tone-next" ${state.draft.companionTone ? "" : "disabled"}>继续</button>
            </div>
          </div>`;
      case "companion-pace":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">TA · 节奏</p>
            <h2>你更喜欢慢慢被带入，还是直接开始？</h2>
            ${renderSingleChoices(COMPANION_PACING, state.draft.companionPace, "pick-pace", "pace")}
            <div class="ob-actions">
              <button class="ghost ob-cta" data-ob="companion-later">稍后设置</button>
              <button class="primary ob-cta" data-ob="pace-next" ${state.draft.companionPace ? "" : "disabled"}>继续</button>
            </div>
          </div>`;
      case "care-remind":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">小知识</p>
            <h2>玩具用完后简单清洁一下，能用得更久也更安心。</h2>
            <p class="ob-sub">想让 TA 之后提醒你保养吗？</p>
            ${renderSingleChoices(CARE_REMIND, state.draft.careRemind, "pick-care", "care")}
            <button class="primary ob-cta" data-ob="care-next" ${state.draft.careRemind ? "" : "disabled"}>继续</button>
          </div>`;
      case "privacy-comfort": {
        const selected = new Set(state.draft.privacyComfort || []);
        return `
          <div class="ob-stack">
            <p class="ob-kicker">隐私</p>
            <h2>最后，你的隐私永远由你说了算。</h2>
            <p class="ob-sub">哪些会让你更安心？（可多选）</p>
            ${PRIVACY_COMFORT.map((item) => `
              <button class="ob-choice ${selected.has(item.id) ? "selected" : ""}" data-ob="pick-privacy" data-privacy="${item.id}">
                <strong>${item.label}</strong>
              </button>
            `).join("")}
            <button class="primary ob-cta" data-ob="privacy-next" ${selected.size ? "" : "disabled"}>继续</button>
          </div>`;
      }
      case "permissions":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">权限</p>
            <h2>只在需要时向你申请</h2>
            <p class="ob-sub">每一项都会说明用途，你可以稍后在设置里更改。</p>
            <div class="ob-card">
              <div>
                <strong>蓝牙</strong>
                <p>用于连接萨福产品或健康手环。生理数据只会留在本 App 内使用。</p>
              </div>
              <button class="ghost" data-ob="perm-bt">${state.draft.bluetooth ? "已允许" : "允许"}</button>
            </div>
            <div class="ob-card">
              <div>
                <strong>通知</strong>
                <p>用于清洁提醒等非打扰型提示，文案会保持隐晦。</p>
              </div>
              <button class="ghost" data-ob="perm-nt">${state.draft.notification ? "已允许" : "允许"}</button>
            </div>
            <button class="primary ob-cta" data-ob="next">继续</button>
          </div>`;
      case "pairing":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">设备配对</p>
            <h2>连接玩具</h2>
            <p class="ob-sub">连接成功后，设备会轻震一下作为确认。</p>
            <div class="ob-pair ${state.draft.paired ? "ok" : ""}">
              ${state.draft.paired ? "已连接 · 轻震确认完成" : "尚未连接"}
            </div>
            <button class="primary ob-cta" data-ob="${state.draft.paired ? "next" : "pair"}">
              ${state.draft.paired ? "继续" : "模拟连接并轻震"}
            </button>
            <button class="ghost ob-cta" data-ob="pair-skip">暂时跳过</button>
          </div>`;
      case "pairing-band":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">设备配对</p>
            <h2>连接健康手环</h2>
            <p class="ob-sub">默认对接小米手表。连接后可在「我的」里查看状态，也可稍后设置。</p>
            <div class="ob-pair ${state.draft.bandPaired ? "ok" : ""}">
              ${state.draft.bandPaired ? "已连接健康手环" : "尚未连接"}
            </div>
            <button class="primary ob-cta" data-ob="${state.draft.bandPaired ? "next" : "pair-band"}">
              ${state.draft.bandPaired ? "继续" : "模拟连接健康手环"}
            </button>
            <button class="ghost ob-cta" data-ob="pair-band-skip">暂时跳过</button>
          </div>`;
      case "guide:clean":
      case "guide:store":
      case "guide:boundary": {
        const guideId = stepId().slice("guide:".length);
        const list = EXPERIENCE[state.draft.experience]?.guides ?? EXPERIENCE.never.guides;
        const index = list.indexOf(guideId);
        const total = list.length;
        const meta = GUIDE_META[guideId];
        return `
          <div class="ob-stack">
            <p class="ob-kicker">使用指南 · ${index + 1}/${total}</p>
            <h2>${meta.title}</h2>
            <div class="ob-placeholder">${meta.body}</div>
            <button class="primary ob-cta" data-ob="next">${index === total - 1 ? "我已阅读" : "下一页"}</button>
          </div>`;
      }
      case "safeword": {
        const canSpeak = speechSupported();
        return `
          <div class="ob-stack">
            <p class="ob-kicker">安全词</p>
            <h2>说出它，我会立刻停下</h2>
            <p class="ob-sub">默认是「红灯」。文字和语音任选一种设置即可。</p>
            <label class="ob-label">文字输入</label>
            <input id="ob-safeword" class="ob-field" type="text" value="${escapeHtml(state.draft.safeword)}" maxlength="12" placeholder="输入你的安全词" />
            <label class="ob-label">语音输入</label>
            <div class="ob-voice-row">
              <button type="button" class="ghost ob-voice-btn ${state.listening ? "listening" : ""}" data-ob="sw-voice" ${canSpeak ? "" : "disabled"}>
                ${state.listening ? "正在听…" : canSpeak ? "点击说出安全词" : "当前浏览器不支持语音"}
              </button>
              <span class="ob-hint" id="ob-sw-voice-hint">${canSpeak ? "与文字输入同步，说完会填入上方。" : "可用文字输入代替。"}</span>
            </div>
            <div class="ob-actions">
              <button class="ghost ob-cta" data-ob="sw-later">稍后设置</button>
              <button class="primary ob-cta" data-ob="sw-next">继续</button>
            </div>
          </div>`;
      }
      case "complete":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">完成</p>
            <h2>送你第一张身体小课</h2>
            <article class="ob-gift-card">
              <span class="pill">认识身体</span>
              <h3>${FIRST_CARD.title}</h3>
              <p>${FIRST_CARD.summary}</p>
              <p class="ob-sub">${FIRST_CARD.body}</p>
            </article>
            <p class="ob-sub">准备好了就关闭引导，进入 Nascent。</p>
            <button class="primary ob-cta" data-ob="close">关闭</button>
          </div>`;
      default:
        return "";
    }
  }

  function startVoiceInput() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) return;
    stopListening();
    const rec = new Speech();
    rec.lang = "zh-CN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    state.recognition = rec;
    state.listening = true;
    const btn = root.querySelector('[data-ob="sw-voice"]');
    const hint = root.querySelector("#ob-sw-voice-hint");
    if (btn) {
      btn.classList.add("listening");
      btn.textContent = "正在听…";
    }
    if (hint) hint.textContent = "请说出你的安全词";

    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
      const word = transcript.replace(/[。．，,！!？?\s]/g, "").slice(0, 12);
      if (word) {
        state.draft.safeword = word;
        persist();
        const input = root.querySelector("#ob-safeword");
        if (input) input.value = word;
        if (hint) hint.textContent = `已录入：「${word}」`;
      }
    };
    rec.onerror = () => {
      state.listening = false;
      if (btn) {
        btn.classList.remove("listening");
        btn.textContent = "点击说出安全词";
      }
      if (hint) hint.textContent = "没听清，可以再试一次或改用文字。";
    };
    rec.onend = () => {
      state.listening = false;
      if (btn) {
        btn.classList.remove("listening");
        btn.textContent = "点击说出安全词";
      }
    };
    try {
      rec.start();
    } catch {
      state.listening = false;
    }
  }

  function togglePrivacy(id) {
    let list = [...(state.draft.privacyComfort || [])];
    if (id === "both") {
      list = list.includes("both") ? [] : ["both"];
    } else {
      list = list.filter((x) => x !== "both");
      if (list.includes(id)) list = list.filter((x) => x !== id);
      else list.push(id);
    }
    state.draft.privacyComfort = list;
    persist();
    paint();
  }

  function bind() {
    if (stepId() === "welcome") {
      window.setTimeout(() => {
        if (stepId() === "welcome") goNext();
      }, 2200);
    }

    const age = root.querySelector("#ob-age");
    if (age) {
      age.addEventListener("input", () => {
        state.draft.age = Number(age.value);
        persist();
        const label = root.querySelector("#ob-age-val");
        if (label) label.textContent = String(state.draft.age);
        const btn = root.querySelector('[data-ob="age-next"]');
        if (btn) {
          const ok = state.draft.age >= 18;
          btn.disabled = !ok;
          btn.textContent = ok ? "确认并继续" : "需满 18 岁才能继续";
        }
      });
    }

    const safewordInput = root.querySelector("#ob-safeword");
    if (safewordInput) {
      safewordInput.addEventListener("input", () => {
        state.draft.safeword = safewordInput.value.trim() || "红灯";
        persist();
      });
    }

    root.onclick = (event) => {
      const t = event.target.closest("[data-ob]");
      if (!t || t.disabled) return;
      const act = t.dataset.ob;

      if (
        act === "next"
        || act === "age-next"
        || act === "intent-next"
        || act === "exp-next"
        || act === "product-next"
        || act === "tone-next"
        || act === "pace-next"
        || act === "care-next"
        || act === "privacy-next"
        || act === "sw-next"
      ) {
        if (act === "intent-next" && !state.draft.intent) return;
        if (act === "exp-next" && !state.draft.experience) return;
        if (act === "product-next" && !state.draft.productId) return;
        if (act === "tone-next" && !state.draft.companionTone) return;
        if (act === "pace-next" && !state.draft.companionPace) return;
        if (act === "care-next" && !state.draft.careRemind) return;
        if (act === "privacy-next" && !(state.draft.privacyComfort || []).length) return;
        if (act === "sw-next") {
          const input = root.querySelector("#ob-safeword");
          state.draft.safeword = input?.value?.trim() || state.draft.safeword || "红灯";
          state.draft.safewordSkipped = false;
          persist();
        }
        if (act === "care-next" && state.draft.careRemind === "yes") {
          state.draft.notification = true;
          persist();
        }
        goNext();
        return;
      }

      if (act === "companion-later") {
        state.draft.personaSkipped = true;
        if (!state.draft.companionTone) state.draft.companionTone = "";
        if (!state.draft.companionPace) state.draft.companionPace = "";
        persist();
        // 跳过剩余陪伴者问题，直接到清洁提醒页。
        jumpTo("care-remind");
        return;
      }

      if (act === "pick-intent") {
        state.draft.intent = t.dataset.intent;
        persist();
        paint();
        return;
      }

      if (act === "exp") {
        state.draft.experience = t.dataset.exp;
        steps = buildSteps(state.draft.experience);
        state.stepIndex = steps.indexOf("experience");
        persist();
        paint();
        return;
      }

      if (act === "product") {
        state.draft.productId = t.dataset.product;
        persist();
        paint();
        return;
      }

      if (act === "pick-tone") {
        state.draft.companionTone = t.dataset.tone;
        const tone = COMPANION_TONES.find((item) => item.id === state.draft.companionTone);
        state.draft.personaNote = tone?.note || "";
        state.draft.personaSkipped = false;
        persist();
        paint();
        return;
      }

      if (act === "pick-pace") {
        state.draft.companionPace = t.dataset.pace;
        persist();
        paint();
        return;
      }

      if (act === "pick-care") {
        state.draft.careRemind = t.dataset.care;
        persist();
        paint();
        return;
      }

      if (act === "pick-privacy") {
        togglePrivacy(t.dataset.privacy);
        return;
      }

      if (act === "perm-bt") {
        state.draft.bluetooth = true;
        persist();
        paint();
        return;
      }
      if (act === "perm-nt") {
        state.draft.notification = true;
        persist();
        paint();
        return;
      }

      if (act === "pair") {
        state.draft.paired = true;
        persist();
        if (navigator.vibrate) navigator.vibrate(40);
        paint();
        return;
      }
      if (act === "pair-skip") {
        state.draft.paired = false;
        persist();
        goNext();
        return;
      }
      if (act === "pair-band") {
        state.draft.bandPaired = true;
        persist();
        if (navigator.vibrate) navigator.vibrate(40);
        paint();
        return;
      }
      if (act === "pair-band-skip") {
        state.draft.bandPaired = false;
        persist();
        goNext();
        return;
      }

      if (act === "sw-voice") {
        startVoiceInput();
        return;
      }

      if (act === "sw-later") {
        state.draft.safewordSkipped = true;
        persist();
        goNext();
        return;
      }

      if (act === "close") {
        stopListening();
        markOnboardingDone();
        root.classList.remove("onboarding");
        onComplete({ draft: state.draft, firstCard: FIRST_CARD });
      }
    };
  }

  paint();

  return {
    destroy() {
      stopListening();
      root.onclick = null;
    },
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
