#include "espnow_link.h"

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <string.h>

namespace {
EspNowLink *g_link = nullptr;
constexpr uint32_t kHeartbeatMs = 500;
}  // namespace

// esp_now 的接收回调是 C 函数指针，只能借全局实例转发。
void nl_espnow_dispatch(const uint8_t * /*mac*/, const uint8_t *data, int len) {
  if (g_link) g_link->handleRx(data, len, millis());
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  nl_espnow_dispatch(info ? info->src_addr : nullptr, data, len);
}
#else
static void onRecv(const uint8_t *mac, const uint8_t *data, int len) {
  nl_espnow_dispatch(mac, data, len);
}
#endif

bool EspNowLink::begin(const uint8_t peer_mac[6], uint8_t channel, CommandHandler handler) {
  memcpy(peer_, peer_mac, 6);
  handler_ = handler;
  g_link = this;

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, true);
  // 固定信道：两块板必须一致，否则收不到。不连路由器就不会被 DHCP 改信道。
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    log_e("esp_now_init 失败");
    return false;
  }
  esp_now_register_recv_cb(onRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, peer_, 6);
  peer.channel = channel;
  peer.encrypt = false;  // 验证期不加密；量产需换成 LMK 加密并做配对流程
  if (esp_now_add_peer(&peer) != ESP_OK) {
    log_e("esp_now_add_peer 失败");
    return false;
  }

  Serial.printf("[espnow] 本机 MAC %s，对端 %02X:%02X:%02X:%02X:%02X:%02X，信道 %u\n",
                WiFi.macAddress().c_str(), peer_[0], peer_[1], peer_[2], peer_[3], peer_[4],
                peer_[5], channel);
  return true;
}

bool EspNowLink::sendRaw(const void *data, size_t len) {
  return esp_now_send(peer_, static_cast<const uint8_t *>(data), len) == ESP_OK;
}

bool EspNowLink::up(uint32_t now_ms) const {
  return last_rx_ms_ != 0 && (now_ms - last_rx_ms_) < NL_LINK_TIMEOUT_MS;
}

void EspNowLink::tick(uint32_t now_ms) {
  if (now_ms - last_hb_ms_ < kHeartbeatMs) return;
  last_hb_ms_ = now_ms;

  nl_wire_header_t hb;
  nl_wire_header_init(&hb, NL_FRAME_TYPE_HEARTBEAT, tx_seq_++);
  sendRaw(&hb, sizeof(hb));
}

bool EspNowLink::sendTelemetry(const nl_telemetry_t &frame) {
  nl_telemetry_t out = frame;
  nl_wire_header_init(&out.hdr, NL_FRAME_TYPE_TELEMETRY, tx_seq_++);
  // 遥测不要 ACK：丢了下一帧 83ms 后就到，重传只会挤占信道。
  return sendRaw(&out, sizeof(out));
}

void EspNowLink::sendAck(uint16_t seq, bool accepted, nl_alert_t reason) {
  nl_ack_t ack = {};
  nl_wire_header_init(&ack.hdr, NL_FRAME_TYPE_ACK, tx_seq_++);
  ack.ack_seq = seq;
  ack.accepted = accepted ? 1 : 0;
  ack.reason = static_cast<uint8_t>(reason);
  sendRaw(&ack, sizeof(ack));
}

void EspNowLink::handleRx(const uint8_t *data, int len, uint32_t now_ms) {
  if (!data || len < static_cast<int>(sizeof(nl_wire_header_t))) return;

  nl_wire_header_t hdr;
  memcpy(&hdr, data, sizeof(hdr));
  if (!nl_wire_header_valid(&hdr)) return;

  // 帧头合法就算链路活着，心跳和遥测都能续命。
  last_rx_ms_ = now_ms;

  if (hdr.frame_type != NL_FRAME_TYPE_COMMAND) return;
  if (len < static_cast<int>(sizeof(nl_command_t))) return;

  nl_command_t cmd;
  memcpy(&cmd, data, sizeof(cmd));

  // 去重：重发的 seq 照样 ACK（否则对端会一直重发），但不重复执行。
  if (has_last_cmd_seq_ && cmd.hdr.seq == last_cmd_seq_) {
    sendAck(cmd.hdr.seq, true, NL_ALERT_NONE);
    return;
  }
  has_last_cmd_seq_ = true;
  last_cmd_seq_ = cmd.hdr.seq;

  if (cmd.cmd >= NL_CMD_COUNT) {
    sendAck(cmd.hdr.seq, false, NL_ALERT_BAD_CMD);
    return;
  }

  sendAck(cmd.hdr.seq, true, NL_ALERT_NONE);
  if (handler_) handler_(cmd);
}
