#include "ao3400.h"

#include <Arduino.h>

#include "config.h"
#include "nascent_protocol.h"

namespace {

// tick() / requestOffNow() / requestLevel() 都只从主循环调用
// （远端 stop 经 CommandMailbox 排到 loop 里再执行）。
// 这把锁留下是因为状态机会被同一次 loop 里的多处入口碰到，
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
  raw_queued_ = false;
  raw_hold_ = false;
  log_high_ = false;
  log_low_ = false;
}

void Ao3400::reclaimPin() {
  // 不用 gpio_reset_pin：它会短暂打开内部上拉，和栅极 47k 下拉分压
  // 可能到 ~1.7V，超过 AO3400A 的 Vgs(th)，等于上电误按。
  pinMode(pin_, OUTPUT);
  digitalWrite(pin_, LOW);
  Serial.printf("[ao3400] 已重新声明 GPIO%u 为推挽输出、默认低（不按键）\n",
                static_cast<unsigned>(pin_));
}

void Ao3400::startPress(bool long_press, uint32_t now_ms) {
  pressing_long_ = long_press;
  pinMode(pin_, OUTPUT);
  digitalWrite(pin_, HIGH);
  phase_ = Phase::kPressing;
  phase_until_ms_ = now_ms + (long_press ? BTN_LONG_MS : BTN_SHORT_MS);
  log_high_ = true;
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
    pinMode(pin_, OUTPUT);
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

void Ao3400::requestRawPress(bool hold) {
  portENTER_CRITICAL(&g_mux);
  goal_active_ = false;
  raw_queued_ = true;
  raw_hold_ = hold;
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
        pinMode(pin_, OUTPUT);
        digitalWrite(pin_, LOW);
        log_low_ = true;
        finishPress();
        phase_ = Phase::kGap;
        // 原板需要时间响应按键释放，间隔给够否则会漏按。
        // 开关机比切档慢，长按之后要多等一会儿。
        phase_until_ms_ = now_ms + (pressing_long_ ? BTN_POWER_GAP_MS : BTN_GAP_MS);
      }
      break;

    case Phase::kGap:
      if (static_cast<int32_t>(now_ms - phase_until_ms_) < 0) break;
      phase_ = Phase::kIdle;
      [[fallthrough]];
    case Phase::kIdle:
      if (phase_ == Phase::kIdle) {
        if (raw_queued_) {
          raw_queued_ = false;
          startPress(raw_hold_, now_ms);
        } else if (goal_active_) {
        if (press_budget_ == 0) {
          // 按了这么多下还没到位，说明开环跟踪已经不可信。停手等 resync，
          // 而不是继续按下去——失控地连按原板按键比停在错档位危险得多。
          goal_active_ = false;
          needs_resync_ = true;
        } else if (goal_step_ == 0) {
          if (powered_) {
            startPress(true, now_ms);  // 长按 = 关机
          } else {
            goal_active_ = false;
          }
        } else if (powered_ && (needs_resync_ || goal_step_ < step_)) {
          startPress(true, now_ms);
        } else if (!powered_) {
          startPress(true, now_ms);  // 长按 = 开机，落在第 1 档
        } else if (goal_step_ > step_) {
          startPress(false, now_ms);  // 短按 = 升一档
        } else {
          goal_active_ = false;  // 到位
        }
        }
      }
      break;
  }

  const bool log_high = log_high_;
  const bool log_low = log_low_;
  const bool log_long = pressing_long_;
  const uint8_t pin = pin_;
  const uint8_t goal = goal_step_;
  const uint8_t step = step_;
  const bool powered = powered_;
  log_high_ = false;
  log_low_ = false;
  portEXIT_CRITICAL(&g_mux);

  if (log_low) {
    Serial.printf("[ao3400] GPIO%u LOW 松手\n", static_cast<unsigned>(pin));
  }
  if (log_high) {
    const uint32_t hold = log_long ? BTN_LONG_MS : BTN_SHORT_MS;
    Serial.printf("[ao3400] GPIO%u HIGH %s %lums（目标档 %u，开环%s 第%u档）\n",
                  static_cast<unsigned>(pin), log_long ? "长按开机/关机" : "短按切档",
                  static_cast<unsigned long>(hold), static_cast<unsigned>(goal),
                  powered ? "已开机" : "关机", static_cast<unsigned>(step));
  }
}
