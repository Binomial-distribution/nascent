// WiFi WebSocket —— 备用链路。协议见 protocol/wifi_ws.md。
//
// 玩具侧作 STA 接入现有局域网（不开 SoftAP），起一个 WebSocket 服务端，
// 承载与 BLE **完全相同**的 JSON。端口、路径、mDNS 主机名来自契约的 wifi: 段。
//
// 鉴权与全部拒绝规则不在这里，在 DownlinkGate，与 BLE 共用同一份。
// 这一点是刻意的：两条链路的安全规则一旦抄成两份，只改了一边的修补
// 就会让另一条变成弱点，而攻击者只需要弱的那条。
//
// 凭据：设置页 `set_wifi` 写入 NVS，或编译期 include/local_config.h。
// 没有凭据时 configured() 为假，本通道整个不启用，只有 BLE。
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "downlink_gate.h"
#include "nascent_protocol.h"
#include "transport.h"

class WifiWs : public Transport {
 public:
  // 是否配了 SSID。没配就不要 begin()，省得白等一轮连接超时。
  static bool configured();

  bool begin(CommandHandler handler) override;
  void end() override;
  void tick(uint32_t now_ms) override;
  void sendUplink(const char *json, size_t len) override;
  bool up(uint32_t now_ms) const override;
  void setStopLatched(bool latched) override { gate_.setStopLatched(latched); }
  nl_alert_t takeAlert() override { return gate_.takeAlert(); }
  const char *name() const override { return "wifi"; }

  uint32_t rejected() const { return gate_.rejected(); }

 private:
  // 连接是**非阻塞**的：begin() 只发起，由 tick() 推进。
  // 不能在 begin() 里 while 等——那会让主循环停转十几秒，
  // 而 BOOT 键的停机就在主循环里。任何让停机路径变慢的写法都不行。
  enum class Phase : uint8_t {
    kOff,
    kConnecting,
    kServing,
    kFailed,  // 连接超时。up() 恒为假，切换器会把链路换回 BLE
  };

  void startServer();
  void stopRadio();
  void onEvent(uint8_t num, int type, uint8_t *payload, size_t length);

  DownlinkGate gate_;
  CommandHandler handler_ = nullptr;
  Phase phase_ = Phase::kOff;
  uint32_t connect_started_ms_ = 0;
  bool mdns_up_ = false;

  // WebSocket 库按连接编号管理客户端。只认一个：这条链路上跑着停机指令，
  // 允许多个控制端同时下指令等于让它们互相覆盖档位。
  bool has_client_ = false;
  uint8_t client_num_ = 0;
  uint32_t last_gen_ = 0;
};
