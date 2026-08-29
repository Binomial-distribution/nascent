import { BleDownlink, BleUplink, NlAlert, NlCmd, NlConst, NlInsertState, NlMode, NlWifi } from "../js/protocol.js";
import { Governor } from "../js/governor.js";
import { HeartState } from "../js/heart.js";
import { NlMoodTone } from "../js/protocol.js";
import { toyWsUrl } from "../js/ws.js";
import { BodyNotesState } from "../js/body-notes.js";
import { NAV_TABS, parseHash, legacyNotesTarget, SCENARIO_FLOW } from "../js/routes.js";
import {
  ScenarioChatState,
  buildSensorContext,
  experienceSummary,
  formatCaptionHtml,
  ingestUplinkSample,
  nextExperiencePhase,
  resetSensorWindow,
  speakDialogue,
  speakUtterance,
  stopRingtone,
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

assert(NAV_TABS.join("/") === "heart/intimacy/records/settings", "bottom nav has four tabs");
assert(parseHash("#/intimacy").page === "root", "intimacy root is the two-entry hub");
assert(parseHash("#/intimacy/scenario").page === "scenario", "scenario list lives under intimacy");
assert(parseHash("#/intimacy/scenario/new").sessionId === "new", "persona form uses scenario/new");
assert(parseHash("#/intimacy/scenario/play").sessionId === "play", "legacy play hash still parses");
assert(parseHash("#/intimacy/scenario/call").sessionId === "call", "existing persona dials into the call screen");
assert(parseHash("#/intimacy/scenario/chat").sessionId === "chat", "text chat remains available as a backup");
assert(SCENARIO_FLOW.includes("call") && SCENARIO_FLOW.includes("chat"), "scenario flow includes call then chat");
assert(parseHash("#/intimacy/control").page === "control", "self-control is a nested intimacy page");
assert(parseHash("#/records").tab === "records" && parseHash("#/records").view == null, "records long page is a root tab");
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
assert(turnBodies[1]?.memory_policy === "off", "resumed turns keep memory_policy off");

const offlineStore = memoryStore();
const offlineFirst = new ScenarioChatState({ fetchImpl: null, storage: offlineStore });
await offlineFirst.send({ key: "persona:calm", id: "calm", name: "阿月" }, "我在这儿");
const offlineAgain = new ScenarioChatState({ fetchImpl: null, storage: offlineStore });
assert(
  offlineAgain.messages("persona:calm").length >= 2,
  "offline threads still keep prior turns after reconstructing from storage",
);

resetSensorWindow();
const risingPress = { pressL: 0.2, pressR: 0.2, envTemp: 26, insertState: "inserted", level: 2, ts: 1 };
ingestUplinkSample(risingPress);
ingestUplinkSample({ ...risingPress, pressL: 0.5, pressR: 0.5 });
ingestUplinkSample({ ...risingPress, pressL: 0.7, pressR: 0.7 });
const sensors = buildSensorContext({ ...risingPress, pressL: 0.7, pressR: 0.7 }, { bandConnected: false });
assert(sensors.pressure_rhythm === "increasing", "pressure trend is derived locally");
assert(!("press_l" in sensors) && !("pressL" in sensors), "raw pressure is not sent to the 9B context");
assert(sensors.hr_trend === "unknown", "heart-rate trend stays unknown without Health Connect");
assert(nextExperiencePhase("approaching", { sceneCtrl: "next", userText: "你好" }) === "rising", "a first reply in approaching can move into rising");
assert(nextExperiencePhase("approaching", { sceneCtrl: "stay", userText: "你好" }) === "rising", "talking in approaching still leads into rising");
assert(nextExperiencePhase("rising", { sceneCtrl: "stay", userText: "" }) === "rising", "sensors or silence do not auto-declare climax");
assert(nextExperiencePhase("rising", { sceneCtrl: "next", userText: "" }) === "rising", "model next during rising does not open the climax window");
assert(nextExperiencePhase("rising", { sceneCtrl: "stay", userText: "要到了" }) === "climax_window", "user language can open the climax window");
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
}, { voice: "junlang_nanyou", fallbackVoice: "FunAudioLLM/CosyVoice2-0.5B:charles", emotion: "calm" });
assert(ttsPath === "/v1/speech/speak", "assistant lines request cloud TTS");
assert(ttsBody.voice === "junlang_nanyou", "speak body includes persona voice");
assert(ttsBody.text === "我在", "speak body still sends the spoken line");

let spokeLocal = false;
globalThis.speechSynthesis = {
  cancel() {},
  speak() { spokeLocal = true; },
};
const failedSpeech = await speakDialogue("我在", { fetchImpl: async () => ({ ok: false }) });
assert(!spokeLocal, "cloud TTS failure does not fake a browser voice");
assert(failedSpeech.played === false && failedSpeech.interrupted === false, "failed cloud TTS reports not played");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
