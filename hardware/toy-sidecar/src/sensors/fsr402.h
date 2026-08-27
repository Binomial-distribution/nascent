// FSR402 薄膜压力。
//
// 分压接法：3V3 -- FSR -- ADC -- 10k -- GND，压力越大 ADC 读数越高。
// 上报的是原始 ADC，不做工程单位换算：FSR 个体差异大，标定属于上层。
//
// 除了原始值，这里还提取 1-2Hz 的节律。它用于「贴合与节律」，
// 不用于任何形式的高潮检测——那是产品红线。
#pragma once

#include <stdint.h>

class Fsr402 {
 public:
  void begin(uint8_t pin_l, int pin_r);  // pin_r < 0 表示未接

  // 12Hz 调用。dt_ms 用于节律估计。
  void sample(uint32_t dt_ms);

  uint16_t raw_l() const { return raw_l_; }
  uint16_t raw_r() const { return raw_r_; }
  bool contact() const { return contact_; }

  // 1-2Hz 带通后的节律频率，单位 mHz；无有效节律时为 0。
  uint16_t rhythm_mhz() const { return rhythm_mhz_; }

 private:
  void updateRhythm(float value, uint32_t dt_ms);

  uint8_t pin_l_ = 0;
  int pin_r_ = -1;
  uint16_t raw_l_ = 0;
  uint16_t raw_r_ = 0;
  bool contact_ = false;

  // 两级一阶 IIR 构成带通：先去直流（高通），再压高频（低通）。
  float dc_ = 0.0f;
  float lp_ = 0.0f;
  float prev_bp_ = 0.0f;
  uint32_t since_cross_ms_ = 0;
  uint16_t rhythm_mhz_ = 0;
};
