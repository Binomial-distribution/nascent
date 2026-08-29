# Web 与 Android 共用 UI：Bug 修复与权限检查清单

## 1. 必须先记住的结构

Nascent 只有一套产品 UI：`software/app/`。网站、PWA 和 Android App 都运行这套
HTML / CSS / JavaScript；Android 工程只是 WebView 宿主，并补上系统 WebView 做不到的
原生能力。

```text
software/app/（唯一 UI、设备 Session、Governor）
  ├─ Chrome / Edge / PWA → Web Bluetooth 或 WiFi WebSocket
  └─ Android WebView     → BleBridge 原生 GATT 或 WiFi WebSocket
                            └─ HeartRateBridge 接收 Gadgetbridge Broadcast
```

因此，任何页面、状态、按钮或设备接口 Bug 都不能只按“网站 Bug”或“Android Bug”处理。
修复前先确认问题属于共享 Web 层、Android 原生桥、浏览器能力差异还是固件；修复后必须按
第 5 节同时验证 Web UI 和 Android。

硬件调试页已经在实机跑通的接口、产品按钮映射和验证状态见
[`硬件实机已验证API基准.md`](硬件实机已验证API基准.md)。涉及设备动作时两份文档必须同时遵守。

## 2. 唯一设备接口

- 所有页面，包括亲密时刻、自我控制、情景模式和硬件联调页，都订阅同一个设备 Session。
- 所有产品指令必须经过 `Governor → sendCommand() → TransportClient`；页面不得直接写
  Bluetooth characteristic、WebSocket 或 `NascentNative.send()`。
- 自我控制的“开启/关闭”和硬件调试的“开机/关机”必须调用同一个原机长按 helper；原板的
  电源键是取反动作，不能让产品页与调试页分别维护两套开关实现。
- `press_key/hold` 是当前实机验证过的原机开关取反动作。自我控制“开启/关闭”和硬件调试
  “开机/关机”必须复用同一个 `toggleOriginalPower()`；`press_key/tap` 暂只用于硬件验板。
- `set_level(0)` 在协议中仍表示不闩锁的目标关机，但当前产品开关不能拿它替代已验证的
  `press_key/hold`。红色 `stop` 才是安全停机；安全停机后只能在玩具上长按 BOOT 两秒恢复。
- 自动情景只能发送 `set_level` 目标档位，绝不能调用原始 `press_key`；目标档位接口须在对应
  固件上重新完成 1–9 档真机回归后，才能写成“已验证”。
- 页面显示的实时温度、压力、贴合、档位必须来自当前共享 Uplink。断连后清空实时值；
  历史/演示数据必须明确标注，不能伪装成当前设备读数。

## 3. Android 权限与连接职责

| 能力 | 谁连接/申请 | Android 权限 | 注意事项 |
|---|---|---|---|
| Nascent 玩具 BLE | Nascent Android 壳的 `BleBridge` | Android 12+：`BLUETOOTH_SCAN`、`BLUETOOTH_CONNECT`；Android 11及以下：`ACCESS_FINE_LOCATION` | 首次点“连接设备”时动态申请；拒绝后必须结束连接 Promise 并显示原因。旧系统还可能要求打开系统定位开关。 |
| 情景语音 | Nascent Android 壳 / WebView | `RECORD_AUDIO` | 只在用户开始语音时申请；拒绝后文字情景仍可用。 |
| 小米手环 7 BLE | Gadgetbridge fork | 由 Gadgetbridge 自己申请附近设备/蓝牙权限 | Nascent 不扫描、不配对、不抢占手环 GATT。 |
| 心率 IPC | Gadgetbridge fork → Nascent Broadcast | `love.nascent.permission.RECEIVE_HEART_RATE`（`signature`） | 不是运行时弹窗。两枚 APK 必须使用同一 keystore 签名，否则广播会被系统拒绝。 |
| 网站与后端 | Android WebView | `INTERNET`，无运行时弹窗 | 当前 APK 不内嵌离线页面，必须能访问所填后端地址；局域网 HTTP 由 network security config 放行。 |

不要为了“省去授权”删除运行时权限检查，也不要把真实 MAC、会话令牌、WiFi 密码写入日志。

