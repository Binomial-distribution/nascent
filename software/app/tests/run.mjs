import { BleDownlink, BleUplink, NlAlert, NlCmd, NlConst, NlInsertState, NlMode, NlWifi } from "../js/protocol.js";
import { Governor } from "../js/governor.js";
import { encodeDownlink } from "../js/channel.js";
import { HeartState, dayKey, MOOD_STORE_KEY } from "../js/heart.js";
import { NlMoodTone } from "../js/protocol.js";
import { toyWsUrl } from "../js/ws.js";
import {
  HeartRateState,
  HR_SOURCE,
  medianBpm,
  nightKeyFor,
  NightHeartLog,
  NIGHT_LOG_KEY,
  NIGHT_SAMPLE_MS,
  trendFromDelta,
} from "../js/hr.js";
import { BodyNotesState } from "../js/body-notes.js";
import { NAV_TABS, parseHash, legacyNotesTarget, SCENARIO_FLOW } from "../js/routes.js";
import {
  buildSleepReport,
  contrastCopy,
  emptySleepCopy,
  isCalendarYesterday,
  sleepCopyIsSafe,
  summarizeNight,
  wakeDayKey,
} from "../js/sleep-summary.js";
import {
  ScenarioChatState,
  buildConversationSummary,
  buildSensorContext,
  experienceSummary,
  foldOldTurns,
  formatCaptionHtml,
  ingestUplinkSample,
  nextExperiencePhase,
  resetSensorWindow,
  speakDialogue,
  speakUtterance,
  stopRingtone,
  SUMMARY_TOTAL_MAX,
  TURN_SEND,
} from "../js/scenario-session.js";
import {
  cardToPromptText,
  draftToCard,
  PERSONA_CARDS,
  personaOpeningLine,
  personaPayload,
  quizAnswersToCard,
} from "../js/persona-cards.js";
import {
  VAD_DEFAULTS,
  createVadState,
  encodeWav,
  frameRms,
  pushVadFrame,
  shouldBargeIn,
} from "../js/live-call.js";
import { accelMag, connectionDiagnostic, fsrContact, imuHealth, insertCopy, sensorLogicView, uplinkStatCopy } from "../js/lab.js";

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
assert(
  gov2.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 9, auth: "" })) == null,
  "manual ninth level is allowed",
);
assert(
  gov2.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 0, auth: "" })) == null,
  "manual level zero is normal power off",
);
assert(
  gov2.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 0, auth: "" }), { automatic: true }) === "档位超出范围。",
  "automatic control cannot power off",
);

{
  const wifiCmd = new BleDownlink({
    cmd: NlCmd.SET_WIFI,
    wifiSsid: "lab-24g",
    wifiPsk: "abcdefgh",
    auth: "token-placeholder",
  });
  assert(wifiCmd.toJson().cmd === "set_wifi", "set_wifi serializes as cmd");
  assert(wifiCmd.toJson().wifi_ssid === "lab-24g", "ssid stays on the downlink object");
  assert(wifiCmd.toJson().wifi_psk === "abcdefgh", "psk stays on the downlink object");
}

{
  const govWifi = new Governor();
  govWifi.ingest(uplink());
  assert(
    govWifi.reject(new BleDownlink({ cmd: NlCmd.SET_WIFI, wifiSsid: "lab", wifiPsk: "abcdefgh", auth: "" })) == null,
    "set_wifi allowed when link is healthy",
  );
  assert(
    govWifi.reject(new BleDownlink({ cmd: NlCmd.SET_WIFI, wifiSsid: "lab", wifiPsk: "abcdefgh", auth: "" }), { automatic: true })
      === "配网只能由你在设置页发起。",
    "set_wifi is never allowed from automatic / LLM",
  );
  assert(
    govWifi.reject(new BleDownlink({ cmd: NlCmd.SET_WIFI, wifiSsid: "  ", wifiPsk: "", auth: "" })) === "请填写 WiFi 名称。",
    "empty ssid is rejected before leaving the browser",
  );
  assert(
    govWifi.reject(new BleDownlink({ cmd: NlCmd.SET_WIFI, wifiSsid: "lab", wifiPsk: "short", auth: "" }))
      === "WiFi 密码须为 8–63 位，或留空（开放网络）。",
    "short psk is rejected",
  );
}

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

{
  const packed = encodeDownlink(new BleDownlink({
    cmd: NlCmd.SET_WIFI,
    wifiSsid: "lab",
    wifiPsk: "abcdefgh",
    auth: "",
  }), "tokentokentoken");
  assert(packed.cmd === "set_wifi", "encodeDownlink keeps set_wifi");
  assert(packed.wifi_ssid === "lab", "encodeDownlink keeps ssid");
  assert(packed.auth === "tokentokentoken", "encodeDownlink stamps the session token");
  assert(!("level" in packed), "encodeDownlink drops null level");
  assert(!("wifi_psk" in packed) === false, "psk is present when provided");
}

