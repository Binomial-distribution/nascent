# App 心绪与亲密时刻实施记录

更新时间：2026-08-28
分支：feat/app-heart-intimacy
状态：心绪/亲密 UI 与协议骨架已完成；B 层 9B Agent、模板、记忆和 IRPI 联调骨架已落地，生产链路待实施

## 目标

交付 Android 优先的 Flutter 交互骨架，完成心绪、亲密时刻和我的三层入口。心绪记录与身体笔记本轮只保存在当前 App 运行内，不接云端、SQLCipher 或完整 BLE 扫描流程。

## 实施清单

- [x] 保留已有心绪页面、知识卡、收藏和分享预览
- [x] 增加五种心绪的内存记录与连续天数
- [x] 增加亲密时刻入口、情境漫游和身体笔记
- [x] 将控制页命名为“我的节奏”，保留停止优先和 Governor 约束
- [x] 将底部导航调整为“心绪 / 亲密时刻 / 我的”
- [x] 将 mood_tone 写入协议契约并生成跨端产物
- [x] 锁定 B 层实时 API 主模型为 `Qwen/Qwen3.5-9B`，服务端逻辑别名为 `nascent-chat-9b` 与 `nascent-control-9b`
- [x] 完成 B 层三层 Prompt、Persona 隔离、记忆确认/删除和 Waifu 边界文档
- [x] 完成温度/压力摘要进入 `sensor_context` 的数据流设计
- [x] 完成实时语音延迟预算、超时回退和停止优先策略设计
- [x] 确认身体笔记为与情境漫游、我的节奏平行的独立模块，并设计“只看这一次 / 参考近期记录”两个自我探索入口
- [ ] 接入真实 `Qwen/Qwen3.5-9B` API、WebSocket 流式输出和 Schema 校验
- [ ] 将温度/压力趋势聚合接入 Agent 请求上下文
- [ ] 实现 Persona、会话、身体笔记和关系记忆的持久化与删除 API
- [ ] 实现本地 ASR/VAD、TTS、barge-in 与 Rive/Waifu 表现适配
- [ ] 运行 Dart 分析与 Flutter 测试（环境阻塞：本机没有 Flutter/Dart SDK）
- [ ] 构建 Android debug APK（环境阻塞：本机没有 Flutter/Android SDK，仓库也没有 android 平台目录）
- [x] 完成 Draft PR（PR #1）

## 安全边界

- 所有设备指令只通过 senderProvider 发送。
- stop 在任何状态下都可发送；App 不提供远程 resume。
- 断连、遥测过期或 link_lost 时，Governor 只放行 stop。
- 情境漫游本轮不自动调档；未来自动调档必须标记 automatic: true。
- 不把环境温度当作安全过温通道。
- 心绪和身体笔记文案不做诊断或异常判断。
- 9B 只接收经过聚合的温度/压力趋势和数据质量，不接收原始 12Hz 数组、压力原始值、PCM、真实设备 MAC、密钥或安全词原文。
- 9B 不得直接控制 BLE、档位、灯光、PWM、停止闩锁、失控计时或删除数据；任何动作建议都必须经过 `Governor` 与 `senderProvider`。
- 温度/压力只影响表达、询问和情景节奏；用户明确表达优先，`unknown` 或质量不足时不猜测。

## 验收记录

### 协议

- 契约版本：0.2.0-demo
- 新增枚举：quiet、open、warm、bright、tired
- UserTags.mood：enum:mood_tone
- BLE 指令、传感器字段和设备安全规则：未改变

### B 层 9B Agent 设计与联调记录

- 主模型：`Qwen/Qwen3.5-9B`
- 服务端别名：`nascent-realtime-9b`
- 调用模式：关闭 Thinking、严格 JSON Schema、短句流式输出；App 不依赖供应商模型名
- Prompt 结构：固定安全系统层 + 当前 Persona 层 + 会话动态层（最近 6 轮、滚动摘要、已授权记忆、`sensor_context`、本轮输入）
- 输出分流：`dialogue/avatar` 进入 TTS/Waifu；`action` 进入 App `Governor`；`memory_proposals` 必须由用户确认后写入
- 失控模式：默认不生成关系记忆；不使用 AI 作为计时器、停止器或恢复器
- 失败回退：超时、非法 JSON、审核拒绝或记忆服务失败时使用本地安全短句，`action=null`

### 温度/压力到 AI 的数据流

```text
ESP32 12Hz 采样
  -> 固件滤波与安全判断
  -> App 约 1Hz 趋势聚合
  -> 每 5-10 秒或状态变化生成 CloudSummary/sensor_context
  -> 只读注入 Qwen3.5-9B Prompt
  -> 只影响台词、询问和场景节奏
```

云端只收到 `temp_state`、`pressure_rhythm`、质量和当前会话状态等摘要，不收到原始数组或音频。当前仓库尚未完成这条真实运行链路，本节记录的是实施契约而非已接通状态。

### 后端联调验证

- `pytest software/backend/tests -q`：6 passed
- `ruff check software/backend/app software/backend/tests`：通过
- `python -m compileall -q software/backend/app software/backend/tests`：通过
- FastAPI 路由装配：包含 `/v1/agent/turn`、`/v1/agent/control-decision`、模板、记忆和偏好接口

### Android 构建

