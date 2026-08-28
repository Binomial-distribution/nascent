#include "downlink_gate.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>

namespace {

// 在生成的名字表里查枚举序号。返回 -1 表示不在枚举内。
int enumFromName(const char *const *names, int count, const char *s) {
  if (!s) return -1;
  for (int i = 0; i < count; ++i) {
    if (strcmp(names[i], s) == 0) return i;
  }
  return -1;
}

}  // namespace

void DownlinkGate::newSession(uint32_t now_ms) {
  // esp_random() 在 WiFi/BLE 已启动时是真随机源。
  for (int i = 0; i < 16; i += 8) {
    uint32_t r = esp_random();
    for (int j = 0; j < 8; ++j) {
      token_[i + j] = "0123456789abcdef"[(r >> (j * 4)) & 0xF];
    }
  }
  token_[16] = '\0';
  token_issued_ms_ = now_ms;
}

void DownlinkGate::endSession() {
  // 令牌随连接作废，重连必须重新取。
  token_[0] = '\0';
}

size_t DownlinkGate::buildInfo(char *buf, size_t cap) const {
  JsonDocument doc;
  doc["proto"] = NL_PROTO_VERSION;
  doc["token"] = token_;
  return serializeJson(doc, buf, cap);
}

nl_alert_t DownlinkGate::takeAlert() {
  nl_alert_t a = alert_;
  alert_ = NL_ALERT_NONE;
  return a;
}

bool DownlinkGate::tokenValid(const char *auth, uint32_t now_ms) const {
  if (!auth || token_[0] == '\0') return false;
  if (strlen(auth) != 16) return false;
  if (now_ms - token_issued_ms_ > NL_SESSION_TOKEN_TTL_MS) return false;
  // 定时比较：长度固定，全长异或，不因首字节不同而提前返回。
  uint8_t diff = 0;
  for (int i = 0; i < 16; ++i) diff |= static_cast<uint8_t>(auth[i] ^ token_[i]);
  return diff == 0;
}

bool DownlinkGate::accept(const char *data, size_t len, uint32_t now_ms, nl_command_t &out) {
  if (!data || len == 0) return false;

  JsonDocument doc;
  if (deserializeJson(doc, data, len) != DeserializationError::Ok) {
    ++rejected_;
    return false;  // 解不出来的包不回任何东西，不给探测者反馈
  }

  // 规则 1：鉴权。失败静默丢弃，连 alert 都不置——
  // 置了 alert 就等于告诉对方"你猜的格式对了、只是令牌错"。
  if (!tokenValid(doc["auth"] | static_cast<const char *>(nullptr), now_ms)) {
    ++rejected_;
    return false;
  }

  // 规则 2：cmd 必须在枚举内。
  int cmd = enumFromName(NL_CMD_NAMES, NL_CMD_COUNT, doc["cmd"] | static_cast<const char *>(nullptr));
  if (cmd < 0) {
    ++rejected_;
    alert_ = NL_ALERT_BAD_CMD;
    return false;
  }

  // resume 不是任何链路上的合法指令。手机直连之后，"指令只可能来自 K10 物理按键"
  // 这个前提消失了，所以这道拒绝**不是唯一防线**——SafetyGovernor::onCommand 里
  // 根本没有 resume 分支，clearLatch() 只有 BOOT 键的处理函数会调。
  // 这里挡一次是为了把它记成 bad_cmd，让 App 看得见自己发错了。
  if (cmd == NL_CMD_RESUME) {
    ++rejected_;
    alert_ = NL_ALERT_BAD_CMD;
    return false;
  }

  // 规则 4：闩锁期间只放 stop 过。
  if (stop_latched_ && cmd != NL_CMD_STOP) {
    ++rejected_;
    return false;
  }

  out = {};
  out.ts_ms = now_ms;
  out.cmd = static_cast<uint8_t>(cmd);
  out.mode = NL_MODE_FREE;
  out.pattern = NL_PATTERN_SOFT_MIN;
  out.led_state = NL_LED_STATE_MODE_DEFAULT;
  out.flags = 0;  // 保留位，原 bit0/bit1 是已删除的摇杆使能

  if (doc["mode"].is<const char *>()) {
    int m = enumFromName(NL_MODE_NAMES, NL_MODE_COUNT, doc["mode"]);
    if (m < 0) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return false;
    }
    out.mode = static_cast<uint8_t>(m);
  }

  if (doc["pattern"].is<const char *>()) {
    int p = enumFromName(NL_PATTERN_NAMES, NL_PATTERN_COUNT, doc["pattern"]);
    if (p < 0) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return false;
    }
    out.pattern = static_cast<uint8_t>(p);
  }

  if (doc["led"].is<const char *>()) {
    int l = enumFromName(NL_LED_STATE_NAMES, NL_LED_STATE_COUNT, doc["led"]);
    if (l < 0) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return false;
    }
    out.led_state = static_cast<uint8_t>(l);
  }

  // 规则 3：档位越界直接丢弃，**不钳位**。
  // 远端发来的越界值说明对端有 bug 或恶意，悄悄改成 8 档执行比拒绝危险得多。
  if (cmd == NL_CMD_SET_LEVEL) {
    if (!doc["level"].is<int>()) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return false;
    }
    int lv = doc["level"];
    if (lv < NL_LEVEL_MIN || lv > NL_LEVEL_MAX) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return false;
    }
    out.level = static_cast<uint8_t>(lv);
  }

  return true;
}