{
  const packed = encodeDownlink(new BleDownlink({
    cmd: NlCmd.STOP,
    auth: "",
  }), "tokentokentoken");
  assert(!("wifi_ssid" in packed), "stop does not carry wifi_ssid");
  assert(!("wifi_psk" in packed), "stop does not carry wifi_psk");
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

assert(NAV_TABS.join("/") === "heart/intimacy/records/settings", "bottom nav has four tabs");
assert(parseHash("#/intimacy").page === "root", "intimacy root is the two-entry hub");
assert(parseHash("#/intimacy/scenario").page === "scenario", "scenario list lives under intimacy");
assert(parseHash("#/intimacy/scenario/new").sessionId === "new", "persona form uses scenario/new");
assert(parseHash("#/intimacy/scenario/play").sessionId === "play", "legacy play hash still parses");
assert(parseHash("#/intimacy/scenario/call").sessionId === "call", "persona pick opens the incoming call");
assert(parseHash("#/intimacy/scenario/chat").sessionId === "chat", "text chat is the swipe-up page after the call");
assert(SCENARIO_FLOW.includes("call") && SCENARIO_FLOW.includes("chat"), "scenario flow includes call and chat");
assert(parseHash("#/intimacy/control").page === "control", "self-control is a nested intimacy page");
assert(parseHash("#/records").tab === "records" && parseHash("#/records").view == null, "records long page is a root tab");
assert(
  parseHash("#/records/sleep").view === "sleep" && parseHash("#/records/sleep").sessionId == null,
  "records/sleep is a view, not a session id",
);
assert(
  parseHash("#/records/demo-session-03/insight?scope=recent&ids=a,b").sessionId === "demo-session-03",
  "insight chat keeps the selected session id",
);
assert(parseHash("#/records/demo-session-03/insight").view === "insight", "insight is a records subview");
assert(
  legacyNotesTarget(parseHash("#/intimacy/notes")) === "#/records",
  "old notes list redirects to records",
);
assert(
  legacyNotesTarget(parseHash("#/intimacy/notes/demo-session-03")) === "#/records",
  "old notes detail redirects to records",
);
assert(
  legacyNotesTarget(parseHash("#/intimacy/notes/demo-session-03/insight?scope=current"))
    === "#/records/demo-session-03/insight?scope=current",
  "old insight path keeps session and query",
);
assert(legacyNotesTarget(parseHash("#/records")) == null, "records itself is not a legacy notes path");

const readableNotes = new BodyNotesState({ fetchImpl: null });
assert(readableNotes.getSession("demo-session-01") !== null, "legacy notes data can still be read after the records rename");
assert(await readableNotes.deleteSession("demo-session-01"), "legacy notes data can still be deleted");
assert(readableNotes.getSession("demo-session-01") === null, "deleted notes records stay gone");

const scenarioTurns = new ScenarioChatState({ fetchImpl: null });
const reply = await scenarioTurns.send({ key: "persona:gentle", name: "温和", text: "缓慢、克制" }, "你好");
assert(Boolean(reply?.dialogue), "scenario chat falls back locally when the agent is offline");
assert(scenarioTurns.messages("persona:gentle").length === 2, "a scenario turn stores user and assistant lines");
assert(scenarioTurns.phase("persona:gentle") === "rising", "a first user line in approaching moves into rising");

const climaxChat = new ScenarioChatState({ fetchImpl: null });
await climaxChat.send({ key: "persona:playful", name: "阿北" }, "你好");
assert(climaxChat.phase("persona:playful") === "rising", "stub next during approaching enters rising");
await climaxChat.send({ key: "persona:playful", name: "阿北" }, "要到了");
assert(climaxChat.phase("persona:playful") === "climax_window", "要到了 still opens the climax window");

const aftercare = await scenarioTurns.send({ key: "persona:gentle", name: "温和" }, "累了，想被抱一会儿");
assert(scenarioTurns.phase("persona:gentle") === "aftercare", "user asking to rest enters aftercare");
assert(aftercare.dialogue.includes("陪"), "aftercare fallback stays with the user");

const opening = personaOpeningLine({ id: "gentle" }, "approaching");
assert(opening.includes("收工") || opening.includes("抱一会儿"), "preset opening uses the boyfriend greeting");
assert(opening.includes("（") && opening.includes("）"), "opening keeps an unread stage aside");
assert(!opening.includes("慢慢靠近"), "opening is not the old coaching script");
const caption = formatCaptionHtml("过来。（轻声）抱你");
assert(caption.includes("class=\"aside\"") && caption.includes("（轻声）"), "captions keep asides visible");
assert(caption.startsWith("过来。"), "spoken words stay outside the aside span");
assert(!formatCaptionHtml("<img>").includes("<img>"), "caption html escapes markup");
stopRingtone();
const payload = personaPayload({ id: "gentle" });
assert(payload.assistant_name === "顾深" && payload.profile.length > 0, "turn payload sends a Waifu-style character card");
assert(payload.tts?.minimax === "junlang_nanyou" && payload.voice === "junlang_nanyou", "personaPayload includes tts voice");
assert(PERSONA_CARDS.gentle.tts.minimax === "junlang_nanyou", "顾深 uses the boyfriend MiniMax voice");
assert(/nanyou|male-/i.test(PERSONA_CARDS.gentle.tts.minimax), "顾深 is a male MiniMax id");
assert(PERSONA_CARDS.playful.tts.minimax === "male-qn-qingse", "阿北 uses a male MiniMax id");
assert(PERSONA_CARDS.calm.tts.minimax === "danya_xuejie", "阿月 uses a female MiniMax id");
assert(!/male-/i.test(PERSONA_CARDS.calm.tts.minimax), "阿月 is not a male MiniMax id");
assert(PERSONA_CARDS.gentle.tts.emotion === "calm", "顾深 speaks calmly");
assert(PERSONA_CARDS.playful.tts.emotion === "happy", "阿北 speaks happily");
assert(PERSONA_CARDS.calm.tts.emotion === "whisper", "阿月 uses a whisper emotion");
assert(PERSONA_CARDS.gentle.tts.mimo === "Milo", "顾深 maps to MiMo Milo");
assert(PERSONA_CARDS.playful.tts.mimo === "Dean", "阿北 maps to MiMo Dean");
assert(PERSONA_CARDS.calm.tts.mimo === "茉莉", "阿月 maps to MiMo 茉莉");

const filledCard = draftToCard({
  assistant_name: "小测",
  user_name: "阿杰",
  profile: "她是温柔的女友\n会做饭",
  skills: "会撒娇\n会损你",
  background: "正在谈恋爱",
  rules: "不要自称 AI",
  prologue: "晚上九点",
  spoken: "我回来了。",
});
assert(filledCard.assistant_name === "小测", "draftToCard keeps the companion name");
assert(Array.isArray(filledCard.profile) && filledCard.profile[0].includes("温柔"), "draftToCard turns profile into a list");
assert(filledCard.spoken === "我回来了。", "draftToCard keeps the spoken opening");
const filledPayload = personaPayload({ card: filledCard, name: filledCard.assistant_name });
assert(
  filledPayload.assistant_name === "小测" && filledPayload.profile.length > 0 && filledPayload.spoken === "我回来了。",
  "draftToCard produces a personaPayload-compatible card",
);

const quizCard = quizAnswersToCard({
  vibe: "gentle",
  name: "gushen",
  user_name: "baobei",
  profile: "sweet",
  skills: ["soft", "daily"],
  background: "dating",
  spoken: "hug",
});
assert(quizCard.assistant_name === "顾深", "quiz answers pick a boyfriend name");
assert(quizCard.user_name === "宝贝", "quiz answers pick how he calls her");
assert(quizCard.profile[0].includes("甜系男友"), "quiz profile is written as a boyfriend");
assert(quizCard.spoken.includes("抱一会儿"), "quiz opening uses the selected line");
assert(quizCard.rules.some((line) => line.includes("听她的")), "quiz rules address her");
const quizPayload = personaPayload({ card: quizCard, name: quizCard.assistant_name });
assert(quizPayload.assistant_name === "顾深" && quizPayload.spoken.includes("抱一会儿"), "quiz card is sent as the agent prompt");
assert(quizPayload.tts?.minimax === "junlang_nanyou", "quiz card keeps the vibe MiniMax voice");

const promptText = cardToPromptText(PERSONA_CARDS.gentle);
assert(promptText.includes("人设:") && promptText.includes("怎么叫她:"), "character card text uses Chinese labels");
assert(!promptText.includes("Profile:"), "character card text does not use English Profile label");
const approachingSummary = experienceSummary("approaching", {});
assert(approachingSummary.includes("带她"), "phase summary talks about her, not him");
assert(!approachingSummary.includes("带他"), "phase summary does not mix him into a female-oriented scene");

function memoryStore() {
  const data = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
  };
}

