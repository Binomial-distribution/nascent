#include "espnow_gw.h"

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <string.h>

namespace {
EspNowGateway *g_gw = nullptr;
constexpr uint32_t kHeartbeatMs = 500;
}  // namespace

void nl_gw_dispatch(const uint8_t * /*mac*/, const uint8_t *data, int len) {
  if (g_gw) g_gw->handleRx(data, len, millis());
}

// DFRobot 的 unihiker 平台锁在 arduino-esp32 2.x（IDF4），回调是旧签名；
// 玩具侧用的是 3.x。两边共用这套代码，所以留着版本分支。
#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  nl_gw_dispatch(info ? info->src_addr : nullptr, data, len);
}
#else
static void onRecv(const uint8_t *mac, const uint8_t *data, int len) {
  nl_gw_dispatch(mac, data, len);
}
#endif

bool EspNowGateway::begin(const uint8_t peer_mac[6], uint8_t channel) {
  memcpy(peer_, peer_mac, 6);
  g_gw = this;

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, true);
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) return false;
  esp_now_register_recv_cb(onRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, peer_, 6);
  peer.channel = channel;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) return false;

  Serial.printf("[gw] 本机 MAC %s，对端 %02X:%02X:%02X:%02X:%02X:%02X，信道 %u\n",
                WiFi.macAddress().c_str(), peer_[0], peer_[1], peer_[2], peer_[3], peer_[4],
                peer_[5], channel);
  return true;
}

bool EspNowGateway::sendRaw(const void *data, size_t len) {
  return esp_now_send(peer_, static_cast<const uint8_t *>(data), len) == ESP_OK;
}

bool EspNowGateway::up(uint32_t now_ms) const {
  return last_rx_ms_ != 0 && (now_ms - last_rx_ms_) < NL_LINK_TIMEOUT_MS;
}

bool EspNowGateway::telemetryFresh(uint32_t now_ms) const {
  return telem_ms_ != 0 && (now_ms - telem_ms_) < NL_LINK_TIMEOUT_MS;
}

bool EspNowGateway::sendCommand(const nl_command_t &cmd, uint32_t now_ms) {
  nl_command_t out = cmd;
  nl_wire_header_init(&out.hdr, NL_FRAME_TYPE_COMMAND, tx_seq_++);
  out.ts_ms = now_ms;

  // stop 直接顶掉在途指令。让一条加档指令排在 stop 前面重传，
  // 是这套系统里最不能接受的事。
  if (out.cmd == NL_CMD_STOP) {
    inflight_ = out;
    has_inflight_ = true;
    retry_ = 0;
    last_tx_ms_ = now_ms;
    // 连发三次不等 ACK：stop 宁可重复执行，也不能漏。
    // 玩具侧按 seq 去重，重复的那两帧只会被 ACK 不会被执行。
    for (int i = 0; i < 3; ++i) sendRaw(&out, sizeof(out));
    return true;
  }

  inflight_ = out;
  has_inflight_ = true;
  retry_ = 0;
  last_tx_ms_ = now_ms;
  return sendRaw(&out, sizeof(out));
}

void EspNowGateway::tick(uint32_t now_ms) {
  if (has_inflight_ && (now_ms - last_tx_ms_) >= kRetryMs) {
    if (retry_ < kMaxRetry) {
      ++retry_;
      last_tx_ms_ = now_ms;
      // 重发保留原 seq，玩具侧据此去重。
      sendRaw(&inflight_, sizeof(inflight_));
    } else {
      Serial.printf("[gw] 指令 seq=%u 重传 %u 次仍无 ACK，放弃\n", inflight_.hdr.seq, kMaxRetry);
      has_inflight_ = false;
    }
  }

  if (now_ms - last_hb_ms_ >= kHeartbeatMs) {
    last_hb_ms_ = now_ms;
    nl_wire_header_t hb;
    nl_wire_header_init(&hb, NL_FRAME_TYPE_HEARTBEAT, tx_seq_++);
    sendRaw(&hb, sizeof(hb));
  }
}

void EspNowGateway::handleRx(const uint8_t *data, int len, uint32_t now_ms) {
  if (!data || len < static_cast<int>(sizeof(nl_wire_header_t))) return;

  nl_wire_header_t hdr;
  memcpy(&hdr, data, sizeof(hdr));
  if (!nl_wire_header_valid(&hdr)) return;

  last_rx_ms_ = now_ms;

  switch (hdr.frame_type) {
    case NL_FRAME_TYPE_TELEMETRY:
      if (len >= static_cast<int>(sizeof(nl_telemetry_t))) {
        memcpy(&telem_, data, sizeof(telem_));
        telem_ms_ = now_ms;
      }
      break;

    case NL_FRAME_TYPE_ACK:
      if (len >= static_cast<int>(sizeof(nl_ack_t))) {
        nl_ack_t ack;
        memcpy(&ack, data, sizeof(ack));
        if (has_inflight_ && ack.ack_seq == inflight_.hdr.seq) {
          has_inflight_ = false;
          if (!ack.accepted) {
            Serial.printf("[gw] 指令被玩具侧拒绝，reason=%s\n", nl_alert_name(ack.reason));
          }
        }
      }
      break;

    default:
      break;
  }
}
