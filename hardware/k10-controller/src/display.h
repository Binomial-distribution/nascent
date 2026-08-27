// K10 屏显。
//
// 屏幕是给旁观者也能看懂的状态面板，措辞上有两条硬性要求：
//   - 入体推断一律说「在使用中 / 未在使用 / 不确定」，绝不出现医疗化表述。
//   - 停机状态必须一眼可辨，且优先于其它一切信息。
//
// 底层用 DFRobot 官方 unihiker_k10 库（随平台提供），
// 这里只组织信息层级，不自己画像素。API 用法参见 reference/ 下的官方示例。
#pragma once

#include <stdint.h>

#include "nascent_protocol.h"

struct DisplayState {
  bool stopped;
  bool link_up;
  bool ble_connected;
  nl_mode_t mode;
  uint8_t level;
  nl_insert_state_t insert;
  nl_alert_t alert;
  int16_t env_temp_c_x10;  // NL_SENTINEL_I16 表示无效
  int16_t env_humidity_x10;
  uint32_t rejected;
};

class Display {
 public:
  void begin();

  // 每轮主循环调用，内部按 SCREEN_REFRESH_MS 节流。
  void render(const DisplayState &s, uint32_t now_ms);

  // 停机路径专用：立刻整屏刷成停机画面，不等下一次节流窗口。
  void renderStoppedNow();

 private:
  uint32_t last_ms_ = 0;
};
