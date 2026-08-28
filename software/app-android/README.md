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

## 怎么跑

1. 电脑上先把网站拉起来（见 [`../app/README.md`](../app/README.md)）。
2. 用 Android Studio 打开本目录，同步 Gradle 后安装到手机。
3. 首次启动填网站地址：
   - 模拟器：`http://10.0.2.2:8000`
   - 真机：电脑的局域网地址，如 `http://192.168.1.8:8000`（电脑防火墙要放行 8000）
4. 进入「我的」页连接设备。

本机没有 Android SDK 时不要假装已经编过；在 PR 里写明即可。

## 为什么 WiFi 备用通道主要在这里验证

玩具侧除 BLE 之外还有一条 WiFi WebSocket 备用通道（`ws://<玩具 IP>:81/nl`）。
手机浏览器上它和 Web Bluetooth 不可能同时可用：网站是纯 HTTP，所以局域网地址不是
安全上下文、Web Bluetooth 不可用；给网站上 HTTPS 之后 `ws://` 又会被混合内容拦掉。

本 App 没有这个矛盾——`usesCleartextTraffic="true"` 允许明文，蓝牙走原生 GATT 桥
而不依赖安全上下文，两条通道都能用。所以 **WiFi 通道以本 App 和桌面 Chrome
作为主要验证路径**，手机浏览器上以 BLE 为准。

## 恢复不在 App 里

停机之后 App 发不出恢复指令，设备端也没有这条指令分支。解除闩锁只能长按玩具侧
板上的 BOOT 键 2 秒。不要在 Kotlin 侧补一个「恢复」按钮。

## 还没做的

- iOS 壳（WKWebView 同样没有 Web Bluetooth，需要单独的 CoreBluetooth 桥）
- 把网站打进 APK 离线包（当前必须能访问后端地址，因为人设接口和页面都在同一源）
