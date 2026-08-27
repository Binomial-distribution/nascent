// WS2812B x8 灯效。
//
// 灯语规则（来自产品定义，不要在实现里自行发挥）：
//   - 换模式才换色，换人不换灯。人设只管说什么，灯只管在哪种玩法。
//   - 档位 = 点亮颗数。
//   - 覆盖层按 priority 抢占模式层；安全词 priority 100，永远压得住一切。
//   - 红色专属失控玩法。安全体系用白 / 琥珀 / 绿，绝不用红。
//
// 配色与优先级全部来自 protocol/contract.yaml 生成的表，不在这里硬编码。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"

class LedRing {
 public:
  void begin();

  void setMode(nl_mode_t mode);
  void setLevel(uint8_t level);
  void setOverride(nl_led_state_t state);

  // 每轮主循环调用，内部按需刷新。
  void render(uint32_t now_ms);

  // 停机路径专用：立刻同步渲染安全灯，不等下一轮 render。
  // 电机停止与灯变白必须是同一时刻发生的，否则用户会怀疑到底停没停。
  void renderSafewordNow();

 private:
  void applyModeLayer(uint32_t now_ms);
  bool applyOverrideLayer(uint32_t now_ms);

  nl_mode_t mode_ = NL_MODE_FREE;
  uint8_t level_ = 0;
  nl_led_state_t override_ = NL_LED_STATE_MODE_DEFAULT;
  uint32_t override_since_ms_ = 0;
  uint32_t last_render_ms_ = 0;
};
