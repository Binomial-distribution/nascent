# BLE GATT —— App ↔ k10-controller

K10 是 **Peripheral**，手机是 **Central**。玩具侧 ESP32 不直连手机。

载荷是 UTF-8 JSON，字段以 `schemas/ble_uplink.json` 与 `schemas/ble_downlink.json` 为准。

## Service 与 Characteristic

| 角色 | UUID | 属性 | 说明 |
|---|---|---|---|
| Service | `a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10` | — | Nascent 主服务 |
| Uplink | `a1b2c001-5f3e-4c8a-9b1d-0e7f2a6c9d10` | Notify | 遥测上行，12 Hz |
| Downlink | `a1b2c002-5f3e-4c8a-9b1d-0e7f2a6c9d10` | Write | 指令下行，事件驱动 |
| Info | `a1b2c003-5f3e-4c8a-9b1d-0e7f2a6c9d10` | Read | 协议版本、固件版本、板间链路状态 |

广播名 `Nascent-K10`。建议 MTU 协商到 ≥ 185，否则上行 JSON 需要分包。

## 上行（Notify，12 Hz）

见 `schemas/ble_uplink.json`。K10 把玩具侧的 ESP-NOW 遥测转成 JSON 后转发，
并补上只有 K10 才知道的字段（`joy_edge`、`mode`、`level`、`battery`）。

```json
{
  "ts": 12345,
  "temp_a": null,
  "temp_b": null,
  "env_temp": 26.4,
  "env_humidity": 55.2,
  "press_l": 412,
  "press_r": 398,
  "accel": [0.0, 0.0, 1.0],
  "gyro": [0.0, 0.0, 0.0],
  "insert_state": "unknown",
  "joy_edge": "none",
  "mode": "free",
  "level": 3,
  "battery": 86,
  "alert": "none"
}
```

- `joy_edge` 在该 12 Hz 窗内最多一次边沿。
- `insert_state` 是**固件推断结果**，不是医疗结论。App 对外文案用「是否在使用中」。
- `accel` / `gyro` 是瞬时值，只供 App 展示；入体推断已在固件完成，App 不得自行重算并据此开档。
- 板间链路断开时 `alert = "link_lost"`，此时传感器字段为上一帧的保留值，App 应停止据其决策。

## 下行（Write）

见 `schemas/ble_downlink.json`。一次 Write 一条指令。

```json
{ "cmd": "set_level", "level": 3, "pattern": "wave", "auth": "<session_token>" }
```

`cmd` 只允许 `stop | set_mode | set_level | set_pattern | set_led | set_joystick`。

枚举里还有第七个值 `resume`，但**它不是这条链路上的合法指令**。
`resume` 只由 K10 上的物理双键确认产生，用于解除安全词闩锁；
App 写进来会被无条件拒绝并置 `alert = "bad_cmd"`。
理由见下面「断连与超时」一节。

各指令读取的字段：

| cmd | 读取字段 |
|---|---|
| `stop` | 无 |
| `set_mode` | `mode` |
| `set_level` | `level`、可选 `pattern` |
| `set_pattern` | `pattern` |
| `set_led` | `led`（只含 state 语义，不接受逐帧灯效） |
| `set_joystick` | `enabled`、`hold_ramp` |

### 固件侧的硬性拒绝规则

按顺序判定，任一命中即丢弃：

1. `auth` 缺失、格式错误或超过 `SESSION_TOKEN_TTL_MS` → 整包丢弃，不回错误（不给探测者反馈）。
2. `cmd` 不在枚举内 → 丢弃并置 `alert = "bad_cmd"`。
3. `level < LEVEL_MIN` 或 `level > LEVEL_MAX` → 丢弃并置 `alert = "bad_cmd"`。
   注意是**丢弃**，不是钳位后执行；钳位只用于本地摇杆等可信来源。
4. 急停或安全词生效期间，**只接受 `stop`**，其余全部丢弃。

`set_led` 永远不能覆盖安全灯：安全词白呼吸的 `priority` 是 100，模式层是 0。

## 断连与超时

- App 侧 Notify 超过 `LINK_TIMEOUT_MS` 未到 → 判定断连，UI 进入不可控状态，并停止发指令。
- K10 侧 BLE 断连 → 不停机，但把模式降到 `free` 并保持当前档位；本地摇杆与屏幕仍可用。
  停机只由安全词、急停拉环、过温熔断触发，这三条不依赖 App 与网络。

## 停机之后怎么恢复

**不能远程恢复。** 闩锁一旦置上，解除的唯一途径是在 K10 上同时长按板载 A、B 两键两秒，
K10 才会向玩具侧发出 `resume`。

这条限制是刻意的：远程解除意味着一个有 bug 或被接管的 App 能在用户喊停之后
让设备重新动起来，这是整个系统里最坏的失败模式。要求物理在场，
就把这种失败挡在了软件够不着的地方。
