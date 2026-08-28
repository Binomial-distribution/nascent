// BLE GATT Peripheral —— 手机与玩具侧之间的默认链路。
//
// 协议见 protocol/ble_gatt.md。UUID、设备名、MTU 全部来自 contract.yaml
// 生成的 NL_BLE_* 宏，App 侧用同一份契约生成的 NlBle 常量，不会漂移。
//
// 0.3.0 之前这个服务跑在 K10 上，由它经 ESP-NOW 转发给本板。现在服务整体
// 挪到玩具侧，UUID 一个没改——服务的逻辑身份没变，换 UUID 只会白白牵动 App。
//
// 本类只负责 GATT 这层管道：广播、连接、读写。**鉴权与全部拒绝规则不在这里**，
// 在 DownlinkGate，与 WiFi WebSocket 共用同一份，免得两条链路的安全规则各自漂移。
//
// 用内核自带的 Bluedroid BLEDevice 而不是 NimBLE-Arduino：
// NimBLE 2.x 要求 arduino-esp32 3.x 内核，1.4.x 对应 2.x，装错版本编不过；
// 而本仓库没有固定 espressif32 的版本，也没有 PlatformIO 可供验证。
// BLEDevice 随内核走，两个大版本都在。BLE 与 WiFi 是运行时互斥的
// （见 transport.h），"省 RAM 好让两栈共存"这个换 NimBLE 的理由不成立。
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "downlink_gate.h"
#include "nascent_protocol.h"
#include "transport.h"

class BlePeripheral : public Transport {
 public:
  bool begin(CommandHandler handler) override;
  void end() override;
  void tick(uint32_t now_ms) override;
  void sendUplink(const char *json, size_t len) override;
  bool up(uint32_t now_ms) const override;
  void setStopLatched(bool latched) override { gate_.setStopLatched(latched); }
  nl_alert_t takeAlert() override { return gate_.takeAlert(); }
  const char *name() const override { return "ble"; }

  uint32_t rejected() const { return gate_.rejected(); }

 private:
  friend class NlServerCallbacks;
  friend class NlDownlinkCallbacks;

  void handleConnect(uint32_t now_ms);
  void handleDisconnect();
  void handleWrite(const char *data, size_t len, uint32_t now_ms);
  void publishInfo();

  DownlinkGate gate_;
  CommandHandler handler_ = nullptr;
  bool started_ = false;
  bool connected_ = false;
};
