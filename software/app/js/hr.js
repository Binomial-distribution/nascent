/**
 * 可穿戴心率：平滑、基线、断流。
 * 只产出趋势给 AI（sensor_context），原始 BPM 留在本机。
 * 禁止从这里发玩具指令。
 */

export const HR_SOURCE = "xiaomi_smart_band_7";
export const HR_BPM_MIN = 30;
export const HR_BPM_MAX = 240;
export const HR_WINDOW = 5;
export const HR_BASELINE_MS = 60_000;
export const HR_STALE_MS = 10_000;
export const HR_STEADY_DELTA = 5;
export const NIGHT_LOG_KEY = "nascent.hr.nights";
export const NIGHT_SAMPLE_MS = 5 * 60 * 1000;
export const NIGHT_KEEP = 7;

export function medianBpm(samples) {
  if (!samples.length) throw new Error("medianBpm requires samples");
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function trendFromDelta(delta) {
  if (delta == null || !Number.isFinite(delta)) return "unknown";
  if (Math.abs(delta) < HR_STEADY_DELTA) return "steady";
  return delta > 0 ? "increasing" : "decreasing";
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function nightKeyFor(timestampMs) {
  const date = new Date(timestampMs);
  const hour = date.getHours();
  if (hour >= 10 && hour < 22) return null;
  if (hour < 10) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export class NightHeartLog {
  /**
   * @param {{ storage?: Storage | null, now?: () => Date }} [options]
   */
  constructor({ storage = defaultStorage(), now = () => new Date() } = {}) {
    this._storage = storage;
    this._now = now;
    this._nights = this._load();
  }

  ingest(bpm, timestampMs) {
    const key = nightKeyFor(timestampMs);
    if (!key) return false;
    const rounded = Math.round(Number(bpm));
    if (!Number.isFinite(rounded)) return false;
    const samples = this._nights.get(key) || [];
    const last = samples[samples.length - 1];
    if (last && timestampMs - last.ts < NIGHT_SAMPLE_MS) return false;
    samples.push({ ts: timestampMs, bpm: rounded });
    this._nights.set(key, samples);
    this._prune();
    this._save();
    return true;
  }

  nights() {
    return [...this._nights.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, samples]) => ({ key, samples: [...samples] }));
  }

  reset() {
    this._nights = new Map();
    this._save();
  }

  _recentNightKeys(days = NIGHT_KEEP, from = new Date()) {
    const keys = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (let i = 0; i < days; i += 1) {
      keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`);
      cursor.setDate(cursor.getDate() - 1);
    }
    return keys;
  }

  _prune() {
    const allowed = new Set(this._recentNightKeys(NIGHT_KEEP, this._now()));
    for (const key of [...this._nights.keys()]) {
      if (!allowed.has(key)) this._nights.delete(key);
    }
  }

  _load() {
    if (!this._storage) return new Map();
    try {
      const raw = JSON.parse(this._storage.getItem(NIGHT_LOG_KEY) || "[]");
      this._nights = new Map((Array.isArray(raw) ? raw : []).map((item) => [
        String(item.key),
        (item.samples || []).map((sample) => ({ ts: Number(sample.ts), bpm: Number(sample.bpm) })),
      ]));
      this._prune();
      this._save();
      return this._nights;
    } catch {
      return new Map();
    }
  }

  _save() {
    if (!this._storage) return;
    try {
      const payload = [...this._nights.entries()].map(([key, samples]) => ({ key, samples }));
      this._storage.setItem(NIGHT_LOG_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota */
    }
  }
}

export const nightHeartLog = new NightHeartLog();

export function nativeHeartRateAvailable(target = globalThis) {
  try {
    return Boolean(target.NascentHeartRate?.available?.());
  } catch {
    return false;
  }
}

export class HeartRateState {
  /**
   * @param {{ now?: () => number, nightLog?: { ingest(bpm: number, ts: number): boolean } | null }} [options]
   */
  constructor({ now = () => Date.now(), nightLog = null } = {}) {
    this._now = now;
    this._nightLog = nightLog;
    this._recent = [];
    this._baselineWindow = [];
    this._startedAt = null;
    this._baseline = null;
    this._lastTs = 0;
    this._source = "unknown";
    this._listeners = new Set();
  }

  reset() {
    this._recent = [];
    this._baselineWindow = [];
    this._startedAt = null;
    this._baseline = null;
    this._lastTs = 0;
    this._source = "unknown";
    this._notify();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    fn(this.snapshot);
    return () => this._listeners.delete(fn);
  }

  /**
   * @param {{ bpm: number, timestampMs: number, source?: string, quality?: number }} sample
   * @returns {boolean} 是否收下
   */
  ingest(sample) {
    const bpm = Number(sample?.bpm);
    const timestampMs = Number(sample?.timestampMs);
    if (!Number.isFinite(bpm) || bpm < HR_BPM_MIN || bpm > HR_BPM_MAX) return false;
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;
    if (this._lastTs && timestampMs < this._lastTs) return false;

    const rounded = Math.round(bpm);
    this._recent.push(rounded);
    if (this._recent.length > HR_WINDOW) this._recent.shift();
    this._lastTs = timestampMs;
    this._source = sample?.source || HR_SOURCE;
    if (this._startedAt == null) this._startedAt = timestampMs;
    if (this._baseline == null) {
      if (timestampMs - this._startedAt <= HR_BASELINE_MS) {
        this._baselineWindow.push(rounded);
      }
      if (
        timestampMs - this._startedAt >= HR_BASELINE_MS
        && this._baselineWindow.length > 0
      ) {
        this._baseline = medianBpm(this._baselineWindow);
      }
    }
    this._notify();
    this._nightLog?.ingest(rounded, timestampMs);
    return true;
  }

  get hasEverSampled() {
    return this._lastTs > 0;
  }

  get live() {
    if (!this.hasEverSampled) return false;
    return this._now() - this._lastTs <= HR_STALE_MS;
  }

  get snapshot() {
    const live = this.live;
    const smooth = this._recent.length ? medianBpm(this._recent) : null;
    const baseline = this._baseline;
    const collecting = this.hasEverSampled && baseline == null;
    const delta = smooth != null && baseline != null ? smooth - baseline : null;
    let quality = "unknown";
    let source = "none";
    let trend = "unknown";
    if (this.hasEverSampled) {
      source = this._source || HR_SOURCE;
      quality = live ? "valid" : "stale";
      if (live && delta != null) trend = trendFromDelta(delta);
    }
    return {
      bpm: live ? smooth : null,
      baseline,
      delta: live ? delta : null,
      trend,
      quality,
      source: this.hasEverSampled ? source : "none",
      live,
      collectingBaseline: live && collecting,
    };
  }

  /**
   * 给 Agent 的脱敏字段。原始 BPM 不在这里。
   * @param {{ bandConnected?: boolean }} [options]
   */
  sensorFields({ bandConnected = false } = {}) {
    const snap = this.snapshot;
    if (snap.source !== "none") {
      return {
        hr_trend: snap.trend,
        hr_quality: snap.quality,
        hr_source: snap.source,
      };
    }
    return {
      hr_trend: "unknown",
      hr_quality: "unknown",
      hr_source: bandConnected ? "wearable_connected_waiting" : "none",
    };
  }

  _notify() {
    const snap = this.snapshot;
    for (const fn of this._listeners) fn(snap);
  }
}

export const heartRate = new HeartRateState({ nightLog: nightHeartLog });

export function installHeartRateBridge(state = heartRate, target = globalThis) {
  if (!target || typeof target !== "object") return;
  target.__nascentOnHeartRateSample = (sample) => state.ingest(sample);
}

installHeartRateBridge();

export function hrChipText(sensors, snap = heartRate.snapshot) {
  if (sensors.hr_source === "none") return "心率 未接入";
  if (sensors.hr_quality === "stale") return "心率 已失联";
  if (snap.collectingBaseline && snap.bpm != null) return `心率 ${snap.bpm} · 采集基线`;
  if (snap.bpm != null && sensors.hr_quality === "valid") {
    const trend = {
      unknown: "趋势未知",
      steady: "平稳",
      increasing: "上升",
      decreasing: "回落",
    }[sensors.hr_trend] || "趋势未知";
    return `心率 ${snap.bpm} · ${trend}`;
  }
  if (sensors.hr_source === "wearable_connected_waiting") return "心率 等待样本";
  return "心率 趋势未知";
}
