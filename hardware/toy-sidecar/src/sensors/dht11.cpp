#include "dht11.h"

#include <Arduino.h>
#include <DHTesp.h>

#include "nascent_protocol.h"

namespace {
DHTesp g_dht;
}

void Dht11::begin(uint8_t pin) {
  // 显式指定 DHT11：DHTesp 的自动探测在 ESP32 上不可靠，作者本人也这么建议。
  g_dht.setup(pin, DHTesp::DHT11);
  last_try_ms_ = millis();
}

bool Dht11::poll(uint32_t now_ms) {
  if (now_ms - last_try_ms_ < NL_DHT11_MIN_INTERVAL_MS) return false;
  last_try_ms_ = now_ms;

  TempAndHumidity th = g_dht.getTempAndHumidity();
  if (g_dht.getStatus() != DHTesp::ERROR_NONE || isnan(th.temperature) || isnan(th.humidity)) {
    // 单次失败不清空读数：DHT11 偶发校验错很常见，连错三次才认为掉线。
    if (++consecutive_fail_ >= 3) valid_ = false;
    return false;
  }

  temp_c_x10_ = static_cast<int16_t>(lroundf(th.temperature * 10.0f));
  humidity_x10_ = static_cast<int16_t>(lroundf(th.humidity * 10.0f));
  valid_ = true;
  consecutive_fail_ = 0;
  last_ok_ms_ = now_ms;
  return true;
}
