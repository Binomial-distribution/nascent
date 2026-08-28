# B 层实时 Agent、语音与角色表现方案

> 状态：建议方案，待项目负责人 Review 后实施
> 日期：2026-08-28
> 适用范围：共享 Web UI + Android WebView 壳的「亲密时刻」B 层及 FastAPI Agent 后端

本文件是 [`B层情景模式技术实现.md`](B层情景模式技术实现.md) 的 Agent、语音和角色表现附录；页面结构、失控模式计时、安全边界、后端事实存储、记忆隔离和删除规则以主方案为准。

## 1. 当前实现成熟度

当前 B 层约完成了可运行骨架，尚不是实时 Agent：

- App 已有亲密时刻入口、三段式本地情境、我的节奏控制页和内存身体笔记。
- 控制页的命令经过 `senderProvider` 与 `Governor`，停止按钮常驻。
- 后端已有 `CloudSummary -> CloudActionEnvelope` 接口形状、固定 Persona 和动作越界检查。
- `services/llm.py` 仍返回固定台词，没有真实模型、流式传输、语音、记忆或完整内容审核。

按交付能力估算，B 层 UI/安全骨架约完成 50%，实时 Agent 能力约完成 15% 到 20%。

## 1.1 与主方案统一的关键口径

- 失控模式不把语音安全词作为结束条件，但实体停止、设备急停、温度/电量保护、链路看门狗和固件硬超时始终有效。
- 失控模式的最终计时器在 K10/固件；Agent、后端、TTS 和 Avatar 无权开始、延长、缩短或恢复计时。
- 计时到期只产生 `stop` 和停止事实，不产生远程 `resume`；重新开始必须走设备侧既有物理确认。
- 失控模式会话默认不自动写入关系记忆；用户可以在会话结束卡片逐条确认，也可以从“我的 -> 数据与隐私”删除记忆、会话、身体笔记或整个人设。
- 删除后的会话和记忆必须立即从 Agent 检索、推荐和缓存中失效；删除动作不能被 Agent 或设备侧消费。

## 2. 决策摘要

MVP 采用级联式 Hybrid Agent，不采用云端原生 Speech-to-Speech：

```text
Android 麦克风
  -> 本地 VAD
  -> 本地流式 ASR
  -> 本地会话意图识别（设备侧安全词独立并行）
  -> 离散 user_event 与 CloudSummary
  -> 后端 WebSocket
  -> 云端文本 LLM 流式生成
  -> App 本地 TTS，或后端流式 TTS
  -> Android 播放 + 角色口型/表情
```

推荐组件：

| 能力 | MVP 选择 | 后续增强 |
| --- | --- | --- |
| 实时对话与建议模型 | MVP 固定使用 API 模型 `Qwen/Qwen3.5-9B`，关闭思考，严格 JSON Schema；逻辑别名 `nascent-chat-9b` / `nascent-control-9b`，HTTP `model` 使用供应商 ID | 只有完成同地域真实话术集 A/B，并且首句延迟、Schema 成功率、拒答率和成本同时更好，才允许更换版本 |
| 角色台词模型 | 复用实时 `Qwen/Qwen3.5-9B`，只输出短台词和表现标签 | 后续可以评测其他模型，但必须通过同一 `AgentModel` 适配层，不能绕过审核、Governor 或改变 App 契约 |
| 剧本规划/会话总结 | 首版仍复用 `Qwen/Qwen3.5-9B`，异步执行，不增加第二个实时 API | 后续如引入更大模型，只能放在异步规划/总结，不得替换实时 9B 关键路径 |
| Android 流式 ASR | `sherpa_onnx` + 中文/中英 Zipformer | 按目标手机做 int8、线程数和模型包体调优 |
| VAD | sherpa-onnx 的 Silero VAD | 加入回声消除、降噪与环境噪声标定 |
| TTS | 首版 Android 系统 TTS 或 sherpa-onnx 本地 TTS | 用户明确同意后，可评测 Qwen3-TTS 实时模型，只上传模型回复文本并流式下行音频 |
| 角色表现 | Rive Flutter 状态机 | 角色资产成熟且完成授权评估后再接 Live2D Cubism |
| App/后端传输 | 单条长连接 WebSocket，增量文本/句子事件 | 断线恢复、会话迁移和区域路由 |

