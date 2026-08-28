#include "ble_peripheral.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <string.h>

namespace {

BLEServer *g_server = nullptr;
BLECharacteristic *g_uplink = nullptr;
BLECharacteristic *g_downlink = nullptr;
BLECharacteristic *g_info = nullptr;
BlePeripheral *g_self = nullptr;

// 在生成的名字表里查枚举序号。返回 -1 表示不在枚举内。
int enumFromName(const char *const *names, int count, const char *s) {
  if (!s) return -1;
  for (int i = 0; i < count; ++i) {
    if (strcmp(names[i], s) == 0) return i;
  }
  return -1;
}

}  // namespace

class NlServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { g_self->handleConnect(millis()); }
  void onDisconnect(BLEServer *server) override {
    g_self->handleDisconnect();
    // 必须重开广播，否则断一次就再也连不上。
    // 注意这**不代表**断连无害：up() 会立刻转 false，安全总督随即归零。
    // 重开广播只是让人能连回来，不是让输出继续。
    server->startAdvertising();
  }
};

class NlDownlinkCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *ch) override {
    // 2.x 返回 std::string，3.x 返回 Arduino String，两者都有 c_str/length。
    auto v = ch->getValue();
    g_self->handleWrite(v.c_str(), v.length(), millis());
  }
};