const threadStore = memoryStore();
const turnBodies = [];
const threadFetch = async (_url, options = {}) => {
  turnBodies.push(JSON.parse(options.body || "{}"));
  return jsonResponse({ dialogue: "我在。", scene_ctrl: "stay" });
};
const firstThread = new ScenarioChatState({ fetchImpl: threadFetch, storage: threadStore });
await firstThread.send({ key: "persona:gentle", id: "gentle", name: "顾深" }, "今天过得怎么样");
assert(firstThread.messages("persona:gentle").length === 2, "first send stores the opening turn");
const resumedThread = new ScenarioChatState({ fetchImpl: threadFetch, storage: threadStore });
assert(
  resumedThread.messages("persona:gentle").length === 2,
  "a new ScenarioChatState hydrates prior turns from storage",
);
await resumedThread.send({ key: "persona:gentle", id: "gentle", name: "顾深" }, "过来陪我");
const recent = turnBodies[1]?.recent_turns || [];
assert(
  recent.some((item) => item.role === "user" && item.content === "今天过得怎么样")
    && recent.some((item) => item.role === "assistant" && item.content === "我在。"),
  "the second send includes the previous user and assistant turn in recent_turns",
);
assert(turnBodies[1]?.memory_policy === "ask_each_time", "resumed turns ask before writing memory");