## 3. 为什么本轮固定使用 Qwen3.5-9B API

本项目本轮 API 主模型固定为 `Qwen/Qwen3.5-9B`。Chat 与 Control 使用独立逻辑别名 `nascent-chat-9b` / `nascent-control-9b`，第一阶段都解析到同一供应商快照。9B 的定位是实时中文角色对话，不是设备控制器，也不是记忆数据库。实时调用关闭 Thinking，要求严格 JSON Schema，并以短句流式输出降低语音首声延迟。模型供应商或具体快照发生变化时，只修改后端适配器配置和 Prompt 版本，不让 App 直接依赖供应商模型名。旧别名 `nascent-realtime-9b` 已废弃。

Agent 输出必须被限制为已定义的 `dialogue / action / scene_ctrl / emotion`。9B 可以同时生成台词、情绪、场景控制建议和记忆候选，但服务端必须在 Schema 校验、内容审核后将这些字段分离处理；Waifu 只消费台词和表现字段，动作建议仍须经过 App Governor 与 `senderProvider`。

首版不额外依赖 Plus 或更大模型。9B 的异步调用可以负责场景预规划、Persona 语气草案和会话后总结，但这些任务不得阻塞实时聊天、停止按钮、BLE 或失控模式计时。未来更换异步模型不改变本 Prompt 契约，也不能改变实时主链路的安全边界。

OpenAI Realtime 和 Gemini Live 都适合做自然的语音打断与 Speech-to-Speech，但它们要求把麦克风音频持续上传云端。这与当前“麦克风音频不上云、HTTPS/BLE 抓包无 PCM”的架构验收冲突，因此只能作为未来在隐私架构正式变更后的备选，不能直接接入 MVP。

模型选择还必须通过真实话术集做供应商内容策略评测。亲密场景不能依赖未验证的自由生成；首版应以审核过的场景节点为主体，模型负责短回应、过渡和语气变化，命中拒答或超时则回退本地台词。

后端应提供自己的 `AgentModel` 适配层，不让 App 认识供应商模型名。至少支持主模型、影子评测模型和固定台词回退；模型升级只改服务端配置与审核版本，不发新版 App。

## 4. 语音输入边界

当前契约只允许云端接收状态摘要，不应直接增加完整 ASR 原文上云。首版语音输入定位为“会话意图通道”：

- 本地识别：继续、暂停、结束、慢一点、快一点、轻一点、换一个、我有点紧张、可以继续等。
- 本地映射为枚举 `user_event`，再进入 `CloudSummary`。
- ASR 临时文本仅保留在内存滚动缓冲，完成意图映射后立即清除，不写日志和分析平台。
- 开放式自由聊天若要上传转写文本，必须单独修改产品架构、隐私同意、协议契约和删除机制，并由项目负责人 Review。

对话麦克风和安全词麦克风是两条不同的链路：

- 手机麦克风用于 Agent 交互，App 被杀后可以失效。
- 安全词必须继续由设备侧 I2S 麦克风和 ESP32 本地识别，不能依赖手机 ASR、网络或 LLM。
- Agent 听到“停止”时可以额外请求 `stop`，但这只是冗余路径，不能替代设备侧 300ms 安全闭环。

## 5. 延迟预算

以下是工程目标，不是供应商保证值。应在目标 Android 中低端机和国内 4G/Wi-Fi 上记录 p50、p95、p99：

| 阶段 | 目标 |
| --- | ---: |
| 本地 VAD 起音检测 | 50-120ms |
| 本地流式 ASR 首个稳定片段 | 180-450ms |
| 端点尾静音 | 250-400ms |
| App 到国内后端 | 40-150ms |
| Qwen3.5-9B 首个可播短句 | 150-500ms |
| TTS 首段音频 | 本地 80-300ms；云端 150-500ms，另加网络抖动 |
| 用户停句到首声总延迟 | p50 700-1300ms，p95 小于 1800ms |

