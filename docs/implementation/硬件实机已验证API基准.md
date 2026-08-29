# 硬件实机已验证 API 基准

> 状态：验证期基准，2026-08-29 更新。以后修改产品页、Android 壳、设备协议或
> toy-sidecar 固件时，先对照本文；不能用一条“看起来更高级”的新接口替换已经在
> “我的 → 硬件调试”中成功的实机链路，除非新接口重新完成同样的真机验收。

## 1. 适用范围

本文记录 `software/app/`、Android 原生 BLE 桥与 toy-sidecar 之间的设备 API。
它不是云端 HTTP API，也不是产品文案规范。协议字段的最终事实来源仍是
[`protocol/contract.yaml`](../../protocol/contract.yaml)；本文记录的是哪些调用路径已经
在当前硬件上跑通，以及产品页面应怎样复用它们。

当前链路：

```text
产品页 / 硬件调试页
        ↓ 只调用 session API
Governor → sendCommand() → TransportClient
        ↓                       ↓
   安全拒绝规则          Android BleBridge / Web Bluetooth / WiFi WS
                                ↓
                         Nascent-Toy toy-sidecar
                                ↓
                       AO3400 模拟原机 GPIO7 按键
```

## 2. 不允许破坏的规则

1. 页面只能调用 [`software/app/js/session.js`](../../software/app/js/session.js) 导出的
   API，不得直接调用 `NascentNative.send()`、写 GATT Characteristic 或写 WebSocket。
2. 所有设备指令都必须经过 `sendCommand()` 和 `Governor`。硬件调试页也不能绕过。
3. 产品页和硬件调试页执行同一个物理动作时，必须复用同一个 helper 和同一条命令。
4. `auth` 由连接层写入当前会话令牌。页面构造 `BleDownlink` 时传空字符串即可，
   不得读取、展示、保存或打印真实令牌。
5. 原机只有一个电源键，长按是**开关状态取反**，不是独立的“开机”和“关机”指令。
6. `stop` 是安全停机；停止后只能在玩具侧长按 BOOT 两秒恢复。任何 App API 都不能恢复。
7. 断连后实时 Uplink 必须清空，不能继续显示旧的温度、贴合、档位或连接状态。

## 3. Web UI 内部公开 API

导入：

```js
import {
  connectDevice,
  disconnectDevice,
  getConnected,
  getConnectionState,
  getUplink,
  sendCommand,
  subscribe,
} from "./session.js";
```

| API | 返回值 | 用途 |
|---|---|---|
| `connectDevice()` | `Promise<void>` | 启动当前通道的权限、扫描和连接流程 |
| `disconnectDevice()` | `Promise<void>` | 主动断开设备 |
| `getConnected()` | `boolean` | 当前是否完成设备会话 |
| `getConnectionState()` | `{ phase, message }` | 当前连接阶段；产品页只显示友好状态，原始消息只进硬件调试页 |
| `getUplink()` | `BleUplink \| null` | 最近一帧真实遥测；断连为 `null` |
| `subscribe(fn)` | 取消订阅函数 | 订阅 `connected`、`uplink`、`connectionState` |
| `sendCommand(cmd, options?)` | `Promise<string \| null>` | 唯一下行入口；`null` 表示已交给传输层，字符串表示拒绝/发送失败 |

`sendCommand()` 返回 `null` 只表示命令已经通过 App 安全检查并交给设备链路，不能单凭
这个返回值宣称电机、灯光或原机按键已经产生物理动作。物理结果必须结合 Uplink、串口或
现场观察确认。

## 4. 已验证连接流程

### 4.1 BLE 标识

| 项目 | 值 |
|---|---|
| 广播名 | `Nascent-Toy` |
| Service | `a1b2c000-5f3e-4c8a-9b1d-0e7f2a6c9d10` |
| Uplink Notify | `a1b2c001-5f3e-4c8a-9b1d-0e7f2a6c9d10` |
| Downlink Write | `a1b2c002-5f3e-4c8a-9b1d-0e7f2a6c9d10` |
| Info Read | `a1b2c003-5f3e-4c8a-9b1d-0e7f2a6c9d10` |

### 4.2 Android GATT 顺序

下面的顺序已经在安卓真机跑通，不能并发改写为多条同时进行的 GATT 操作：

```text
权限 → 过滤扫描 → connectGatt
     → requestMtu（实测 517）
     → discoverServices
     → 写 Uplink CCCD
     → 读 Info / 取得会话令牌
     → ready
```

