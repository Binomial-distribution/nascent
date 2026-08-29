#include "led_ws2812.h"

#include <Adafruit_NeoPixel.h>
#include <Arduino.h>

#include "config.h"

namespace {

Adafruit_NeoPixel g_strip(NL_LED_COUNT, PIN_WS2812B, NEO_GRB + NEO_KHZ800);

constexpr uint32_t kFrameMs = 33;  // 30fps 足够，再高只是白烧 CPU
constexpr uint32_t kComfortHoldMs = 3000;

const nl_led_row_t *findMode(nl_mode_t mode) {
  for (const auto &row : NL_LED_MODE_TABLE) {
    if (row.key == static_cast<uint8_t>(mode)) return &row;
  }
  return &NL_LED_MODE_TABLE[0];
}

const nl_led_row_t *findOverride(nl_led_state_t state) {
  for (const auto &row : NL_LED_OVERRIDE_TABLE) {
    if (row.key == static_cast<uint8_t>(state)) return &row;
  }
  return nullptr;
}

// 三角波呼吸：比 sin 便宜，且在低亮度段比正弦更线性，观感更"匀"。
uint8_t breatheScale(uint32_t now_ms, uint32_t period_ms) {
  uint32_t t = now_ms % period_ms;
  uint32_t half = period_ms / 2;
  uint32_t up = t < half ? t : period_ms - t;
  return static_cast<uint8_t>(up * 255 / half);
}

inline uint8_t scale8(uint8_t v, uint8_t s) {
  return static_cast<uint8_t>((static_cast<uint16_t>(v) * s) >> 8);
}

void fillWhite(uint8_t v) {
  uint32_t c = Adafruit_NeoPixel::Color(v, v, v);
  for (uint16_t i = 0; i < NL_LED_COUNT; ++i) g_strip.setPixelColor(i, c);
}

void fillAll(const nl_led_row_t *row, uint8_t s) {
  uint32_t c = Adafruit_NeoPixel::Color(scale8(row->r, s), scale8(row->g, s), scale8(row->b, s));
  for (uint16_t i = 0; i < NL_LED_COUNT; ++i) g_strip.setPixelColor(i, c);
}

}  // namespace

void LedRing::begin() {
  // begin() 会去申请 RMT 通道，失败时后面所有 show() 都是空操作，
  // 灯不亮会被误判成"设备没反应"，所以这里必须留下痕迹。
  if (!g_strip.begin()) Serial.println("[led] NeoPixel begin 失败，灯环不可用");
  g_strip.setBrightness(255);
  g_strip.clear();
  g_strip.show();
}

void LedRing::selfTestAfterRadio() {
  // 不在这里 gpio_reset_pin：RMT 已经占着 GPIO6，重置会把通道打掉。
  // 全白、最高亮度、停 2.5 秒，看不清才是线没接对。
  g_strip.setBrightness(255);
  fillWhite(255);
  g_strip.show();
  Serial.printf("[led] 自检：GPIO%u 8 颗全白 %d ms，请看灯环\n", PIN_WS2812B,
                LED_BOOT_SELFTEST_MS);
  delay(LED_BOOT_SELFTEST_MS);
  hold_until_ms_ = millis() + LED_BOOT_HOLD_MS;
  Serial.printf("[led] 全白再保持 %d ms，随后档位 0 会灭灯\n", LED_BOOT_HOLD_MS);
}

void LedRing::flashCommandAck() {
  ack_until_ms_ = millis() + 500;
}

void LedRing::setMode(nl_mode_t mode) { mode_ = mode; }

void LedRing::setLevel(uint8_t level) { level_ = level; }

void LedRing::setOverride(nl_led_state_t state) {
  if (state == override_) return;
  override_ = state;
  override_since_ms_ = millis();
}

void LedRing::render(uint32_t now_ms) {
  if (now_ms - last_render_ms_ < kFrameMs) return;
  last_render_ms_ = now_ms;

  if (now_ms < ack_until_ms_ || now_ms < hold_until_ms_) {
    g_strip.setBrightness(255);
    fillWhite(255);
    g_strip.show();
    return;
  }

  g_strip.setBrightness(LED_BRIGHTNESS);
  if (!applyOverrideLayer(now_ms)) applyModeLayer(now_ms);
  g_strip.show();
}

