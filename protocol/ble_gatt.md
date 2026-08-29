# BLE GATT —— App ↔ toy-sidecar

玩具侧 ESP32-S3 是 **Peripheral**，手机是 **Central**。中间没有别的板。

0.3.0 之前手机连的是 k10-controller，由它经 ESP-NOW 转发给玩具侧。K10 已删除，
GATT 服务整体挪到玩具侧，**UUID 一个都没改**——服务的逻辑身份没变，
换 UUID 只会白白牵动 App 与 Android 壳。

BLE 是默认通道。WiFi WebSocket 是备用通道，载荷完全相同，见 [`wifi_ws.md`](wifi_ws.md)。

载荷是 UTF-8 JSON，字段以 `schemas/ble_uplink.json` 与 `schemas/ble_downlink.json` 为准。

## Service 与 Characteristic

| 角色 | UUID | 属性 | 说明 |
|---|---|---|---|
| Service | `a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10` | — | Nascent 主服务 |
| Uplink | `a1b2c001-5f3e-4c8a-9b1d-0e7f2a6c9d10` | Notify | 遥测上行，12 Hz |
| Downlink | `a1b2c002-5f3e-4c8a-9b1d-0e7f2a6c9d10` | Write | 指令下行，事件驱动 |
| Info | `a1b2c003-5f3e-4c8a-9b1d-0e7f2a6c9d10` | Read | 协议版本、固件版本、会话令牌 |

广播名 `Nascent-Toy`。建议 MTU 协商到 ≥ 185，否则上行 JSON 需要分包。

Info 读出的会话令牌由玩具侧生成，TTL 为 `SESSION_TOKEN_TTL_MS`。
0.3.0 之前它由 K10 生成，现在生成方跟着 GATT 服务一起挪过来了。

## 上行（Notify，12 Hz）

见 `schemas/ble_uplink.json`。玩具侧把自己的 `nl_telemetry_t` 直接序列化成 JSON，
不再有中间板补字段。

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
  "mode": "free",
  "level": 3,
  "battery": null,
  "alert": "none"
}
```

- `insert_state` 是**固件推断结果**，不是医疗结论。App 对外文案用「是否在使用中」。
- `accel` / `gyro` 是瞬时值，只供 App 展示；入体推断已在固件完成，App 不得自行重算并据此开档。
- `level` 是玩具侧**实际生效**的档位，不是 App 请求的档位。两者不一致说明被安全总督降了。
- `battery` 恒为 `null`：demo 没有电量采样电路。

`joy_edge` 字段随 HW504 摇杆一起在 0.3.0 删除。摇杆是 K10 上的件，K10 没了它也没了。

## 下行（Write）

见 `schemas/ble_downlink.json`。一次 Write 一条指令。

```json
{ "cmd": "set_level", "level": 3, "pattern": "wave", "auth": "<session_token>" }
```

`cmd` 只允许 `stop | set_mode | set_level | set_pattern | set_led | set_wifi`。

枚举里还有第六个值 `resume`，但**它不是任何链路上的合法指令**。
固件的 `SafetyGovernor::onCommand` 已经不再识别这个值——解除闩锁只能由玩具侧
BOOT 键的处理函数直接调用 `clearLatch()`。写进来会被丢弃并置 `alert = "bad_cmd"`。
理由见下面「停机之后怎么恢复」。

`set_joystick` 随摇杆一起在 0.3.0 删除。

各指令读取的字段：

| cmd | 读取字段 |
|---|---|
| `stop` | 无 |
| `set_mode` | `mode` |
| `set_level` | `level`、可选 `pattern` |
| `set_pattern` | `pattern` |
| `set_led` | `led`（只含 state 语义，不接受逐帧灯效） |
| `set_wifi` | `wifi_ssid`、可选 `wifi_psk`。写入玩具 NVS，不驱动按键。密码不上行、不进云端、不打串口日志 |

### 固件侧的硬性拒绝规则

按顺序判定，任一命中即丢弃：

1. `auth` 缺失、格式错误或超过 `SESSION_TOKEN_TTL_MS` → 整包丢弃，不回错误（不给探测者反馈）。
2. `cmd` 不在枚举内，**或等于 `resume`** → 丢弃并置 `alert = "bad_cmd"`。
3. `level < LEVEL_MIN` 或 `level > LEVEL_MAX` → 丢弃并置 `alert = "bad_cmd"`。
   注意是**丢弃**，不是钳位后执行。
4. 急停或安全词生效期间，**只接受 `stop`**，其余全部丢弃（含 `set_wifi`）。
5. `set_wifi` 在闸门鉴权通过后写入玩具 NVS，**不进入 SafetyGovernor 调档**。
   SSID 为空/过长，或密码既非空也不是 8–63 位 → `bad_cmd`。密码不得打进串口。

`set_led` 永远不能覆盖安全灯：安全词白呼吸的 `priority` 是 100，模式层是 0。

## 断连与超时

- App 侧 Notify 超过 `LINK_TIMEOUT_MS` 未到 → 判定断连，UI 进入不可控状态，并停止发指令。
- 玩具侧 BLE 断连 → **归零并按关机时序断电**。手机是唯一的指令来源，
  连接一断就没有任何东西能再降档或停机，所以断连的默认行为必须是停下来。

这一条与 0.3.0 之前不同：那时 K10 断连不停机，因为 K10 上还有摇杆和屏幕可以本地控。
现在玩具侧唯一的本地入口是 BOOT 键，只能停不能开，所以断连不能保持输出。

## 停机之后怎么恢复

**不能远程恢复。** 闩锁一旦置上，解除的唯一途径是长按玩具侧的 BOOT 键
`BOOT_RESUME_HOLD_MS`（2 秒）。

这条限制是刻意的：远程解除意味着一个有 bug 或被接管的 App 能在用户喊停之后
让设备重新动起来，这是整个系统里最坏的失败模式。要求物理在场，
就把这种失败挡在了软件够不着的地方。

实现上这条不变量不靠"下游自觉过滤"：`resume` 根本不在固件的指令分发里，
`clearLatch()` 只有 BOOT 键的处理函数会调。传输层就算被攻破也合成不出一次恢复。
