# 第三方库来源

通用驱动一律用社区成熟库，源码直接 vendored 进各工程的 `lib/`，
PlatformIO 会自动把 `lib/` 下的每个目录当作项目本地库编译，不需要 `lib_deps`。

这么做的代价是升级要手动重做，好处是离线可构建、且队友克隆下来版本必然一致。

## 清单

| 库 | 版本 | 上游 | 用在哪 | 许可证 |
|---|---|---|---|---|
| DHTesp | 1.19 | <https://github.com/beegee-tokyo/DHTesp> | toy-sidecar，DHT11 | MIT |
| MPU6050 | v1.4.5 | <https://github.com/ElectronicCats/mpu6050> | toy-sidecar，六轴 | MIT |
| Adafruit_NeoPixel | 1.15.5 | <https://github.com/adafruit/Adafruit_NeoPixel> | toy-sidecar，WS2812B ×8 | LGPL-3.0 |
| ArduinoJson | v7.4.3 | <https://github.com/bblanchon/ArduinoJson> | toy-sidecar，BLE / WebSocket JSON | MIT |

## 随平台提供、不需要也没法 vendored 的部分

这几个是**工具链的一部分**，不是可以拷进 `lib/` 的库。
既然构建时必须联网拉平台，再把平台自带的库复制一份进仓库只会造成重复定义。

| 组件 | 随谁提供 |
|---|---|
| `esp_now` | ESP-IDF，随 `espressif32` / `platform-unihiker` 平台 |
| `unihiker_k10`（屏幕 / 板载按键 / RGB） | DFRobot `framework-arduinounihiker` 内核 |
| `BLEDevice`（Bluedroid） | arduino-esp32 内核 |

K10 工程的 platform 直接写成 GitHub 地址，PlatformIO 首次构建时自己拉：

```ini
platform = https://github.com/DFRobot/platform-unihiker.git
board = unihiker_k10
```

`k10-controller/reference/` 下放了 DFRobot 官方示例原件（MIT），
用来对照屏幕、按键、模拟输入的正确 API 用法。它们不参与编译，
存在的意义是：写这块板的代码时不要凭记忆猜 API，照着官方例子抄。

## vendored 内容做了裁剪

只保留可编译源码与元数据（`src/` 或根目录源文件、`library.json` / `library.properties`、
`keywords.txt`、`README.md`、许可证）。删掉了 `examples/`、`extras/`、`tests/`、
`docs/`、`ci/`、`.github/` 等构建不需要的内容。

许可证文件**一律保留**，不要在后续清理里删掉。

## 升级步骤

```bash
cd hardware
TAG=<新版本 tag>
curl -fsSL "https://github.com/<owner>/<repo>/archive/refs/tags/$TAG.tar.gz" -o /tmp/lib.tgz
rm -rf <工程>/lib/<库名> && mkdir -p <工程>/lib/<库名>
tar -xzf /tmp/lib.tgz -C <工程>/lib/<库名> --strip-components=1
# 按上面的规则裁剪，然后更新本文件的版本号
```

## 为什么这几块没有用库

| 模块 | 为什么必须自己写 |
|---|---|
| `ao3400.cpp` | 模拟的是**这一台**原产品控制板的按键时序与九档循环行为，没有通用性 |
| `insert_state.cpp` | 入体推断的判据组合与阈值是产品定义的一部分 |
| `led_ws2812.cpp` 的灯语层 | 底层驱动用 NeoPixel，模式配色与优先级抢占是产品语言 |
| `ble_peripheral.cpp` | 只是 `BLEDevice` 的薄封装加本产品的拒绝规则，没有通用性 |
| `boot_key.cpp` | 短按停机 / 长按解闩锁的时序与死区是安全语义，不能交给通用按键库 |