2026-08-29 真机日志的成功序列为：扫描命中、`status=0` 连接、MTU 517、服务发现
`status=0`、CCCD 写入 `status=0`、`GATT ready`。日志不得包含 MAC、令牌或 WiFi 密码。

连接阶段枚举：

```text
idle | permission | scanning | connecting | initializing | ready | error
```

## 5. 实机成功的原按键 API

### 5.1 开机 / 关机：同一个长按取反

JSON 线格式：

```json
{
  "cmd": "press_key",
  "key": "hold",
  "auth": "<session_token>"
}
```

页面调用：

```js
await sendCommand(new BleDownlink({
  cmd: NlCmd.PRESS_KEY,
  key: NlKeyPress.HOLD,
  auth: "",
}));
```

固件动作：GPIO7 输出高电平约 1.2 秒，再恢复低电平。原机根据之前状态在开机和关机之间
取反。因此：

- “自我控制 → 开启”；
- “自我控制 → 关闭”；
- “硬件调试 → 开机”；
- “硬件调试 → 关机”；

必须调用 [`toggleOriginalPower()`](../../software/app/js/app.js)，不能分别实现。

不要把 `set_level(1)` 当作这条已验证长按的等价替代。此前产品页只发 `set_level(1)`，
页面提示成功但实机没有执行与硬件调试页相同的长按，已经造成“点击开启没反应”。

### 5.2 调档：原机短按

JSON 线格式：

```json
{
  "cmd": "press_key",
  "key": "tap",
  "auth": "<session_token>"
}
```

页面调用：

```js
await sendCommand(new BleDownlink({
  cmd: NlCmd.PRESS_KEY,
  key: NlKeyPress.TAP,
  auth: "",
}));
```

固件动作：GPIO7 输出高电平约 120ms，再恢复低电平。只在原机已经开机后使用；关机时
短按不会开机。原机档位是循环/递进式实体按键，未经状态同步时不得由页面盲发多次短按。

### 5.3 当前产品映射

| 用户动作 | 必须调用 | 备注 |
|---|---|---|
| 自我控制“开启” | `toggleOriginalPower()` → `press_key/hold` | 与硬件调试开机完全同路 |
| 自我控制“关闭” | `toggleOriginalPower()` → `press_key/hold` | 原机电源取反 |
| 硬件调试开机/关机 | 同上 | 允许显示 GPIO 和时序细节 |
| 硬件调试点按调档 | `press_key/tap` | 实机原按键基准 |
| 红色“停止” | `stop` | 不是普通关闭 |
| 产品档位滑杆 | `set_level` 目标接口 | 当前必须单独做固件回归，不能拿它证明原按键已成功 |

## 6. 安全停机 API

```json
{
  "cmd": "stop",
  "auth": "<session_token>"
}
```

```js
await sendCommand(new BleDownlink({ cmd: NlCmd.STOP, auth: "" }));
```

`stop` 在 App Governor 中永远允许，并在固件侧设置闩锁、清零请求档位、执行关机时序、
显示安全灯。以下接口不存在：

```text
resume()
clearStop()
remoteUnlock()
```

协议枚举中的 `resume` 只用于明确拒绝。真正恢复只能在玩具侧长按 BOOT 两秒。

## 7. 灯光和模式 API

模式：

```json
{ "cmd": "set_mode", "mode": "free", "auth": "<session_token>" }
```

`mode` 可为 `free | scenario | wild`。切换模式会经过 Governor；进入 `wild` 的产品入口必须
保留二次确认和 15 分钟自动退出。

灯语覆盖：

```json
{ "cmd": "set_led", "led": "warming", "auth": "<session_token>" }
```

`led` 可为：

```text
mode_default | warming | comfort_reached | cleaning | low_battery | safeword
```

普通页面不得伪造 `safeword`。安全词白灯由固件安全状态决定，优先级最高，普通覆盖不能
压过它。灯光页面显示变化不能作为 GPIO6/灯环已经成功的唯一证据，验收仍需现场观察。

## 8. Uplink 遥测 API

示例：

```json
{
  "ts": 12345,
  "temp_a": null,
  "temp_b": null,
  "env_temp": 26.4,
  "env_humidity": 55.2,
  "press_l": 412,
  "press_r": 0,
  "accel": [0.0, 0.0, 1.0],
  "gyro": [0.0, 0.0, 0.0],
  "insert_state": "unknown",
  "mode": "free",
  "level": 0,
  "battery": null,
  "alert": "none"
}
```

