# k10-controller —— UNIHIKER K10 主控

ESP32-S3。整套系统的控制器兼网关：

```
App ──BLE──> K10 ──ESP-NOW──> toy-sidecar
App <──BLE── K10 <──ESP-NOW── toy-sidecar
```

## 断开手机它照样能用

摇杆和屏幕不依赖 App，也不依赖网络。这不是降级方案，是设计前提：
安全相关的操作一条都不许挂在手机上。

停机的三个来源全部绕开 App：

| 来源 | 操作 | 说明 |
|---|---|---|
| 安全词 | 摇杆按键长按 1 秒 | 到时立即触发，不等松手 |
| 急停 | 板载 A+B 双键 | 按下即停 |
| 板间断链 | 自动 | 玩具侧自己会归零，K10 只负责显示 |

### 恢复只能在设备上做

停机闩锁**不能远程解除**。唯一途径是同时长按板载 A、B 两键两秒。
App 写 `resume` 会被无条件拒绝。

理由：远程解除意味着一个有 bug 或被接管的 App 能在用户喊停之后让设备重新动起来。
要求物理在场，就把这种失败挡在了软件够不着的地方。

## 接线

HW504 摇杆接金手指：

| 功能 | 丝印 | GPIO | 备注 |
|---|---|---|---|
| VRx | P0 | 1 | ADC1_CH0，demo 未使用 |
| VRy | P8 | 8 | ADC1_CH7，换档轴 |
| SW | P9 | 9 | 按下拉低，内部上拉 |

**选脚有个坑**：官方 `variants/unihiker_k10/pins_arduino.h` 里
`P1` 和 `P11`(KeyB) 都是 GPIO2，`P2` 和 `P12` 都是 GPIO3——同一个 GPIO 挂了两个丝印名。
所以这里避开 P1/P2。焊之前对着实物丝印再确认一遍。

另外金手指上的 `P3`–`P15` 在官方 `initBoard.h` 里是通过 I2C 扩展芯片访问的
（`digital_write(ePin_t, ...)`），只能数字读写。要接模拟量就得用 P0/P8/P9 这类原生 ADC 脚。

## 回中式换档

推一次只算一档，手必须回到中位才能再算下一档。想连续加档就一直推着，
超过 `JOY_HOLD_RAMP_MS` 之后按固定节奏续档——节奏与推的力度无关，
用力推不会让强度涨得更快。

中位在上电时实测一次（`Joystick::begin`），因为 HW504 的分压中点个体差异能到几百 LSB，
硬用理论值 2048 会让某个方向的死区明显偏小。标定时手别碰摇杆。

## 依赖

平台直接指向 DFRobot 的 GitHub 仓库：

```ini
platform = https://github.com/DFRobot/platform-unihiker.git
board = unihiker_k10
```

它自带板定义和 Arduino 内核，内核里已经包含 `unihiker_k10`（屏幕/按键/RGB）、
`BLEDevice`、`esp_now`。这部分是工具链不是库，不需要也没法 vendored。

需要 vendored 的第三方库只有 ArduinoJson，在 `lib/` 下，版本见 [`../VENDOR.md`](../VENDOR.md)。

`reference/` 放的是 DFRobot 官方示例原件（MIT），用来对照屏幕、按键、模拟输入的
正确 API 用法，不参与编译。

### 为什么用 Bluedroid 而不是 NimBLE

DFRobot 的平台锁在 arduino-esp32 2.x / IDF4 工具链上，NimBLE-Arduino 2.x 要求 3.x 内核，
装了也编不过。量产若换内核，换成 NimBLE 能省几十 KB RAM。

## 烧录

```bash
pio run -e k10-controller -t upload
pio device monitor -b 115200
```

首次上电串口会打印本机 MAC，把它填进 toy-sidecar 的 `PEER_MAC_K10`；
反过来把玩具侧打印的 MAC 填进本工程的 `PEER_MAC_TOY`。验证期不做动态配对。

## 会话令牌

App 连上之后，K10 生成 16 位十六进制随机令牌，通过 Info 特征读出。
之后每条下行指令都要带 `auth`，比较用定长全量异或，不做提前返回。
断连即作废，重连必须重读。

这套机制挡的是同处一室的误连和简单探测，**不是**完整的配对认证。
量产需要 BLE bonding + LESC，见 `protocol/ble_gatt.md`。

## 还没做的

- 电量采样，所以上行 `battery` 恒为 null
- 情景模式的剧本引擎（目前切到情景只是换灯换色，档位仍靠手动）
- `joy_edge` 上行字段目前恒为 `none`，没有把本地边沿回传给 App
