# B 层完整版技术文稿：双 9B Agent、模板 Skill 与偏好闭环

> 版本：B3.0 设计稿
> 日期：2026-08-28
> 范围：Nascent Love 共享 Web UI + Android WebView 壳、FastAPI Agent、Qwen 9B 双模型、压力 / 产品表面温感 / 心率趋势、情景漫游、我的节奏、身体笔记
> 关键词：人设、模板 Skill、Chat 9B、Control 9B、SensorSnapshot、有限自动适配、WellnessAssessment、IRPI、记忆隔离、可删除、低延迟
> 本文件是 B 层软件的权威规格。页面导航、传感器类型和自动适配规则以本节为准；BLE 设备命令仍以 [`protocol/contract.yaml`](../../protocol/contract.yaml) 为准，不要把 Agent 类型写进设备协议。实施计划原文见 [`docs/implementation/B层完整软件实施计划-B3.0.md`](../implementation/B层完整软件实施计划-B3.0.md)。

### 当前仓库对照（2026-08-28）

| B3.0 规格 | 当前仓库 | 落地轮次 |
| --- | --- | --- |
| 亲密时刻三个并列模块 | 已有入口 | 已实现 |
| Chat / Control 双逻辑模型与 `parallel-turn` | 后端联调骨架 | 已实现 |
| 身体笔记列表 → 详情 → 了解自己 | 已有；详情底栏仍是两个同级按钮 | 单入口改到后续导航 PR |
| 情景漫游三入口与微信式聊天 | 仅静态情景轮播 | 后续 PR |
| 我的节奏只要自由档位 + 失控模式 | 控制页仍把 Slider 与情景/失控按钮放在同一层 | 后续 PR |
| `SensorSnapshot`、心率、Health Connect | 仍用松散 `sensor_context`；协议已有 `hr_trend` / `hr_1hz` 摘要字段 | 后续 PR |
| `ResponseAssessment` / `WellnessAssessment` | 未实现 | 后续 PR |
| 有限自动适配执行 | Governor 仅拦截 `automatic` 且 insert 未知 | 后续 PR |
| IRPI 六因子（含心率 0.05） | 代码仍是五因子 `0.45 / 0.25 / 0.15 / 0.10 / 0.05` | 后续 PR |
| 按住说话 / TTS / Waifu | 未实现 | 后续 PR |

## 1. 摘要

B 层不是一个“聊天机器人直接控制硬件”的页面，而是一条受控的亲密体验链路：

```text
用户选择/创建人设
  -> 情景聊天或手动控制
  -> 本地语音输入与脱敏 SensorSnapshot
  -> Chat 9B 生成台词与角色表现
  -> Control 9B 生成 hold / recommend / ask
  -> 确定性 Policy + Governor 审核
  -> sendCommand() 发送允许的协议命令
  -> TTS / Waifu 表现 + 身体趋势
  -> 用户反馈 / 会话归档 / 偏好更新
```

两个 9B 是两个**职责隔离的逻辑模型**，不是两个拥有不同权限的“人格”：

| 模型 | 服务别名 | 负责 | 不负责 |
| --- | --- | --- | --- |
| Chat 9B | `nascent-chat-9b` | 对话、情景推进、语气、Waifu 表现、记忆候选 | 调档、停止、计时、恢复、删除、读取原始传感器 |
| Control 9B | `nascent-control-9b` | 根据已聚合的趋势和已确认模板提出节奏建议 | 直接控制 BLE、绕过 Governor、改变安全上限、延长失控模式 |

两个**逻辑别名**可以在第一阶段指向同一个供应商快照 `Qwen/Qwen3.5-9B`，但必须使用不同的系统 Prompt、输入 Schema、输出 Schema、超时和审计指标。HTTP `model` 字段发给供应商时使用供应商 ID，不要把 `nascent-chat-9b` 直接当作第三方网关模型名。负载上升后可以拆成两个独立副本，不改变客户端契约。旧文稿中的 `nascent-realtime-9b` 已废弃。

## 2. 产品边界

### 2.1 B 层三个模块

