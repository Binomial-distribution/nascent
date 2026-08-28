/**
 * 首次启动 Onboarding（文档 4.3）
 * 新用户只出现一次；demo 可通过 reset / #/onboarding 反复进入。
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

/** 玩具经验 → 卫生与安全指南屏（渐进披露） */
export const EXPERIENCE = {
  never: {
    id: "never",
    label: "完全没用过",
    hint: "从基础清洁、收纳到使用边界，三页都看一遍。",
    guides: ["clean", "store", "boundary"],
  },
  aware: {
    id: "aware",
    label: "有一些了解，但没用过萨福品牌",
    hint: "保留清洁要点与使用边界两页。",
    guides: ["clean", "boundary"],
  },
  experienced: {
    id: "experienced",
    label: "已经有经验了",
    hint: "只保留一页安全边界提醒。",
    guides: ["boundary"],
  },
};

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
    "experience",
    "product",
    "persona",
    "permissions",
    "pairing",
    ...guides,
    "safeword",
    "complete",
  ];
}

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
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
      experience: "",
      productId: "",
      personaNote: "",
      personaSkipped: false,
      bluetooth: false,
      notification: false,
      storage: "local",
      paired: false,
      safeword: "红灯",
      safewordSkipped: false,
      ...loadDraft(),
    },
  };

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
      case "experience":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">使用经验</p>
            <h2>你和小玩具打过几次交道？</h2>
            <p class="ob-sub">我们会据此调整后面使用指南的篇幅。</p>
            ${Object.values(EXPERIENCE).map((item) => `
              <button class="ob-choice ${state.draft.experience === item.id ? "selected" : ""}" data-ob="exp" data-exp="${item.id}">
                <strong>${item.label}</strong>
                <span>${item.hint}</span>
              </button>
            `).join("")}
            <button class="primary ob-cta" data-ob="exp-next" ${state.draft.experience ? "" : "disabled"}>
              继续
            </button>
          </div>`;
      case "product":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">产品</p>
            <h2>你这次购买的是哪种萨福产品？</h2>
            <p class="ob-sub">先认准手上的这一台，后续指南会按型号展开。</p>
            <button class="ob-choice ${state.draft.productId === "fitme" ? "selected" : ""}" data-ob="product" data-product="fitme">
              <strong>Fit me!听我的</strong>
              <span>入体小玩具</span>
            </button>
            <button class="primary ob-cta" data-ob="product-next" ${state.draft.productId ? "" : "disabled"}>
              继续
            </button>
          </div>`;
      case "persona":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">AI 伴侣人设</p>
            <h2>想让 TA 怎么陪你？</h2>
            <p class="ob-sub">用一两句话告诉我即可，不用填表。</p>
            <div class="ob-chat">
              <div class="ob-bubble ai">你好。我可以温柔一些，也可以更直接。你希望我是什么样的陪伴？</div>
              ${state.draft.personaNote ? `<div class="ob-bubble me">${escapeHtml(state.draft.personaNote)}</div>` : ""}
            </div>
            <textarea id="ob-persona" class="ob-input" rows="3" placeholder="例如：话少一点，先听我说……">${escapeHtml(state.draft.personaNote)}</textarea>
            <div class="ob-actions">
              <button class="ghost ob-cta" data-ob="persona-later">稍后再设置</button>
              <button class="primary ob-cta" data-ob="persona-next">继续</button>
            </div>
          </div>`;
      case "permissions":
        return `
          <div class="ob-stack">
            <p class="ob-kicker">权限</p>
            <h2>只在需要时向你申请</h2>
            <p class="ob-sub">每一项都会说明用途，你可以稍后在设置里更改。</p>
            <div class="ob-card">
              <div>
                <strong>蓝牙</strong>
                <p>用于连接玩具，控制与状态同步。</p>
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

      if (act === "next" || act === "age-next" || act === "persona-next" || act === "sw-next" || act === "exp-next" || act === "product-next") {
        if (act === "persona-next") {
          const area = root.querySelector("#ob-persona");
          state.draft.personaNote = area?.value?.trim() || "";
          state.draft.personaSkipped = false;
          persist();
        }
        if (act === "sw-next") {
          const input = root.querySelector("#ob-safeword");
          state.draft.safeword = input?.value?.trim() || state.draft.safeword || "红灯";
          state.draft.safewordSkipped = false;
          persist();
        }
        if (act === "exp-next" && !state.draft.experience) return;
        if (act === "product-next" && !state.draft.productId) return;
        goNext();
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

      if (act === "persona-later") {
        state.draft.personaSkipped = true;
        persist();
        goNext();
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