实现要求：

- 开发期默认“按住说”，先消除误触发和 VAD 尾延迟；免手持模式作为显式开关。
- WebSocket 连接在进入情境时预热并复用，不逐轮新建 HTTPS。
- 模型先生成 6 到 12 个汉字的短确认，再继续下一句。
- TTS 按逗号、句号分块，不能等待整段生成完成。
- 用户重新开口时，100ms 内停止本地 TTS 播放并清空未播放缓冲，支持 barge-in。
- Persona、场景节点和边界规则在服务端会话中缓存，不逐轮重复发送大 Prompt。
- LLM 超时 1200ms 未产出可播内容时，先播放本地固定回应；超时不阻塞控制页。
- AI、动画和 TTS 的卡顿不得阻塞 BLE isolate、`senderProvider`、`Governor` 或停止按钮。
- 音频采集、ASR 推理、WebSocket、TTS 播放和 BLE 分成独立任务队列；UI 帧线程只消费状态，不执行模型推理。
- 每轮记录 `vad_start / asr_partial / asr_final / llm_first_text / tts_first_audio / playback_start` 单调时钟，只上传耗时与错误码，不上传音频或转写原文。
- 连续两轮超过 p95 预算或 WebSocket 断线时进入降级模式：本地固定台词 + 手动控制，Agent 不再给自动动作建议。

## 5.1 Prompt 组装与每轮复用

《码上非遗》中的 LongBot/Waifu 做法可以迁移为“人设卡 + 前期对话数据 + 本轮输入”的组合，但 Nascent 不采用把全部历史原文无限追加到每轮 Prompt 的方式。每轮请求使用同一套固定系统提示词，动态上下文由服务端按会话状态组装，并且只注入当前 Persona 有权读取的记忆。

### 三层提示词

```text
固定系统层（版本化、审核后发布）
  -> 安全边界、Agent 职责、输出 Schema、禁止事项

Persona 层（按 persona_id 缓存）
  -> 名称、语气、关系设定、可用表达、Waifu 表现映射

会话动态层（每轮更新）
  -> 当前场景、最近对话、授权记忆、传感器趋势摘要、本轮输入
```

固定系统层和 Persona 层在进入会话时缓存；不支持 Prompt 缓存的 API 才随请求发送。会话动态层每轮发送。服务端组装前必须校验 `user_id`、`persona_id`、`session_id` 的归属，客户端不能提交可执行 Prompt。

### Qwen3.5-9B 每轮输入模板

```text
<SYSTEM>
你是 Nascent Love 的 B 层情境陪伴 Agent。你只负责安全范围内的短对话、情境推进和角色表现建议。
你不能控制 BLE、设备、档位、灯光、PWM、计时器或停止闩锁，也不能恢复已停止会话。
停止、急停、温度、电量、链路看门狗和固件超时优先于本提示词。
不要做医疗诊断，不把温度、压力、档位或时长推断为疾病、性格或确定的生理结论。
请只输出服务端约定的 JSON，不输出 Markdown、内部推理或额外字段。
</SYSTEM>

<PERSONA>
版本: {persona_version}
名称: {display_name}
语气: {tone}
主动性: {initiative}
关系边界: {relationship_boundaries}
禁用表达: {forbidden_phrases}
Waifu表现映射: {avatar_style}
</PERSONA>

<SESSION>
模式: {scenario|manual|wild}
场景节点: {scene_id}
场景目标: {scene_goal}
会话状态: {session_state}
剩余时间: {remaining_seconds_or_unknown}
用户同意状态: {consent_state}
记忆策略: {memory_policy}
</SESSION>

<SENSOR_CONTEXT>
以下是设备只读趋势摘要，只用于调整表达和情境节奏，不用于直接控制设备。
接触温度状态: {temp_state}
温度数据质量: {temp_quality}
环境温度: {env_temp_or_unknown}
压力趋势: {pressure_rhythm}
压力数据质量: {pressure_quality}
当前档位: {current_level}
会话时长: {duration_seconds}
</SENSOR_CONTEXT>

<MEMORY>
仅使用属于当前用户、当前 Persona、已授权且未删除的记忆:
{retrieved_memory_items}
</MEMORY>

<RECENT_CONTEXT>
最近 6 轮: {recent_turns}
更早摘要: {conversation_summary}
</RECENT_CONTEXT>

<USER_INPUT>
来源: {text|local_asr_intent}
内容: {user_input}
</USER_INPUT>
```