| 模块 | 选择/使用关系 | 主要职责 | 设备权限 |
| --- | --- | --- | --- |
| 情景漫游 | 先选或创建人设，再进入独立聊天页 | 微信式会话、语音、情景节点、三传感器摘要、台词和 Skill 建议 | 不能直接发命令；有限自动适配也必须经过 Policy、Governor 和 `sendCommand(..., automatic: true)` |
| 我的节奏 | 先选控制方案，再进入独立控制页 | 只保留自由档位和失控模式 | 唯一允许用户直接发调档命令的 UI；不出现人设、情景或聊天入口 |
| 身体笔记 | 与情景漫游、我的节奏平行 | 单次记录、近期图表、三段总结、了解自己 | 只读；不能恢复设备运行，也不能产生设备动作 |

选择页和使用页必须分层：

```text
亲密时刻
  ├─ 情景漫游
  │    ├─ 选择已有人设 -> 人设列表 -> 情景聊天
  │    ├─ 定义人设 -> 结构化表单 -> 保存 -> 情景聊天
  │    └─ 对话创建人设 -> 创建助手对话 -> 预览确认 -> 情景聊天
  ├─ 我的节奏
  │    ├─ 自由档位 -> 控制页（八档 Slider，松手发送，0 = 停止）
  │    └─ 失控模式 -> 时间配置与健康提示 -> 二次确认 -> 独立使用页
  └─ 身体笔记
       ├─ 使用记录列表
       ├─ 单次记录详情（上方本次记录，下方近期图表与三段总结）
       └─ 了解自己（一个入口；一次读取当前记录和最多 5 次近期记录）
```

创建人设的对话页和实际使用的情景聊天必须是不同页面。所有主要操作放在屏幕下半区；触控高度至少 48dp，停止按钮至少 56dp。

选择页不放 Slider、档位按钮或失控倒计时；使用页不允许临时修改模板的安全边界。停止按钮在使用页始终固定可见，网络、模型、TTS 和动画都不能成为停止的前置条件。

### 2.2 用户风格标签

UI 可以提供以下标签帮助用户表达偏好：

- `温柔`：低主动性、更多确认、较长停顿、低刺激表达。
- `强势`：更明确的引导语气，但仍然必须逐步确认、可随时暂停，不能推断“必须服从”。
- `SM 风格`：只代表用户主动选择的角色叙事风格，不代表可以跳过同意、停止或安全边界；UI 应显示“自愿、可退出、不会改变安全规则”。
- `安静`：少说话、更多环境和趋势提示。
- `玩心`：更多轻松问答和情景变化，但不增加设备权限。

这些是 Persona/Template 的表达参数，不是工具权限、强度上限或安全词替代品。用户可以同时选择多个标签，也可以随时关闭。

## 3. 双模型架构

### 3.1 总体拓扑

```text
Flutter Android
  ├─ Local VAD / ASR
  ├─ BLE uplink -> TrendAggregator（约 1 Hz）
  ├─ Chat WebSocket / HTTP
  └─ Control event queue

FastAPI
  ├─ Session Orchestrator
  │    ├─ Context Builder
  │    ├─ MemoryProvider
  │    ├─ Template / Skill Registry
  │    └─ Consent & Privacy Policy
  ├─ Chat 9B Adapter
  ├─ Control 9B Adapter
  ├─ Deterministic Policy Engine
  ├─ Moderation / Schema Validator
  └─ Session Store + Preference Store

App Governor -> senderProvider -> BLE
K10 / 固件 SafetyGovernor -> 最终裁决
```

### 3.2 Chat 9B 输入输出

Chat 9B 每轮只接收：

- 当前 Persona 和已确认 Template 的参数化卡片。
- 最近 6 轮对话和滚动摘要。
- 当前场景节点、用户同意状态和剩余时间。
- 已授权且未删除的关系记忆，最多 5 条。
- `sensor_context` 的趋势枚举和数据质量，不接收原始数组。
- 当前用户的本轮文字或本地 ASR 意图。

输出：

```json
{
  "dialogue": "我听到了，我们慢一点。",
  "avatar": {
    "expression": "soft",
    "motion": "listen",
    "interruptible": true
  },
  "scene_ctrl": "stay",
  "emotion": "gentle",
  "skill_proposals": [],
  "memory_proposals": [],
  "action": null
}
```

`skill_proposals` 只能引用当前已确认模板的 Skill；`memory_proposals` 只能是待用户确认的候选。任何 `action` 字段都在 Pydantic 校验后强制置空。

### 3.3 Control 9B 输入输出

Control 9B 只在以下时机运行：

- 会话开始后的首次设备状态确认。
- 每 5-10 秒的趋势窗口结束。
- 用户明确说“慢一点/快一点/保持/暂停”等节奏意图。
- 温度/压力趋势或数据质量发生状态变化。

