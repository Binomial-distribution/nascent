import { BleDownlink, BleUplink, NlAlert, NlCmd, NlConst, NlInsertState, NlMode, NlWifi } from "../js/protocol.js";
import { Governor } from "../js/governor.js";
import { HeartState } from "../js/heart.js";
import { NlMoodTone } from "../js/protocol.js";
import { toyWsUrl } from "../js/ws.js";
import { BodyNotesState } from "../js/body-notes.js";

let failed = 0;
let passed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${msg}`);
  }
}

function uplink(over = {}) {
  return BleUplink.fromJson({
    ts: 1,
    press_l: 0,
    press_r: 0,
    accel: [0, 0, 1],
    gyro: [0, 0, 0],
    insert_state: "unknown",
    mode: "free",
    level: 1,
    alert: "none",
    ...over,
  });
}

const gov = new Governor();
assert(gov.reject(new BleDownlink({ cmd: NlCmd.STOP, auth: "" })) == null, "stop is always allowed");
assert(
  gov.reject(new BleDownlink({ cmd: NlCmd.RESUME, auth: "" }))?.includes("BOOT"),
  "resume is rejected and points at the toy's BOOT key",
);
assert(
  gov.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 3, auth: "" })) === "与设备的连接不可用，此时只能发送停止。",
  "unhealthy link only allows stop",
);

gov.ingest(uplink({ alert: "safeword" }));
assert(
  gov.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 2, auth: "" }))
    === "已停止。需要长按玩具上的 BOOT 键两秒才能继续。",
  "safeword latches stop",
);
assert(gov.reject(new BleDownlink({ cmd: NlCmd.STOP, auth: "" })) == null, "stop still allowed after safeword");

const gov2 = new Governor();
gov2.ingest(uplink({ insert_state: "unknown", level: 2 }));
assert(
  gov2.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 4, auth: "" }), { automatic: true })
    === "当前无法确认使用状态，已暂停自动调节。",
  "automatic level-up blocked when insert_state is unknown",
);
assert(
  gov2.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 4, auth: "" })) == null,
  "manual level-up allowed when insert_state is unknown",
);
assert(
  gov2.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: NlConst.levelMax + 1, auth: "" })) === "档位超出范围。",
  "level above max is rejected",
);

const heart = new HeartState();
heart.recordMood(NlMoodTone.WARM);
assert(heart.moodFor(new Date())?.mood === NlMoodTone.WARM, "records today's mood");
assert(heart.streak === 1, "streak is 1 after today");

const heart2 = new HeartState();
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
heart2.recordMood(NlMoodTone.QUIET, { date: yesterday });
assert(heart2.streak === 1, "streak tolerates empty today and counts from yesterday");

const heart3 = new HeartState();
const twoDaysAgo = new Date();
twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
heart3.recordMood(NlMoodTone.BRIGHT, { date: twoDaysAgo });
assert(heart3.streak === 0, "streak breaks when yesterday is missing");

const card = heart.cards[0];
heart.readCard(card);
heart.toggleFavorite(card);
assert(heart.isRead(card.id), "marks card read");
assert(heart.isFavorite(card.id), "marks card favorite");
heart.toggleFavorite(card);
assert(!heart.isFavorite(card.id), "favorite toggles off");

assert(
  toyWsUrl("192.168.1.20") === `ws://192.168.1.20:${NlWifi.wsPort}${NlWifi.wsPath}`,
  "bare host gets the contract port and path",
);
assert(
  toyWsUrl(" nascent.local ") === `ws://nascent.local:${NlWifi.wsPort}${NlWifi.wsPath}`,
  "address is trimmed",
);
assert(
  toyWsUrl("192.168.1.20:8080") === `ws://192.168.1.20:8080${NlWifi.wsPath}`,
  "explicit port is kept",
);
assert(
  toyWsUrl("ws://192.168.1.20/") === `ws://192.168.1.20:${NlWifi.wsPort}${NlWifi.wsPath}`,
  "pasted scheme and trailing slash are tolerated",
);
{
  let threw = false;
  try { toyWsUrl("  "); } catch { threw = true; }
  assert(threw, "empty address is rejected instead of building ws://:81");
}

