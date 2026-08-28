import { BleDownlink, BleUplink, NlAlert, NlCmd, NlConst, NlInsertState, NlMode } from "../js/protocol.js";
import { Governor } from "../js/governor.js";
import { HeartState } from "../js/heart.js";
import { NlMoodTone } from "../js/protocol.js";

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
    joy_edge: "none",
    mode: "free",
    level: 1,
    alert: "none",
    ...over,
  });
}

const gov = new Governor();
assert(gov.reject(new BleDownlink({ cmd: NlCmd.STOP, auth: "" })) == null, "stop is always allowed");
assert(
  gov.reject(new BleDownlink({ cmd: NlCmd.RESUME, auth: "" }))?.includes("设备上") ,
  "resume is rejected with device-only message",
);
assert(
  gov.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 3, auth: "" })) === "与设备的连接不可用，此时只能发送停止。",
  "unhealthy link only allows stop",
);

gov.ingest(uplink({ alert: "safeword" }));
assert(
  gov.reject(new BleDownlink({ cmd: NlCmd.SET_LEVEL, level: 2, auth: "" })) === "已停止。需要在设备上按键确认后才能继续。",
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

heart.addBodyNote("  先慢一点  ");
heart.addBodyNote("听见自己的节奏");
assert(heart.bodyNotes.length === 2, "stores two body notes");
assert(heart.latestBodyNote?.text === "听见自己的节奏", "newest note first");
assert(heart.bodyNotes.at(-1).text === "先慢一点", "trims and keeps older note");

const card = heart.cards[0];
heart.readCard(card);
heart.toggleFavorite(card);
assert(heart.isRead(card.id), "marks card read");
assert(heart.isFavorite(card.id), "marks card favorite");
heart.toggleFavorite(card);
assert(!heart.isFavorite(card.id), "favorite toggles off");

assert(NlInsertState.UNKNOWN === "unknown", "insert_state unknown is the safe default");
assert(NlMode.FREE === "free", "mode free is the default play");
assert(NlAlert.NONE === "none", "alert none is the safe default");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
