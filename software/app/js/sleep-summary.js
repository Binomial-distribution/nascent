import { MoodUi, dayKey } from "./heart.js";
import { medianBpm } from "./hr.js";

export const REST_LABEL = Object.freeze({
  quiet: "安静",
  varied: "起伏",
  restless: "偏醒",
});

/** Isolated or trailing samples cover five minutes. */
export const REST_COVER_MIN = 5;
/** Gaps longer than this are not counted as rest (band off / missing samples). */
export const REST_GAP_MAX_MS = 15 * 60 * 1000;

export function restKindForBpm(bpm, median) {
  if (bpm <= median - 5) return "quiet";
  if (bpm >= median + 8) return "restless";
  return "varied";
}

export function wakeDayKey(nightKey) {
  const [year, month, day] = String(nightKey).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  return dayKey(date);
}

export function isCalendarYesterday(key, now = new Date()) {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  yesterday.setDate(yesterday.getDate() - 1);
  return dayKey(yesterday) === dayKey(key);
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
  const pieces = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    const next = sorted[index + 1];
    const kind = restKindForBpm(item.bpm, median);
    const gap = next ? next.ts - item.ts : 0;
    if (next && gap > 0 && gap <= REST_GAP_MAX_MS) {
      pieces.push({ kind, minutes: Math.max(1, Math.round(gap / 60000)) });
    } else {
      pieces.push({ kind, minutes: REST_COVER_MIN });
    }
  }
  const segments = [];
  for (const piece of pieces) {
    const last = segments[segments.length - 1];
    if (last && last.kind === piece.kind) last.minutes += piece.minutes;
    else segments.push({ kind: piece.kind, minutes: piece.minutes });
  }
  const total = segments.reduce((sum, item) => sum + item.minutes, 0) || 1;
  for (const item of segments) item.pct = Math.round((item.minutes / total) * 100);
  const dominant = segments.reduce((best, item) => (item.minutes >= best.minutes ? item : best)).kind;
  return {
    hasHr: true,
    durationMin: Math.max(1, total),
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

export function buildSleepReport({ nights = [], moodKeys = [], moodFor, now = new Date() } = {}) {
  const byKey = new Map((nights || []).map((night) => [night.key, night.samples || []]));
  const usedMoodDays = new Set();
  const nightRows = [...byKey.keys()].sort().reverse().map((key) => {
    const wake = wakeDayKey(key);
    usedMoodDays.add(wake);
    const moodId = typeof moodFor === "function" ? moodFor(wake)?.mood || null : null;
    return { key, ...summarizeNight(byKey.get(key) || [], moodId, isCalendarYesterday(wake, now)) };
  });
  const moodRows = [...new Set(moodKeys || [])]
    .filter((key) => !usedMoodDays.has(key) && !byKey.has(key))
    .sort()
    .reverse()
    .map((key) => {
      const moodId = typeof moodFor === "function" ? moodFor(key)?.mood || null : null;
      return { key, ...summarizeNight([], moodId, isCalendarYesterday(key, now)) };
    });
  return [...nightRows, ...moodRows].sort((a, b) => (a.key < b.key ? 1 : -1));
}

export function collectRecentMoodKeys(moods, days = 7, from = new Date()) {
  const allowed = new Set();
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < days; i += 1) {
    allowed.add(dayKey(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return [...(moods?.keys?.() || [])].filter((key) => allowed.has(key));
}
