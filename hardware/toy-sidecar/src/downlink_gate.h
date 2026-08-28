// 下行闸门 —— 会话令牌 + 全部拒绝规则，BLE 与 WiFi WebSocket **共用这一份**。
//
// 为什么不让两条传输各写一遍：这些规则就是设备的安全边界（鉴权、档位越界、
// 闩锁期间只放 stop、resume 不可投递）。抄成两份之后，任何一次只改了一边的
// 修补都会让另一条链路变成弱点，而攻击者只需要弱的那条。
//
// 规则本身见 protocol/ble_gatt.md 的「固件侧的硬性拒绝规则」，
// WebSocket 逐条对齐，见 protocol/wifi_ws.md 的「安全约束」。
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "nascent_protocol.h"

class DownlinkGate {
 public:
  // 每次新连接建立时签发。旧令牌立即作废。
  void newSession(uint32_t now_ms);

  // 连接断开时调用，令牌作废，之后任何指令都过不了鉴权。
  void endSession();

  bool hasSession() const { return token_[0] != '\0'; }

  // 组装 {"proto":...,"token":...}。BLE 放进 Info 特征，WebSocket 连上就先推一帧。
  size_t buildInfo(char *buf, size_t cap) const;

  void setStopLatched(bool latched) { stop_latched_ = latched; }

  // 取走并清除最近一次因参数非法产生的告警，用于填进上行的 alert 字段。
  nl_alert_t takeAlert();

  uint32_t rejected() const { return rejected_; }

  // 解析并逐条判定。返回 true 表示 out 已经可信，可以交给安全总督；
  // 返回 false 表示该包被丢弃（是否置 alert 由内部规则决定）。
  bool accept(const char *data, size_t len, uint32_t now_ms, nl_command_t &out);

 private:
  bool tokenValid(const char *auth, uint32_t now_ms) const;

  bool stop_latched_ = false;
  uint32_t rejected_ = 0;
  nl_alert_t alert_ = NL_ALERT_NONE;

  char token_[17] = {0};
  uint32_t token_issued_ms_ = 0;
};