- flutter pub get：未执行，本机没有 flutter 命令
- dart analyze：未执行，本机没有 dart 命令
- flutter test：未执行，本机没有 Flutter/Dart SDK
- flutter build apk --debug：未执行，本机没有 Flutter/Android SDK，仓库没有 android 平台目录
- APK 路径：暂无；不能把未构建结果当作 APK 交付

### Git 交付

- 提交：16d09c3 feat: add heart and intimacy app framework
- Draft PR：#1

### 已完成检查

- protocol/tools/gen.py --check：通过
- Python 生成协议模块 py_compile：通过
- git diff --check：通过

## 本轮不包含

- BLE 扫描、连接 UI 和 Android 12+ 权限申请
- 云端 HTTPS、SQLCipher、本地持久化迁移
- 情境剧本驱动设备的自动调档
- 远程解除停止状态

## 开源 Agent 选型与模板实现（2026-08-28）

- [x] 新增 `docs/architecture/开源Agent与情感对话方案评估.md`，记录 Mem0、Pipecat、Letta、Open-LLM-VTuber 和 LiveKit Agents 的适用范围、许可证核对和不直接整包合并的原因。
- [x] 增加 `MemoryProvider`：按 `user_id + persona_id` 隔离，支持检索、逐条删除、按人设删除和用户全量删除；默认是本地内存实现，接口预留 Mem0/SQLCipher 替换。
- [x] 增加 `AgentTurn` 严格 JSON 契约：对话、Waifu 表现、场景控制、待确认记忆候选和 `skill_proposals` 分流；`action` 强制为 null。
- [x] 增加预置模板和用户自定义模板生命周期：`draft -> confirmed`；聊天生成只能得到草稿，必须由用户确认后保存。
- [x] 增加受限硬件 Skill 白名单：只允许参数化节奏段/波形建议，不能声明 BLE、停止、恢复、延长失控时长或安全阈值。
- [x] 增加 `/v1/agent/turn`、`/v1/agent/templates/*` 和 `/v1/agent/memory*` 本地联调接口。
- [x] 增加 Qwen 9B OpenAI-compatible HTTP 适配器；未配置网关、超时、非法 JSON 时回退本地短句，设备状态不受影响。
- [x] 增加 IRPI 偏好服务：明确反馈优先、传感器质量门控、偏好快照隔离和删除。
- [x] 增加 `/v1/agent/preferences/observe`、`GET/DELETE /v1/agent/preferences` 联调接口。

### 模板交互口径

1. 选择页只展示预置模板和已确认的自定义模板。
2. 创建页是独立的聊天页，用户用自然语言描述节奏，Agent 返回模板草稿。
3. 预览页展示名称、语气、Skill、档位范围、时长和“需要确认”的提示；这里不启动设备。
4. 用户确认后模板才进入使用页；Skill 调度仍由 App `Governor + senderProvider` 执行。
5. 删除入口位于模板管理页；删除模板后可级联删除该 Persona 的关系记忆，不能再检索。

### 本轮仍未完成

- 内存适配器还没有换成持久化数据库或自托管 Mem0。
- Agent API 尚未接入生产鉴权、内容审核服务和 WebSocket 流式传输。
- Flutter 使用页尚未接上 `skill_proposals` 的确认弹层和 Skill 到 `senderProvider` 的映射。
- 本机没有 Flutter/Dart/Android SDK，无法宣称 Android APK 已构建。

## 后续 B 层补充方案（仍未实施）

以下设计已写入架构文档，但尚未接入 Flutter/持久化/协议字段：

- `我的节奏 / 失控模式` 使用用户选择的有限时长，计时起点以设备确认开始为准。
- `我的节奏` 采用三个主入口：`常用人设`、`新建人设`、`定时失控`；采用 2+1 布局，入口位于单手拇指热区。
- 失控模式不使用语音安全词作为结束条件，但实体停止、设备急停、温度/电量保护、链路看门狗和固件硬超时不可关闭。
- 最终计时器由 K10/固件持有；App 和后端只显示、记录和接收状态，不能远程延长或恢复。
- 新增后端事实数据设计：`session_control`、`session_event`、`session_trend` 和 `body_note`。
- 新增 UI 删除入口：单条记忆、单次会话数据、身体笔记、Persona、Persona 关系记忆和全部数据。
- `身体笔记` 后续实现为“使用记录列表 -> 单次记录详情 -> 了解自己对话”；详情页使用两个同级按钮：`只看这一次` 仅授权当前记录，`参考近期记录` 在用户确认具体日期和模式后授权最近 5 次、最多 10 次记录。
- 自我探索对话复用 Chat 9B，但采用不含动作字段的独立输出契约；默认不持久化整段对话，只有用户点击“保存这条发现”才写入可编辑、可删除的身体笔记。
- 失控模式会话默认不自动写入关系记忆，只有用户逐条确认后才能保存。
- 两份 B 层技术方案已统一：主逻辑以 `docs/architecture/B层情景模式技术实现.md` 为准，Agent 与语音文档作为配套附录。
- `docs/architecture/B层Agent提示词契约.md` 已作为 9B Prompt、输出 JSON、记忆边界和 Waifu 输入的独立契约；实现时不得由客户端自由拼接系统 Prompt。
- 9B API 的部署地域、网关、模型快照和密钥尚未登记到联调环境；这些信息不进入仓库。

下一轮实施前必须先将计时、删除和数据字段写入 `protocol/contract.yaml`，再运行协议生成器，并补充数据库迁移、权限检查和 Android UI 验收。