它不在每个聊天气泡都运行，避免增加延迟和调用成本。

输入示例：

```json
{
  "session_id": "s_01",
  "mode": "scenario",
  "template_id": "tpl_01",
  "template_skill_allowlist": ["rhythm_segment", "set_pattern"],
  "phase": "warming",
  "current_level": 2,
  "remaining_seconds": 420,
  "consent_state": "confirmed",
  "sensor_context": {
    "temperature_state": "warming",
    "temperature_quality": "valid",
    "pressure_rhythm": "steady",
    "pressure_quality": "partial",
    "pressure_change": "small",
    "data_age_ms": 1200
  },
  "explicit_user_signal": "慢一点",
  "recent_feedback": "comfortable"
}
```

输出必须是建议，不是命令：

```json
{
  "decision": "hold",
  "recommended_skill_id": "rhythm_segment",
  "recommended_level": 2,
  "recommended_pattern": "soft",
  "hold_seconds": 60,
  "confidence": 0.71,
  "reason_codes": ["user_requested_slower", "temperature_warming"],
  "requires_user_confirmation": true,
  "action": null
}
```

当 `sensor_context` 为 `unknown`、数据过期、链路不可信、用户撤回同意、模式为 `wild` 或模板没有对应 Skill 时，Control 9B 必须输出 `decision=hold`、`action=null`。它不能输出 `stop` 指令；停止由用户、App、K10 或固件完成。

### 3.4 调用调度

聊天和调控必须异步隔离：

```text
用户输入 -> Chat 队列 -> Chat 9B -> TTS/Waifu
趋势窗口 -> Control 队列 -> Control 9B -> Policy Engine -> App 建议
停止事件 -> 本地高优先级队列 -> senderProvider -> BLE
```

停止事件不能等待任何模型队列。Control 9B 超时只保持当前状态；Chat 9B 超时只播放本地回退短句。

## 4. 三传感器融合

B3.0 用强类型 `SensorSnapshot` 替换松散的 `sensor_context`。当前代码仍接受 `sensor_context` 字典，后续传感器 PR 再切换契约。协议里的 `CloudSummary.hr_trend` 和 `SessionRecord.hr_1hz` 只是会话摘要字段，不能代替发给模型的聚合快照。

### 4.1 数据分层

```text
ESP32 12 Hz 原始采样
  -> 固件滤波、异常丢弃、安全判断
  -> App 1 Hz 趋势聚合
  -> 5-10 秒摘要窗口
  -> Control 9B / Chat 9B 只读上下文
  -> 会话归档和偏好特征
```

原始温度、压力、PCM、设备 MAC、令牌和安全词原文不得进入 LLM Prompt、共享日志或关系记忆。原始数据如需调试，只允许本地短时环形缓存，并必须有单独的调试开关和自动过期。

### 4.2 发给模型的聚合字段

当前联调仍使用 `sensor_context`。目标 `SensorSnapshot` 只含 5–10 秒聚合特征：

- 压力：接触质量、左右相对值、节律、连续时间、上升/平稳/变化/下降、缺失率。
- 温感：只记录产品表面/接触温度、相对变化、变化速度、舒适区状态和数据质量，不解释为核心体温。验证期 DHT11 是环境温湿，质量必须标为环境通道；**不能**当作接触面过温熔断。硬安全只认量产接触 NTC 和固件规则。
- 心率：Android Health Connect 读取小米手环同步数据，含会话前参考值、变化量、趋势、覆盖率、来源和新鲜度。Web 没有这条通道。旧文稿中的 Zepp 名称不再使用。

原始压力、温度和 BPM 曲线保存在本地加密记录；发送给模型的只有聚合特征。心率、压力或温感任何单一信号都不能判断 climax、同意或偏好。

| 字段 | 示例 | 允许用途 | 禁止用途 |
| --- | --- | --- | --- |
| `temperature_state` | `warming` / `comfortable` / `cooling` | 语气、节奏、询问是否保持 | 推断疾病、核心体温或性功能结论 |
| `temperature_quality` | `valid` / `partial` / `unknown` / `environment_only` | 决定是否可参考 | 质量不足时猜测；把 DHT11 当熔断 |
| `pressure_rhythm` | `steady` / `increasing` / `decreasing` | 描述趋势和是否询问 | 推断快感、高潮或意愿 |
| `pressure_quality` | `valid` / `partial` / `unknown` | 降低决策置信度 | 当成确定生理事实 |
| `pressure_change` | `small` / `large` | 触发“保持/暂停确认” | 直接调高档位 |
| `heart_rate_trend` | `rising` / `steady` / `falling` / `unknown` | 辅助询问 | 单独停止、诊断或确认 climax |
| `data_age_ms` | `1200` | 判断新鲜度 | 掩盖断连 |
| `current_level` | `2` | 显示当前状态 | 作为自动升档理由 |

