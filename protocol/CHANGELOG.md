# 协议变更记录

版本号语义见 [`README.md`](README.md#版本策略)。
每次改动都要在这里留一行，写清**为什么**改，而不只是改了什么。

## 0.3.0-demo — 2026-08-29（字段追加）

验证期要把 WiFi 备用通道交给非开发者使用：凭据不能只靠重烧 `local_config.h`。
`cmd` 末尾追加 `set_wifi`（线序 6，前面不变），`BleDownlink` 追加可空的
`wifi_ssid` / `wifi_psk`。主版本不变，旧固件会把未知 cmd 当成 `bad_cmd` 丢掉。

- `set_wifi` **不驱动按键、不进 SafetyGovernor 的档位分发**。闸门鉴权通过后写入
  玩具 NVS；编译期 `local_config.h` 仍可作为没有 NVS 时的回退。
- 密码只走已鉴权的设备链路。不上行、不进云端摘要、不打串口日志。
- 闩锁期间仍只放 `stop`，配网必须在未停机时做。
- `resume` 的线序和不可投递语义不变。

联调需要直接模拟原按键，而不是走开环档位状态机。`press_key` **再追加**在
`set_wifi` 之后（线序 7），`set_wifi` / `resume` 线序都不动。

- 新增 `cmd.press_key` 与枚举 `key_press: [tap, hold]`。`tap` = GPIO7 短接约 120ms（开机后切一档）；`hold` = 短接约 1.2s（电源取反）。产品控制页不使用。闩锁期间仍只放 `stop`。

## 0.3.0-demo — 2026-08-28

去掉行空板 K10 与 HW504 摇杆，手机直连玩具侧 ESP32-S3。这是**破坏性变更**：
`cmd` 枚举删掉了中间的 `set_joystick`，`resume` 的线序从 6 挪到 5，
固件与控制端必须同批更新。现场没有已发出的设备，代价可以接受。

为什么改：双板形态里 K10 只做了两件事——摇杆换档和当手机的 BLE 入口。
两件都不值得一块独立的板：BLE 外设玩具侧自己就能做，而摇杆换来的
"断网也能换档"原产品的实体按键本来就有。少一块板少一条链路，
停机路径上也少了一跳。

- `ble.device_name` 改为 `Nascent-Toy`。UUID 全部不动：服务只是从 K10 挪到玩具侧，
  逻辑身份没变，换 UUID 只会白白牵动 App 与 Android 壳。
- 新增 `wifi:` 段（`ws_port` / `ws_path` / `mdns_host`）与 [`wifi_ws.md`](wifi_ws.md)：
  WiFi 是备用通道，承载与 BLE 完全相同的 JSON。BLE 优先，两者运行时互斥，
  理由是 ESP32-S3 只有一路射频，共存会让 12 Hz 上行抖动。
- 删 `joy_edge` 枚举与 `BleUplink.joy_edge`；删 `cmd.set_joystick` 与
  `BleDownlink.enabled` / `hold_ramp`；删 `JOY_EDGE_HOLD_MS` / `JOY_HOLD_RAMP_MS` /
  `JOY_DEADZONE`。摇杆是 K10 上的件，K10 没了它也没了。
- **`resume` 保留在枚举里，但不再是任何链路上的可投递指令。**
  固件的 `SafetyGovernor::onCommand` 不再识别它，`clearLatch()` 只有玩具侧 BOOT 键的
  处理函数会调。这是本次最重要的一条：手机直连之后，"指令只可能来自 K10 物理按键"
  这个前提没了，如果继续让 `onCommand` 接受 `resume`，手机就能远程解除停机闩锁。
  把它从分发里删掉，传输层被攻破也合成不出一次恢复，不再依赖下游自觉过滤。
  枚举值留着是为了让 App 的安全总督继续显式拒绝并给出文案。
- 新增 `BOOT_KEY_DEBOUNCE_MS` / `BOOT_STOP_MAX_MS` / `BOOT_RESUME_HOLD_MS`：
  玩具侧 BOOT 键短按本地停机，长按 2 秒解除闩锁。取代 K10 的物理双键。
- 新增 `TRANSPORT_IDLE_SWITCH_MS`：BLE 与 WiFi 的切换门槛。
- ESP-NOW 相关全部删除：`espnow_frame.md` 删除，`ack` 帧删除，
  `frame_type` 收缩为 `[telemetry, command]`。BLE 的写响应与 WebSocket 的 TCP
  已经各自负责可靠性，玩具侧不再需要自己做配对与确认帧。
- `wire_header` / `wire_frames` **保留但语义改变**：不再是板间线上格式，
  而是玩具侧固件的内部表示（传输层 JSON ⇄ `nl_command_t` / `nl_telemetry_t`）。
  保留的实际好处是安全总督的接口一行都不用改。250 字节的 ESP-NOW 载荷断言随之删除，
  packing 断言保留。
- `command.flags` 的 bit0/bit1 改为保留位，必须为 0。

## 0.2.0-demo — 2026-08-28

为 App 的心绪记录提供跨端稳定的枚举值，避免用户标签在三端使用自由文本后产生无法互认的值。

- 新增 mood_tone 枚举：quiet、open、warm、bright、tired。
- UserTags.mood 改为 enum:mood_tone。
- VERSION_MINOR 同步为 2，与版本字符串对齐；ESP-NOW 帧只校验 major，minor 仅记录，不影响既有设备互联。
- App 侧 BLE 版本门控放宽为只校验主版本，0.1.x 固件无需重新烧录即可连接。
- BLE 指令、传感器字段、设备安全协议和停止/恢复规则不变。

## 0.1.0-demo — 2026-08-28

首个冻结版本，对应验证期双板形态（k10-controller + toy-sidecar）。

- 定义三条链路：BLE GATT（App ↔ K10）、ESP-NOW packed struct（K10 ↔ 玩具侧）、HTTPS（App ↔ 后端）。
- 枚举 0 号统一为最安全取值（`stop` / `unknown` / `none`），使全零坏包不会导致加档。
- `temp_a` / `temp_b` 保留量产 NTC 字段名但置为 nullable，demo 恒为 `null`；
  新增 `env_temp` / `env_humidity` 承载 DHT11，并明确其**不是安全通道**。
- 八档表、LED 模式层与覆盖层进入契约，由固件本地渲染，云端无权逐帧下发灯效。
- BLE 的 UUID、设备名与 MTU 收进 `ble:` 段。之前它们只写在 `ble_gatt.md` 里，
  而文档不会被编译器检查——固件和 App 各抄一份迟早会抄歪。
- `cmd` 末尾追加 `resume`（线序 6，前面不变）。它是解除停机闩锁的唯一指令，
  且**只由 K10 上的物理双键确认产生**，App 写进来会被拒绝。
  让软件能远程解除安全词，等于把最后一道保险交回给软件。
- `battery` 改为 nullable。demo 没有电量采样电路，K10 恒发 `null`；
  声明成非空会让 App 一解析就崩，而不是安静地不显示电量。
- 生成器现在把 `protocol.js` 与 `protocol.py` 直接投放到控制端和后端的包内。
  浏览器与 Python 的模块解析都不喜欢跳出包根引用文件，与其让两端各写一段路径 hack，
  不如由生成器负责分发——反正它们都是生成物。`generated/protocol.dart` 仍生成，供对照。