const styleStore = memoryStore();
const styleChat = new ScenarioChatState({
  fetchImpl: async () => jsonResponse({ dialogue: "过来。", scene_ctrl: "stay", tts_style: "低语" }),
  storage: styleStore,
});
const styled = await styleChat.send({ key: "persona:gentle", id: "gentle", name: "顾深" }, "在吗");
assert(styled.tts_style === "低语", "send returns this turn's tts_style for TTS");
styleChat.clearAll();
assert(styleChat.messages("persona:gentle").length === 0, "clearAll drops in-memory scenario threads");

const offlineStore = memoryStore();
const offlineFirst = new ScenarioChatState({ fetchImpl: null, storage: offlineStore });
await offlineFirst.send({ key: "persona:calm", id: "calm", name: "阿月" }, "我在这儿");
const offlineAgain = new ScenarioChatState({ fetchImpl: null, storage: offlineStore });
assert(
  offlineAgain.messages("persona:calm").length >= 2,
  "offline threads still keep prior turns after reconstructing from storage",
);

const overflowItems = Array.from({ length: TURN_SEND + 2 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  text: index % 2 === 0 ? `她${index}` : `他${index}`,
}));
const folded = foldOldTurns(overflowItems, TURN_SEND);
assert(folded.startsWith("更早的对话："), "old turns fold into a dialogue summary");
assert(folded.includes("她0") && folded.includes("他1"), "the summary keeps lines that fell out of the window");
assert(!folded.includes(`她${TURN_SEND}`), "the live window is not copied into the folded summary");
const combinedSummary = buildConversationSummary(overflowItems, "rising", {});
assert(combinedSummary.includes("更早的对话") && combinedSummary.includes("一起往前"), "summary keeps folded dialogue and phase goals");
assert(combinedSummary.length <= SUMMARY_TOTAL_MAX, "the combined summary stays within the contract limit");

const overflowBodies = [];
const overflowChat = new ScenarioChatState({
  fetchImpl: async (_url, options = {}) => {
    overflowBodies.push(JSON.parse(options.body || "{}"));
    return jsonResponse({ dialogue: "我在。", scene_ctrl: "stay" });
  },
  storage: memoryStore(),
});
for (let i = 0; i < 7; i += 1) {
  await overflowChat.send({ key: "persona:gentle", id: "gentle", name: "顾深" }, `第${i}句`);
}
const overflowPayload = overflowBodies.at(-1);
assert((overflowPayload?.recent_turns || []).length <= TURN_SEND, "requests still send at most 12 recent turns");
assert(
  String(overflowPayload?.conversation_summary || "").includes("更早的对话")
    && String(overflowPayload?.conversation_summary || "").includes("第0句"),
  "turns outside the window are compressed into conversation_summary",
);

const memBodies = [];
const memStore = memoryStore();
const memFetch = async (url, options = {}) => {
  const path = String(url);
  if (path.includes("/v1/agent/memory") && options.method === "POST") {
    memBodies.push(JSON.parse(options.body || "{}"));
    return jsonResponse({
      id: "mem_1",
      user_id: "local-demo",
      persona_id: "gentle",
      text: memBodies.at(-1).text,
      created_at: 1,
    });
  }
  if (path.includes("/v1/agent/memory") && options.method === "DELETE") {
    return jsonResponse({ deleted_count: 1 });
  }
  return jsonResponse({
    dialogue: "记下了。",
    scene_ctrl: "stay",
    memory_proposals: [{ text: "喜欢慢慢来", reason: "她说了" }],
  });
};
const memChat = new ScenarioChatState({ fetchImpl: memFetch, storage: memStore });
await memChat.send({ key: "persona:gentle", id: "gentle", name: "顾深" }, "记住，我喜欢慢慢来");
const offered = memChat.messages("persona:gentle")[1];
assert(offered?.proposals?.[0]?.text === "喜欢慢慢来", "assistant turns keep pending memory proposals");
assert(offered.proposals[0].status === "pending", "new proposals wait for confirm");
await memChat.confirmMemory({ key: "persona:gentle", id: "gentle" }, 1, 0);
assert(memBodies[0]?.text === "喜欢慢慢来", "confirm posts the proposal to the memory API");
assert(memChat.messages("persona:gentle")[1].proposals[0].status === "kept", "confirmed proposals stay marked kept");
const hydratedMem = new ScenarioChatState({ fetchImpl: memFetch, storage: memStore });
assert(
  hydratedMem.messages("persona:gentle")[1].proposals[0].status === "kept",
  "confirmed proposals survive localStorage hydrate",
);
await memChat.forgetMemories({ key: "persona:gentle", id: "gentle" });
assert(
  memChat.messages("persona:gentle")[1].proposals[0].status === "skipped",
  "forgetting a persona marks local proposals skipped",
);
const forgottenHydrated = new ScenarioChatState({ fetchImpl: memFetch, storage: memStore });
assert(
  forgottenHydrated.messages("persona:gentle")[1].proposals[0].status === "skipped",
  "forgotten local proposals survive hydrate",
);

const skipChat = new ScenarioChatState({
  fetchImpl: async () => jsonResponse({
    dialogue: "好。",
    scene_ctrl: "stay",
    memory_proposals: [{ text: "下次不要突然加快", reason: "她说了" }],
  }),
  storage: memoryStore(),
});
await skipChat.send({ key: "persona:playful", id: "playful", name: "阿北" }, "下次不要突然加快");
skipChat.skipMemory({ key: "persona:playful", id: "playful" }, 1, 0);
assert(skipChat.messages("persona:playful")[1].proposals[0].status === "skipped", "rejecting a proposal does not write memory");