bool BlePeripheral::begin(CommandHandler handler) {
  if (started_) return true;
  handler_ = handler;
  g_self = this;

  BLEDevice::init(NL_BLE_DEVICE_NAME);
  BLEDevice::setMTU(NL_BLE_MIN_MTU);

  g_server = BLEDevice::createServer();
  g_server->setCallbacks(new NlServerCallbacks());

  // 三个特征加上 CCCD 描述符，默认的 15 个句柄不够用。
  BLEService *svc = g_server->createService(BLEUUID(NL_BLE_SERVICE_UUID), 32, 0);

  g_uplink = svc->createCharacteristic(NL_BLE_UPLINK_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  g_uplink->addDescriptor(new BLE2902());

  g_downlink = svc->createCharacteristic(NL_BLE_DOWNLINK_UUID, BLECharacteristic::PROPERTY_WRITE);
  g_downlink->setCallbacks(new NlDownlinkCallbacks());

  g_info = svc->createCharacteristic(NL_BLE_INFO_UUID, BLECharacteristic::PROPERTY_READ);

  svc->start();
  publishInfo();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NL_BLE_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  started_ = true;
  Serial.printf("[ble] 广播 %s，服务 %s\n", NL_BLE_DEVICE_NAME, NL_BLE_SERVICE_UUID);
  return true;
}

void BlePeripheral::end() {
  if (!started_) return;
  // 切到 WiFi 之前必须把射频和协议栈整个还掉，否则两栈并存抢时隙。
  BLEDevice::deinit(true);
  g_server = nullptr;
  g_uplink = nullptr;
  g_downlink = nullptr;
  g_info = nullptr;
  started_ = false;
  connected_ = false;
  token_[0] = '\0';
  Serial.println("[ble] 已停止");
}

void BlePeripheral::tick(uint32_t) {
  // Bluedroid 的连接维护全在它自己的任务里，这里没有要推进的状态。
}

bool BlePeripheral::up(uint32_t) const { return connected_; }

void BlePeripheral::sendUplink(const char *json, size_t len) {
  if (!connected_ || !g_uplink) return;
  g_uplink->setValue(reinterpret_cast<uint8_t *>(const_cast<char *>(json)), len);
  g_uplink->notify();
}

nl_alert_t BlePeripheral::takeAlert() {
  nl_alert_t a = alert_;
  alert_ = NL_ALERT_NONE;
  return a;
}

void BlePeripheral::handleConnect(uint32_t now_ms) {
  connected_ = true;
  newSessionToken(now_ms);
  publishInfo();
  Serial.println("[ble] 手机已连接，已签发新会话令牌");
}

void BlePeripheral::handleDisconnect() {
  connected_ = false;
  // 令牌随连接作废，重连必须重新读 Info。
  token_[0] = '\0';
  Serial.println("[ble] 手机断开");
}

void BlePeripheral::newSessionToken(uint32_t now_ms) {
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

bool BlePeripheral::tokenValid(const char *auth, uint32_t now_ms) const {
  if (!auth || token_[0] == '\0') return false;
  if (strlen(auth) != 16) return false;
  if (now_ms - token_issued_ms_ > NL_SESSION_TOKEN_TTL_MS) return false;
  // 定时比较：长度固定，全长异或，不因首字节不同而提前返回。
  uint8_t diff = 0;
  for (int i = 0; i < 16; ++i) diff |= static_cast<uint8_t>(auth[i] ^ token_[i]);
  return diff == 0;
}

void BlePeripheral::publishInfo() {
  if (!g_info) return;
  JsonDocument doc;
  doc["proto"] = NL_PROTO_VERSION;
  doc["token"] = token_;
  char buf[128];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  g_info->setValue(reinterpret_cast<uint8_t *>(buf), n);
}

void BlePeripheral::handleWrite(const char *data, size_t len, uint32_t now_ms) {
  if (!data || len == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, data, len) != DeserializationError::Ok) {
    ++rejected_;
    return;  // 解不出来的包不回任何东西，不给探测者反馈
  }

  // 规则 1：鉴权。失败静默丢弃，连 alert 都不置——
  // 置了 alert 就等于告诉对方"你猜的格式对了、只是令牌错"。
  if (!tokenValid(doc["auth"] | static_cast<const char *>(nullptr), now_ms)) {
    ++rejected_;
    return;
  }

  // 规则 2：cmd 必须在枚举内。
  int cmd = enumFromName(NL_CMD_NAMES, NL_CMD_COUNT, doc["cmd"] | static_cast<const char *>(nullptr));
  if (cmd < 0) {
    ++rejected_;
    alert_ = NL_ALERT_BAD_CMD;
    return;
  }

  // resume 不是任何链路上的合法指令。手机直连之后，"指令只可能来自 K10 物理按键"
  // 这个前提消失了，所以这道拒绝不再是唯一防线——SafetyGovernor::onCommand 里
  // 根本没有 resume 分支，clearLatch() 只有 BOOT 键的处理函数会调。
  // 这里挡一次是为了把它记成 bad_cmd，让 App 看得见自己发错了。
  if (cmd == NL_CMD_RESUME) {
    ++rejected_;
    alert_ = NL_ALERT_BAD_CMD;
    return;
  }

  // 规则 4：闩锁期间只放 stop 过。
  if (stop_latched_ && cmd != NL_CMD_STOP) {
    ++rejected_;
    return;
  }

  nl_command_t out = {};
  out.cmd = static_cast<uint8_t>(cmd);
  out.mode = NL_MODE_FREE;
  out.pattern = NL_PATTERN_SOFT_MIN;
  out.led_state = NL_LED_STATE_MODE_DEFAULT;
  out.ts_ms = now_ms;
  out.flags = 0;  // 保留位，原 bit0/bit1 是已删除的摇杆使能

  if (doc["mode"].is<const char *>()) {
    int m = enumFromName(NL_MODE_NAMES, NL_MODE_COUNT, doc["mode"]);
    if (m < 0) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return;
    }
    out.mode = static_cast<uint8_t>(m);
  }

  if (doc["pattern"].is<const char *>()) {
    int p = enumFromName(NL_PATTERN_NAMES, NL_PATTERN_COUNT, doc["pattern"]);
    if (p < 0) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return;
    }
    out.pattern = static_cast<uint8_t>(p);
  }

  if (doc["led"].is<const char *>()) {
    int l = enumFromName(NL_LED_STATE_NAMES, NL_LED_STATE_COUNT, doc["led"]);
    if (l < 0) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return;
    }
    out.led_state = static_cast<uint8_t>(l);
  }

  // 规则 3：档位越界直接丢弃，**不钳位**。
  // 远端发来的越界值说明对端有 bug 或恶意，悄悄改成 8 档执行比拒绝危险得多。
  if (cmd == NL_CMD_SET_LEVEL) {
    if (!doc["level"].is<int>()) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return;
    }
    int lv = doc["level"];
    if (lv < NL_LEVEL_MIN || lv > NL_LEVEL_MAX) {
      ++rejected_;
      alert_ = NL_ALERT_BAD_CMD;
      return;
    }
    out.level = static_cast<uint8_t>(lv);
  }

  if (handler_) handler_(out);
}
