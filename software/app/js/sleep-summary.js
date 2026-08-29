import { MoodUi } from "./heart.js";
import { medianBpm } from "./hr.js";

export const REST_LABEL = Object.freeze({
  quiet: "安静",
  varied: "起伏",
  restless: "偏醒",
});

export function restKindForBpm(bpm, median) {
  if (bpm <= median - 5) return "quiet";
  if (bpm >= median + 8) return "restless";
  return "varied";
}

export function contrastCopy(moodId, dominant, asLastNight = false) {
  const moodLabel = moodId && MoodUi[moodId] ? MoodUi[moodId].label : "";
  const noted = asLastNight ? "昨天记下" : "那天记下";
  if (!moodLabel && !dominant) return "";
  if (!dominant) return `${noted}${moodLabel}`;
  if (!moodLabel) {
    if (dominant === "quiet") return "夜里心率比较安静";
    if (dominant === "restless") return "夜里心率偏醒的时段多一些";
    return "夜里心率起伏多一些";
  }
  if (moodId === "tired" && dominant !== "quiet") {
    return `${noted}有点累，夜里心率起伏多一些`;
  }
  if (dominant === "quiet") return `${noted}${moodLabel}，夜里心率比较安静`;
  if (dominant === "restless") return `${noted}${moodLabel}，夜里心率偏醒的时段多一些`;
  return `${noted}${moodLabel}，夜里心率起伏多一些`;
}

export function summarizeNight(samples, moodId, asLastNight = false) {
  if (!samples?.length) {
    return {
      hasHr: false,
      durationMin: 0,
      startTs: null,
      endTs: null,
      segments: [],
      dominant: null,
      contrast: contrastCopy(moodId, null, asLastNight),
      moodId: moodId || null,
    };
  }
  const sorted = [...samples].sort((a, b) => a.ts - b.ts);
  const median = medianBpm(sorted.map((item) => item.bpm));
  const startTs = sorted[0].ts;
  const endTs = sorted[sorted.length - 1].ts;
  const pieces = sorted.map((item, index) => {
    const next = sorted[index + 1];
    const minutes = next ? Math.max(1, Math.round((next.ts - item.ts) / 60000)) : 5;
    return { kind: restKindForBpm(item.bpm, median), minutes };
  });
  const segments = [];
  for (const piece of pieces) {
    const last = segments[segments.length - 1];
    if (last && last.kind === piece.kind) last.minutes += piece.minutes;
    else segments.push({ kind: piece.kind, minutes: piece.minutes });
  }
  const total = segments.reduce((sum, item) => sum + item.minutes, 0) || 1;
  for (const item of segments) item.pct = Math.round((item.minutes / total) * 100);
  const dominant = segments.reduce((best, item) => (item.minutes >= best.minutes ? item : best)).kind;
  const spanMin = Math.round((endTs - startTs) / 60000);
  return {
    hasHr: true,
    durationMin: Math.max(1, spanMin || total),
    startTs,
    endTs,
    segments,
    dominant,
    contrast: contrastCopy(moodId, dominant, asLastNight),
    moodId: moodId || null,
  };
}

export function emptySleepCopy() {
  return "还没有夜间心率或心绪记录";
}

export function sleepCopyIsSafe(text) {
  return !/检测|障碍|深睡|REM|评分|诊断|异常/.test(String(text || ""));
}

export function buildSleepReport({ nights = [], moodKeys = [], moodFor } = {}) {
  const byKey = new Map((nights || []).map((night) => [night.key, night.samples || []]));
  const keys = [...new Set([...byKey.keys(), ...(moodKeys || [])])].sort().reverse().slice(0, 7);
  return keys.map((key, index) => {
    const moodId = typeof moodFor === "function" ? moodFor(key)?.mood || null : null;
    return { key, ...summarizeNight(byKey.get(key) || [], moodId, index === 0) };
  });
}

export function collectRecentMoodKeys(moods, days = 7) {
  const allowed = new Set();
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i += 1) {
    allowed.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`);
    cursor.setDate(cursor.getDate() - 1);
  }
  return [...(moods?.keys?.() || [])].filter((key) => allowed.has(key));
}
