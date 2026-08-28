# WiFi WebSocket —— App ↔ toy-sidecar（备用通道）

BLE 是默认通道，见 [`ble_gatt.md`](ble_gatt.md)。这一条是备用：
BLE 连不上、浏览器不支持 Web Bluetooth、或者需要在桌面上长时间联调时用它。

**载荷与 BLE 完全相同**，还是 `schemas/ble_uplink.json` 与 `schemas/ble_downlink.json`。
换传输不换契约，App 侧只换一个 send / onMessage 的实现。

## 拓扑与地址

玩具侧作 **STA** 接入现有局域网（不开 SoftAP），然后起一个 WebSocket 服务端：

```
ws://<玩具 IP>:81/nl
```

端口 `NL_WIFI_WS_PORT`、路径 `NL_WIFI_WS_PATH` 来自契约，两端不许各写一份。
同时用 mDNS 播 `NL_WIFI_MDNS_HOST`，即 `ws://nascent.local:81/nl`。

WiFi 凭据不进仓库：写在 gitignored 的 `hardware/toy-sidecar/include/local_config.h`，
沿用仓库既有的做法。没有这个文件时 WiFi 通道直接不启用，只有 BLE。

mDNS 的 `.local` 解析在移动端浏览器上并不可靠，所以 App 的设置页保留手填 IP，
mDNS 只是省事的那条路，不是唯一的路。

## BLE 与 WiFi 互斥

**同一时刻只开一条。** ESP32-S3 只有一路 2.4 GHz 射频，BLE 与 WiFi 共存要靠时分，
12 Hz 的上行会开始抖，而这条链路上跑着停机指令。

切换规则：

- 上电默认起 BLE，因为默认优先蓝牙。
- 当前通道空闲超过 `TRANSPORT_IDLE_SWITCH_MS`（20 秒）**且**另一条已配置，才切过去。
- 切换要完整 deinit 再 init，不做两栈并存。
- 切换过程中安全状态不重置：闩锁、档位、模式都跨传输保持。
  换一条线连上来不是"新的一次会话"，更不是解除停机的理由。

## 消息格式

WebSocket 走**文本帧**，一帧一条 JSON，与 BLE 的一次 Notify / 一次 Write 对应。
二进制帧与分片一律忽略。

上行 12 Hz，与 BLE 同频。下行事件驱动。

`auth` 字段的语义和 BLE 完全一样：会话令牌由玩具侧生成。
WebSocket 没有 Info 特征可读，所以连上之后玩具侧**主动**先推一帧握手：

```json
{ "proto": "0.3.0-demo", "token": "<session_token>" }
```

App 用它做协议主版本门控，与 BLE 读 Info 特征等价。收到握手前发的任何指令都会被丢弃。

## 连接规则

- **路径必须精确匹配** `NL_WIFI_WS_PATH`。握手时路径不符立刻断开。
- **同时只接受一个控制端。** 已有连接时新连接被拒绝，而不是踢掉旧的：
  正在用的那一条不该被一个新连接抢走停机的能力。
- **判活靠 ping/pong**，玩具侧每 500 ms 发一次 ping，连续两个
  `LINK_TIMEOUT_MS` 窗口收不到 pong 就断开并归零。浏览器会自动回 pong，
  App 不需要做任何事。
- App **不要**用"最近收到上行的时间"之外的东西判断自己是否在线；
  反过来玩具侧也不用"最近收到指令的时间"判活——下行是事件驱动的，
  用户十几秒不操作是正常的，拿它当活性指标会误判断链并把档位归零。

## 安全约束

这条通道不因为"是备用"就降低要求，下面几条与 BLE 逐条对齐：

1. **`resume` 不是合法指令。** 和 BLE 一样丢弃并置 `alert = "bad_cmd"`。
   解除闩锁只能长按玩具侧 BOOT 键，见 `ble_gatt.md` 的「停机之后怎么恢复」。
2. **断连即归零。** WebSocket 断开或超过 `LINK_TIMEOUT_MS` 没有任何帧，
   玩具侧按关机时序断电，与 BLE 断连的处理完全一致。
3. **`level` 收到后必须再钳一次。** 不信任来自链路的任何数值。
4. 急停或安全词生效期间只接受 `stop`。

## 已知限制（不要静默）

`ws://` 是明文。当前网站由 FastAPI 以纯 HTTP 托管（默认 `127.0.0.1:8000`，仓库无 TLS 配置），
所以现在能用。但两件事互斥：

- 网站一旦上 HTTPS，浏览器会按混合内容拦掉 `ws://<玩具 IP>`。
- 网站不上 HTTPS，手机浏览器访问局域网地址就不是安全上下文，**Web Bluetooth 用不了**。

也就是说手机浏览器同时走通两条通道是做不到的。Android 壳没有这个矛盾：
`usesCleartextTraffic="true"` 加原生 GATT 桥，两条都能用。
因此 **WiFi 通道以 Android 壳和桌面 Chrome 作为主要验证路径**，
手机浏览器上以 BLE 为准。要在手机浏览器上用 WiFi 通道，得先给设备上 TLS，
那属于量产范围，本 demo 不做。