| 字段 | 当前硬件含义 | 禁止误用 |
|---|---|---|
| `env_temp` / `env_humidity` | DHT11 环境读数，最快 1Hz | 不能当接触面温度或过温熔断 |
| `press_l` / `press_r` | FSR 原始 ADC；demo 右路可能未接 | 不能直接判断高潮或直接调档 |
| `accel` / `gyro` | MPU6050 体动读数 | 不能绕过固件融合结论 |
| `insert_state` | 固件融合后的“是否在使用中” | 不是医疗结论 |
| `level` | SafetyGovernor 当前生效目标 | 原始 `press_key` 动作后不一定等于原机真实机械档位 |
| `battery` | demo 恒为 `null` | 不得在产品页伪造 100% |
| `alert` | 当前设备告警 | `safeword/estop` 时只允许继续发送 `stop` |

传感器已经有读数只证明 Uplink 成功，不证明 Downlink、GPIO7、GPIO6 或原机电机成功。
调试时必须把“数据上行”和“物理控制下行”分开验收。

## 9. 当前验证状态

| 能力 | 状态 | 证据/基准 |
|---|---|---|
| Android BLE 扫描与连接 | 已验证 | 真机完整到 `GATT ready` |
| MTU、服务发现、CCCD、Info 令牌 | 已验证 | MTU 517，全部 `status=0` |
| DHT11 / FSR / MPU6050 上行 | 已在硬件调试页看到读数 | 继续按 Uplink 字段分别回归 |
| GPIO7 长按开关机 | 已验证基准 | `press_key/hold`，约 1.2s |
| GPIO7 点按调档 | 已验证基准 | `press_key/tap`，约 120ms |
| 产品页开启/关闭 | 已统一到基准 | 与硬件调试复用 `toggleOriginalPower()` |
| `set_level(1..9)` 目标档位 | 尚不能替代原按键基准 | 必须重新刷入对应固件并逐档实测 |
| 灯语覆盖 | 保留调试接口 | 必须现场观察灯环，不以 UI 变化代替 |
| 远程恢复 | 明确禁止 | 只能物理 BOOT 长按 2s |

## 10. 修改后的强制回归

任何涉及设备按钮、连接、协议、Android BLE 或固件的修改，至少执行：

1. Web 单元测试：`cd software/app && node tests/run.mjs`。
2. 协议一致性：`cd protocol && python3 tools/gen.py --check`。
3. Android 构建：`cd software/app-android && ./gradlew assembleDebug`。
4. 安卓真机连接，确认连接阶段完整到 `ready`。
5. 在“硬件调试”依次验证长按开机、短按调档、长按关机。
6. 回到“自我控制”，确认开启/关闭调用同一个 helper，而不是另一条命令。
7. 验证红色停止立即生效，远程 `resume` 仍被拒绝。
8. 同时核对 Web UI 与 Android WebView 的状态和按钮；产品页不显示原始技术错误。
9. PR 中明确写出哪些是现场物理验证、哪些只是编译或代码检查。未验证项不得写“已完成”。

## 11. 代码索引

| 层 | 文件 |
|---|---|
| 协议唯一事实来源 | [`protocol/contract.yaml`](../../protocol/contract.yaml) |
| Web Session / 唯一下行入口 | [`software/app/js/session.js`](../../software/app/js/session.js) |
| 产品与调试按钮映射 | [`software/app/js/app.js`](../../software/app/js/app.js) |
| 硬件调试展示 | [`software/app/js/lab.js`](../../software/app/js/lab.js) |
| Android GATT 状态机 | [`software/app-android/.../BleBridge.kt`](../../software/app-android/app/src/main/java/love/nascent/app/BleBridge.kt) |
| 固件命令闸门 | [`hardware/toy-sidecar/src/downlink_gate.cpp`](../../hardware/toy-sidecar/src/downlink_gate.cpp) |
| 固件安全总督 | [`hardware/toy-sidecar/src/safety.cpp`](../../hardware/toy-sidecar/src/safety.cpp) |
| GPIO7 按键状态机 | [`hardware/toy-sidecar/src/ao3400.cpp`](../../hardware/toy-sidecar/src/ao3400.cpp) |
| 跨 Web/Android 检查清单 | [`Web与Android共用UI调试检查.md`](Web与Android共用UI调试检查.md) |