### 4.3 确定性融合

融合器输出 `ResponseAssessment`：阶段为 `unknown / settling / engaged / rising / sustained / recovery`。至少两种有效传感趋势同向，且没有停止、不适、减速等负面反馈，才产生“可能的高响应区间”。区间只能标为 `candidate`；用户选择“这段很有感觉”后才变为 `confirmed` 并允许进入偏好学习。接近该区间时默认优先保持稳定节奏。

`WellnessAssessment` 状态为 `clear / check_in / pause_recommended / stop_required`：

- 固件 NTC 过温、急停、安全词和链路安全规则直接触发停止，不等待 AI。
- 压力持续时间过长或节律突然变化只触发询问、休息或调整姿势提示，不诊断身体损伤。
- 心率相对参考值明显变化但没有用户不适时只做温和确认；心率单独不能触发自动停止或健康结论。
- 用户报告胸闷、头晕、疼痛、麻木或明显不适时停止自动 Skill，并提示暂停使用和根据情况寻求专业帮助。

用户明确表达永远高于传感器趋势。传感器只提供“可以询问或保持”的辅助信号，不提供同意信号。

## 5. 非医疗的亲密响应与偏好指数

用户提出“女性性功能指数”的权重链，产品实现采用名称 **IRPI（Intimacy Response & Preference Index，亲密响应与偏好指数）**。它是个性化交互排序指标，不是医学量表，不用于诊断性功能、判断高潮、判断健康或给出治疗建议。

### 5.1 指数目标

IRPI 只回答一个产品问题：

> 在某个用户、某个人设、某个模板和某种上下文下，哪些表达和节奏更接近用户明确反馈的偏好？

IRPI 不回答：

- 用户是否“正常”。
- 用户是否达到某种生理状态。
- 传感器是否证明用户愿意继续。
- 用户是否有疾病或性功能障碍。

### 5.2 权重链

```text
原始传感器
  -> 质量门控 Q
  -> 趋势特征 F_sensor
  -> 用户明确反馈 F_explicit
  -> 会话事件 F_behavior
  -> 会话上下文分层
  -> 偏好更新
  -> IRPI 仅用于推荐排序
```

建议初始权重如下，产品上线后通过脱敏评估数据校准，不能把模型置信度当作事实：

| 来源 | 符号 | 目标权重 | 说明 |
| --- | --- | ---: | --- |
| 用户明确反馈 | `F_explicit` | 0.45 | “喜欢/不喜欢/慢一点/保持/暂停”以及会话后评分 |
| 用户主动行为 | `F_behavior` | 0.25 | 主动降档、主动暂停、主动继续、跳过情景段 |
| 压力趋势 | `F_pressure` | 0.12 | 只使用节奏/稳定性特征，不标注生理含义 |
| 温感趋势 | `F_temperature` | 0.08 | 只使用升温/稳定/降温趋势和质量 |
| 心率趋势 | `F_heart_rate` | 0.05 | 只使用相对参考值和覆盖率，不能单独学习 |
| 完成上下文 | `F_context` | 0.05 | 时长、时间段、Persona、模板和环境标签 |

当前代码仍使用五因子 `0.45 / 0.25 / 0.15 / 0.10 / 0.05`，没有心率项。下一轮改 `preference.py` 时再切换，不能把文档权重误报成已上线。

单次样本：

```text
R_session = Q * (
    0.45 * F_explicit
  + 0.25 * F_behavior
  + 0.12 * F_pressure
  + 0.08 * F_temperature
  + 0.05 * F_heart_rate
  + 0.05 * F_context
)
```

其中 `Q` 由数据新鲜度、传感器质量、链路状态和缺失比例共同计算。`Q` 低于门槛时只记录“数据不足”，不更新偏好。任何用户明确的停止、拒绝或不适表达都进入安全事件，不参与“喜欢程度”正向学习。

### 5.3 偏好维度

偏好不是一个总分，而是多个可删除维度：

