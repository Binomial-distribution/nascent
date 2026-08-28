# 协议变更记录

版本号语义见 [`README.md`](README.md#版本策略)。
每次改动都要在这里留一行，写清**为什么**改，而不只是改了什么。

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
- 生成器现在把 `protocol.dart` 与 `protocol.py` 直接投放到 App 和后端的包内。
  Dart 与 Python 的模块解析都不喜欢跳出包根引用文件，与其让两端各写一段路径 hack，
  不如由生成器负责分发——反正它们都是生成物。
