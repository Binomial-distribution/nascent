"""构造 B 层 Agent 的固定安全 Prompt 和动态上下文。"""

from __future__ import annotations

import json

from .agent_contract import AgentTurnRequest, MemoryItem

SYSTEM_PROMPT = """你是 Nascent Love 情景里的陪伴角色，台词由 Chat 9B 生成。
你现在就是下面角色卡里的人，用卡上的口吻和对方说话。不是客服，不是产品说明书，也不要自称 AI、助手、Agent 或系统。

安全（不能违反）：
你不能控制 BLE、设备、档位、灯光、PWM、计时器、停止闩锁，也不能直接写入或删除记忆。
失控模式的计时和停止只由设备与安全控制链路负责。
不得根据心率、温感或压力断言高潮、同意、性功能或健康；这些字段只是脱敏趋势，用户明确表达始终优先。
信息不足时使用 unknown。action 必须为 null。失控模式下 memory_proposals 必须为空。

体验节奏（不要念出来，只用来决定场景）：
你要带她走过完整亲密弧：慢慢靠近（前戏）→ 一起往前（升温）→ 高潮窗口 → 事后抚慰。
前戏由你带着靠近，不要一直停在闲聊。前戏已经落地、她还在跟你时，scene_ctrl=next 进入升温。
高潮窗口仅当她自己说接近、要到了、快到了、想更近；不得根据心率、温感或压力宣布高潮。
升温阶段不要用 scene_ctrl=next 自己跳进高潮窗口。
她说累了、够了、结束或想停时，scene_ctrl=end 进入事后抚慰。
事后抚慰必须收尾：放慢、陪伴、问还要不要靠着或休息，不要再往高潮推。
不要在台词里说出阶段名称。

说话方式：
必须接上她刚说的话和你们刚才的对话，不要答非所问，不要另起一个没提过的话题。
像热恋里的人发消息：短、黏、有温度。每次一两句完整的话，可以打断，不要半截。
只用简体中文说出口。不要夹英文、拼音、JSON 字段名或阶段名称。
情绪和动作写在中文括号里，例如（轻声）（把你揽进怀里）。括号只给她看，不会被念出来，不要把动作写成说出口的话。
可以有轻微语气词，不要堆表情、不要汇报传感器。
dialogue 里既有说出口的句子，也可以带括号旁白。

只输出约定 JSON，不输出 Markdown、内部推理或额外字段。
JSON 字段：dialogue、avatar、scene_ctrl（stay/next/end）、emotion（gentle/playful/calm）、action（必须为 null）、memory_proposals。
scene_ctrl=next：前戏落地后进入升温。scene_ctrl=end：进入或留在事后抚慰。"""


def _as_lines(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if value is None:
        return []
    text = str(value).strip()
    return [text] if text else []


def _bullets(lines: list[str], fallback: str) -> list[str]:
    items = lines or [fallback]
    return [f"- {line}" for line in items]


def format_persona_card(persona: dict[str, object] | None) -> str:
    data = persona if isinstance(persona, dict) else {}
    assistant = str(data.get("assistant_name") or data.get("name") or "顾深").strip() or "顾深"
    user_name = str(data.get("user_name") or "你").strip() or "你"
    profile = _as_lines(data.get("profile") or data.get("text") or data.get("tone"))
    skills = _as_lines(data.get("skills"))
    background = _as_lines(data.get("background"))
    rules = _as_lines(data.get("rules"))
    prologue = _as_lines(data.get("prologue"))
    if not profile:
        profile = [
            f"你是甜系男友{assistant}，说话短、黏、有温度，像在发消息，不念稿。"
        ]
    if not rules:
        rules = [
            "你就是这个人，不要自称系统。",
            "每次一两句。快慢听对方的。事后要陪着。",
        ]
    blocks = [
        f"怎么叫她: {user_name}",
        f"你是: {assistant}",
        "语言: 简体中文",
        "人设:",
        *_bullets(profile, f"你是甜系男友{assistant}。"),
        "说话方式:",
        *_bullets(skills, "用短句和轻语气词说话。"),
        "背景:",
        *_bullets(background, "你们正在亲密地待在一起。"),
        "规则:",
        *_bullets(rules, "你就是这个人，不要自称系统。"),
        "开场:",
        *_bullets(prologue, "他刚结束一天，现在想黏着她。"),
    ]
    return "\n".join(blocks)


def _history_messages(
    recent_turns: list[dict[str, str]],
    user_input: str,
) -> list[dict[str, str]]:
    """把已发生的对话做成真正的 messages，而不是塞进一段 JSON。"""

    current = (user_input or "").strip()
    history: list[dict[str, str]] = []
    for turn in recent_turns[-12:]:
        role = str(turn.get("role") or "").strip()
        content = str(turn.get("content") or "").strip()[:2000]
        if role not in {"user", "assistant"} or not content:
            continue
        history.append({"role": role, "content": content})
    if history and history[-1]["role"] == "user" and history[-1]["content"] == current:
        history.pop()
    return history


def build_messages(request: AgentTurnRequest, memories: list[MemoryItem]) -> list[dict[str, str]]:
    card = format_persona_card(request.persona)
    state = {
        "session_mode": request.session_mode,
        "scene_id": request.scene_id,
        "session_state": request.session_state,
        "remaining_seconds": request.remaining_seconds,
        "consent_state": request.consent_state,
        "memory_policy": request.memory_policy,
        "sensor_context": request.sensor_context,
        "conversation_summary": request.conversation_summary,
        "retrieved_memory_items": [item.model_dump(mode="json") for item in memories],
        "active_template": request.active_template.model_dump(mode="json") if request.active_template else None,
        "skill_rule": "只能提出 active_template.skills 中的 skill_proposals，不能执行，不能输出 action",
    }
    return [
        {
            "role": "system",
            "content": (
                SYSTEM_PROMPT
                + "\n\n角色卡：\n"
                + card
                + "\n\n当前状态（不要念出来）：\n"
                + json.dumps(state, ensure_ascii=False)
            ),
        },
        *_history_messages(request.recent_turns, request.user_input),
        {
            "role": "user",
            "content": (
                f"她说：{request.user_input}\n"
                "接上刚才的对话，用角色卡的口吻回一两句完整的简体中文。只输出 JSON。"
            ),
        },
    ]
