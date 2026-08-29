// DHT11 温湿度：DHTesp 库的薄封装。
//
// 封装存在的理由只有两个：
//   1. 把 float 摄氏度换算成协议要求的 x10 定点整数；
//   2. 强制 >= NL_DHT11_MIN_INTERVAL_MS 的采样间隔，并对外暴露读数新鲜度。
//
// 器件本身最快 1 Hz，测的是玩具附近的环境温湿度，不是接触面温度。
// 严禁用它做过温熔断——那是量产接触 NTC 的职责。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"

class Dht11 {
 public:
  void begin(uint8_t pin);

  // 每轮主循环调用，内部自己判断是否到采样点。
  // 返回 true 表示本次产生了新读数。
  bool poll(uint32_t now_ms);

  bool valid() const { return valid_; }
  int16_t temperature_c_x10() const { return temp_c_x10_; }
  int16_t humidity_x10() const { return humidity_x10_; }

  // 读数是否新鲜（用于 telemetry 的 dht_valid 标志位）
  bool fresh(uint32_t now_ms) const {
    return valid_ && (now_ms - last_ok_ms_) < NL_DHT11_MIN_INTERVAL_MS * 3;
  }

 private:
  bool valid_ = false;
  int16_t temp_c_x10_ = 0;
  int16_t humidity_x10_ = 0;
  uint32_t last_try_ms_ = 0;
  uint32_t last_ok_ms_ = 0;
  uint8_t consecutive_fail_ = 0;
};
