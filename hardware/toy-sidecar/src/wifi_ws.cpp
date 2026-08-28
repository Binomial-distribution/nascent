#include "wifi_ws.h"

#include <Arduino.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include <string.h>

#if __has_include("local_config.h")
#include "local_config.h"
#endif

// 没有 local_config.h 时给出空 SSID，configured() 随之为假。
// 用宏而不是弱符号，是为了让"没配凭据"在编译期就是个明确的空串，
// 而不是运行期某个忘了初始化的指针。
#ifndef NL_WIFI_SSID
#define NL_WIFI_SSID ""
#endif
#ifndef NL_WIFI_PASSWORD
#define NL_WIFI_PASSWORD ""
#endif

namespace {

WebSocketsServer g_ws(NL_WIFI_WS_PORT);
WifiWs *g_self = nullptr;

constexpr uint32_t kConnectTimeoutMs = 15000;

}  // namespace

bool WifiWs::configured() { return strlen(NL_WIFI_SSID) > 0; }

bool WifiWs::begin(CommandHandler handler) {
  if (phase_ != Phase::kOff && phase_ != Phase::kFailed) return true;
  if (!configured()) {
    Serial.println("[wifi] 未配置 SSID（缺 include/local_config.h），WiFi 通道不启用");
    return false;
  }

  handler_ = handler;
  g_self = this;

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // 12Hz 上行不能被省电模式攒成一批
  WiFi.begin(NL_WIFI_SSID, NL_WIFI_PASSWORD);

  phase_ = Phase::kConnecting;
  connect_started_ms_ = millis();
  Serial.printf("[wifi] 正在连接 %s\n", NL_WIFI_SSID);
  return true;
}

void WifiWs::startServer() {
  mdns_up_ = MDNS.begin(NL_WIFI_MDNS_HOST);
  if (mdns_up_) MDNS.addService("ws", "tcp", NL_WIFI_WS_PORT);

  g_ws.begin();
  g_ws.onEvent([](uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
    if (g_self) g_self->onEvent(num, static_cast<int>(type), payload, length);
  });

  // 判活交给库的心跳：它每 500ms 发一次 ping，连着两个 LINK_TIMEOUT_MS 窗口
  // 收不到 pong 就主动断开并回调 DISCONNECTED，于是 up() 转假、安全总督归零。
  //
  // 为什么不自己按"最近收包时间"判活：pong 在这个库里不产生应用层事件，
  // 而正常使用时下行是事件驱动的，可能几十秒都没有一条指令。
  // 拿收包新鲜度当活性指标会在用户没操作时误判断链，把档位归零。
  g_ws.enableHeartbeat(500, NL_LINK_TIMEOUT_MS, 2);

  phase_ = Phase::kServing;
  Serial.printf("[wifi] 已连接，ws://%s:%d%s\n", WiFi.localIP().toString().c_str(),
                NL_WIFI_WS_PORT, NL_WIFI_WS_PATH);
  if (mdns_up_) {
    Serial.printf("[wifi] 也可以用 ws://%s.local:%d%s\n", NL_WIFI_MDNS_HOST, NL_WIFI_WS_PORT,
                  NL_WIFI_WS_PATH);
  }
}

void WifiWs::stopRadio() {
  if (mdns_up_) {
    MDNS.end();
    mdns_up_ = false;
  }
  // 切回 BLE 之前把射频整个还掉，否则两栈并存抢时隙。
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_OFF);
}

void WifiWs::end() {
  if (phase_ == Phase::kOff) return;
  if (phase_ == Phase::kServing) g_ws.close();
  stopRadio();
  phase_ = Phase::kOff;
  has_client_ = false;
  gate_.endSession();
  Serial.println("[wifi] 已停止");
}

void WifiWs::tick(uint32_t now_ms) {
  switch (phase_) {
    case Phase::kConnecting:
      if (WiFi.status() == WL_CONNECTED) {
        startServer();
      } else if (now_ms - connect_started_ms_ >= kConnectTimeoutMs) {
        // 停在 kFailed，up() 恒为假，切换器过一个空闲窗口会把链路换回 BLE。
        // 这里不自己重试：重试的判断属于切换器，两处都试会互相打断。
        Serial.println("[wifi] 连接超时，等待切回 BLE");
        stopRadio();
        phase_ = Phase::kFailed;
      }
      return;

    case Phase::kServing:
      g_ws.loop();
      return;

    case Phase::kOff:
    case Phase::kFailed:
      return;
  }
}

bool WifiWs::up(uint32_t) const {
  // 对端掉电、NAT 超时这类"连接还在但对面没了"的情况由库的心跳负责，
  // 见 startServer() 里 enableHeartbeat 的那段说明。
  return phase_ == Phase::kServing && has_client_;
}

void WifiWs::sendUplink(const char *json, size_t len) {
  if (phase_ != Phase::kServing || !has_client_) return;
  g_ws.sendTXT(client_num_, json, len);
}

void WifiWs::onEvent(uint8_t num, int type, uint8_t *payload, size_t length) {
  const uint32_t now = millis();

  switch (type) {
    case WStype_CONNECTED: {
      // 这个库不按路径路由，握过手才拿得到 URL（它在 CONNECTED 的 payload 里，
      // 以 NUL 结尾）。所以路径校验只能在这里做：不是契约里那条就立刻断开。
      const char *url = reinterpret_cast<const char *>(payload);
      (void)length;
      if (!url || strcmp(url, NL_WIFI_WS_PATH) != 0) {
        Serial.printf("[wifi] 客户端 %u 路径不符（%s），断开\n", num, url ? url : "");
        g_ws.disconnect(num);
        return;
      }

      // 只认一个控制端。已经有连接时拒绝新的，而不是踢掉旧的——
      // 正在用的那一条不该被一个新连接抢走停机的能力。
      if (has_client_) {
        Serial.printf("[wifi] 已有控制端，拒绝客户端 %u\n", num);
        g_ws.disconnect(num);
        return;
      }

      has_client_ = true;
      client_num_ = num;
      gate_.newSession(now);

      // WebSocket 没有 Info 特征可读，所以连上先主动推一帧握手。
      char buf[128];
      size_t n = gate_.buildInfo(buf, sizeof(buf));
      g_ws.sendTXT(num, buf, n);
      Serial.printf("[wifi] 控制端 %u 已连接，已签发新会话令牌\n", num);
      return;
    }

    case WStype_DISCONNECTED:
      if (has_client_ && num == client_num_) {
        has_client_ = false;
        gate_.endSession();
        Serial.printf("[wifi] 控制端 %u 断开\n", num);
      }
      return;

    case WStype_TEXT: {
      if (!has_client_ || num != client_num_) return;
      nl_command_t out;
      if (!gate_.accept(reinterpret_cast<const char *>(payload), length, now, out)) return;
      if (handler_) handler_(out);
      return;
    }

    default:
      // 二进制帧与分片一律忽略：契约规定这条链路走文本帧，一帧一条 JSON。
      return;
  }
}
