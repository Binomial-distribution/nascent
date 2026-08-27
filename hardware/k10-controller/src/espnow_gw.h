// ESP-NOW 网关（K10 侧）—— 与 toy-sidecar 的板间链路。
//
// 与玩具侧的 espnow_link 是同一套帧结构（protocol/espnow_frame.md），
// 方向相反：这边发 command、收 telemetry 和 ack。
//
// ESP-NOW 走 WiFi 射频，BLE 走蓝牙射频，两者在 ESP32-S3 上共用 2.4GHz 天线。
// 12Hz 的小帧共存没问题，但别在这条链路上塞大数据。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"

class EspNowGateway {
 public:
  bool begin(const uint8_t peer_mac[6], uint8_t channel);

  void tick(uint32_t now_ms);

  // 发指令。带重传：没等到 ACK 就在 tick 里重发，最多 kMaxRetry 次。
  // stop 例外，见 .cpp 里的说明。
  bool sendCommand(const nl_command_t &cmd, uint32_t now_ms);

  bool up(uint32_t now_ms) const;

  // 最近一帧遥测。fresh() 为假时里面是旧数据，不要拿去做决策。
  const nl_telemetry_t &telemetry() const { return telem_; }
  bool telemetryFresh(uint32_t now_ms) const;

 private:
  friend void nl_gw_dispatch(const uint8_t *mac, const uint8_t *data, int len);

  void handleRx(const uint8_t *data, int len, uint32_t now_ms);
  bool sendRaw(const void *data, size_t len);

  static constexpr uint8_t kMaxRetry = 3;
  static constexpr uint32_t kRetryMs = 60;

  uint8_t peer_[6] = {0};
  uint16_t tx_seq_ = 0;

  nl_telemetry_t telem_ = {};
  uint32_t telem_ms_ = 0;
  uint32_t last_rx_ms_ = 0;
  uint32_t last_hb_ms_ = 0;

  // 待确认的指令
  nl_command_t inflight_ = {};
  bool has_inflight_ = false;
  uint8_t retry_ = 0;
  uint32_t last_tx_ms_ = 0;
};
