# App 心绪、亲密时刻与 B 层实施记录

更新时间：2026-08-28
当前分支：`feat/body-notes-insight`
基线：已合并 `origin/main`（含 AO3400A）
状态：共享 Web UI 和 Android 壳框架已存在；B 层 Agent 联调骨架与身体笔记纵向切片已完成。B3.0 是权威规格，见 [`docs/architecture/B层完整版技术文稿-双模型与偏好闭环.md`](../architecture/B层完整版技术文稿-双模型与偏好闭环.md) 与 [`docs/implementation/B层完整软件实施计划-B3.0.md`](B层完整软件实施计划-B3.0.md)。本分支继续更新 Draft PR #6，不自动合并。完整情景 UI、传感器接入、有限自动适配和语音拆后续短 PR。

## 当前软件形态

控制端已经从历史 Flutter 方案迁移为两部分：

- `software/app/`：FastAPI 托管的共享 Web UI / PWA，负责心绪、亲密时刻、我的、`Governor` 和唯一设备命令入口 `sendCommand()`。
- `software/app-android/`：Android WebView 壳和原生 GATT 桥，展示同一套 Web UI，不在 Kotlin 中复制页面、Agent 或安全总督。

亲密时刻保持三个并列模块：

```text
亲密时刻
├─ 情境漫游
├─ 我的节奏
└─ 身体笔记
```

选择页与实际使用页保持分离。身体笔记也使用独立导航，不与情境选择或控制页合并。

## 本分支已完成

### B 层基础架构

- [x] Chat 9B 与 Control 9B 使用两个逻辑模型配置，可先指向同一个 `Qwen/Qwen3.5-9B` 服务，部署时再拆副本。
- [x] 新增 `POST /v1/agent/parallel-turn`，同一回合用 `asyncio.gather` 并行启动 Chat 与 Control；总等待接近较慢通道而不是两段超时相加。
- [x] 两条通道独立降级：Chat 异常只回退安全台词，Control 异常只返回 `hold`，不会互相取消，也不进入设备停止链路。
- [x] 并行响应返回可供 UI 展示的脱敏 `data_flow`，只显示数据阶段，不泄露 Prompt、原始采样或内部记忆文本。
- [x] Persona 预置模板、自定义草稿、确认后使用和删除接口骨架。
- [x] 关系记忆按用户与 Persona 隔离，只有确认后写入，并支持逐条、按 Persona 和全量删除。
- [x] Control 9B 只生成受限建议，`action` 强制为空；失控模式、未同意、数据过期或质量未知时返回 `hold`。
- [x] 温度与压力只以聚合趋势和数据质量进入模型，不上传原始 12 Hz 数组、音频、设备地址、密钥或安全词。
- [x] OpenAI-compatible HTTP 适配器、严格 JSON 解析、短超时和本地安全回退。

### 身体笔记纵向切片

- [x] 页面分层：`使用记录列表 -> 单次记录详情 -> 了解自己对话`。当前详情底栏仍是过渡实现：两个同级按钮 `只看这一次` 与 `参考近期记录`。B3.0 产品口径改为单一 `了解自己` 入口，下一轮导航 PR 再改 UI。
- [x] 单次详情展示日期、模式、时长、数据完整度、低频档位/压力图、温感趋势、压力趋势和用户反馈。
- [x] 详情页底部当前仍是两个同级按钮：`只看这一次` 与 `参考近期记录`（过渡实现）。
- [x] `只看这一次` 只发送当前 `session_id`。
- [x] `参考近期记录` 默认选择最近 5 次可用记录、最多 10 次，并在进入前展示确切日期、模式和时长。
- [x] 微信式临时对话页面持续显示当前读取范围和数据来源。
- [x] 临时对话默认不持久化，只有点击 `保存这条发现` 才创建可删除的 `body_note`。
- [x] 单次记录和单条发现都有可见删除入口与二次确认。
- [x] 在线后端删除失败时 UI 不再假装成功；只有纯静态演示允许本地内存删除。
- [x] 自我探索输出只允许 `dialogue` 和 `insight_candidate`，设备控制、Skill、诊断、确定性愉悦结论和固定偏好话术会被拒绝。
- [x] PWA 缓存已加入 `js/body-notes.js`。

## 身体笔记 API

```text
GET    /v1/body-notes/sessions
GET    /v1/body-notes/sessions/{session_id}
DELETE /v1/body-notes/sessions/{session_id}
POST   /v1/body-notes/sessions/{session_id}/note
PATCH  /v1/body-notes/{note_id}
DELETE /v1/body-notes/{note_id}
POST   /v1/body-notes/insight-turn
```

当前 `InMemoryBodyNotesStore` 是可替换的联调实现。生产版必须增加登录用户归属校验、数据库迁移、删除审计和多实例一致性，不能把进程内存当作正式存储。

## AI 数据走向

```text
ESP32 12 Hz 采样
  -> 固件滤波与本地安全判断
  -> Web UI / App 生成低频趋势与质量
  -> 用户在身体笔记中选择读取范围
  -> 后端按显式 session_id 取已授权记录
  -> 只生成来源标识 + 数据质量 + 温感/压力聚合趋势
  -> Chat 9B 严格 JSON 输出
  -> UI 展示临时对话
  -> 用户主动点击“保存这条发现”后才写入笔记
```

不会发送给身体笔记模型的字段：档位时间线、原始温度/压力数组、音频、MAC、密钥、安全词、BLE 命令、Skill、停止闩锁和失控计时器。

## 双模型与延迟预算

