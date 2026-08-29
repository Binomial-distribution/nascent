# app-android —— 同一套 Web UI 的 Android 壳

网站和 App **共用** `software/app/` 里的页面。差别只在怎么连设备：

| 入口 | 打开方式 | 连玩具侧 ESP32-S3 |
|---|---|---|
| 网站 | 浏览器打开后端托管的页面 | Web Bluetooth |
| PWA | 浏览器「添加到主屏幕」 | 仍是 Web Bluetooth（跑在 Chrome 里） |
| 本目录的 App | WebView 加载同一网站 | 原生 GATT 桥。系统 WebView 没有 `navigator.bluetooth` |

连的对象是玩具侧那块板（广播名 `Nascent-Toy`）。协议 0.3.0 之前中间还有一块行空板
K10，现在已经删除；GATT 的 UUID 一个都没改，所以 `BleBridge` 这边不需要跟着改协议。

App 不内嵌第二份 UI，也不自己实现安全总督。总督仍在网页的 `governor.js` 里。

每次修复 UI、设备连接或权限 Bug，都必须同时验证共享 Web UI 与 Android 真机。
强制清单见 [`docs/implementation/Web与Android共用UI调试检查.md`](../../docs/implementation/Web与Android共用UI调试检查.md)。

## 健康手环心率

玩具 GATT 与心率是两条路。本壳只收 Gadgetbridge fork 的 Broadcast，再回调网页的
`window.__nascentOnHeartRateSample`。合同见
[`docs/implementation/mi-band7-gadgetbridge-bridge.md`](../../docs/implementation/mi-band7-gadgetbridge-bridge.md)。

- Action：`love.nascent.action.HEART_RATE_SAMPLE`
- 权限：`love.nascent.permission.RECEIVE_HEART_RATE`（signature，两 APK 同一证书）
- JS 桥：`NascentHeartRate.available()` 恒为 true；**没有**发往玩具的方法

网页负责平滑、基线和断流。心率不得变成档位指令。网站 / PWA 没有这条桥。


## 怎么跑

1. 电脑上先把网站拉起来（见 [`../app/README.md`](../app/README.md)）。
2. 用 Android Studio 打开本目录，同步 Gradle 后安装到手机。
3. 首次启动填网站地址：
   - 公网演示：`https://nlove.divesee.com`（对话走 `https://loveapi.divesee.com`）
   - 模拟器本机：`http://10.0.2.2:8000`
   - 真机连电脑：电脑的局域网地址，如 `http://192.168.1.8:8000`（电脑防火墙要放行 8000）
   之后改地址或填写对话 / 语音供应商密钥，都在网页「我的 → 云端接口」，不再用原生顶栏按钮。
4. 进入「我的」页连接设备。情景实时通话需要麦克风权限（`RECORD_AUDIO`）。

本机没有 Android SDK 时不要假装已经编过；在 PR 里写明即可。

## 为什么 WiFi 备用通道主要在这里验证

玩具侧除 BLE 之外还有一条 WiFi WebSocket 备用通道（`ws://<玩具 IP>:81/nl`）。
手机浏览器上它和 Web Bluetooth 不可能同时可用：网站是纯 HTTP，所以局域网地址不是
安全上下文、Web Bluetooth 不可用；给网站上 HTTPS 之后 `ws://` 又会被混合内容拦掉。

本 App 没有这个矛盾——`usesCleartextTraffic="true"` 与
`res/xml/network_security_config.xml` 允许明文，蓝牙走原生 GATT 桥
而不依赖安全上下文，两条通道都能用。所以 **WiFi 通道以本 App 和桌面 Chrome
作为主要验证路径**，手机浏览器上以 BLE 为准。

## 设置页给 ESP32 配 WiFi

网站、PWA、本 App 共用 `software/app/` 的「我的」页，没有第二套 Kotlin UI。

1. 通道保持「蓝牙」，连上玩具。
2. 填写 2.4 GHz SSID 和密码，点「写入玩具」。指令是协议里的 `set_wifi`，
   经 `Governor` → 原生 GATT → 玩具 `DownlinkGate`，写入 NVS。密码不上云。
3. 断开蓝牙，等固件空闲约 20 秒切到 WiFi；把通道切到 WiFi，填玩具局域网地址。

## 恢复不在 App 里

停机之后 App 发不出恢复指令，设备端也没有这条指令分支。解除闩锁只能长按玩具侧
板上的 BOOT 键 2 秒。不要在 Kotlin 侧补一个「恢复」按钮。

## 还没做的

- iOS 壳（WKWebView 同样没有 Web Bluetooth，需要单独的 CoreBluetooth 桥）
- 把网站打进 APK 离线包（当前必须能访问后端地址，因为人设接口和页面都在同一源）
