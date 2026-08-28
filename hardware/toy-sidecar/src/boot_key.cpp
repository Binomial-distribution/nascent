#include "boot_key.h"

#include <Arduino.h>

#include "nascent_protocol.h"

void BootKey::begin(uint8_t pin) {
  pin_ = pin;
  // 开发板上 BOOT 键接地、外部上拉，按下为低。
  pinMode(pin_, INPUT_PULLUP);
  raw_ = false;
  pending_raw_ = false;
  armed_ = false;
}

BootKey::Event BootKey::poll(uint32_t now_ms) {
  const bool level = (digitalRead(pin_) == LOW);

  // --- 去抖：电平要稳定 BOOT_KEY_DEBOUNCE_MS 才认 ---
  if (level != pending_raw_) {
    pending_raw_ = level;
    edge_ms_ = now_ms;
  }
  if (pending_raw_ != raw_ && (now_ms - edge_ms_) >= NL_BOOT_KEY_DEBOUNCE_MS) {
    raw_ = pending_raw_;

    if (!raw_) {
      // 看到一次确定的松开：从这一刻起才允许按压生效。
      // 卡在低电平的坏键永远等不到这一步，也就永远解不了闩锁。
      armed_ = true;

      const bool was_pressed = pressed_;
      const uint32_t held = now_ms - press_ms_;
      const bool fired = resume_fired_;
      pressed_ = false;
      resume_fired_ = false;

      // 长按已经在按住期间触发过，松手不再补一次事件。
      if (was_pressed && !fired && held <= NL_BOOT_STOP_MAX_MS) {
        return Event::kStop;
      }
      return Event::kNone;
    }

    if (armed_) {
      pressed_ = true;
      press_ms_ = now_ms;
      resume_fired_ = false;
    }
    return Event::kNone;
  }

  // --- 按住期间：到阈值就发一次解闩锁，不等松手 ---
  if (pressed_ && !resume_fired_ && (now_ms - press_ms_) >= NL_BOOT_RESUME_HOLD_MS) {
    resume_fired_ = true;
    return Event::kResume;
  }

  return Event::kNone;
}