void LedRing::renderSafewordNow() {
  const nl_led_row_t *row = findOverride(NL_LED_STATE_SAFEWORD);
  if (row) fillAll(row, 255);
  g_strip.show();
  override_ = NL_LED_STATE_SAFEWORD;
  override_since_ms_ = millis();
}

bool LedRing::applyOverrideLayer(uint32_t now_ms) {
  if (override_ == NL_LED_STATE_MODE_DEFAULT) return false;

  const nl_led_row_t *row = findOverride(override_);
  if (!row) return false;

  uint32_t elapsed = now_ms - override_since_ms_;

  switch (override_) {
    case NL_LED_STATE_SAFEWORD:
      // 缓慢白呼吸，与电机停止同步。这一层没有超时，只能被显式解除。
      fillAll(row, static_cast<uint8_t>(60 + breatheScale(now_ms, 4000) / 2));
      return true;

    case NL_LED_STATE_WARMING:
      fillAll(row, static_cast<uint8_t>(40 + breatheScale(now_ms, 2600) * 3 / 4));
      return true;

    case NL_LED_STATE_COMFORT_REACHED:
      // 暖绿常亮 3 秒后自己让位给模式灯。
      if (elapsed >= kComfortHoldMs) {
        override_ = NL_LED_STATE_MODE_DEFAULT;
        return false;
      }
      fillAll(row, 255);
      return true;

    case NL_LED_STATE_CLEANING:
      fillAll(row, (now_ms / 900) % 2 ? 0 : 255);
      return true;

    case NL_LED_STATE_LOW_BATTERY: {
      // 快闪 3 次然后让位，避免长期占用灯环遮住模式信息。
      uint32_t cycle = elapsed / 200;
      if (cycle >= 6) {
        override_ = NL_LED_STATE_MODE_DEFAULT;
        return false;
      }
      fillAll(row, cycle % 2 ? 0 : 255);
      return true;
    }

    default:
      return false;
  }
}

void LedRing::applyModeLayer(uint32_t now_ms) {
  g_strip.clear();

  const nl_led_row_t *mode_row = findMode(mode_);
  const nl_level_row_t *lv = nl_level_row(level_);
  uint8_t lit = lv ? lv->lit : 0;

  switch (mode_) {
    case NL_MODE_FREE: {
      // 手动：档位渐变色的静态颗数，从暖粉到暖红。
      if (!lv) break;
      uint32_t c = Adafruit_NeoPixel::Color(lv->r, lv->g, lv->b);
      for (uint8_t i = 0; i < lit && i < NL_LED_COUNT; ++i) g_strip.setPixelColor(i, c);
      break;
    }

    case NL_MODE_SCENARIO: {
      // 情景：雾灰紫整体呼吸，颗数仍然表达档位。
      uint8_t s = static_cast<uint8_t>(70 + breatheScale(now_ms, 3400) * 2 / 3);
      uint32_t c = Adafruit_NeoPixel::Color(scale8(mode_row->r, s), scale8(mode_row->g, s),
                                            scale8(mode_row->b, s));
      for (uint8_t i = 0; i < lit && i < NL_LED_COUNT; ++i) g_strip.setPixelColor(i, c);
      break;
    }

    case NL_MODE_WILD: {
      // 失控：八颗全亮红色流光。这里不看档位颗数，红色本身就是警示。
      uint32_t head = (now_ms / 90) % NL_LED_COUNT;
      for (uint16_t i = 0; i < NL_LED_COUNT; ++i) {
        uint8_t dist = static_cast<uint8_t>((NL_LED_COUNT + head - i) % NL_LED_COUNT);
        uint8_t s = dist == 0 ? 255 : static_cast<uint8_t>(200 >> dist);
        if (s < 40) s = 40;
        g_strip.setPixelColor(i, Adafruit_NeoPixel::Color(scale8(mode_row->r, s),
                                                          scale8(mode_row->g, s),
                                                          scale8(mode_row->b, s)));
      }
      break;
    }

    default:
      break;
  }
}
