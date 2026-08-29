import { BleDownlink, BleUplink, NlAlert, NlCmd, NlConst, NlInsertState, NlMode, NlWifi } from "../js/protocol.js";
import { Governor } from "../js/governor.js";
import { HeartState } from "../js/heart.js";
import { NlMoodTone } from "../js/protocol.js";
import { toyWsUrl } from "../js/ws.js";
import { accelMag, fsrContact, imuHealth, insertCopy, sensorLogicView, uplinkStatCopy } from "../js/lab.js";

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

assert(insertCopy(NlInsertState.INSERTED) === "在使用中", "lab copy is in-use not medical insertion");
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
