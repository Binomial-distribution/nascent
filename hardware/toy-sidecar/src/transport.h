// 传输层抽象 —— 手机与玩具侧之间的那一条线。
//
// 0.3.0 之前这里只有一个 EspNowLink，对端是 K10。K10 删掉之后手机直连本板，
// 于是出现了两条可选链路：BLE GATT（默认）与 WiFi WebSocket（备用）。
// 两条承载的是**同一份 JSON**，所以差异全部收在这个接口后面，
// main.cpp 只认一个 Transport*，不知道自己现在跑在哪条线上。
//
// 同一时刻只开一条：ESP32-S3 只有一路 2.4 GHz 射频，BLE 与 WiFi 共存要靠时分，
// 12 Hz 的上行会开始抖，而这条链路上跑着停机指令。切换必须 end() 再 begin()。
//
// 上行 JSON 由 main.cpp 组装一次（见 uplink_json.h）再交给传输层发送，
// 而不是每个传输各自序列化一遍——两条线的载荷按契约就是同一个。
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "nascent_protocol.h"

// 只有通过全部拒绝规则的指令才会回调，参数已经可信。
// **resume 永远不会经由这个回调到达**：它不在任何传输层的放行名单里，
// 解除闩锁只有玩具侧 BOOT 键一条路。
using CommandHandler = void (*)(const nl_command_t &cmd);

class Transport {
 public:
  virtual ~Transport() = default;

  virtual bool begin(CommandHandler handler) = 0;

  // 完整释放射频与协议栈。切换传输时必须调，否则两栈并存。
  virtual void end() = 0;

  // 每轮主循环调用：维护连接、重连、心跳。
  virtual void tick(uint32_t now_ms) = 0;

  virtual void sendUplink(const char *json, size_t len) = 0;

  // 手机在线才算链路在。断链的默认行为是归零，见 SafetyGovernor::onLink。
  virtual bool up(uint32_t now_ms) const = 0;

  // 闩锁期间只放 stop 过。由主循环同步过来，让拒绝发生在解析层而不是总督层。
  virtual void setStopLatched(bool latched) = 0;

  // 取走并清除最近一次因参数非法产生的告警，用于填进上行的 alert 字段。
  virtual nl_alert_t takeAlert() = 0;

  virtual const char *name() const = 0;
};