const stubMem = new ScenarioChatState({ fetchImpl: null, storage: memoryStore() });
await stubMem.send({ key: "persona:gentle", id: "gentle", name: "顾深" }, "记住，我喜欢被慢慢抱");
assert(
  stubMem.messages("persona:gentle")[1].proposals?.length >= 1,
  "offline stub still offers a confirmable memory when she asks to remember",
);

resetSensorWindow();
const risingPress = { pressL: 0.2, pressR: 0.2, envTemp: 26, insertState: "inserted", level: 2, ts: 1 };
ingestUplinkSample(risingPress);
ingestUplinkSample({ ...risingPress, pressL: 0.5, pressR: 0.5 });
ingestUplinkSample({ ...risingPress, pressL: 0.7, pressR: 0.7 });
const sensors = buildSensorContext({ ...risingPress, pressL: 0.7, pressR: 0.7 }, { bandConnected: false });
assert(sensors.pressure_rhythm === "increasing", "pressure trend is derived locally");
assert(!("press_l" in sensors) && !("pressL" in sensors), "raw pressure is not sent to the 9B context");
assert(sensors.hr_trend === "unknown", "heart-rate trend stays unknown without wearable samples");
assert(sensors.hr_source === "none", "heart-rate source is none when the band is not connected");

const waiting = buildSensorContext(risingPress, { bandConnected: true });
assert(waiting.hr_source === "wearable_connected_waiting", "a simulated band without samples still does not invent a trend");
assert(waiting.hr_trend === "unknown", "simulated band connection does not fill hr_trend");

assert(medianBpm([80, 70, 90, 72, 71]) === 72, "bpm smoother uses the median of five samples");
assert(trendFromDelta(2) === "steady", "small deltas stay steady");
assert(trendFromDelta(8) === "increasing", "a rise above the deadband is increasing");
assert(trendFromDelta(-8) === "decreasing", "a drop below the deadband is decreasing");

let nowMs = 1_000_000;
const hr = new HeartRateState({ now: () => nowMs });
assert(!hr.ingest({ bpm: 10, timestampMs: nowMs }), "bpm below 30 is rejected");
assert(!hr.ingest({ bpm: 70, timestampMs: 0 }), "non-positive timestamps are rejected");
assert(hr.ingest({ bpm: 70, timestampMs: nowMs, source: HR_SOURCE }), "a valid sample is accepted");
assert(!hr.ingest({ bpm: 71, timestampMs: nowMs - 1 }), "timestamps that go backwards are rejected");
for (let i = 1; i <= 4; i += 1) {
  nowMs += 1_000;
  hr.ingest({ bpm: 70 + i, timestampMs: nowMs, source: HR_SOURCE });
}
assert(hr.snapshot.collectingBaseline, "the first 60 seconds collect a baseline");
assert(hr.snapshot.trend === "unknown", "trend stays unknown until the baseline is frozen");
assert(hr.snapshot.bpm === 72, "live bpm is the median of the recent window");

nowMs = 1_000_000 + 60_000;
hr.ingest({ bpm: 70, timestampMs: nowMs, source: HR_SOURCE });
assert(hr.snapshot.baseline != null, "baseline freezes after 60 seconds");
assert(hr.snapshot.trend === "steady", "near-baseline bpm is steady");

nowMs += 1_000;
hr.ingest({ bpm: 90, timestampMs: nowMs, source: HR_SOURCE });
nowMs += 1_000;
hr.ingest({ bpm: 91, timestampMs: nowMs, source: HR_SOURCE });
nowMs += 1_000;
hr.ingest({ bpm: 92, timestampMs: nowMs, source: HR_SOURCE });
nowMs += 1_000;
hr.ingest({ bpm: 93, timestampMs: nowMs, source: HR_SOURCE });
nowMs += 1_000;
hr.ingest({ bpm: 94, timestampMs: nowMs, source: HR_SOURCE });
assert(hr.snapshot.trend === "increasing", "a sustained rise maps to increasing");

const liveSensors = buildSensorContext(risingPress, { bandConnected: true, heartRate: hr });
assert(liveSensors.hr_source === HR_SOURCE, "valid samples publish xiaomi_smart_band_7");
assert(liveSensors.hr_quality === "valid", "fresh samples are valid");
assert(liveSensors.hr_trend === "increasing", "sensor_context carries the mapped rhythm");
assert(!("bpm" in liveSensors), "raw bpm is not sent to the 9B context");
assert(!("nights" in liveSensors), "night heart log is not sent as sensor_context");
assert(
  !JSON.stringify(turnBodies[1] || {}).includes("nascent.hr.nights"),
  "Chat 9B payload does not include nascent.hr.nights",
);

