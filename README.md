# Nascent

智能情趣按摩玩具的软硬件工程仓库。当前处于**验证期单板 Demo** 阶段：手机直连玩具侧那块 ESP32-S3，中间没有别的板。

产品架构（仓库内权威副本）：[`docs/architecture/产品架构.md`](docs/architecture/产品架构.md)。飞书讨论稿：<https://my.feishu.cn/docx/FggRdEmySofDoGx2WzFc77MznCd>（改架构必须同步回仓库）。

**如果你上一次拉代码是在 `0.2.0-demo`，先读 [`docs/0.3.0 单板改造交接.md`](docs/0.3.0%20单板改造交接.md)。** 那次改造删掉了行空板 K10 与摇杆，协议是破坏性变更，文档里逐条写了你那一侧要不要跟。

## 三层运行架构

```mermaid
flowchart TB
  subgraph cloud [云端剧本层]
    LLM["LLM Agent 与剧本引擎"]
    AUD["内容双向审核"]
  end
  subgraph app [浏览器语义层 / Web UI]
    GOV["安全总督"]
    FSM["会话状态机"]
    DB["本次运行内存归档"]
  end
  subgraph fw ["ESP32 实时层（玩具侧唯一一块板）"]
    Toy["toy-sidecar: DHT11 / MPU6050 / FSR402 / WS2812B"]
    Boot["BOOT 键 GPIO0：短按急停 / 长按 2s 解闩锁"]
  end
  Board["原产品控制板 + 三路振动"]

  cloud <-->|"状态摘要 / 动作契约"| app
  app <-->|"BLE GATT（默认；网站 Web Bluetooth / App 原生桥）"| Toy
  app <-->|"WiFi WebSocket（备用；与 BLE 运行时互斥）"| Toy
  Boot -->|"本地停机；恢复只有这一条路"| Toy
  Toy -->|"AO3400A 并联原按键"| Board
```

职责边界是硬约束，不是建议：

- **云端**只产出台词与剧本推进，永远看不到原始传感器流与音频。
- **浏览器控制端** 是安全总督，在 LLM 之外硬编码封顶、过温拒绝加档、安全词后丢弃一切非 stop 动作。
- **固件**负责实时闭环。安全词、急停、过温熔断、90% 强度封顶**不依赖 App 与网络**。

两条设备通道承载完全相同的 JSON，但**同一时刻只开一条**：ESP32-S3 只有一路 2.4GHz 射频，共存要靠时分，12Hz 上行会开始抖，而这条链路上跑着停机指令。默认 BLE，当前通道长时间空闲且另一条已配置才切换，切换不重置闩锁、档位与模式。

## 目录

| 目录 | 内容 | 成熟度 |
|---|---|---|
| [`protocol/`](protocol/) | 三端唯一事实来源：契约、生成器、JSON Schema | 已冻结 `0.3.0-demo` |
| [`hardware/toy-sidecar/`](hardware/toy-sidecar/) | 玩具侧 ESP32-S3，**唯一一块板**：传感、入体推断、灯效、原按键模拟、BLE 与 WiFi 两条传输 | 功能完整 |
| [`software/app/`](software/app/) | 浏览器控制端（网站 + PWA） | 框架骨架 |
| [`software/app-android/`](software/app-android/) | 同一套 Web UI 的 Android 壳 | 框架骨架 |
| [`software/backend/`](software/backend/) | FastAPI 后端（同时托管网站） | 框架骨架 |
| [`datasheets/`](datasheets/) | 已选型器件的厂商 datasheet | — |
| [`docs/`](docs/) | 协作与提交规范 | — |
| [`docs/architecture/`](docs/architecture/) | 产品架构（权威副本） | V1.4 已归档 |
| [`docs/implementation/`](docs/implementation/) | B 层实施计划、落地记录与 Codex 文稿归档 | B3.0 |

`hardware/` 下原来还有一个 `k10-controller/`（行空板 K10：摇杆、屏、BLE Peripheral、ESP-NOW 网关），协议 `0.3.0-demo` 起已整个删除，手机改为直连玩具侧。目录名里的 "sidecar" 是双板时期留下的，暂不改名以免牵动所有路径引用。