- `pace_preference`：慢、稳定、变化、留白。
- `intensity_preference`：用户主动选择的强度区间，不从传感器反推上限。
- `pattern_preference`：允许的波形/节奏 Skill。
- `voice_preference`：温柔、强势、安静、玩心等表达风格。
- `scene_preference`：用户主动收藏的情景类型。
- `boundary_preference`：不想出现的词、场景、调度方式。
- `sensor_sharing_preference`：是否允许趋势进入云端 Agent。

所有维度都按 `user_id + persona_id + template_id` 隔离。默认不跨 Persona 合并，跨模板只允许用户手动打开“合并相似偏好”。

### 5.4 形成用户偏好的过程

```text
会话前：读取已确认偏好（不读失控模式关系记忆）
会话中：记录趋势窗口、明确反馈、Skill 使用和拒绝事件
会话后：生成偏好变化草稿
用户确认：写入 PreferenceSnapshot
用户删除：级联删除特征、快照和相关记忆
```

AI 可以建议“你似乎更喜欢慢速开始”，但 UI 必须标注“基于本次/最近几次主动反馈的建议”，并提供“不保存”“删除这条”“以后不再询问”。

## 6. 模板与硬件 Skill

### 6.1 两类模板

1. **预置模板**：审核后随 App 或服务端版本发布，用户只能选择、预览和使用。
2. **用户自定义模板**：用户可以配置名称、Persona、风格标签、节奏段和 Skill 白名单。

模板生命周期：

```text
聊天描述 -> Agent 草稿 -> 参数校验 -> 预览 -> 用户确认 -> confirmed -> 使用
                                       └-> 放弃/删除
```

### 6.2 对话创建模板

用户点击“帮我设计一个模板”后进入独立聊天页。Agent 先问最多三个澄清问题：

1. 你希望整体更偏温柔、安静、强势还是 SM 风格叙事？
2. 你想要慢慢开始、稳定保持还是有明显段落变化？
3. 哪些内容或节奏明确不想出现？

用户说“我不知道”时，点击“帮我选择”进入向导，而不是让模型擅自猜：

```text
第一步：选择今天的感觉（放松 / 好奇 / 想被引导 / 想自己掌控）
第二步：选择语气（温柔 / 安静 / 强势但会确认 / SM 风格叙事）
第三步：选择节奏（慢速 / 稳定 / 分段 / 不自动变化）
第四步：选择档位上限和最长时长
第五步：选择传感器趋势是否允许用于本次建议
预览 -> 确认保存
```

向导输出的是推荐模板草稿，不自动启动设备，不自动写关系记忆。

### 6.3 Skill 白名单

第一版 Skill：

| Skill | 参数 | 执行条件 |
| --- | --- | --- |
| `rhythm_segment` | level、pattern、duration_s | 已确认模板、用户已授权、非 wild、Governor 放行 |
| `set_pattern` | pattern、duration_s | 已确认模板、用户已授权、Governor 放行 |
| `hold_current` | duration_s | 只保持现状，不改变档位 |

禁止 Skill：`resume`、延长失控、修改安全阈值、绕过停止、直接写 BLE、读取原始传感器、删除记忆、改变同意状态。

所有自动 Skill 都必须执行：

```text
Control 9B proposal
  -> schema validator
  -> template allowlist
  -> user consent / mode check
  -> App Governor(automatic: true)
  -> sendCommand()
  -> protocol command
```

有限自动适配只在情景漫游单次会话中生效，且必须显式开启；退出会话后授权失效。“我的节奏”自由档位始终手动；失控模式只按固件计时，不接受 Agent 自动调档。

自动 Skill 仅允许 `rhythm_segment` 和 `set_pattern`。每次最多变化一档，至少保持 30 秒，自动变化冷却 45 秒；7、8 档始终需要用户再次点击确认。至少两种传感器质量有效、链路正常、同意状态有效且无安全事件时才允许自动执行。`SkillProposal` 当前只有 `skill_id`；level/pattern/duration 仍在 `HardwareSkill` / `ControlDecision` 上，后续自动适配 PR 再补齐提案字段。

## 7. 后端数据与记忆

### 7.1 核心实体

