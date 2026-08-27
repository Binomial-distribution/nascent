// HW504 摇杆 —— 回中式换档。
//
// 「回中式」的意思是：推一次只算一档，手必须回到中位才能再算下一档。
// 这样在黑暗里凭手感操作不会一推就冲到顶。想连续加档就一直推着，
// 超过 JOY_HOLD_RAMP_MS 之后按固定节奏续档，节奏不会随推的力度变快。
//
// 时间常数全部来自 contract.yaml，不在这里另定。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"

class Joystick {
 public:
  // 上电时实测中位。手别碰摇杆，否则中位会标定歪。
  void begin(uint8_t pin_x, uint8_t pin_y, uint8_t pin_sw);

  void tick(uint32_t now_ms);

  // 取走本轮产生的换档边沿，取完即清。一个 12Hz 窗内最多一次。
  nl_joy_edge_t takeEdge();

  // 短按：在手动与情景之间切换。失控模式只能由 App 开，摇杆开不了。
  bool takeShortPress();
  // 长按：停机。等价于安全词。
  bool takeLongPress();

  int16_t raw_y() const { return raw_y_; }
  int16_t center() const { return center_y_; }

 private:
  enum class Zone : uint8_t { kCenter, kUp, kDown };

  Zone classify(int16_t v) const;

  uint8_t pin_x_ = 0, pin_y_ = 0, pin_sw_ = 0;

  int16_t center_y_ = JOY_CENTER_NOMINAL_FALLBACK;
  int16_t raw_y_ = 0;

  Zone zone_ = Zone::kCenter;
  uint32_t zone_since_ms_ = 0;
  bool edge_emitted_ = false;   // 本次偏转是否已经出过那一下离散边沿
  uint32_t last_emit_ms_ = 0;

  nl_joy_edge_t pending_edge_ = NL_JOY_EDGE_NONE;

  bool sw_down_ = false;
  uint32_t sw_since_ms_ = 0;
  bool long_fired_ = false;
  bool pending_short_ = false;
  bool pending_long_ = false;

  // config.h 里的值通过构造期赋值传进来，这里给个编译期兜底
  static constexpr int16_t JOY_CENTER_NOMINAL_FALLBACK = 2048;
};
