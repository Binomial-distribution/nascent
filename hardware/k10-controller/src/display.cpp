#include "display.h"

#include <Arduino.h>
#include <stdio.h>
#include <unihiker_k10.h>

#include "config.h"

// 这个实例被 main.cpp 复用（板载按键、加速度都挂在它上面），
// 所以定义在这里、由 display 负责 begin。
UNIHIKER_K10 k10;

namespace {

const char *modeText(nl_mode_t m) {
  switch (m) {
    case NL_MODE_FREE: return "手动";
    case NL_MODE_SCENARIO: return "情景";
    case NL_MODE_WILD: return "失控";
    default: return "?";
  }
}

// 措辞是产品红线：这里不出现任何医疗或解剖学表述。
const char *insertText(nl_insert_state_t s) {
  switch (s) {
    case NL_INSERT_STATE_INSERTED: return "在使用中";
    case NL_INSERT_STATE_NOT_INSERTED: return "未在使用";
    default: return "不确定";
  }
}

const char *alertText(nl_alert_t a) {
  switch (a) {
    case NL_ALERT_NONE: return "";
    case NL_ALERT_OVER_TEMP: return "温度告警";
    case NL_ALERT_LOW_BATTERY: return "电量低";
    case NL_ALERT_SAFEWORD: return "安全词";
    case NL_ALERT_ESTOP: return "急停";
    case NL_ALERT_BAD_CMD: return "非法指令";
    case NL_ALERT_LINK_LOST: return "板间断链";
    default: return "";
  }
}

}  // namespace

void Display::begin() {
  k10.begin();
  k10.initScreen(SCREEN_DIR);
  k10.creatCanvas();
  k10.setScreenBackground(COLOR_BG);
  k10.canvas->canvasText("Nascent", 1, COLOR_TEXT);
  k10.canvas->canvasText("初始化中…", 3, COLOR_TEXT);
  k10.canvas->updateCanvas();
}

void Display::renderStoppedNow() {
  k10.canvas->canvasClear();
  k10.canvas->canvasText("已停止", 2, COLOR_STOP);
  k10.canvas->canvasText("需在 App 上确认后才能恢复", 4, COLOR_TEXT);
  k10.canvas->updateCanvas();
  last_ms_ = millis();
}

void Display::render(const DisplayState &s, uint32_t now_ms) {
  if (now_ms - last_ms_ < SCREEN_REFRESH_MS) return;
  last_ms_ = now_ms;

  // 停机压过一切，其它信息这时都不重要。
  if (s.stopped) {
    renderStoppedNow();
    return;
  }

  char line[64];
  k10.canvas->canvasClear();

  snprintf(line, sizeof(line), "%s  档位 %u/%u", modeText(s.mode), s.level, NL_LEVEL_MAX);
  k10.canvas->canvasText(line, 1, s.mode == NL_MODE_WILD ? COLOR_WARN : COLOR_TEXT);

  k10.canvas->canvasText(insertText(s.insert), 2,
                         s.insert == NL_INSERT_STATE_UNKNOWN ? COLOR_WARN : COLOR_TEXT);

  snprintf(line, sizeof(line), "玩具 %s   App %s", s.link_up ? "已连接" : "断开",
           s.ble_connected ? "已连接" : "未连接");
  k10.canvas->canvasText(line, 3, (s.link_up && s.ble_connected) ? COLOR_OK : COLOR_WARN);

  if (s.env_temp_c_x10 != NL_SENTINEL_I16) {
    snprintf(line, sizeof(line), "环境 %.1f℃  %.0f%%", s.env_temp_c_x10 / 10.0f,
             s.env_humidity_x10 / 10.0f);
  } else {
    snprintf(line, sizeof(line), "环境 —");
  }
  k10.canvas->canvasText(line, 4, COLOR_TEXT);

  const char *al = alertText(s.alert);
  if (al[0] != '\0') {
    k10.canvas->canvasText(al, 5, COLOR_WARN);
  } else if (s.rejected > 0) {
    snprintf(line, sizeof(line), "已拒绝 %lu 条指令", static_cast<unsigned long>(s.rejected));
    k10.canvas->canvasText(line, 5, COLOR_WARN);
  }

  k10.canvas->updateCanvas();
}
