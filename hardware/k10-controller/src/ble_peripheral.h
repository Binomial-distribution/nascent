// BLE GATT Peripheral —— App 侧唯一入口。
//
// 协议见 protocol/ble_gatt.md。UUID、设备名、MTU 全部来自 contract.yaml
// 生成的 NL_BLE_* 宏，App 侧用同一份契约生成的 NlBle 常量，不会漂移。
//
// 用内核自带的 Bluedroid BLEDevice 而不是 NimBLE：
// DFRobot 的 unihiker 平台锁在 arduino-esp32 2.x / IDF4 上，
// NimBLE-Arduino 2.x 要求 3.x 内核，装了也编不过。
// 量产若换内核，换成 NimBLE 能省几十 KB RAM。
#pragma once

#include <stdint.h>
#include <stddef.h>

#include "nascent_protocol.h"

// 只有通过全部拒绝规则的指令才会回调，参数已经可信。
using DownlinkHandler = void (*)(const nl_command_t &cmd);

class BlePeripheral {
 public:
  void begin(DownlinkHandler handler);

  // 12Hz 上行。json 由调用方组装。
  void notify(const char *json, size_t len);

  bool connected() const { return connected_; }

  // 停机闩锁期间只接受 stop，其余一律丢弃。由主循环同步过来。
  void setStopLatched(bool latched) { stop_latched_ = latched; }

  // 取走并清除最近一次因参数非法产生的告警，用于填进上行的 alert 字段。
  nl_alert_t takeAlert();

  uint32_t rejected() const { return rejected_; }

 private:
  friend class NlServerCallbacks;
  friend class NlDownlinkCallbacks;

  void handleConnect(uint32_t now_ms);
  void handleDisconnect();
  void handleWrite(const char *data, size_t len, uint32_t now_ms);

  void newSessionToken(uint32_t now_ms);
  bool tokenValid(const char *auth, uint32_t now_ms) const;
  void publishInfo();

  DownlinkHandler handler_ = nullptr;
  bool connected_ = false;
  bool stop_latched_ = false;
  uint32_t rejected_ = 0;
  nl_alert_t alert_ = NL_ALERT_NONE;

  char token_[17] = {0};
  uint32_t token_issued_ms_ = 0;
};
