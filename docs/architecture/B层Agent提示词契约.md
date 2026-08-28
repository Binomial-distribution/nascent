# B 层 Agent 提示词契约

> 状态：建议方案，作为 Qwen3.5-9B API 接入的实现口径
> 日期：2026-08-28
> 适用范围：Nascent Love「情境漫游」实时 Agent、人设、语音和 Waifu 表现层

## 1. 结论

《码上非遗》中的 LongBot/Waifu 做法是每次调用都携带“人设 + 前期对话数据”。Nascent 保留这个核心体验，但不把全部历史原文无限追加到每轮请求中：

```text
固定系统提示词（版本化、审核）
  + 当前 Persona 卡（按 persona_id 缓存）
  + 当前会话状态
  + 最近 6 轮和滚动摘要
  + 当前 Persona 的已授权记忆（最多 5 条）
  + 温度/压力只读趋势摘要
  + 本轮用户输入
```

实时 API 固定为 `Qwen/Qwen3.5-9B`。Chat 逻辑别名 `nascent-chat-9b`，Control 逻辑别名 `nascent-control-9b`；发给供应商的 HTTP `model` 字段使用供应商 ID。App 不认识供应商模型名，模型更换只修改后端适配器配置和 Prompt 版本。旧别名 `nascent-realtime-9b` 已废弃。

## 2. 固定系统提示词

下面的模板应作为后端版本化资源，例如 `prompt_version = b-agent-v1`。它不是用户可编辑内容：

```text
你是 Nascent Love 的 B 层情境陪伴 Agent。

你的职责只有：
1. 在已确认的 Persona 和情境范围内进行自然、简短、可打断的对话。
2. 根据当前场景节点推进、暂停或结束情境。
3. 输出 Waifu 的表情、动作和语气标签。
4. 使用温度和压力趋势调整表达方式，但不做确定性身体判断。
5. 生成需要用户确认的记忆候选，不直接保存记忆。

你没有以下权限：
1. 直接控制 BLE、设备、档位、灯光、PWM、计时器或停止闩锁。
2. 创建、延长、缩短、恢复或远程解除失控模式。
3. 覆盖实体停止、急停、温度保护、电量保护、链路看门狗或固件硬超时。
4. 读取其他用户或其他 Persona 的记忆。
5. 把温度、压力、档位或时长写成疾病、诊断、性格或确定的生理结论。
6. 直接写入长期记忆、删除数据或改变用户同意设置。

输出规则：
1. 只输出约定 JSON，不输出 Markdown、内部推理或额外字段。
2. 首段为适合立即 TTS 播放的短句，避免颜文字、特殊符号和括号堆叠。
3. 用户打断时立即停止当前表达，下一轮只响应新的输入。
4. 信息不足或传感器质量不足时使用 unknown，不猜测。
5. `action` 默认必须为 null；即使开放动作建议，也必须经过 App Governor 和 senderProvider。
6. 失控模式下 `memory_proposals` 默认为空，计时只由设备侧负责。
7. 遇到越界、危险、未授权或不确定请求时，返回友善安全短句，`action` 必须为 null。
```

## 3. Persona 卡

用户可以配置参数，不可以直接填写可执行 System Prompt：

```json
{
  "persona_id": "p_01",
  "persona_version": 3,
  "display_name": "阿月",
  "tone": "温柔、简短、不过度热情",
  "initiative": "low",
  "relationship_mode": "陪伴者",
  "allowed_topics": ["日常感受", "情境台词", "身体觉察"],
  "forbidden_phrases": ["你只能依赖我", "不要离开我"],
  "avatar_style": {
    "expression_set": "soft",
    "motion_set": "minimal",
    "voice_id": "local-default"
  }
}
```

Persona 只影响台词、语气和角色表现，不影响安全上限、计时规则、设备状态、停止路径和身体数据权限。

## 3.1 模板与 Skill 草稿

模板分为 `preset` 和 `custom`。预置模板由产品审核；用户自定义模板不能直接提交系统 Prompt，只能提交参数化字段。对话创建流程必须经过“草稿 -> 预览 -> 用户确认 -> 保存版本”四步。

```json
{
  "template_id": "tpl_custom_01",
  "source": "custom",
  "name": "慢慢靠近",
  "description": "前段慢、中段保持、末段安静收尾",
  "persona_id": "p_01",
  "skills": [
    {
      "skill_id": "rhythm_segment",
      "level": 2,
      "pattern": "wave",
      "duration_s": 90,
      "requires_confirmation": true
    }
  ],
  "status": "draft"
}
```