## 上手

协作、分支、提交和评审流程见 [`docs/Nascent 开发与代码提交规范.md`](docs/Nascent%20开发与代码提交规范.md)。架构结论写在 [`docs/architecture/产品架构.md`](docs/architecture/产品架构.md)，不要只改飞书。改任何跨端字段之前，先读 [`protocol/README.md`](protocol/README.md)。

```bash
# 协议：改完 contract.yaml 后必须重新生成
cd protocol && python3 tools/gen.py

# 固件（需要 PlatformIO）。WiFi 备用通道要先填凭据，不填则只有 BLE
cd hardware/toy-sidecar
cp include/local_config.h.example include/local_config.h   # 可选，已被 gitignore
pio run

# 后端 + 网站
cd software/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# 打开 http://127.0.0.1:8000
# Android App：用 Android Studio 打开 software/app-android/，填入同一地址
```

Windows 上开发没有额外步骤：仓库全 ASCII 文件名、`.gitattributes` 锁 LF、
生成器显式 UTF-8 读写。唯一注意的是 venv 激活命令与 macOS/Linux 不同。

## 硬件选型（验证期已锁定）

| 器件 | 接哪块板 | 建议引脚 | 用途 |
|---|---|---|---|
| DHT11 | 玩具侧 | GPIO4 单总线 | 玩具环境温湿度，**非安全通道** |
| MPU6050 | 玩具侧 | I2C GPIO8/9 @0x68 | 入体状态推断 |
| FSR402 | 玩具侧 | GPIO1 ADC | 贴合与 1–2 Hz 节律 |
| WS2812B ×8 | 玩具侧 | GPIO6 RMT | 模式配色 + 档位颗数 |
| AO3400A | 玩具侧 | GPIO7 | 并联原按键走原板九档，漏极串 10kΩ 限流 |
| BOOT 键 | 玩具侧 | GPIO0，板载 | 短按急停，长按 2 秒解除停机闩锁。不需要接线 |

HW504 摇杆随 `hardware/k10-controller/` 一起删除，datasheet 只留档不再接线：它换来的只有「手机断连也能换档」，而原产品的实体按键本来就给了这条退路。

datasheet 与接线摘要见 [`datasheets/README.md`](datasheets/README.md)。

## 第三方依赖

通用驱动一律用社区成熟库，自己只写产品独有逻辑。固件侧的库源码 vendored 在
`hardware/*/lib/`，来源、版本与升级步骤见 [`hardware/VENDOR.md`](hardware/VENDOR.md)。

App 与后端不做 vendored——`pubspec.lock` 和 `requirements.txt` 已经锁了版本，
把源码拷进仓库反而破坏各自的工具链。

## 红线

- **不做医疗器械。** 禁止核心体温、疾病预警、生理周期监测的表述与算法承诺。
  `insert_state` 对外文案一律是「是否在使用中」，不是「插入检测」。
- **不做高潮检测。** 压力只用于贴合与节律。
- **安全功能永不收费。**
- **原始 12 Hz 传感器流与麦克风音频不出设备与 App。** 上云的只有离散枚举摘要。
- **按键支路不驱动电机。** 它只并联原按键，电机始终由原产品控制板驱动。
  AO3400A 的漏极串了 10kΩ，支路电流封在 0.37mA，这是物理保证而不只是纪律。
- **停机不能远程解除。** 安全词或急停之后，恢复的唯一途径是长按玩具侧板上的 BOOT 键 2 秒。
  这一条不靠「各处记得过滤 `resume`」来保证：固件里根本没有那条指令分支，
  `clearLatch()` 只有 BOOT 键的处理函数会调。过滤会漏，不存在的代码路径不会漏。
  用户喊过停之后设备自己重新动起来，是这个产品最坏的失败模式。
- **手机断连即归零。** 玩具侧唯一的本地入口是 BOOT 键，它只能停不能开，
  断连之后没有任何东西能再降档，所以断连的默认行为必须是停下来。
