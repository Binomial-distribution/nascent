#include "cd4066.h"

#include <Arduino.h>

#include "config.h"
#include "nascent_protocol.h"

void Cd4066 ::begin(uint8_t pin) {
  pin_ = pin;
  pinMode(pin_, OUTPUT);
  digitalWrite(pin_, LOW);  // 断开 = 不按

  // 上电时不知道原板停在哪，先长按关机把状态对齐到已知点。
  requestOffNow();
}

void Cd4066::requestOffNow() {
  pending_ = 0;
  pending_long_ = true;
  target_step_ = 0;
  needs_resync_ = false;
}

void Cd4066::requestLevel(uint8_t target) {
  target = target > NL_LEVEL_MAX ? NL_LEVEL_MAX : target;

  if (target == 0) {
    if (!powered_ && !busy()) return;
    requestOffNow();
    return;
  }

  if (needs_resync_) {
    // 状态不可信：先关机回到已知点，再从 1 档按上去。
    pending_long_ = true;
    pending_ = target;
    target_step_ = target;
    needs_resync_ = false;
    return;
  }

  if (busy() && target == target_step_) return;

  if (!powered_) {
    // 关机态：第一下开机停在 1 档，之后每下 +1。
    pending_long_ = false;
    pending_ = target;
    target_step_ = target;
    return;
  }

  if (target == step_) return;

  if (target > step_) {
    pending_long_ = false;
    pending_ = static_cast<uint8_t>(target - step_);
    target_step_ = target;
    return;
  }

  // 降档。原板只能单向循环，若靠绕一圈回落，中途必然经过第 9 档
  // ——也就是最强档。为了不让用户在降档时被顶一下最大强度，
  // 这里改成"长按关机再按上来"。多花约 1 秒，换掉一个真实的伤害风险。
  pending_long_ = true;
  pending_ = target;
  target_step_ = target;
}

void Cd4066::tick(uint32_t now_ms) {
  switch (phase_) {
    case Phase::kIdle:
      if (pending_long_) {
        pending_long_ = false;
        digitalWrite(pin_, HIGH);
        phase_ = Phase::kPressing;
        phase_until_ms_ = now_ms + BTN_LONG_MS;
        step_ = 0;
        powered_ = false;
      } else if (pending_ > 0) {
        --pending_;
        digitalWrite(pin_, HIGH);
        phase_ = Phase::kPressing;
        phase_until_ms_ = now_ms + BTN_SHORT_MS;
        if (!powered_) {
          powered_ = true;
          step_ = 1;
        } else {
          step_ = static_cast<uint8_t>(step_ % ORIGINAL_STEP_COUNT + 1);
        }
      }
      break;

    case Phase::kPressing:
      if (static_cast<int32_t>(now_ms - phase_until_ms_) >= 0) {
        digitalWrite(pin_, LOW);
        phase_ = Phase::kGap;
        // 原板需要时间响应按键释放，间隔给够，否则会漏按。
        phase_until_ms_ = now_ms + BTN_GAP_MS;
      }
      break;

    case Phase::kGap:
      if (static_cast<int32_t>(now_ms - phase_until_ms_) >= 0) phase_ = Phase::kIdle;
      break;
  }
}
