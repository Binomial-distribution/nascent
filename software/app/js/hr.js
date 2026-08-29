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

export function nativeHeartRateAvailable(target = globalThis) {
  try {
    return Boolean(target.NascentHeartRate?.available?.());
  } catch {
    return false;
  }
}

export class HeartRateState {
  /**
   * @param {{ now?: () => number }} [options]
   */
  constructor({ now = () => Date.now() } = {}) {
    this._now = now;
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

export const heartRate = new HeartRateState();

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
