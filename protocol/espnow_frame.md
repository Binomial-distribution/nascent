# ESP-NOW 板间帧 —— k10-controller ↔ toy-sidecar

两块板之间不走 BLE，走 ESP-NOW：省一条 BLE 连接、延迟更低、断网可用。
载荷是**定长 packed struct**，结构体定义由 `generated/nascent_protocol.h` 生成，
不要手写字节偏移。

单帧上限 250 字节，生成器会 `static_assert` 每个帧都在限内。

## 帧头 `nl_wire_header_t`（8 字节）

| 字段 | 类型 | 说明 |
|---|---|---|
| `magic` | `uint16_t` | 固定 `NL_PROTO_MAGIC`，非本协议直接丢 |
| `version_major` | `uint8_t` | 与本机不同直接丢 |
| `version_minor` | `uint8_t` | 只记录，不影响接收 |
| `frame_type` | `uint8_t` | `nl_frame_type_t` |
| `seq` | `uint16_t` | 发送方自增，用于 ACK 与去重 |
| `reserved` | `uint8_t` | 补零 |

收包第一件事永远是 `nl_wire_header_valid()`。

## 帧类型

| 类型 | 方向 | 触发 | 大小 |
|---|---|---|---|
| `pair` | 双向 | 上电、链路重建 | 8 B |
| `ack` | toy → K10 | 收到 `command` | 12 B |
| `heartbeat` | 双向 | 每 500 ms | 8 B |
| `telemetry` | toy → K10 | 12 Hz | 42 B |
| `command` | K10 → toy | 事件驱动 + 心跳重发 | 18 B |

### `telemetry`

传感器原始量与固件推断结果。约定：

- `env_temp_c_x10` / `env_humidity_x10` 来自 DHT11，最快 1 Hz；两次采样之间保持上一次的值，
  并用 `flags` 的 `dht_valid` 位标注是否新鲜。**不得用于过温熔断。**
- `temp_a_c_x100` / `temp_b_c_x100` 是量产接触 NTC 的占位，**demo 阶段恒为 `NL_SENTINEL_I16`**。
- `press_l` / `press_r` 是 FSR402 原始 ADC（0–4095），不做单位换算，标定留给上层。
- `press_rhythm_mhz` 是 1–2 Hz 带通后的节律估计，单位 mHz。
- `insert_state` 由玩具侧 1 Hz 决策后给出，K10 不重算。
- `flags`：`bit0 still`、`bit1 dht_valid`、`bit2 imu_valid`、`bit3 estop`。

### `command`

K10 下发的执行意图。`level` 在**发送前**已经过 `nl_clamp_level()`，
但玩具侧收到后**必须再钳一次**——不信任来自链路的任何数值是这层的基本假设。

`flags`：`bit0 joystick_enabled`、`bit1 hold_ramp`。

### `ack`

`accepted = 0` 时 `reason` 给出 `nl_alert_t`，K10 据此点亮 UI 提示并写日志。

## 可靠性与降级

ESP-NOW 本身不保证送达，所以：

- **`command` 需要 ACK。** 未收到 ACK 则以 100 ms 间隔重发，最多 3 次。
  `seq` 用于玩具侧去重，重复的 `seq` 只 ACK 不重复执行。
- **`telemetry` 不需要 ACK。** 丢了就丢了，下一帧 83 ms 后就到。
- **心跳 500 ms。** 任一侧超过 `NL_LINK_TIMEOUT_MS`（1500 ms）没收到对端任何帧，判定链路断开：
  - K10：上行 `alert = "link_lost"`，屏幕提示，停止转发指令。
  - 玩具侧：**立即执行 stop 语义**——通过 AO3400A 发关机按键时序，LED 转安全态。
    这是断链默认行为，不需要任何一端在线确认。

## 配对

demo 阶段用固定 MAC 白名单，不做动态配对：两块板的 MAC 写在各自的 `include/config.h` 里。
上电互发 `pair` 直到收到对端 `pair` 或 `heartbeat`，期间 K10 屏幕显示未连接。

理由：验证期只有两块板，动态配对带来的攻击面和调试成本都不划算。量产另行设计。