| 角色 | 责任 | 默认超时 | 失败行为 |
| --- | --- | --- | --- |
| Chat 9B | 对话、人设草稿、身体笔记自我探索 | 8.0 秒 | 返回本地短句，不产生动作 |
| Control 9B | 只读趋势上的受限节奏建议 | 2.5 秒 | `decision=hold`，不改变当前状态 |

情境漫游的单轮编排：

```text
同一用户事件
  ├─ Chat lane: 用户输入 + 已授权记忆 -> Chat 9B -> 台词/人设表现
  └─ Control lane: 聚合温压趋势 + Skill 白名单 -> Control 9B -> 待确认建议

待确认建议 -> 用户确认 -> Governor -> sendCommand() -> 设备安全规则
```

两条 lane 并行执行但不共享输出：Chat 不能读取 Control 的档位建议，Control 不能读取完整聊天记忆。身体笔记的自我探索不属于设备使用回合，因此只调用 Chat lane，不启动 Control lane。

两个角色通过以下环境变量配置：

```text
NASCENT_LLM_API_KEY
NASCENT_LLM_BASE_URL
NASCENT_LLM_MODEL
NASCENT_CHAT_LLM_MODEL
NASCENT_CONTROL_LLM_MODEL
NASCENT_CHAT_LLM_TIMEOUT_S
NASCENT_CONTROL_LLM_TIMEOUT_S
```

仓库只提交空白 `.env.example`。聊天中出现过的密钥视为已泄露，不得用于联调或写入命令；必须先在服务商控制台撤销并生成替换密钥，然后只放进被 Git 忽略的 `software/backend/.env`。真实联调还需要确认服务商的 OpenAI-compatible `base URL` 和准确模型 ID。

## 安全边界

- 所有设备指令只走 Web UI 的 `sendCommand()`，由 `Governor` 先检查；Android 壳不旁路。
- `stop` 始终优先；App 和云端不提供远程 `resume`。
- 身体笔记历史页不包含恢复、调档、延时或设备动作。
- 失控模式的最终计时和停止由设备持有，AI、后端和 WebSocket 都不能延长或解除。
- Chat 9B 和 Control 9B 都不是安全控制器；网络、模型或解析失败不得阻塞本地停止路径。
- 温感、压力和 IRPI 权重只能形成待确认观察，不得直接断言性功能、高潮、异常或固定偏好。
- 删除记录后必须立即从 Agent 可检索范围移除；生产版还需用鉴权与数据库事务实现这一约束。

## 验证记录

截至 2026-08-28，本分支已运行：

- `node software/app/tests/run.mjs`：30 passed，0 failed。
- 本机 PATH 没有可用的 Python 解释器，未复跑 `pytest` / `ruff` / `gen.py --check`；这些检查已写入 `.github/workflows/ci.yml`，由 CI 执行。
- 新增覆盖：Control `hold` 不改写为 `skill_not_allowed`、记忆负 limit、insight「不代表固定偏好」可通过校验、身体笔记加载中拒绝删除。

浏览器在 360 x 800 视口完成了记录列表、单次详情和“只看这一次”独立聊天页检查：底部两个同级入口可见，页面无横向溢出，聊天回复显示来源范围和“保存这条发现”按钮。近期范围选择、后端失败不误删和纯静态本地删除由前端自动化测试覆盖；删除确认没有在浏览器中实际执行，以免改动联调数据。

本分支没有增加 BLE 跨端字段，因此没有修改 `protocol/contract.yaml`。身体笔记请求/响应属于后端应用层契约，不应伪装成设备协议字段。

## Android 状态

- Android 使用 `software/app-android/` WebView 壳展示同一套页面。
- 本轮前端改动不要求在 Kotlin 中复制 UI。
- 2026-08-28 实机环境检查：Android Studio 安装于 `D:\Program Files\Android\Android Studio`，自带 JBR 可运行；用户 SDK 当前只发现 `android-37.0`。
- 仓库的 `software/app-android/` 缺少 `gradlew`、`gradlew.bat` 和 Wrapper JAR，工程又声明 `compileSdk 34`；因此本轮没有可复现的命令行 Gradle 入口，也没有生成 APK，不宣称构建成功。
- 后续需由 Android Studio 同步并补齐 SDK 34/Gradle Wrapper，再执行 `gradlew.bat assembleDebug`，将真实 APK 路径写回本文件和 PR。
- 浏览器/Android 壳的最终真机验收仍需覆盖 360px 单手布局、键盘弹出、删除确认、两种读取范围和返回路径。

## 尚未完成

- 真实 9B 网关、替换密钥和模型 ID 的联调与延迟压测。
- WebSocket 流式响应、VAD、ASR、TTS、barge-in 和 Waifu/Rive 表现层。
- 身体笔记、Persona、关系记忆和偏好快照的生产数据库、鉴权、导出和删除审计。
- [ ] 情境漫游完整微信式会话列表、独立人设选择页（选择已有 / 定义 / 对话创建）和实际使用页。
- [ ] 我的节奏改为自由档位 / 失控模式两入口，选择页与使用页分层。
- [ ] 身体笔记详情改为单一「了解自己」入口（读取当前 + 最多 5 次近期）。
- [ ] Control 9B 的 Skill 确认 UI 与 `sendCommand(..., { automatic: true })` 映射。
- [ ] SensorSnapshot、Health Connect（小米手环）、ResponseAssessment、WellnessAssessment。
- [ ] 失控模式设备本地计时的协议字段、固件实现和真机验收。
- [ ] Android Gradle 构建和真机 GATT 联调。

## Git 交付

- 当前短分支：`feat/body-notes-insight`。
- 本轮：B3.0 规格收口 + PR #6 Review 修复。
- 推送后更新 Draft PR #6，不自动合并。
