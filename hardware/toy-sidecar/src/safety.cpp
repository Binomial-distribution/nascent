#include "safety.h"

#include <Arduino.h>

void SafetyGovernor::begin(uint32_t now_ms) {
  wild_since_ms_ = now_ms;
  effective_level_ = 0;
  requested_level_ = 0;
}

void SafetyGovernor::onCommand(const nl_command_t &cmd, uint32_t now_ms) {
  // stop 不看任何前置条件，也不排队。它是唯一一条能穿过所有状态的指令。
  if (cmd.cmd == NL_CMD_STOP) {
    latched_ = true;
    requested_level_ = 0;
    alert_ = NL_ALERT_SAFEWORD;
    recompute(now_ms);
    return;
  }

  // resume 是唯一能解除闩锁的指令，而它只由 K10 上的物理双键确认产生。
  // App 与云端都发不出它——喊停之后要恢复，必须有人在场按下去。
  if (cmd.cmd == NL_CMD_RESUME) {
    if (latched_) {
      Serial.println("[safety] 收到物理确认，解除闩锁");
      clearLatch(now_ms);
    }
    return;
  }

  // 闩锁期间其余指令一律丢弃，包括换模式。
  if (latched_) return;

  switch (cmd.cmd) {
    case NL_CMD_SET_MODE:
      if (cmd.mode < NL_MODE_COUNT) {
        nl_mode_t next = static_cast<nl_mode_t>(cmd.mode);
        if (next != mode_) {
          mode_ = next;
          if (next == NL_MODE_WILD) wild_since_ms_ = now_ms;
          // 换模式清零档位：不允许把手动的高档位平移进失控模式。
          requested_level_ = 0;
        }
      }
      break;

    case NL_CMD_SET_LEVEL:
      requested_level_ = cmd.level > NL_LEVEL_MAX ? NL_LEVEL_MAX : cmd.level;
      break;

    case NL_CMD_SET_LED:
      if (cmd.led_state < NL_LED_STATE_COUNT) {
        // 安全词灯只能由停机路径点亮，不接受远端直接指定，
        // 否则一个错误指令就能伪造"已停机"的视觉信号。
        if (cmd.led_state != NL_LED_STATE_SAFEWORD) {
          requested_led_ = static_cast<nl_led_state_t>(cmd.led_state);
        }
      }
      break;

    case NL_CMD_SET_PATTERN:
    case NL_CMD_SET_JOYSTICK:
      // 波形由原板按档位自己决定，摇杆使能是 K10 侧的事，玩具侧不需要动作。
      break;

    default:
      break;
  }

  recompute(now_ms);
}

void SafetyGovernor::onSensors(nl_insert_state_t insert, bool still, uint32_t still_ms) {
  insert_ = insert;
  still_ = still;
  still_ms_ = still_ms;
}

void SafetyGovernor::onLink(bool up, uint32_t now_ms) {
  if (up == link_up_) return;
  link_up_ = up;
  if (!up) {
    Serial.println("[safety] 链路丢失，归零");
    recompute(now_ms);
  }
}

void SafetyGovernor::onEstop(uint32_t now_ms) {
  latched_ = true;
  requested_level_ = 0;
  alert_ = NL_ALERT_ESTOP;
  recompute(now_ms);
}

void SafetyGovernor::clearLatch(uint32_t now_ms) {
  latched_ = false;
  requested_level_ = 0;
  alert_ = NL_ALERT_NONE;
  mode_ = NL_MODE_FREE;
  requested_led_ = NL_LED_STATE_MODE_DEFAULT;
  recompute(now_ms);
}

void SafetyGovernor::tick(uint32_t now_ms) { recompute(now_ms); }

void SafetyGovernor::recompute(uint32_t now_ms) {
  // 按优先级逐层否决，任何一层命中就直接归零并返回。
  if (latched_) {
    effective_level_ = 0;
    return;
  }

  if (!link_up_) {
    effective_level_ = 0;
    alert_ = NL_ALERT_LINK_LOST;
    return;
  }

  if (mode_ == NL_MODE_WILD && (now_ms - wild_since_ms_) >= NL_WILD_TIMEOUT_MS) {
    Serial.println("[safety] 失控模式超时，退回手动");
    mode_ = NL_MODE_FREE;
    requested_level_ = 0;
    effective_level_ = 0;
    alert_ = NL_ALERT_NONE;
    return;
  }

  if (still_ && still_ms_ >= NL_STILL_PAUSE_MS) {
    effective_level_ = 0;
    alert_ = NL_ALERT_NONE;
    return;
  }

  uint8_t target = requested_level_;

  // 拿不准在不在用，就不许自动往上加。降档和手动操作不受影响。
  if (insert_ == NL_INSERT_STATE_UNKNOWN && isAutoPath() && target > effective_level_) {
    target = effective_level_;
  }

  if (target > NL_LEVEL_MAX) target = NL_LEVEL_MAX;

  effective_level_ = target;
  alert_ = NL_ALERT_NONE;
}

nl_led_state_t SafetyGovernor::led() const {
  if (latched_) return NL_LED_STATE_SAFEWORD;
  if (!link_up_) return NL_LED_STATE_MODE_DEFAULT;
  return requested_led_;
}
