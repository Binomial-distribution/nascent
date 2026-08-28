"""构造 B 层 Agent 的固定安全 Prompt 和动态上下文。"""

from __future__ import annotations

import json

from .agent_contract import AgentTurnRequest, MemoryItem

SYSTEM_PROMPT = """你是 Nascent Love 的 B 层情境陪伴 Agent。

你只负责简短、可打断的对话，推进或结束当前情境，以及返回 Waifu 表现状态。
你不能控制 BLE、设备、档位、灯光、PWM、计时器、停止闩锁，也不能直接写入或删除记忆。
失控模式的计时和停止只由设备与安全控制链路负责。不得把温度、压力、档位或时长写成疾病、诊断或确定的生理结论。
温度和压力只读趋势摘要；信息不足时使用 unknown，用户明确表达优先。
只输出约定 JSON，不输出 Markdown、内部推理或额外字段。action 必须为 null。
失控模式下 memory_proposals 必须为空。memory_proposals 只能作为待确认候选，不能假设已经保存。

JSON 字段：dialogue、avatar、scene_ctrl（stay/next/end）、emotion（gentle/playful/calm）、action（必须为 null）、memory_proposals。
首句适合立即 TTS，简短、自然、无特殊符号堆叠。"""


def build_messages(request: AgentTurnRequest, memories: list[MemoryItem]) -> list[dict[str, str]]:
    dynamic = {
        "session_mode": request.session_mode,
        "scene_id": request.scene_id,
        "session_state": request.session_state,
        "remaining_seconds": request.remaining_seconds,
        "consent_state": request.consent_state,
        "memory_policy": request.memory_policy,
        "persona": request.persona,
        "sensor_context": request.sensor_context,
        "recent_turns": request.recent_turns,
        "conversation_summary": request.conversation_summary,
        "retrieved_memory_items": [item.model_dump(mode="json") for item in memories],
        "user_input": request.user_input,
        "active_template": request.active_template.model_dump(mode="json") if request.active_template else None,
        "skill_rule": "只能提出 active_template.skills 中的 skill_proposals，不能执行，不能输出 action",
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": "请依据以下受控上下文生成一个 JSON 回合：\n" + json.dumps(dynamic, ensure_ascii=False),
        },
    ]
