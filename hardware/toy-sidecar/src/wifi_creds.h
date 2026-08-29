// WiFi STA 凭据：NVS 优先，编译期 local_config.h 回退。
// 密码不得打进 Serial，不得出现在上行 JSON。
#pragma once

#include <stddef.h>
#include <stdint.h>

bool wifi_creds_save(const char *ssid, const char *psk);
bool wifi_creds_load(char *ssid, size_t ssid_cap, char *psk, size_t psk_cap);
bool wifi_creds_configured();
// 每次成功写入后递增。WiFi 通道用它判断要不要按新凭据重连。
uint32_t wifi_creds_generation();