nowMs += 11_000;
assert(hr.snapshot.quality === "stale", "10 seconds without samples is stale");
assert(hr.snapshot.trend === "unknown", "stale heart rate does not keep the old trend");
assert(hr.snapshot.bpm == null, "stale snapshots hide the last bpm");
const staleSensors = buildSensorContext(risingPress, { heartRate: hr });
assert(staleSensors.hr_quality === "stale", "sensor_context reports stale after dropout");
assert(staleSensors.hr_trend === "unknown", "stale samples do not drive AI trend");
assert(nextExperiencePhase("approaching", { sceneCtrl: "next", userText: "你好" }) === "rising", "a first reply in approaching can move into rising");
assert(nextExperiencePhase("approaching", { sceneCtrl: "stay", userText: "你好" }) === "rising", "talking in approaching still leads into rising");
assert(nextExperiencePhase("rising", { sceneCtrl: "stay", userText: "" }) === "rising", "sensors or silence do not auto-declare climax");
assert(nextExperiencePhase("rising", { sceneCtrl: "next", userText: "" }) === "rising", "model next during rising does not open the climax window");
assert(nextExperiencePhase("rising", { sceneCtrl: "stay", userText: "要到了" }) === "climax_window", "user language can open the climax window");
assert(nextExperiencePhase("rising", { sceneCtrl: "stay", userText: "不想更近" }) === "rising", "saying they do not want closer does not open climax");
assert(nextExperiencePhase("rising", { sceneCtrl: "stay", userText: "我到了" }) === "rising", "arriving home does not open climax");
assert(nextExperiencePhase("climax_window", { sceneCtrl: "end", userText: "" }) === "aftercare", "ending the scene always aftercares");
assert(nextExperiencePhase("rising", { sceneCtrl: "stay", userText: "累了" }) === "aftercare", "saying they are tired enters aftercare");

const quiet = new Float32Array(32);
const loud = new Float32Array(32).fill(0.2);
assert(frameRms(loud) > frameRms(quiet), "rms rises when the speaker is louder");
let vad = createVadState();
let step = pushVadFrame(vad, 0.001, quiet, 0);
assert(!step.utterance && !step.speaking, "silence does not start an utterance");
step = pushVadFrame(step.state, VAD_DEFAULTS.startRms + 0.01, loud, 10);
assert(step.speaking && step.bargeIn, "crossing the start threshold begins listening");
step = pushVadFrame(step.state, VAD_DEFAULTS.holdRms + 0.01, loud, 200);
step = pushVadFrame(step.state, 0.001, quiet, 400);
step = pushVadFrame(step.state, 0.001, quiet, 400 + VAD_DEFAULTS.hangoverMs + 20);
assert(step.utterance && step.utterance.length > 0, "a pause after speech flushes one utterance");
assert(!step.speaking, "the vad returns to idle after a completed sentence");
const wav = encodeWav(step.utterance, 16000);
assert(wav.type === "audio/wav" && wav.size > 44, "an utterance is encoded as wav for ASR only");

const bargeQuiet = shouldBargeIn(1000, 0.2, { playing: true, playbackStartedAt: 900 });
assert(!bargeQuiet.bargeIn, "speaker echo during the opening grace does not stop TTS");
const bargeHold = shouldBargeIn(2000, 0.2, { playing: true, playbackStartedAt: 1000, loudSince: 1850 });
assert(!bargeHold.bargeIn, "a single loud frame is not enough to barge in");
const bargeYes = shouldBargeIn(2300, 0.2, { playing: true, playbackStartedAt: 1000, loudSince: 2000 });
assert(bargeYes.bargeIn, "sustained speech after grace can interrupt playback");

let ttsPath = "";
let ttsBody = null;
await speakUtterance("我在", async (path, options = {}) => {
  ttsPath = path;
  ttsBody = JSON.parse(options.body || "{}");
  return {
    ok: true,
    blob: async () => new Blob([new Uint8Array(64)], { type: "audio/mpeg" }),
  };
}, { voice: "junlang_nanyou", fallbackVoice: "FunAudioLLM/CosyVoice2-0.5B:charles", emotion: "calm", tts_style: "俏皮", provider: "mimo" });
assert(ttsPath === "/v1/speech/speak", "assistant lines request cloud TTS");
assert(ttsBody.voice === "junlang_nanyou", "speak body includes persona voice");
assert(ttsBody.text === "我在", "speak body still sends the spoken line");
assert(ttsBody.tts_style === "俏皮", "speak body includes this turn's tts_style");
assert(ttsBody.provider === "mimo", "speak body can select the MiMo provider");

let spokeLocal = false;
globalThis.speechSynthesis = {
  cancel() {},
  speak() { spokeLocal = true; },
};
const failedSpeech = await speakDialogue("我在", { fetchImpl: async () => ({ ok: false }) });
assert(!spokeLocal, "cloud TTS failure does not fake a browser voice");
assert(failedSpeech.played === false && failedSpeech.interrupted === false, "failed cloud TTS reports not played");