assert(NlInsertState.UNKNOWN === "unknown", "insert_state unknown is the safe default");
assert(NlMode.FREE === "free", "mode free is the default play");
assert(NlAlert.NONE === "none", "alert none is the safe default");

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

const localNotes = new BodyNotesState({ fetchImpl: null });
assert(localNotes.sessions.length === 3, "body notes expose demo sessions without a backend");
assert(localNotes.recentComparisons("demo-session-03").length === 2, "recent scope selects usable records");

const insightCalls = [];
const remoteNotes = new BodyNotesState({
  fetchImpl: async (path, options = {}) => {
    if (path === "/v1/body-notes/sessions") return jsonResponse(localNotes.sessions);
    if (path === "/v1/body-notes/insight-turn") {
      insightCalls.push(JSON.parse(options.body));
      return jsonResponse({
        dialogue: "只读取这一次。",
        scope: "current",
        sources: [],
        insight_candidate: null,
      });
    }
    return jsonResponse({}, { ok: false, status: 404 });
  },
});
await remoteNotes.load();
await remoteNotes.sendInsight("demo-session-03", [], "帮我理解这一次");
assert(remoteNotes.backendAvailable === true, "body notes detect the available backend");
assert(insightCalls[0].session_id === "demo-session-03", "current insight sends the selected session id");
assert(insightCalls[0].comparison_session_ids.length === 0, "current insight sends no recent records");

const failedDelete = new BodyNotesState({
  fetchImpl: async (path) => path === "/v1/body-notes/sessions"
    ? jsonResponse(localNotes.sessions)
    : jsonResponse({}, { ok: false, status: 500 }),
});
await failedDelete.load();
assert(!await failedDelete.deleteSession("demo-session-03"), "remote deletion reports backend failure");
assert(failedDelete.getSession("demo-session-03") !== null, "failed remote deletion keeps the local record visible");

let resolveLoad;
const loadingNotes = new BodyNotesState({
  fetchImpl: () => new Promise((resolve) => {
    resolveLoad = resolve;
  }),
});
const loadingPromise = loadingNotes.load();
assert(!await loadingNotes.deleteSession("demo-session-03"), "delete is refused while backend probe is in flight");
assert(loadingNotes.getSession("demo-session-03") !== null, "in-flight load does not locally delete the record");
assert(!await loadingNotes.sendInsight("demo-session-03", [], "先等等"), "insight is refused while backend probe is in flight");
assert(loadingNotes.messages("demo-session-03", "current").length === 0, "refused insight does not enqueue a user turn");
resolveLoad(jsonResponse(localNotes.sessions));
await loadingPromise;
assert(loadingNotes.backendAvailable === true, "load completes after the in-flight probe");

const staleList = [
  { session_id: "demo-session-03", title: "复活检查", started_at: new Date().toISOString(), duration_s: 60, mode: "free", persona_name: null, max_level: 1, data_quality: "complete", temperature: { direction: "stable", label: "温感平稳", quality: "complete", sample_count: 10 }, pressure: { direction: "stable", label: "接触压力变化较少", quality: "complete", sample_count: 10 }, summary: "", user_feedback: "", timeline: [], notes: [] },
];
const staleNotes = new BodyNotesState({
  sessions: staleList,
  fetchImpl: async (path, options = {}) => {
    if (path === "/v1/body-notes/sessions" && !options.method) return jsonResponse(staleList);
    if (String(path).includes("/sessions/demo-session-03") && options.method === "DELETE") {
      return jsonResponse({ deleted: true });
    }
    return jsonResponse({}, { ok: false, status: 404 });
  },
});
await staleNotes.load();
assert(await staleNotes.deleteSession("demo-session-03"), "loaded backend allows deletion");
assert(staleNotes.getSession("demo-session-03") === null, "deleted session leaves local state");
await staleNotes.load();
assert(staleNotes.getSession("demo-session-03") === null, "a stale backend list does not resurrect a deleted session");
assert(staleNotes.mutationsLocked === false, "mutations unlock after load finishes");

const offlineDelete = new BodyNotesState({ fetchImpl: null });
assert(await offlineDelete.deleteSession("demo-session-03"), "offline demo allows local-only deletion");
assert(offlineDelete.getSession("demo-session-03") === null, "offline deletion removes the demo record");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
