#include "ble_peripheral.h"

#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

namespace {

BLEServer *g_server = nullptr;
BLECharacteristic *g_uplink = nullptr;
BLECharacteristic *g_downlink = nullptr;
BLECharacteristic *g_info = nullptr;
BlePeripheral *g_self = nullptr;

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
  gate_.endSession();
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

void BlePeripheral::handleConnect(uint32_t now_ms) {
  connected_ = true;
  gate_.newSession(now_ms);
  publishInfo();
  Serial.println("[ble] 手机已连接，已签发新会话令牌");
}

void BlePeripheral::handleDisconnect() {
  connected_ = false;
  gate_.endSession();
  Serial.println("[ble] 手机断开");
}

void BlePeripheral::publishInfo() {
  if (!g_info) return;
  char buf[128];
  size_t n = gate_.buildInfo(buf, sizeof(buf));
  g_info->setValue(reinterpret_cast<uint8_t *>(buf), n);
}

void BlePeripheral::handleWrite(const char *data, size_t len, uint32_t now_ms) {
  nl_command_t out;
  if (!gate_.accept(data, len, now_ms, out)) return;
  if (handler_) handler_(out);
}
