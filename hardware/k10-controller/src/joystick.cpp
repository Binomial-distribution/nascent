#include "joystick.h"

#include <Arduino.h>

#include "config.h"

namespace {
constexpr uint32_t kLongPressMs = 1000;
// 回中判定比出发判定更宽松，避免在死区边界上反复触发。
constexpr float kReturnRatio = 0.6f;
}  // namespace

void Joystick::begin(uint8_t pin_x, uint8_t pin_y, uint8_t pin_sw) {
  pin_x_ = pin_x;
  pin_y_ = pin_y;
  pin_sw_ = pin_sw;

  pinMode(pin_x_, INPUT);
  pinMode(pin_y_, INPUT);
  pinMode(pin_sw_, INPUT_PULLUP);
  analogReadResolution(12);

  // 实测中位：HW504 的分压中点个体差异能到几百 LSB，
  // 用理论值 2048 会让某个方向的死区明显偏小。
  int32_t sum = 0;
  for (int i = 0; i < 32; ++i) {
    sum += analogRead(pin_y_);
    delay(2);
  }
  int16_t measured = static_cast<int16_t>(sum / 32);

  // 标定时如果手正压着摇杆，读数会离理论中点很远，这时宁可用理论值。
  if (abs(measured - JOY_CENTER_NOMINAL) < NL_JOY_DEADZONE) {
    center_y_ = measured;
  } else {
    center_y_ = JOY_CENTER_NOMINAL;
    Serial.printf("[joy] 中位标定异常（实测 %d），回退到 %d\n", measured, center_y_);
  }
  Serial.printf("[joy] 中位 %d，死区 ±%d\n", center_y_, NL_JOY_DEADZONE);
}

Joystick::Zone Joystick::classify(int16_t v) const {
  int32_t d = v - center_y_;
#if JOY_INVERT_Y
  d = -d;
#endif

  int32_t threshold = NL_JOY_DEADZONE;
  // 已经偏转时用更小的阈值判定"还没回中"，形成迟滞。
  if (zone_ != Zone::kCenter) threshold = static_cast<int32_t>(NL_JOY_DEADZONE * kReturnRatio);

  if (d > threshold) return Zone::kUp;
  if (d < -threshold) return Zone::kDown;
  return Zone::kCenter;
}

void Joystick::tick(uint32_t now_ms) {
  raw_y_ = static_cast<int16_t>(analogRead(pin_y_));
  Zone z = classify(raw_y_);

  if (z != zone_) {
    zone_ = z;
    zone_since_ms_ = now_ms;
    edge_emitted_ = false;
  }

  if (zone_ != Zone::kCenter) {
    nl_joy_edge_t dir = (zone_ == Zone::kUp) ? NL_JOY_EDGE_UP : NL_JOY_EDGE_DOWN;

    if (!edge_emitted_) {
      // 去抖：偏转必须稳定持续 JOY_EDGE_HOLD_MS 才承认，
      // 否则手指擦过摇杆也会换档。
      if (now_ms - zone_since_ms_ >= NL_JOY_EDGE_HOLD_MS) {
        pending_edge_ = dir;
        edge_emitted_ = true;
        last_emit_ms_ = now_ms;
      }
    } else if (now_ms - last_emit_ms_ >= NL_JOY_HOLD_RAMP_MS) {
      // 一直推着：按固定节奏续档。节奏与推的幅度无关，这是刻意的——
      // 用力推不该让强度涨得更快。
      pending_edge_ = dir;
      last_emit_ms_ = now_ms;
    }
  }

  // --- 按键 ---
  bool down = digitalRead(pin_sw_) == LOW;
  if (down && !sw_down_) {
    sw_down_ = true;
    sw_since_ms_ = now_ms;
    long_fired_ = false;
  } else if (down && sw_down_) {
    if (!long_fired_ && (now_ms - sw_since_ms_) >= kLongPressMs) {
      // 长按到时立即触发，不等松手。停机不该让用户多等一步。
      pending_long_ = true;
      long_fired_ = true;
    }
  } else if (!down && sw_down_) {
    sw_down_ = false;
    if (!long_fired_) pending_short_ = true;
  }
}

nl_joy_edge_t Joystick::takeEdge() {
  nl_joy_edge_t e = pending_edge_;
  pending_edge_ = NL_JOY_EDGE_NONE;
  return e;
}

bool Joystick::takeShortPress() {
  bool v = pending_short_;
  pending_short_ = false;
  return v;
}

bool Joystick::takeLongPress() {
  bool v = pending_long_;
  pending_long_ = false;
  return v;
}
