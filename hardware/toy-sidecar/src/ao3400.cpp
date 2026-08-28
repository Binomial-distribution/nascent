#include "ao3400.h"

#include <Arduino.h>

#include "config.h"
#include "nascent_protocol.h"

namespace {

// requestOffNow() 从 ESP-NOW 回调（WiFi 任务，另一个核）调用，
// tick() 从主循环调用。两边都改同一组状态，必须互斥。
// 临界区里只有寄存器写和几个赋值，微秒级。
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

}  // namespace

void Ao3400::begin(uint8_t pin) {
  pin_ = pin;
  pinMode(pin_, OUTPUT);
  digitalWrite(pin_, LOW);  // 栅极拉低 = 截止 = 不按

  // 上电什么都不按。
  //
  // 长按是电源取反而不是关机：如果玩具此刻是关着的，一次"对齐用"的长按
  // 会把它打开——用户没要求任何输出、设备却自己动起来，是这个产品最坏的
  // 失败模式。所以这里只假定它关着，真实状态交给 MotorSense 观测去修正。
  phase_ = Phase::kIdle;
  pressing_long_ = false;
  goal_active_ = false;
  goal_step_ = 0;
  press_budget_ = 0;
  step_ = 0;
  powered_ = false;
  needs_resync_ = false;
}

void Ao3400::startPress(bool long_press, uint32_t now_ms) {
  pressing_long_ = long_press;
  digitalWrite(pin_, HIGH);
  phase_ = Phase::kPressing;
  phase_until_ms_ = now_ms + (long_press ? BTN_LONG_MS : BTN_SHORT_MS);
}

void Ao3400::finishPress() {
  if (press_budget_ > 0) --press_budget_;

  if (pressing_long_) {
    // 长按是电源取反，不是单向关机。
    powered_ = !powered_;
    step_ = powered_ ? 1 : 0;  // 实测：长按开机后原板停在第 1 档
    // 关机是这条链路上唯一可信的已知点，到了就把记录重新标为可信。
    if (!powered_) needs_resync_ = false;
    return;
  }

  // 关机态下的短按原板没有反应，step_ 保持 0。
  // 正常路径不会走到这里（tick 只在开机态发短按），留着是防御。
  if (!powered_) return;

  // 协议封顶 NL_LEVEL_MAX = 8 而原板有九档，requestLevel 永远不会
  // 主动按到第 9 档，所以这个回绕在正常路径上不会发生，是防御性的。
  step_ = static_cast<uint8_t>(step_ % ORIGINAL_STEP_COUNT + 1);
}

void Ao3400::requestOffNow() {
  portENTER_CRITICAL(&g_mux);

  // 队列里可能正排着"开机"长按，先把目标改成关机，
  // 否则关掉之后紧接着又被打开。
  goal_step_ = 0;
  goal_active_ = true;
  press_budget_ = 2;

  if (phase_ == Phase::kPressing) {
    // 停机打断了一次正在进行的按压。原板可能已经把它当成一次完整的
    // 短按或长按，也可能什么都没认到——此刻它是开还是关无法确定。
    // 保守按"可能是开着的"处理：立刻松手，随后走一次长按去关。
    digitalWrite(pin_, LOW);
    pressing_long_ = false;
    phase_ = Phase::kGap;
    phase_until_ms_ = millis() + BTN_POWER_GAP_MS;
    powered_ = true;
    needs_resync_ = true;
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  if (!powered_) {
    // 记录为关机：什么都不按。
    //
    // 长按在关机态是"开机"，盲发一次等于把用户没要求的输出打开。
    // 若实机其实开着（有人手按过实体键），MotorSense 会观测到电机振动
    // 并通过 markObservedPowered() 修正记录，届时这条路径才真的去关。
    goal_active_ = false;
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  portEXIT_CRITICAL(&g_mux);
}

void Ao3400::requestLevel(uint8_t target) {
  if (target > NL_LEVEL_MAX) target = NL_LEVEL_MAX;

  if (target == 0) {
    requestOffNow();
    return;
  }

  portENTER_CRITICAL(&g_mux);
  goal_step_ = target;
  goal_active_ = true;
  // 最坏路径是"长按关机 + 长按开机 + 升到第 8 档" = 2 长按 + 7 短按。
  // 给点余量，超了就停手要求 resync，绝不无限按下去。
  press_budget_ = static_cast<uint8_t>(ORIGINAL_STEP_COUNT + 4);
  portEXIT_CRITICAL(&g_mux);
}

void Ao3400::markObservedPowered(bool on) {
  portENTER_CRITICAL(&g_mux);
  if (powered_ != on) {
    powered_ = on;
    // 档位无从观测，只能标记为不可信，下次调档会先回到关机再按上去。
    step_ = on ? 1 : 0;
    needs_resync_ = true;
  }
  portEXIT_CRITICAL(&g_mux);
}

void Ao3400::tick(uint32_t now_ms) {
  portENTER_CRITICAL(&g_mux);

  switch (phase_) {
    case Phase::kPressing:
      if (static_cast<int32_t>(now_ms - phase_until_ms_) >= 0) {
        digitalWrite(pin_, LOW);
        finishPress();
        phase_ = Phase::kGap;
        // 原板需要时间响应按键释放，间隔给够否则会漏按。
        // 开关机比切档慢，长按之后要多等一会儿。
        phase_until_ms_ = now_ms + (pressing_long_ ? BTN_POWER_GAP_MS : BTN_GAP_MS);
      }
      portEXIT_CRITICAL(&g_mux);
      return;

    case Phase::kGap:
      if (static_cast<int32_t>(now_ms - phase_until_ms_) < 0) {
        portEXIT_CRITICAL(&g_mux);
        return;
      }
      phase_ = Phase::kIdle;
      break;

    case Phase::kIdle:
      break;
  }

  if (!goal_active_) {
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  if (press_budget_ == 0) {
    // 按了这么多下还没到位，说明开环跟踪已经不可信。停手等 resync，
    // 而不是继续按下去——失控地连按原板按键比停在错档位危险得多。
    goal_active_ = false;
    needs_resync_ = true;
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  // 每一步都用最新的开环状态重新决策。
  if (goal_step_ == 0) {
    if (powered_) {
      startPress(true, now_ms);  // 长按 = 关机
    } else {
      goal_active_ = false;
    }
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  // 状态不可信、或者要降档：都得先回到"关机"这个唯一的已知点。
  // 降档不靠短按绕一圈，那样中途必然经过原板第 9 档——也就是最强档。
  // 用户在降档时被顶一下最大强度是真实的伤害风险，多花约 3 秒换掉它。
  if (powered_ && (needs_resync_ || goal_step_ < step_)) {
    startPress(true, now_ms);
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  if (!powered_) {
    startPress(true, now_ms);  // 长按 = 开机，落在第 1 档
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  if (goal_step_ > step_) {
    startPress(false, now_ms);  // 短按 = 升一档
    portEXIT_CRITICAL(&g_mux);
    return;
  }

  goal_active_ = false;  // 到位
  portEXIT_CRITICAL(&g_mux);
}