| 实体 | 关键字段 | 删除策略 |
| --- | --- | --- |
| `persona` | user_id、persona_id、version、style_tags | 删除 Persona 时可级联关系记忆 |
| `template` | template_id、source、status、skill_allowlist | 预置不可删；自定义可删 |
| `session_control` | session_id、mode、timer_owner、consent_state | 用户可删除整次会话 |
| `session_trend` | 5-10 秒温度/压力趋势、质量、时间 | 随会话级联删除 |
| `session_event` | stop、pause、slow、keep、skill_confirmed | 随会话级联删除 |
| `control_decision` | 模型版本、建议、置信度、拒绝原因 | 删除会话时删除；不保存原始 Prompt |
| `preference_snapshot` | 维度、权重、来源、用户是否确认 | 单条或全量删除 |
| `memory_item` | user_id、persona_id、text、source、consent | 单条、Persona、用户全量删除 |
| `body_note` | 用户文本、事实摘要、created_at | UI 删除后不可检索 |
| `session_summary` | session_id、事实摘要、AI 草稿、用户确认文本、状态 | 随会话级联删除；未确认草稿不进入长期记忆 |

### 7.2 记忆隔离

检索键必须包含：

```text
tenant/user_id + persona_id + consent_scope + not_deleted
```

失控模式默认：

- 不检索关系记忆。
- 不生成关系记忆候选。
- 不更新偏好快照。
- 只在用户明确选择后保存用户写的身体笔记。

记忆服务采用 `MemoryProvider` 接口，第一版可以是内存适配器，生产环境换成自托管 Mem0 或 SQLCipher/向量存储。换实现不能改变隔离、确认和删除语义。

### 7.3 删除 API

联调实现以现网路由为准，生产版必须加登录用户归属校验：

```text
DELETE /v1/agent/memory/{memory_id}?user_id=...&persona_id=...
DELETE /v1/agent/memory?user_id=...&persona_id=...
DELETE /v1/agent/templates/{template_id}?user_id=...
DELETE /v1/agent/preferences?user_id=...&persona_id=...&template_id=...
DELETE /v1/body-notes/sessions/{session_id}
DELETE /v1/body-notes/{note_id}
```

不要实现已废弃的 `DELETE /v1/preference/{preference_id}` 或 `DELETE /v1/session/{session_id}`。删除会话时级联删除曲线、摘要、高响应候选、对话发现和偏好观察；删除人设时删除其关系记忆。检索层先写 tombstone，防止已删除数据被缓存重新召回。当前存储仍是进程内适配器，tombstone 尚未落地。

## 8. UI 设计与单手操作

### 8.1 情景漫游选择页

三个同级按钮：`选择已有人设`、`定义人设`、`对话创建人设`。列表页展示头像、名称、安全摘要和最近时间，不展示敏感身体数据。定义人设使用结构化表单（温柔、强势、SM 风格、安静、玩心、说话频率和允许的 Skill）。对话创建必须在独立页面完成，确认后再进入情景聊天。

### 8.2 情景漫游使用页

```text
顶部：返回 / 人设 / 连接状态
聊天上方常驻：三传感器摘要；点击打开数据流抽屉
  传感器 → 聚合趋势 → Agent 判断 → Policy 结果 → Governor 结果 → 实际设备状态
中部：微信式消息
底部固定：停止 | 按住说话 | 文字输入 | 更多
```

底部 `更多` 才打开切换情景、查看 Skill 建议、查看记忆候选和结束会话。停止高度至少 56dp，键盘和数据面板展开时仍可见。

### 8.3 我的节奏

选择页只保留 `自由档位` 和 `失控模式`，不出现人设、情景或聊天入口。自由档位使用页：八档 Slider，仅松手发送；档位 0 为停止；固定大停止按钮始终可见。失控模式：时间配置与健康提示 → 二次确认 → 独立使用页；AI 不能延长计时或恢复停止状态。当前仓库仍把 Slider 和情景/失控按钮放在同一控制页，分层导航属于后续 PR。

### 8.4 身体笔记与“了解自己”

身体笔记是 B 层第三个独立模块。单次记录固定包含：会话概览、档位时间线、压力节律、表面温感、心率图和覆盖率、可能高响应区间、结束原因、数据质量、用户主观反馈和可编辑总结。

总结分为三段：

- `生理参考`：只陈述压力、温感、心率和时间上的可观测变化。
- `心理体验`：来自使用前后心绪、舒适度、掌控感、风格标签、最有感觉片段和用户原话。
- `身心关联`：描述哪些变化同时出现，不宣称因果，并明确“不代表固定偏好”。

