// k10-controller 板级配置。
#pragma once

#include <stdint.h>

// ---------------------------------------------------------------------------
// HW504 摇杆接在金手指上。
//
// 选脚有个坑：官方 variants/unihiker_k10/pins_arduino.h 里
//   P1  = GPIO2 而 P11 = GPIO2（KeyB）
//   P2  = GPIO3 而 P12 = GPIO3
// 同一个 GPIO 被两个丝印名占用。为了不踩这个别名，这里避开 P1/P2，
// 只用 P0 / P8 / P9 —— 三者都是 ADC1 通道，且不与板载外设复用。
//
//   P0 = GPIO1 = ADC1_CH0
//   P8 = GPIO8 = ADC1_CH7
//   P9 = GPIO9 = ADC1_CH8
//
// 换脚之前先对着实物丝印确认，别信任何二手接线图。
// ---------------------------------------------------------------------------
#define PIN_JOY_VRX      1   // P0
#define PIN_JOY_VRY      8   // P8
#define PIN_JOY_SW       9   // P9，按下拉低，需 INPUT_PULLUP

// 摇杆装配方向。若上推读数变小，把这个改成 1，不要去改状态机。
#define JOY_INVERT_Y     0

// 12 位 ADC 的理论中点。上电时会实测一次并覆盖它，
// 这里的值只用于实测失败时兜底。
#define JOY_CENTER_NOMINAL 2048

// ---------------------------------------------------------------------------
// 对端 MAC：验证期固定白名单。
// 烧录前用 toy-sidecar 串口打印的 MAC 替换。
// ---------------------------------------------------------------------------
static const uint8_t PEER_MAC_TOY[6] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00};

#define ESPNOW_CHANNEL   1

// ---------------------------------------------------------------------------
// 屏
// ---------------------------------------------------------------------------
#define SCREEN_DIR       2
#define SCREEN_REFRESH_MS 250   // 屏刷得比 12Hz 慢，省 CPU 也不闪

#define COLOR_BG         0x000000
#define COLOR_TEXT       0xFFFFFF
#define COLOR_WARN       0xFFB000
#define COLOR_STOP       0xFFFFFF
#define COLOR_OK         0x38C172