assert(insertCopy(NlInsertState.INSERTED) === "在使用中", "lab copy is in-use not medical insertion");
assert(
  connectionDiagnostic({ phase: "error", message: "GATT 133" }) === "阶段 error · GATT 133",
  "lab keeps raw connection diagnostics out of product status bars",
);
assert(insertCopy(NlInsertState.UNKNOWN) === "不确定", "unknown insert copy");
assert(accelMag([0, 0, 0]) < 0.15, "zero accel is empty");
assert(imuHealth([0, 0, 0]).ok === false, "zero accel is I2C miss");
assert(imuHealth([0, 0, 1]).ok === true, "1g z is a live IMU");
assert(fsrContact(599, 0) === false, "below contact threshold");
assert(fsrContact(600, 0) === true, "at contact threshold");

{
  const deadImu = sensorLogicView(uplink({ accel: [0, 0, 0], insert_state: "unknown" }));
  assert(deadImu.fusion.includes("六轴未就绪"), "dead IMU keeps fusion unknown");
}

assert(
  uplinkStatCopy({ connected: true, uplink: null, stats: { parsed: 0, notifies: 0 } }).includes("0 帧"),
  "lab explains missing uplink while connected",
);
assert(
  uplinkStatCopy({ connected: true, uplink: uplink(), stats: { parsed: 3, notifies: 3, lastBytes: 210 } }).includes("已解析 3 帧"),
  "lab shows parsed frame count",
);
assert(
  uplinkStatCopy({
    connected: true,
    uplink: null,
    stats: { parsed: 0, notifies: 4, lastError: "Unexpected end of JSON" },
  }).includes("解不出 JSON"),
  "lab explains truncated notify payloads",
);