```text
身体笔记
  -> 使用记录列表
      -> 单次记录详情
          -> 上方：本次记录
          -> 下方：最近 5 次有效记录图表与三段总结
          -> 底部唯一入口：了解自己
              -> 独立 Chat 页（当前记录 + 最多 5 次近期记录，页面显示实际数据来源）
```

当前仓库详情底栏仍是两个同级按钮 `只看这一次` / `参考近期记录`，作为过渡实现保留；B3.0 产品口径是单一 `了解自己`。整段对话默认不持久化，只有用户点击“保存这条发现”才写入可编辑、可删除笔记。不能给出医学结论、性功能诊断、确定的愉悦判断、偏好定论或任何设备动作。

### 8.5 引导按钮

按钮名称建议为“帮我选一个开始方式”。它不直接替用户选择偏好，而是用五步向导生成推荐模板，预览页必须显示：

- 选择了哪些标签。
- 允许哪些 Skill。
- 档位上限和最长时长。
- 是否使用温度/压力趋势。
- 哪些内容被明确排除。

## 9. 延迟与故障策略

### 9.1 目标预算

| 链路 | p50 目标 | p95 目标 | 超时策略 |
| --- | ---: | ---: | --- |
| 本地按住说/VAD | 50-120 ms | <200 ms | 继续等待下一段 |
| 本地 ASR 首字 | 250-500 ms | <900 ms | 提示重试或切换输入 |
| Chat 9B 首个 JSON | 500-900 ms | <1500 ms | 本地短句 + 保留文字 |
| Control 9B 决策 | 250-500 ms | <1000 ms | 保持当前，不自动变化 |
| 停止 | <300 ms | <500 ms | 本地直发，完全绕过模型 |

### 9.2 降级矩阵

| 故障 | Chat | Control | 设备 |
| --- | --- | --- | --- |
| 网络断开 | 本地短句/文字气泡 | 不作自动建议 | 手动和停止仍可用 |
| Chat 超时 | 回退短句 | 不受影响 | 保持当前 |
| Control 超时 | 不受影响 | `hold` | 保持当前 |
| 传感器未知 | 可以继续对话但标注数据不足 | 禁止自动加档 | 手动遵循 Governor |
| TTS 失败 | 显示文字 | 不受影响 | 不阻塞停止 |
| Agent 输出非法 | 丢弃模型输出 | 丢弃建议 | 不发送命令 |
| 记忆服务失败 | 不注入长期记忆 | 不影响设备 | 停止和手动控制不受影响 |

## 10. 安全、隐私和合规边界

1. Agent 没有 BLE、文件系统、删除、定时器、停止或恢复工具。
2. Chat 9B 与 Control 9B 均不能把传感器数据写成诊断或确定的性反应结论。
3. 同意状态来自 UI/会话控制，不由模型推断；传感器不能代替同意。
4. 用户明确停止、拒绝、不适、撤回时，立即停止自动 Skill，并记录安全事件。
5. 失控模式的终止由设备计时与固件安全逻辑负责，模型不能创建、延长或解除。
6. Prompt、日志和模型供应商请求不得包含 PCM、原始 12Hz 数据、压力原始值、设备 MAC、密钥、安全词原文或其他 Persona 记忆。
7. 所有记忆、偏好、会话和身体笔记都必须提供 UI 删除入口，并执行后端级联删除。
8. “强势”和“SM 风格”只能改变叙事语气与场景参数，不能改变停止规则和安全上限。

## 11. 版本化 API 草案

```text
POST /v1/agent/turn
  -> ChatTurn

POST /v1/agent/control-decision
  -> ControlProposal

GET  /v1/agent/templates?user_id=...
POST /v1/agent/templates/draft
POST /v1/agent/templates/confirm
DELETE /v1/agent/templates/{template_id}

POST /v1/agent/memory
GET  /v1/agent/memory
DELETE /v1/agent/memory/{memory_id}
DELETE /v1/agent/memory

POST /v1/session/{session_id}/feedback
GET  /v1/session/{session_id}/trend

GET  /v1/body-notes/sessions?cursor=...
GET  /v1/body-notes/sessions/{session_id}
DELETE /v1/body-notes/sessions/{session_id}
POST /v1/body-notes/sessions/{session_id}/note
PATCH /v1/body-notes/{note_id}
DELETE /v1/body-notes/{note_id}

DELETE /v1/agent/preferences?user_id=...&persona_id=...&template_id=...

POST /v1/body-notes/insight-turn
  body: session_id, comparison_session_ids, message
  -> InsightTurn（纯文本/引用范围，不含 action、skill_proposals）
```

