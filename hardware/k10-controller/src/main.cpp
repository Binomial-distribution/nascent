// k10-controller 主循环。
//
// K10 是整套系统的**控制器与网关**：
//   App ──BLE──> K10 ──ESP-NOW──> toy-sidecar
//   App <──BLE── K10 <──ESP-NOW── toy-sidecar
//
// 它自己也是一个可以独立工作的控制器：断开手机之后，摇杆和屏幕照常可用。
// 这不是降级方案，而是设计前提——安全相关的操作不许依赖手机和网络。
//
// 停机的三个来源，都不经过 App：
//   1. 摇杆长按（安全词）
//   2. 板载 A+B 双键（急停）
//   3. 板间链路丢失（玩具侧自己会归零，这边只是同步显示）
//
// 工程骨架基于 DFRobot 官方示例，屏幕/按键 API 用法见 reference/。
#include <Arduino.h>
#include <ArduinoJson.h>
#include <unihiker_k10.h>

#include "ble_peripheral.h"
#include "config.h"
#include "display.h"
#include "espnow_gw.h"
#include "joystick.h"
#include "nascent_protocol.h"

// display.cpp 里定义，板载按键挂在它上面。
extern UNIHIKER_K10 k10;

namespace {

Joystick g_joy;
EspNowGateway g_gw;
BlePeripheral g_ble;
Display g_display;

// K10 侧的会话状态。注意它只是**意图**，
// 玩具侧的 SafetyGovernor 才是实际档位的最终裁决者。
nl_mode_t g_mode = NL_MODE_FREE;
uint8_t g_level = 0;
bool g_stopped = false;

uint32_t g_last_tick_ms = 0;
uint32_t g_ab_since_ms = 0;
bool g_ab_held = false;

constexpr uint32_t kResumeHoldMs = 2000;

void sendSimple(uint8_t cmd, uint32_t now_ms) {
  nl_command_t c = {};
  c.cmd = cmd;
  c.mode = static_cast<uint8_t>(g_mode);
  c.level = g_level;
  g_gw.sendCommand(c, now_ms);
}

void doStop(uint32_t now_ms) {
  if (g_stopped) return;
  g_stopped = true;
  g_level = 0;
  g_ble.setStopLatched(true);

  // 先把 stop 送出去，再刷屏。顺序反了会让屏幕先说"已停止"
  // 而电机还在转，那比不显示更糟。
  sendSimple(NL_CMD_STOP, now_ms);
  g_display.renderStoppedNow();
  Serial.println("[k10] 停机");
}

void doResume(uint32_t now_ms) {
  if (!g_stopped) return;
  g_stopped = false;
  g_mode = NL_MODE_FREE;
  g_level = 0;
  g_ble.setStopLatched(false);
  sendSimple(NL_CMD_RESUME, now_ms);
  Serial.println("[k10] 物理确认，恢复");
}

void applyLevelDelta(int delta, uint32_t now_ms) {
  if (g_stopped) return;
  int next = static_cast<int>(g_level) + delta;
  if (next < 0) next = 0;
  if (next > NL_LEVEL_MAX) next = NL_LEVEL_MAX;
  if (next == g_level) return;

  g_level = static_cast<uint8_t>(next);

  nl_command_t c = {};
  c.cmd = NL_CMD_SET_LEVEL;
  c.mode = static_cast<uint8_t>(g_mode);
  c.level = g_level;
  // 波形跟着档位走，查的是生成的档位表，不在这里硬编码。
  const nl_level_row_t *row = nl_level_row(g_level);
  c.pattern = row ? row->pattern : NL_PATTERN_SOFT_MIN;
  g_gw.sendCommand(c, now_ms);
}

// App 下发的指令已经过 BLE 层的全部拒绝规则，这里只做转发和本地状态同步。
void onDownlink(const nl_command_t &cmd) {
  uint32_t now = millis();

  if (cmd.cmd == NL_CMD_STOP) {
    doStop(now);
    return;
  }

  if (cmd.cmd == NL_CMD_SET_MODE) g_mode = static_cast<nl_mode_t>(cmd.mode);
  if (cmd.cmd == NL_CMD_SET_LEVEL) g_level = cmd.level;

  g_gw.sendCommand(cmd, now);
}

void buildUplink(char *buf, size_t cap, size_t &out_len, uint32_t now_ms) {
  const nl_telemetry_t &t = g_gw.telemetry();
  bool fresh = g_gw.telemetryFresh(now_ms);

  JsonDocument doc;
  doc["ts"] = now_ms;

  // demo 没有接触 NTC。这两个字段恒为 null，而不是拿 DHT11 的环境温度顶替——
  // 上层看到 null 才知道"没有可信的接触温度"，看到一个数就会当真。
  doc["temp_a"] = nullptr;
  doc["temp_b"] = nullptr;

  if (fresh && t.env_temp_c_x10 != NL_SENTINEL_I16) {
    doc["env_temp"] = t.env_temp_c_x10 / 10.0f;
    doc["env_humidity"] = t.env_humidity_x10 / 10.0f;
  } else {
    doc["env_temp"] = nullptr;
    doc["env_humidity"] = nullptr;
  }

  doc["press_l"] = fresh ? t.press_l : 0;
  doc["press_r"] = fresh ? t.press_r : 0;

  JsonArray acc = doc["accel"].to<JsonArray>();
  JsonArray gyr = doc["gyro"].to<JsonArray>();
  if (fresh) {
    acc.add(t.accel_mg_x / 1000.0f);
    acc.add(t.accel_mg_y / 1000.0f);
    acc.add(t.accel_mg_z / 1000.0f);
    gyr.add(t.gyro_dps_x10_x / 10.0f);
    gyr.add(t.gyro_dps_x10_y / 10.0f);
    gyr.add(t.gyro_dps_x10_z / 10.0f);
  } else {
    for (int i = 0; i < 3; ++i) {
      acc.add(0.0f);
      gyr.add(0.0f);
    }
  }

  // 链路不新鲜时一律报 unknown。拿上一帧的推断结果冒充当前状态，
  // 会让 App 以为设备还在正常工作。
  doc["insert_state"] = nl_insert_state_name(fresh ? t.insert_state : NL_INSERT_STATE_UNKNOWN);
  doc["joy_edge"] = nl_joy_edge_name(NL_JOY_EDGE_NONE);
  doc["mode"] = nl_mode_name(g_mode);
  doc["level"] = fresh ? t.applied_level : 0;
  doc["battery"] = nullptr;  // demo 没有电量采样

  nl_alert_t alert = g_ble.takeAlert();
  if (g_stopped) {
    alert = NL_ALERT_SAFEWORD;
  } else if (!g_gw.up(now_ms)) {
    alert = NL_ALERT_LINK_LOST;
  } else if (alert == NL_ALERT_NONE && fresh) {
    alert = static_cast<nl_alert_t>(t.alert);
  }
  doc["alert"] = nl_alert_name(alert);

  out_len = serializeJson(doc, buf, cap);
}

void pollOnboardButtons(uint32_t now_ms) {
  bool ab = k10.buttonAB->isPressed();

  if (ab && !g_ab_held) {
    g_ab_held = true;
    g_ab_since_ms = now_ms;
  } else if (!ab) {
    g_ab_held = false;
  }

  if (!g_ab_held) return;

  uint32_t held = now_ms - g_ab_since_ms;
  if (g_stopped) {
    // 停机态下，A+B 长按两秒是唯一的恢复入口。
    if (held >= kResumeHoldMs) {
      doResume(now_ms);
      g_ab_held = false;
    }
  } else if (held >= 50) {
    // 运行态下，A+B 就是急停，按下即停，不需要按住。
    doStop(now_ms);
    g_ab_held = false;
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[k10-controller] 协议 %s\n", NL_PROTO_VERSION);

  g_display.begin();
  g_joy.begin(PIN_JOY_VRX, PIN_JOY_VRY, PIN_JOY_SW);

  if (!g_gw.begin(PEER_MAC_TOY, ESPNOW_CHANNEL)) {
    Serial.println("[k10] ESP-NOW 初始化失败");
  }
  // BLE 必须在 WiFi/ESP-NOW 之后起：两者共用 2.4G 射频，
  // 反过来初始化在 IDF4 上偶发起不来。
  g_ble.begin(onDownlink);

  g_last_tick_ms = millis();
}

void loop() {
  uint32_t now = millis();

  // 输入与重传要比 12Hz 更勤地跑，否则摇杆手感会发黏。
  g_joy.tick(now);
  g_gw.tick(now);
  pollOnboardButtons(now);

  if (g_joy.takeLongPress()) doStop(now);

  if (!g_stopped) {
    if (g_joy.takeShortPress()) {
      // 摇杆只在手动与情景之间切。失控模式必须由 App 明确开启，
      // 不能靠一次误触进入。
      g_mode = (g_mode == NL_MODE_FREE) ? NL_MODE_SCENARIO : NL_MODE_FREE;
      g_level = 0;
      sendSimple(NL_CMD_SET_MODE, now);
    }

    nl_joy_edge_t edge = g_joy.takeEdge();
    if (edge == NL_JOY_EDGE_UP) applyLevelDelta(1, now);
    else if (edge == NL_JOY_EDGE_DOWN) applyLevelDelta(-1, now);
  } else {
    // 停机态下把摇杆产生的事件丢掉，不让它们排队等恢复之后一起生效。
    g_joy.takeEdge();
    g_joy.takeShortPress();
  }

  if (now - g_last_tick_ms < NL_UPLINK_PERIOD_MS) {
    delay(1);
    return;
  }
  g_last_tick_ms = now;

  if (g_ble.connected()) {
    char buf[512];
    size_t len = 0;
    buildUplink(buf, sizeof(buf), len, now);
    g_ble.notify(buf, len);
  }

  const nl_telemetry_t &t = g_gw.telemetry();
  bool fresh = g_gw.telemetryFresh(now);

  DisplayState st;
  st.stopped = g_stopped;
  st.link_up = g_gw.up(now);
  st.ble_connected = g_ble.connected();
  st.mode = g_mode;
  st.level = fresh ? t.applied_level : 0;
  st.insert = fresh ? static_cast<nl_insert_state_t>(t.insert_state) : NL_INSERT_STATE_UNKNOWN;
  st.alert = fresh ? static_cast<nl_alert_t>(t.alert) : NL_ALERT_LINK_LOST;
  st.env_temp_c_x10 = fresh ? t.env_temp_c_x10 : NL_SENTINEL_I16;
  st.env_humidity_x10 = fresh ? t.env_humidity_x10 : NL_SENTINEL_I16;
  st.rejected = g_ble.rejected();
  g_display.render(st, now);
}
