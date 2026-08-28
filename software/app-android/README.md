# app-android —— 同一套 Web UI 的 Android 壳

网站和 App **共用** `software/app/` 里的页面。差别只在怎么连行空板：

| 入口 | 打开方式 | 连行空板 K10 |
|---|---|---|
| 网站 | 浏览器打开后端托管的页面 | Web Bluetooth |
| PWA | 浏览器「添加到主屏幕」 | 仍是 Web Bluetooth（跑在 Chrome 里） |
| 本目录的 App | WebView 加载同一网站 | 原生 GATT 桥。系统 WebView 没有 `navigator.bluetooth` |

App 不内嵌第二份 UI，也不自己实现安全总督。总督仍在网页的 `governor.js` 里。

## 怎么跑

1. 电脑上先把网站拉起来（见 [`../app/README.md`](../app/README.md)）。
2. 用 Android Studio 打开本目录，同步 Gradle 后安装到手机。
3. 首次启动填网站地址：
   - 模拟器：`http://10.0.2.2:8000`
   - 真机：电脑的局域网地址，如 `http://192.168.1.8:8000`（电脑防火墙要放行 8000）
4. 进入「我的 → 连接行空板 K10」。

本机没有 Android SDK 时不要假装已经编过；在 PR 里写明即可。

## 还没做的

- iOS 壳（WKWebView 同样没有 Web Bluetooth，需要单独的 CoreBluetooth 桥）
- 把网站打进 APK 离线包（当前必须能访问后端地址，因为人设接口和页面都在同一源）