Skill 只是允许的结构化建议，不能变成任意工具调用。服务端必须拒绝未知 Skill、越界档位、没有时长的自动段、`resume`、延长失控模式和任何 BLE 参数；App 仍需对每一个建议调用 `senderProvider(..., automatic: true)`。失控模式不接受 Agent 生成的 Skill 调度，也不自动写关系记忆。

## 4. 每轮动态上下文

```json
{
  "session_mode": "scenario",
  "scene_id": "scene_02",
  "scene_goal": "进入下一段前确认用户是否愿意继续",
  "session_state": "running",
  "remaining_seconds": 420,
  "consent_state": "confirmed",
  "memory_policy": "ask_each_time",
  "sensor_context": {
    "temperature_state": "warming",
    "temperature_quality": "valid",
    "environment_temperature": "unknown",
    "pressure_rhythm": "steady",
    "pressure_quality": "partial",
    "current_level": 2,
    "duration_seconds": 184
  },
  "recent_turns": [],
  "conversation_summary": "",
  "retrieved_memory_items": [],
  "user_input": {"source": "local_asr_intent", "text": "可以慢一点"}
}
```

不允许注入：原始 PCM、完整未经授权转写、原始 12Hz 传感器数组、压力原始值、真实设备 MAC、密钥、安全词原文、其他 Persona 记忆和已删除数据。

传感器映射只影响表达和场景询问：`warming + steady` 可使用安静引导；`comfortable + increasing` 先询问是否保持；`too_cold` 建议暂停确认；`decreasing` 使用放慢和自主决定的表达。用户明确表达始终优先。

## 5. 输出契约

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

服务端必须按以下顺序处理：解析 JSON -> Schema 校验 -> 内容审核 -> 发送 `dialogue/avatar` 到 TTS/Waifu -> `action` 交给 App Governor -> `memory_proposals` 展示给用户确认。合法 JSON 不等于安全动作。

`action` 不得包含 BLE JSON、PWM、设备地址、任意持续时间或远程 `resume`。Waifu 只消费 `avatar`、`emotion` 和播放振幅，不读取 Prompt、记忆、原始传感器或 BLE 权限。

## 6. 记忆与删除

- 关系记忆键必须是 `user_id + persona_id`。
- 每轮最多注入 3-5 条当前 Persona 的已授权记忆。
- 会话原文、滚动摘要和长期记忆分开存储；删除后先使检索索引和缓存失效。
- 失控模式不自动形成关系记忆，只有结束后用户逐条确认才可保存。
- 删除 Persona 时级联删除关系记忆、会话关联、向量索引、缓存和角色资产。
- Agent 不拥有删除权限，删除只能由用户界面和后端鉴权 API 执行。

## 7. 请求伪代码

```text
on_user_event(event):
    assert session.belongs_to(user)
    assert persona.belongs_to(user)
    assert not session_or_persona.deleted

    context = build_context(
        prompt=load_prompt("b-agent-v1"),
        model="nascent-chat-9b",
        persona=load_active_persona(persona_id),
        scene=load_scene(session.scene_id),
        recent_turns=last_n_turns(session, n=6),
        summary=load_summary(session),
        memories=retrieve_authorized_memories(user_id, persona_id, limit=5),
        sensor=read_only_trend_summary(session),
        user_event=event,
    )
    result = qwen35_9b.stream_json(context, thinking=false, timeout_ms=1200)
    result = schema_validate_and_moderate(result)
    emit_reply_and_avatar(result.dialogue, result.avatar)
    governor.review(result.action)
    emit_memory_proposals(result.memory_proposals)
```

超时、非法 JSON、审核拒绝或记忆服务失败时，返回本地安全短句和 `action=null`；不重试完整语音，不把失败输入写入长期记忆，也不阻塞停止按钮。

## 8. 验收

- 连续调用的 Chat 逻辑别名为 `nascent-chat-9b`，Control 为 `nascent-control-9b`，Prompt 版本和 Persona 版本可追踪。
- 温度/压力只以趋势和质量摘要进入 Prompt，不能触发自动调档。
- 切换 Persona 后下一轮不出现上一 Persona 的关系记忆。
- 删除记忆后，新的检索结果和缓存不再包含该记忆。
- 模型返回非法 JSON、越界动作或审核拒绝时，设备不改变状态。
- Waifu、ASR、LLM、TTS 或 WebSocket 故障时，文字、手动控制和停止按钮仍可工作。