## 4. 产品界面与硬件调试的边界

- 心绪、亲密、自我控制、情景、记录和“我的”都是给最终用户使用的产品界面。这里不得显示
  WebView、GATT、Characteristic、协议版本、广播名、GPIO、App 壳或浏览器限制等工程术语。
- 产品页只显示用户需要的状态和下一步，例如“连接设备”“正在寻找设备”“暂时无法连接，点此重试”。
  原生桥返回的状态码和完整错误不得直接放进状态条或 Toast。
- 用户必须知道的操作可以保留，例如“请先连接设备”“停止后请在设备上恢复”；不要顺带解释
  内部架构、权限链路或为什么这样实现。
- 原始连接阶段、GATT 状态码、协议版本、Uplink 帧、传感器原始值、GPIO、灯语覆盖和固件核对项
  只放在“我的 → 硬件调试”。调试页可以详细，但仍不得记录 MAC、令牌或 WiFi 密码。
- 共享页面改动要同时检查常见手机比例和 Android WebView；状态条、停止、开关、滑杆和模式按钮
  不得因说明文字变成长卡片，也不得把主操作挤出首屏。

## 5. 每次 Bug 修复的最低验证矩阵

### 共享 Web UI

1. 运行 `cd software/app && node tests/run.mjs`。
2. 从后端托管页面打开网站，验证改动页面、连接状态、失败文案和断连状态。
3. 涉及设备控制时，确认页面只调用共享 `sendCommand()`，且 Governor 拒绝理由能显示。
4. 涉及缓存文件时更新 Service Worker 缓存版本，再验证刷新后取得新代码。

### Android 壳

1. 运行 `cd software/app-android && ./gradlew assembleDebug`。
2. 安装到真机；不能只用模拟器证明 BLE 可用。
3. 分别验证首次授权、拒绝授权、再次授权、扫描超时、RESET 后重连和应用切后台。
4. 用 `adb logcat -s NascentBle` 检查 GATT 阶段和状态码；日志不得包含密钥或 MAC。
5. 验证 Android WebView 中显示的页面、控件和状态与网站一致，只允许原生能力表现不同。

### 真机执行器

凡是档位、灯语、停止、开关机或情景自动控制改动，还必须确认：

- 页面反馈不是“只在 UI 里变化”，命令确实到达固件；
- 正常关闭不会设置安全闩锁；
- `stop` 立即停机，远程 `resume` 仍然无效；
- 断连后实时数据清空，重连不会自动恢复旧档位；
- 原始传感器和心率不能绕过 Control / Governor 直接控制振动。

## 6. 小米手环 7 与玩具如何同时连接

两条蓝牙连接由两个 App 分工持有，可以同时存在：

```text
小米手环 7 ⇄ Gadgetbridge fork ──签名权限 Broadcast──> Nascent HeartRateBridge
Nascent-Toy ⇄ Nascent BleBridge ──设备 Uplink/Downlink──> 同一套 Web UI
```

正确步骤：

1. 在 Gadgetbridge fork 中配对并保持小米手环 7 连接，打开需要的连续/实时心率采样。
2. 确认 Gadgetbridge fork 与 Nascent APK 使用同一 keystore 签名。
3. 打开 Nascent；健康手环状态由 Broadcast 自动更新，不需要在 Nascent 里再次搜索手环。
4. 在 Nascent 中单独连接 `Nascent-Toy`。Android 可以同时保持手环和玩具两条 BLE GATT。
5. 验收时同时观察：玩具 Uplink 持续到达、心率时间戳持续前进、任一连接断开不会把另一条误判为断开。

心率只进入本地平滑、基线和 AI 上下文，不得调用 `sendCommand()`，也不得直接调档。
网站/PWA 没有 Gadgetbridge Broadcast 桥，因此没有原生实时手环来源。

## 7. 提交说明必须写什么

每个相关 PR 至少写明：

- 问题发生在共享 Web 层、Android 桥还是固件；
- 网站/PWA验证结果；
- Android 构建与真机验证结果；
- 本次涉及的权限及拒绝权限后的表现；
- 若涉及手环，Gadgetbridge 与玩具是否已同时连接验证；
- 未完成的硬件验证，不能用“理论可用”替代。