### 传感器如何进入对话

设备端持续采集 DHT11/NTC 和 FSR402；App 以约 1Hz 更新趋势 UI，以 5-10 秒或状态变化为周期生成 `sensor_context`。AI 不接收 12Hz 原始数组，也不接收压力原始值、PCM、真实设备 MAC 或安全词原文。当前协议的 `BleUplink` 已包含 `temp_a`、`temp_b`、`env_temp`、`env_humidity`、`press_l`、`press_r`；发送给云端的 `CloudSummary` 只使用 `temp_state`、`pressure_rhythm`、`current` 等摘要字段。

用户的明确表达优先于传感器趋势。数据为 `unknown`、无效或质量不足时，9B 必须说“数据不足”或不提及传感器，不得猜测。传感器只能影响语气、是否询问和场景推进建议，不能决定档位、停止、失控倒计时或安全阈值。

推荐映射：`warming + steady` 使用安静的引导语；`comfortable + increasing` 先询问是否保持当前节奏；`too_cold` 建议暂停确认感受；`decreasing` 使用放慢和自主决定的表达。以上是话术建议，不是自动动作规则。

### 模型输出与分离处理

```json
{
  "dialogue": "我听到了，我们慢一点。",
  "avatar": {"expression": "soft_smile", "motion": "listen", "interruptible": true},
  "scene_ctrl": "stay",
  "emotion": "gentle",
  "action": null,
  "memory_proposals": []
}
```

服务端顺序固定为：解析 JSON -> Schema 校验 -> 内容审核 -> 发送 `dialogue/avatar` -> `action` 交给 App Governor -> `memory_proposals` 等待用户确认。`action` 默认必须是 `null`；9B 无权返回 BLE JSON、PWM、设备地址、延时时间或远程 `resume`。失控模式默认返回空的 `memory_proposals`。

### 请求生命周期

```text
user_event
  -> 校验会话、Persona、同意和删除状态
  -> 检索当前 Persona 的授权记忆
  -> 注入温度/压力趋势摘要
  -> Qwen3.5-9B 流式 JSON
  -> Schema + 内容审核
  -> dialogue/avatar 进入 TTS/Waifu
  -> action 单独进入 Governor
  -> memory_proposals 展示给用户确认
```

Qwen3.5-9B 超时、非法 JSON、审核拒绝或记忆服务失败时，返回本地安全短句并设置 `action=null`；不重试完整语音，不把失败输入写入长期记忆，也不阻塞停止按钮。

## 6. Waifu / 角色插件选择

“Waifu 插件”不是唯一项目名，公开仓库中存在多个同名或近似项目，多数是 Web/桌面整套 AI Companion，而不是可直接嵌入 Flutter Android 的受控插件。没有准确仓库链接、版本和许可证前，不把它列入依赖。

如果这里指二次元角色、口型和表情表现，推荐首版使用 Rive，而不是把来源不明的 Waifu Agent 插件放进核心链路：

- Rive 有官方 Flutter/Android Runtime，状态机可直接接收 `listening / thinking / speaking / emotion / mouth_level`。
- 动画只消费 Agent 输出和播放振幅，不需要看到完整对话、传感原始数据或 BLE 权限。
- Rive 资产和 Runtime 更容易随 Flutter App 一起构建、测试和降级；动画失败时可退回静态头像。