{
  const govLab = new Governor();
  govLab.ingest(uplink());
  assert(
    govLab.reject(new BleDownlink({ cmd: NlCmd.RESUME, auth: "" }))?.includes("BOOT"),
    "lab resume path is rejected by governor",
  );
  assert(govLab.reject(new BleDownlink({ cmd: NlCmd.STOP, auth: "" })) == null, "lab stop is allowed");
  assert(
    govLab.reject(new BleDownlink({ cmd: NlCmd.PRESS_KEY, key: "hold", auth: "" })) == null,
    "lab long-press key is allowed when linked",
  );
  assert(
    govLab.reject(new BleDownlink({ cmd: NlCmd.PRESS_KEY, key: "tap", auth: "" })) == null,
    "lab tap key is allowed when linked",
  );
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function localMs(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

assert(emptySleepCopy() === "还没有夜间心率或心绪记录", "sleep empty copy is non-medical");
assert(sleepCopyIsSafe(emptySleepCopy()), "empty sleep copy has no medical words");
assert(!sleepCopyIsSafe("深睡评分"), "medical sleep words are rejected");
assert(buildSleepReport({ nights: [], moodKeys: [] }).length === 0, "no nights and no moods yields an empty report");

{
  const sleepHash = parseHash("#/records/sleep");
  assert(sleepHash.page === "sleep" && sleepHash.view === "sleep", "sleep hash sets the sleep view");
  assert(sleepHash.sessionId == null, "sleep is not treated as a session id");
  assert(parseHash("#/records/demo-session-03").sessionId === "demo-session-03", "other records segments remain sessions");
}

assert(nightKeyFor(localMs(2026, 8, 28, 22)) === "2026-08-28", "22:00 belongs to that calendar night");
assert(nightKeyFor(localMs(2026, 8, 29, 2)) === "2026-08-28", "after midnight still belongs to the previous night");
assert(nightKeyFor(localMs(2026, 8, 29, 9, 59)) === "2026-08-28", "before 10:00 stays on the previous night");
assert(nightKeyFor(localMs(2026, 8, 28, 10)) == null, "daytime samples are ignored");
assert(nightKeyFor(localMs(2026, 8, 28, 21, 59)) == null, "before 22:00 is ignored");

{
  const store = memoryStorage();
  const frozen = new Date(2026, 7, 29, 12, 0, 0);
  const log = new NightHeartLog({ storage: store, now: () => frozen });
  const start = localMs(2026, 8, 28, 22, 0);
  assert(log.ingest(58, start), "first night sample is kept");
  assert(!log.ingest(59, start + 60_000), "samples inside five minutes are downsampled");
  assert(log.ingest(90, start + NIGHT_SAMPLE_MS), "a sample five minutes later is kept");
  assert(log.ingest(62, localMs(2026, 8, 29, 6, 0)), "wake-window sample is kept");
  const nights = log.nights();
  assert(nights.length === 1 && nights[0].key === "2026-08-28", "night log groups by the evening date");
  assert(nights[0].samples.length === 3, "downsampled night keeps spaced points");
}

{
  const store = memoryStorage();
  store.setItem(NIGHT_LOG_KEY, JSON.stringify([
    { key: "2019-01-01", samples: [{ ts: 1, bpm: 60 }] },
    { key: "2026-08-28", samples: [{ ts: localMs(2026, 8, 28, 22, 0), bpm: 58 }] },
  ]));
  const frozen = new Date(2026, 7, 29, 12, 0, 0);
  const log = new NightHeartLog({ storage: store, now: () => frozen });
  assert(!log.nights().some((night) => night.key === "2019-01-01"), "nights older than 7 calendar days are dropped");
  assert(log.nights().some((night) => night.key === "2026-08-28"), "nights inside 7 calendar days stay");
  const persisted = JSON.parse(store.getItem(NIGHT_LOG_KEY));
  assert(!persisted.some((item) => item.key === "2019-01-01"), "pruned night log is written back");
}

assert(wakeDayKey("2026-08-28") === "2026-08-29", "a night keyed on the evening wakes the next calendar day");
assert(isCalendarYesterday("2026-08-28", new Date(2026, 7, 29)), "calendar yesterday is not the newest report index");
assert(!isCalendarYesterday("2026-08-28", new Date(2026, 7, 28)), "the same calendar day is not yesterday");

{
  const sparse = [
    { ts: localMs(2026, 8, 28, 22, 0), bpm: 55 },
    { ts: localMs(2026, 8, 29, 0, 0), bpm: 90 },
    { ts: localMs(2026, 8, 29, 6, 0), bpm: 62 },
  ];
  const sparseNight = summarizeNight(sparse, NlMoodTone.TIRED, true);
  assert(sparseNight.hasHr && sparseNight.durationMin === 15, "gapped samples do not count the empty span as rest");
  const dense = [];
  for (let ts = localMs(2026, 8, 28, 22, 0); ts <= localMs(2026, 8, 29, 6, 0); ts += NIGHT_SAMPLE_MS) {
    dense.push({ ts, bpm: 58 });
  }
  const night = summarizeNight(dense, NlMoodTone.TIRED, true);
  assert(night.hasHr && night.durationMin >= 470 && night.durationMin <= 490, "contiguous heart-rate samples become rest duration");
  assert(night.contrast.includes("有点累") && night.contrast.includes("记下"), "mood contrast keeps the original label");
  assert(night.contrast.includes("起伏") || night.contrast.includes("安静"), "tired night still uses a non-medical rest word");
  assert(sleepCopyIsSafe(night.contrast), "mood contrast has no medical words");
  assert(contrastCopy(NlMoodTone.TIRED, "varied", true) === "昨天记下有点累，夜里心率起伏多一些", "last-night tired copy matches the planned sentence");
}

{
  const samples = [
    { ts: localMs(2026, 8, 28, 22, 0), bpm: 58 },
    { ts: localMs(2026, 8, 28, 22, 5), bpm: 59 },
  ];
  const rows = buildSleepReport({
    nights: [{ key: "2026-08-28", samples }],
    moodKeys: ["2026-08-29"],
    moodFor: (key) => (key === "2026-08-29" ? { mood: NlMoodTone.TIRED } : null),
    now: new Date(2026, 7, 29, 12, 0, 0),
  });
  assert(rows.length === 1, "wake-day mood does not create a second calendar row");
  assert(rows[0].moodId === NlMoodTone.TIRED, "night contrast uses the wake-day mood");
  assert(rows[0].contrast.includes("那天记下"), "today's wake-day mood is not labeled 昨天记下");
}

{
  const rows = buildSleepReport({
    nights: [{ key: "2026-08-27", samples: [{ ts: localMs(2026, 8, 27, 23, 0), bpm: 60 }] }],
    moodKeys: ["2026-08-28"],
    moodFor: (key) => (key === "2026-08-28" ? { mood: NlMoodTone.TIRED } : null),
    now: new Date(2026, 7, 29, 12, 0, 0),
  });
  assert(rows[0].contrast.includes("昨天记下"), "yesterday's wake-day mood is labeled 昨天记下");
}

{
  const rows = buildSleepReport({
    nights: [],
    moodKeys: ["2026-08-28"],
    moodFor: () => ({ mood: NlMoodTone.WARM }),
    now: new Date(2026, 7, 29, 12, 0, 0),
  });
  assert(rows.length === 1 && !rows[0].hasHr, "mood-only nights still enter the summary");
  assert(rows[0].contrast.includes("温柔"), "mood-only copy uses the original heart label");
  assert(rows[0].contrast.includes("昨天记下"), "mood-only copy uses the calendar day, not report index");
  assert(sleepCopyIsSafe(rows[0].contrast), "mood-only copy is non-medical");
}

{
  const store = memoryStorage();
  const today = new Date();
  const writer = new HeartState(undefined, { storage: store });
  writer.recordMood(NlMoodTone.TIRED);
  const reader = new HeartState(undefined, { storage: store });
  assert(reader.moodFor(today)?.mood === NlMoodTone.TIRED, "recent moods hydrate from local storage");
  const staleKey = "2019-01-01";
  store.setItem(MOOD_STORE_KEY, JSON.stringify([
    { key: staleKey, mood: NlMoodTone.BRIGHT },
    { key: dayKey(today), mood: NlMoodTone.QUIET },
  ]));
  const pruned = new HeartState(undefined, { storage: store });
  assert(pruned.moodFor(today)?.mood === NlMoodTone.QUIET, "hydrate keeps moods from the last 7 days");
  assert(!pruned.moods.has(staleKey), "moods older than 7 days are dropped");
  assert(
    !JSON.parse(store.getItem(MOOD_STORE_KEY)).some((item) => item.key === staleKey),
    "pruned moods are written back",
  );
  pruned.clearLocal();
  const cleared = new HeartState(undefined, { storage: store });
  assert(cleared.moods.size === 0, "clearLocal persists an empty mood store");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
