// 上行 JSON 组装 —— BleUplink，见 protocol/schemas/ble_uplink.json。
//
// BLE 与 WiFi WebSocket 承载的是同一份载荷，所以序列化只写一遍、
// 由 main.cpp 调一次，再把缓冲交给当前那条传输。让每个传输各自拼一遍
// 迟早会拼歪，而这条链路上跑着停机状态。
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "nascent_protocol.h"

// 返回写入的字节数。缓冲建议 ≥ 384 字节。
size_t nl_build_uplink(char *buf, size_t cap, const nl_telemetry_t &t, nl_mode_t mode,
                       nl_alert_t alert, uint32_t now_ms);
