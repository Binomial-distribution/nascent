#include "fsr402.h"

#include <Arduino.h>

#include "config.h"

namespace {
// 12Hz 采样下的一阶系数。DC 跟踪要慢（~0.15Hz），低通要压掉 3Hz 以上。
constexpr float kDcAlpha = 0.02f;
constexpr float kLpAlpha = 0.45f;

// 节律有效区间对应的半周期毫秒数：1Hz -> 500ms，2Hz -> 250ms。
constexpr uint32_t kHalfPeriodMinMs = 200;
constexpr uint32_t kHalfPeriodMaxMs = 700;

// 过零判据的幅度门限，避免静止时的 ADC 噪声被当成节律。
constexpr float kCrossHysteresis = 12.0f;
}  // namespace

void Fsr402::begin(uint8_t pin_l, int pin_r) {
  pin_l_ = pin_l;
  pin_r_ = pin_r;
  analogReadResolution(12);
  analogSetPinAttenuation(pin_l_, ADC_11db);  // 满量程约 3.1V
  if (pin_r_ >= 0) analogSetPinAttenuation(static_cast<uint8_t>(pin_r_), ADC_11db);

  dc_ = analogRead(pin_l_);
  lp_ = 0.0f;
}

void Fsr402::sample(uint32_t dt_ms) {
  raw_l_ = static_cast<uint16_t>(analogRead(pin_l_));
  raw_r_ = (pin_r_ >= 0) ? static_cast<uint16_t>(analogRead(static_cast<uint8_t>(pin_r_))) : 0;

  uint16_t peak = raw_l_ > raw_r_ ? raw_l_ : raw_r_;
  contact_ = peak >= FSR_CONTACT_ADC;

  updateRhythm(static_cast<float>(raw_l_), dt_ms);
}

void Fsr402::updateRhythm(float value, uint32_t dt_ms) {
  dc_ += kDcAlpha * (value - dc_);
  float hp = value - dc_;
  lp_ += kLpAlpha * (hp - lp_);
  float bp = lp_;

  since_cross_ms_ += dt_ms;

  // 带滞回的上升沿过零：一个完整周期 = 两次过零，这里量的是半周期。
  bool crossed = (prev_bp_ <= -kCrossHysteresis) && (bp > kCrossHysteresis);
  prev_bp_ = bp;

  if (!crossed) {
    // 太久没有过零就认为节律消失，避免上报一个陈旧的频率。
    if (since_cross_ms_ > kHalfPeriodMaxMs * 3) rhythm_mhz_ = 0;
    return;
  }

  uint32_t half = since_cross_ms_;
  since_cross_ms_ = 0;

  if (half < kHalfPeriodMinMs || half > kHalfPeriodMaxMs) {
    rhythm_mhz_ = 0;  // 落在 1-2Hz 之外，不是我们关心的节律
    return;
  }

  // 半周期 half 毫秒 -> 频率 = 1000 / (2 * half) Hz -> 乘 1000 得 mHz
  rhythm_mhz_ = static_cast<uint16_t>(500000UL / half);
}