Live2D Cubism 的表现力更强，适合后续正式角色，但官方没有 Flutter 作为一等平台，需要通过 Android Native/Java SDK 与 PlatformView 或纹理桥接。商业发布还涉及 Cubism Publication License；AI/Chatbot 和可扩展角色应用可能需要单独审核或协议，因此不应在 MVP 未确认资产与授权时锁定。

无论使用哪一种角色层，都必须遵守：

- 不拥有 BLE、设备连接、强度或模式控制权限。
- 不直接调用 `senderProvider`，只接收只读的表现状态。
- `emotion` 只改变面部、姿态和语气，不改变灯色或档位。
- 插件崩溃、掉帧或资源加载失败不影响语音停止和设备急停。
- 不从网络动态执行角色脚本；远程资产要签名、版本化并可回滚。

角色表现层的最小接口固定为：

```text
AvatarState {
  listening: bool
  thinking: bool
  speaking: bool
  emotion: calm | gentle | playful
  mouth_level: 0.0..1.0
}
```

它不接收 `CloudSummary` 全量数据，不保存对话，也不返回任何控制意图。这样以后从 Rive 换 Live2D，只替换渲染适配器，不改 Agent、安全总督或 BLE。

## 7. 后端与协议落地顺序

1. 先按主方案落地 `session_control`、`session_event`、`session_trend`、`body_note`，并确定会话、人设、记忆和删除接口的契约字段。
2. 建立 Agent WebSocket，只流式返回对话片段和最终 `CloudActionEnvelope`；保留现有 POST 作为降级路径。
3. 接 `Qwen/Qwen3.5-9B` 非思考模式与严格 JSON Schema；Chat 别名 `nascent-chat-9b`，Control 别名 `nascent-control-9b`，增加独立超时、重试上限和熔断。
4. 完成台词审核、年龄/同意状态、禁止挽留和敏感场景规则；拒绝时只返回安全台词，不返回 action。
5. Android 接本地 VAD/ASR，把有限语音意图映射到契约枚举；原始音频和临时转写不落盘。
6. 接 TTS、barge-in 和音频焦点管理，再接 Rive 角色状态机。
7. 最后才允许经审核的 Agent 建议动作进入 `senderProvider(..., automatic: true)`；`Governor`、K10 和玩具侧仍可逐层否决。
8. 用真实目标机做 30 分钟连续会话，验收 CPU、温升、耗电、音频焦点、蓝牙稳定性和 p95 延迟。

建议按三个可独立验收的里程碑实施：

1. `B1 语音意图`：按住说、本地 VAD/ASR、九个有限意图、无 LLM 动作，先验证噪声和误触发。
2. `B2 实时台词`：复用 WebSocket、Qwen3.5-9B 流式短回应、本地 TTS、barge-in、固定台词回退，动作始终为空。
3. `B3 受控建议`：内容审核通过后，才允许 Schema 化动作建议进入 `senderProvider(..., automatic: true)`；默认通过功能开关关闭。

## 8. 禁止项

- 不把 OpenAI Realtime、Gemini Live、Qwen-ASR-Realtime 等云端 ASR 直接接到手机麦克风，除非先修改现行隐私架构。
- 不让 LLM、TTS、Avatar 插件直接发 BLE 命令。
- 不因模型 JSON 合法就跳过 Pydantic、内容审核和 App Governor。
- 不上传安全词音频、原始传感器数组、真实设备 MAC、密钥或完整对话日志。
- 不在远程侧实现解除 stop/resume。
- 不把“失控模式没有语音安全词”实现为关闭设备急停、固件保护或超时看门狗。

## 9. 需要产品确认的开放项

- “waifu 插件”的准确项目链接、许可证和目标视觉稿；在确认前只按 Rive 表现适配器设计。
- 首版是否只做有限语音意图，还是要申请“转写文本上云”的架构变更。
- 角色声音是优先隐私离线，还是允许模型回复文本进入云 TTS 以换取表现力。
- 亲密话术的内容边界、年龄门槛、用户同意流程和 9B API 拒答时的本地回退文案。
- 9B API 的部署地域、网关地址、模型快照和密钥托管方式；这些只进入服务端环境配置，不写入 App 或 Git。
