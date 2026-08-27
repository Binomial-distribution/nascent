// ESP-NOW 板间链路（玩具侧）。
//
// 直接用 ESP-IDF 自带的 esp_now API，只加一层薄封装处理三件事：
//   1. command 的 ACK 与按 seq 去重（ESP-NOW 不保证送达也不保证不重复）；
//   2. 心跳与链路超时判定；
//   3. 帧头校验。
//
// 帧结构由 protocol/contract.yaml 生成，不在这里手写字节偏移。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"

using CommandHandler = void (*)(const nl_command_t &cmd);

class EspNowLink {
 public:
  bool begin(const uint8_t peer_mac[6], uint8_t channel, CommandHandler handler);

  // 每轮主循环调用：发心跳、更新链路状态。
  void tick(uint32_t now_ms);

  bool sendTelemetry(const nl_telemetry_t &frame);

  // 超过 NL_LINK_TIMEOUT_MS 没收到对端任何帧即为断链。
  bool up(uint32_t now_ms) const;

 private:
  friend void nl_espnow_dispatch(const uint8_t *mac, const uint8_t *data, int len);

  void handleRx(const uint8_t *data, int len, uint32_t now_ms);
  void sendAck(uint16_t seq, bool accepted, nl_alert_t reason);
  bool sendRaw(const void *data, size_t len);

  uint8_t peer_[6] = {0};
  CommandHandler handler_ = nullptr;

  uint16_t tx_seq_ = 0;
  uint32_t last_rx_ms_ = 0;
  uint32_t last_hb_ms_ = 0;

  bool has_last_cmd_seq_ = false;
  uint16_t last_cmd_seq_ = 0;
};
