// 仅用于宿主机检查的 Arduino 桩，不属于固件。
#pragma once

#include <cstdint>

typedef int portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(m) \
  do {                        \
    (void)(m);                \
  } while (0)
#define portEXIT_CRITICAL(m) \
  do {                       \
    (void)(m);               \
  } while (0)
