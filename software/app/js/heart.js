import { NlMoodTone } from "./protocol.js";

export const MoodUi = Object.freeze({
  [NlMoodTone.QUIET]: { emoji: "🌙", label: "安静", color: "#B7A7C9" },
  [NlMoodTone.OPEN]: { emoji: "🌿", label: "松开", color: "#A8D5BA" },
  [NlMoodTone.WARM]: { emoji: "🌷", label: "温柔", color: "#F4A7B9" },
  [NlMoodTone.BRIGHT]: { emoji: "☀️", label: "明亮", color: "#F5C97B" },
  [NlMoodTone.TIRED]: { emoji: "☁️", label: "有点累", color: "#9BB9C9" },
});

export const CardCategory = Object.freeze({
  body: { id: "body", label: "认识身体" },
  safety: { id: "safety", label: "安全与卫生" },
  signals: { id: "signals", label: "读懂信号" },
  rhythm: { id: "rhythm", label: "状态与生活" },
});

export const MOOD_STORE_KEY = "nascent.heart.moods";
export const MOOD_KEEP_DAYS = 7;

export function dayKey(date) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function startOfDayFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function recentDayKeys(days = MOOD_KEEP_DAYS, from = new Date()) {
  const keys = [];
  const cursor = startOfDay(from);
  for (let i = 0; i < days; i += 1) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return keys;
}

const DAILY_CARDS = [
  {
    id: "body-01",
    category: "body",
    title: "身体的感觉，没有标准答案",
    summary: "每个人的感受、节奏和偏好都可以不同。",
    body: "把注意力放回自己：舒服、陌生、想停一下，都是值得被听见的信号。你不需要用别人的经验来校准自己。",
    source: "Nascent 身体小课 · 自我觉察",
  },
  {
    id: "safety-01",
    category: "safety",
    title: "清洁之后，记得让它完全干燥",
    summary: "清洁、冲净、擦干，再放回通风的位置。",
    body: "使用产品说明中允许的清洁方式。不要把未干燥的设备收进密闭袋里，也不要让充电口接触水。具体做法以产品说明书为准。",
    source: "Nascent 身体小课 · 安全与卫生",
  },
  {
    id: "signals-01",
    category: "signals",
    title: "记录是为了了解，不是为了打分",
    summary: "一次记录只描述当下，不替你下结论。",
    body: "温度、压力和节律可以帮助你回看当时的体验，但它们不是诊断，也不能替代专业建议。保留“我当时怎么感觉”同样重要。",
    source: "Nascent 身体小课 · 读懂信号",
  },
  {
    id: "rhythm-01",
    category: "rhythm",
    title: "找到自己的节奏，可以从慢一点开始",
    summary: "低档、短时、随时可停，是很好的开始。",
    body: "开始前给自己留一点准备时间。过程中留意呼吸和身体反馈，不舒服时及时停下，不需要坚持到某个“完成线”。",
    source: "Nascent 身体小课 · 状态与生活",
  },
];

export class HeartState {
  constructor(cards = DAILY_CARDS, { storage = defaultStorage() } = {}) {
    this._cards = Array.isArray(cards) ? cards : DAILY_CARDS;
    this._storage = storage;
    this._readCards = new Map();
    this._favoriteCards = new Set();
    this._moods = this._loadMoods();
    this._activeCard = 0;
    this._listeners = new Set();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    for (const fn of this._listeners) fn();
  }

  get cards() {
    return this._cards;
  }

  get activeCard() {
    return this._cards[this._activeCard];
  }

  get activeCardIndex() {
    return this._activeCard;
  }

  get favoriteCardIds() {
    return new Set(this._favoriteCards);
  }

  get moods() {
    return new Map(this._moods);
  }

  moodFor(date) {
    return this._moods.get(dayKey(date)) ?? null;
  }

  get streak() {
    if (this._moods.size === 0) return 0;
    let cursor = startOfDay(new Date());
    if (!this._moods.has(dayKey(cursor))) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
    let count = 0;
    while (this._moods.has(dayKey(cursor))) {
      count += 1;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
    return count;
  }

  isRead(cardId) {
    return this._readCards.has(cardId);
  }

  isFavorite(cardId) {
    return this._favoriteCards.has(cardId);
  }

  selectCard(index) {
    if (index < 0 || index >= this._cards.length || index === this._activeCard) return;
    this._activeCard = index;
    // 不通知整页重绘：卡片条滚动位置不能被清掉。
  }

  readCard(card) {
    this._readCards.set(card.id, new Date());
    this._notify();
  }

  toggleFavorite(card) {
    if (!this._favoriteCards.delete(card.id)) this._favoriteCards.add(card.id);
    this._notify();
  }

  recordMood(mood, { note = "", date = new Date() } = {}) {
    const day = startOfDay(date);
    this._moods.set(dayKey(day), { date: day, mood, note });
    this._pruneMoods();
    this._persistMoods();
    this._notify();
  }

  clearLocal() {
    this._readCards.clear();
    this._favoriteCards.clear();
    this._moods.clear();
    this._activeCard = 0;
    this._persistMoods();
    this._notify();
  }

  _loadMoods() {
    if (!this._storage) return new Map();
    try {
      const raw = JSON.parse(this._storage.getItem(MOOD_STORE_KEY) || "[]");
      const map = new Map();
      for (const item of Array.isArray(raw) ? raw : []) {
        const key = dayKey(item.key || item.date);
        if (!key || !item.mood) continue;
        map.set(key, { date: startOfDayFromKey(key), mood: item.mood, note: item.note || "" });
      }
      this._moods = map;
      this._pruneMoods();
      return map;
    } catch {
      return new Map();
    }
  }

  _pruneMoods() {
    const allowed = new Set(recentDayKeys());
    for (const key of [...this._moods.keys()]) {
      if (!allowed.has(key)) this._moods.delete(key);
    }
  }

  _persistMoods() {
    if (!this._storage) return;
    try {
      const payload = [...this._moods.entries()].map(([key, entry]) => ({
        key,
        mood: entry.mood,
        note: entry.note || "",
      }));
      this._storage.setItem(MOOD_STORE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota */
    }
  }

  prependCard(card) {
    if (!card?.id || this._cards.some((c) => c.id === card.id)) return;
    this._cards = [card, ...this._cards];
    this._activeCard = 0;
    this._notify();
  }
}

export const heart = new HeartState();