Chat、Control 和 Memory API 均需要用户鉴权；当前仓库的联调路由仍是裸接口，不能直接作为生产接口发布。

## 12. 测试计划

### 契约测试

- Chat 9B 返回额外字段、非法 JSON、非法 `scene_ctrl` 时整条丢弃并回退。
- Control 9B 返回 `action`、`resume`、未知 Skill、超过 8 档或超过 900 秒时拒绝。
- `skill_proposals` 不在当前模板 allowlist 时被丢弃。
- wild 模式永不检索或写入关系记忆。

### 数据测试

- 同一用户不同 Persona 不串记忆。
- 删除单条记忆后不能再次检索。
- 删除模板后，相关偏好和关系记忆按用户选择级联删除。
- Prompt 中无原始温度/压力数组、PCM、MAC、密钥和安全词原文。
- `Q < threshold` 时不更新 IRPI。
- “只看这一次”请求只能检索当前 `session_id`，Prompt 不出现其他会话摘要。
- “参考近期记录”只能检索请求中明确列出的 `comparison_session_ids`，删除或越权记录必须被过滤。
- 未点击“保存这条发现”时，自我探索对话不会生成 `body_note`、`memory_item` 或偏好快照。

### 设备与交互测试

- Stop 不依赖网络、模型、TTS、动画或页面状态。
- 断连时自动建议被 Governor 拒绝，Stop 仍可发。
- 失控模式到时停止，App 没有远程恢复入口。
- 选择页和使用页分离，编辑模板不会在未确认时启动设备。
- 360dp 宽度下，停止、按住说、暂停和“更多”均在拇指热区。
- 身体笔记详情页在 360dp 宽度下可单手点击了解自己入口，并在对话页显示实际读取范围。

B3.0 后续还必须覆盖：传感器缺失/过期、单信号误判、多信号候选、用户否认、有限自动档位限制、7/8 档确认、过温/急停、删除后不可检索、双模型超时、无 Health Connect 权限和 Android debug APK 构建。

## 13. 实施阶段

| 阶段 | 交付 | 本轮 |
| --- | --- | --- |
| B0 | B3.0 文档、Prompt/输出契约、模板和 Skill 白名单 | 本 PR 收口规格与 Review 修复 |
| B1 | 三模块导航、人设三入口、自由档位、失控确认页、身体笔记单入口 | 后续短 PR |
| B2 | Chat 9B 适配、微信式聊天、数据流抽屉 | 后端骨架已有；完整 UI 后续 |
| B3 | SensorSnapshot、Health Connect、融合评估 | 后续短 PR |
| B4 | 有限自动适配、Governor 映射、7/8 档确认 | 后续短 PR |
| B5 | IRPI 六因子、用户确认、级联删除与 tombstone | 五因子骨架已有 |
| B6 | SQLCipher、鉴权、审计、WebSocket、ASR/VAD/TTS/Waifu | 后续 |
| B7 | Android 端到端验收、延迟压测、灰度开关 | 后续 |

Draft PR #6 继续更新，不自动合并。完整情景 UI 和传感器接入拆为后续短 PR。

## 14. 本仓库当前状态

- [x] 已有受控 `MemoryProvider`，支持按用户/Persona 隔离和删除。
- [x] 已有预置/自定义模板的 `draft -> confirmed` 后端骨架。
- [x] 已有 Chat 9B / Control 9B 的 OpenAI-compatible 适配器、并行编排和安全回退。
- [x] 已有 `skill_proposals` 和模板 Skill 白名单 `rhythm_segment` / `set_pattern`。
- [x] 身体笔记列表、详情、自我探索对话和删除的联调切片。
- [x] IRPI 五因子计算、质量门控和偏好快照的进程内骨架。
- [ ] 情景漫游三入口与微信式聊天页。
- [ ] 我的节奏选择页与失控确认页分层。
- [ ] SensorSnapshot、Health Connect、ResponseAssessment、WellnessAssessment。
- [ ] 有限自动适配执行、IRPI 心率权重、tombstone。
- [ ] 生产鉴权、WebSocket、ASR/VAD/TTS、Waifu 和 Android APK 验收。

本文件是完整目标架构；当前已完成的是后端联调骨架和身体笔记纵向切片，不是生产上线。未完成项必须保持未勾选。
