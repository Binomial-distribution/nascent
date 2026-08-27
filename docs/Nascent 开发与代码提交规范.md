# Nascent 开发与代码提交规范

**适用对象：**所有参与 Nascent 固件、App、后端、协议、文档、测试和硬件接线的同事。

**目标：**让硬件、协议、软件可以并行开发，同时避免三端各写各的字段、互相覆盖代码、形成超大 PR，或把文件提交到错误目录。

每个小任务使用一个短分支，尽早创建 Draft PR；main 始终保持可集成。不要建立个人长期分支、模块长期分支或整个阶段共用分支。

验证期双板 Demo 的架构与红线见仓库根目录 [`README.md`](../README.md)。飞书架构文档（需权限）：<https://my.feishu.cn/docx/FggRdEmySofDoGx2WzFc77MznCd>

# 1. 仓库与 AI 入口

GitHub 仓库：[Binomial-distribution/nascent](https://github.com/Binomial-distribution/nascent)

仓库根目录 `AGENTS.md` 要求 AI 在开发、Review、文档和协议任务开始前阅读本文件，以及任务涉及的子目录 README。

当前**没有**独立的范围校验 Skill。本文件就是协作规范。AI 不会自动提交、推送或合并代码，除非使用者明确授权相应操作。

# 2. 首次拉取和日常更新

**首次拉取：**

```bash
git clone https://github.com/Binomial-distribution/nascent.git
cd nascent
```

固件首次构建会从 GitHub 拉 DFRobot `platform-unihiker` 与 espressif32 工具链，耗时较长。第三方驱动已经 vendored 在 `hardware/*/lib/`，不需要再跑 `pio lib install`。

**开始新任务前：**

```bash
git switch main
git pull --ff-only
git status --short --branch
```

如果工作区已有未提交修改，不要通过 reset、clean、stash 或覆盖文件来强行更新。先确认这些修改属于谁、是否与本任务相关；不能安全绕开时，及时说明。

# 3. 每个小任务建立一个短分支

分支应对应一个可以独立说明、测试和 Review 的任务，通常在 1—2 天内形成 Draft PR。

| 类型 | 示例 | 适用情况 |
|---|---|---|
| 协议 | `feat/protocol-resume` | 改 `contract.yaml`、生成物、GATT / ESP-NOW 文档 |
| 固件 | `feat/k10-joystick-deadzone` | 单板、单模块的功能或标定 |
| 软件 | `feat/app-ble-scan` | App 或后端的一块可演示功能 |
| 修复 | `fix/toy-dht-interval` | 明确且范围较小的问题修复 |
| 文档 | `docs/pinout-k10` | 接线、决策、协作规范 |
| 工程配置 | `chore/vendor-neopixel` | 工具链、依赖升级、gitignore |

```bash
git switch -c feat/your-small-task
```

不要使用“某某个人开发分支”“固件长期分支”或 `demo-phase` 共用分支。联调演示使用已经集成的 main；如需固定演示快照，在演示提交上创建 `demo-0.1` 一类标签。

# 4. 文件放置规则

| 路径 | 放置内容 | 注意事项 |
|---|---|---|
| `protocol/` | 三端唯一事实来源：`contract.yaml`、生成器、Schema、链路文档 | 改协议只改契约再跑生成器。禁止手改 `generated/`、`schemas/`，以及投放到 App/后端包内的副本 |
| `hardware/k10-controller/` | K10 主控：摇杆、屏、BLE、ESP-NOW 网关 | 屏幕/按键 API 对照 `reference/` 下的官方示例，不要凭记忆猜。`lib/ArduinoJson` 是 vendored 库，不要顺手改 |
| `hardware/toy-sidecar/` | 玩具侧：传感、入体推断、灯语、CD4066、板间链路 | 这块板不驱动电机。`lib/` 下是 vendored 驱动，升级步骤见 `hardware/VENDOR.md` |
| `hardware/VENDOR.md` | 第三方库来源、版本、裁剪规则 | 升级库必须同步改这个文件 |
| `software/app/` | Flutter 控制端（Android 优先） | A 层不放调强度的控件。发指令只走 `senderProvider`，不许绕过 `Governor` |
| `software/backend/` | FastAPI 云端 | 云端只给建议，不控制硬件。密钥只进 `.env`，不进仓库 |
| `datasheets/` | 已选型器件的厂商 datasheet | 不放视频、超大原稿、临时导出 |
| `docs/` | 协作规范、决策记录 | 确认结论和开放问题应分开记录 |

**跨端字段一律进 `protocol/contract.yaml`。** 不要在固件宏、Dart 常量和 Python 模型里各抄一份 UUID、档位上限或超时。改完契约后必须：

```bash
cd protocol && python3 tools/gen.py
```

并在同一个提交里带上 `contract.yaml`、`protocol/generated/`、`protocol/schemas/`、`software/app/lib/core/protocol/protocol.dart`、`software/backend/app/protocol.py` 以及 `protocol/CHANGELOG.md`。

# 5. 提交前的标准流程

1. 运行本任务相关的检查（见下表）。涉及协议时必须先跑 `python3 tools/gen.py --check`。
2. 检查全部改动，确认没有混入他人的文件、密钥、本机 MAC、临时文件和超大素材。
3. 只暂存本任务明确负责的路径。
4. 创建一个语义完整的 Commit，推送分支并建立 Draft PR。

```bash
git status --short --branch
git diff --name-status
git diff --check

# 只加入自己负责的具体路径
git add -- path/you-own another/path/you-own
git diff --cached --name-status
git diff --cached

git commit -m "feat: describe the coherent change"
git push -u origin feat/your-small-task
```

禁止在混合工作区中使用 `git add .`、`git add -A` 或 `git commit -am`。

禁止提交：`.env`、私钥、访问令牌、本机 `PEER_MAC_*`（真实 MAC 写进已被 gitignore 的 `local_config.h`）、`.pio/`、`node_modules`、`.venv/`、构建产物、以及未按 `VENDOR.md` 裁剪的完整第三方仓库。

## 各层提交前检查

| 改了什么 | 最少要跑 |
|---|---|
| `protocol/contract.yaml` 或生成器 | `python3 protocol/tools/gen.py --check` |
| `hardware/toy-sidecar/` | `cd hardware/toy-sidecar && pio run`（有板再 `-t upload`） |
| `hardware/k10-controller/` | `cd hardware/k10-controller && pio run` |
| `software/app/` | `cd software/app && dart analyze`；有真机再 `flutter run` |
| `software/backend/` | `python3 -m py_compile app/*.py app/routers/*.py app/services/*.py` |

没有 PlatformIO 或 Flutter 时，在 PR 里写明「本机未构建、请 Reviewer 补跑」，不要假装已经验证过。

# 6. Pull Request 与评审

开发开始后尽早创建 Draft PR，不必等整块板或整层 App 做完。PR 应说明改了什么、为什么修改、用户或设备影响、验证结果、明确未包含的工作以及需要谁 Review。完成后由相应 Reviewer 确认，再合并 main。

| 改动类型 | 必须 Review 的角色 | 原因 |
|---|---|---|
| `protocol/contract.yaml`、GATT / ESP-NOW 帧、枚举线序 | 项目负责人 | 三端同时失效或静默错位 |
| 安全路径：`safety.*`、`governor.dart`、`resume` / `stop`、CD4066 时序、档位封顶 | 项目负责人 | 停机、封顶、远程恢复都是产品红线 |
| BLE 鉴权、会话令牌、云端密钥与审核开关 | 项目负责人 | 影响设备被谁控制 |
| 入体推断、对外文案、医疗化表述 | 项目负责人 | 文案和算法承诺受产品红线约束 |
| 引脚、CD4066 供电方案、vendored 库升级 | 硬件主责 | 焊错脚或重复定义库会让整板不可用 |
| 普通 UI、后端桩、模块内测试、文档 | 模块主责，可邀请其他同事 | 由最熟悉该层的人负责质量 |

项目负责人不需要逐条检查每个 Commit，但需要关注每个 PR，并亲自 Review 上表中的高风险改动。协议和安全相关改动建议在开始实现后尽早建立 Draft PR，以便提前发现方向问题。

# 7. 使用 AI 开发时怎么说

在 Cursor 或其他支持仓库指令的 AI 工具中，可以使用下面的开场说明：

> 请先阅读仓库根目录 AGENTS.md 和 docs/Nascent 开发与代码提交规范.md，再开始本任务。只修改本任务负责的文件，保留其他人的改动；使用短分支。改协议只改 protocol/contract.yaml 再运行 python3 protocol/tools/gen.py，禁止手改 generated/ 和投放到 App/后端的协议副本。固件通用驱动用现有 vendored 库，不要自己写 DHT11 / MPU6050 / NeoPixel / JSON / ESP-NOW 底层。先创建 Draft PR，不要自行合并。

如果任务涉及协议、安全路径、停机恢复、档位封顶、入体推断文案或引脚，还应明确告诉 AI：这是需要项目负责人 Review 的高风险改动。

# 8. 本规范覆盖到哪里

已经约定：短分支、显式暂存、Draft PR、文件放置、协议生成流程、提交前检查和高风险评审。

尚未具备：自动范围校验器、CI 里的 `gen.py --check`、固件硬件在环测试。没有这些工具时，仍按第 5、6 节人工执行；不要因为没有 CI 就跳过 `gen.py --check`。

本规范替代不了上板验证和人工 Review。每个涉及执行器或停机路径的任务，最终仍需在真机上确认：停止立刻生效，且不能从 App 远程恢复。



# 10. 适用边界

当前目录规则和红线专用于 Nascent 仓库。其它产品可以立即采用短分支、显式暂存、Draft PR 和高风险评审原则，但不能直接复制本仓库的协议生成流程或硬件 vendored 约定。

<https://github.com/Binomial-distribution/nascent>
