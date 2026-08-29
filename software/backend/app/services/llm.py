"""B 层 Chat/Control：Prompt、Schema 与安全回退。供应商 HTTP 在 providers/。"""

from __future__ import annotations

import json
import logging

import httpx

from ..config import settings
from ..protocol import CloudAction, CloudActionEnvelope, CloudSummary, Emotion, SceneCtrl
from .agent_contract import (
    AgentTurn,
    AgentTurnRequest,
    ControlDecision,
    ControlDecisionRequest,
    PersonaTemplate,
    TemplateDraftRequest,
)
from .body_note_contract import BodyInsightModelOutput
from .prompt_builder import build_messages
from .providers import openai_compat

logger = logging.getLogger("nascent.llm")


async def complete_json(**kwargs) -> str:
    """Logical Chat/Control lane. Tests monkeypatch this instead of HTTP."""

    return await openai_compat.complete(**kwargs)


async def suggest(summary: CloudSummary) -> CloudActionEnvelope:
    if not settings.llm_api_key:
        return _stub(summary)

    # TODO(骨架): 调真模型。注意两件事：
    #   1. 超时要短。这条链路是"锦上添花"，卡住了宁可不给建议，
    #      也不能让 App 等着——App 等待期间用户是没有反馈的。
    #   2. 模型的输出必须当成不可信输入解析，越界值一律丢弃而不是钳位。
    return _stub(summary)


async def generate_turn(request: AgentTurnRequest, memories: list) -> AgentTurn:
    """生成一个 B 层回合；配置不完整或服务异常时返回安全回退。"""

    if not settings.llm_configured:
        return _agent_stub(request)

    try:
        content = await complete_json(
            model=settings.chat_llm_model or settings.llm_model,
            messages=build_messages(request, memories),
            timeout_s=settings.chat_llm_timeout_s,
            temperature=0.85,
            max_tokens=700,
        )
        result = AgentTurn.model_validate_json(content)
        allowed_skills = {
            skill.skill_id for skill in request.active_template.skills
        } if request.active_template else set()
        skill_proposals = [
            proposal for proposal in result.skill_proposals
            if proposal.skill_id in allowed_skills
        ]
        memory_proposals = (
            [] if request.session_mode == "wild" or request.memory_policy == "off"
            else result.memory_proposals
        )
        return result.model_copy(update={
            "action": None,
            "skill_proposals": skill_proposals,
            "memory_proposals": memory_proposals,
        })
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError) as exc:
        logger.warning("Chat 9B fallback to stub: %s", openai_compat.error_summary(exc))
        return _agent_stub(request)


async def generate_control(request: ControlDecisionRequest) -> ControlDecision:
    """Control 9B 只生成受限建议；安全条件不满足时保持当前状态。"""

    if _control_must_hold(request):
        return _control_hold("policy_hold")
    if not settings.llm_configured:
        return _control_hold("policy_hold")
    try:
        content = await complete_json(
            model=settings.control_llm_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是 Nascent 的 Control 9B。只根据脱敏趋势提出节奏建议，不能控制设备。"
                        "只输出 ControlDecision JSON，action 必须为 null。不得输出 stop、resume、BLE、"
                        "安全阈值、延长失控或任何未在 template_skill_allowlist 中的技能。"
                    ),
                },
                {"role": "user", "content": json.dumps(request.model_dump(mode="json"), ensure_ascii=False)},
            ],
            timeout_s=settings.control_llm_timeout_s,
            temperature=0.1,
            max_tokens=180,
        )
        result = ControlDecision.model_validate_json(content)
        return _apply_control_policy(result, request.template_skill_allowlist)
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError) as exc:
        logger.warning("Control 9B fallback to hold: %s", openai_compat.error_summary(exc))
        return _control_hold("model_unavailable")


def _control_must_hold(request: ControlDecisionRequest) -> bool:
    sensor = request.sensor_context
    quality = sensor.get("temperature_quality")
    pressure_quality = sensor.get("pressure_quality")
    data_age = sensor.get("data_age_ms")
    return (
        request.session_mode == "wild"
        or request.consent_state != "confirmed"
        or request.template_id is None
        or quality == "unknown"
        or pressure_quality == "unknown"
        or isinstance(data_age, (int, float)) and data_age > 10_000
    )


def _control_hold(reason: str) -> ControlDecision:
    return ControlDecision(decision="hold", reason_codes=[reason])


def _apply_control_policy(
    result: ControlDecision, allowlist: list[str]
) -> ControlDecision:
    """Normalize Control output. hold keeps its reasons and drops leftover suggestions."""

    if result.decision == "hold":
        return result.model_copy(
            update={
                "action": None,
                "recommended_skill_id": None,
                "recommended_level": None,
                "recommended_pattern": None,
                "requires_user_confirmation": True,
            }
        )
    if result.recommended_skill_id not in set(allowlist):
        return _control_hold("skill_not_allowed")
    return result.model_copy(update={"action": None, "requires_user_confirmation": True})


async def generate_template(request: TemplateDraftRequest) -> PersonaTemplate | None:
    """让模型生成参数化模板草稿；永远返回 draft，不能直接启用。"""

    if not settings.llm_configured:
        return None
    messages = [
        {
            "role": "system",
            "content": (
                "你是 Nascent 模板设计助手。只输出 PersonaTemplate JSON。"
                "source 必须是 custom，status 必须是 draft，skills 只能使用 rhythm_segment 或 set_pattern。"
                "档位只能 1 到 8，duration_s 只能 1 到 900，requires_confirmation 必须为 true。"
                "不能输出 BLE、resume、stop、延长失控、删除或安全阈值字段。"
            ),
        },
        {"role": "user", "content": json.dumps(request.model_dump(mode="json"), ensure_ascii=False)},
    ]
    try:
        content = await complete_json(
            model=settings.chat_llm_model or settings.llm_model,
            messages=messages,
            timeout_s=settings.chat_llm_timeout_s,
            temperature=0.2,
            max_tokens=300,
        )
        template = PersonaTemplate.model_validate_json(content)
        return template.model_copy(update={
            "source": "custom",
            "status": "draft",
            "persona_id": request.persona_id,
        })
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError):
        return None


async def generate_body_insight(
    message: str,
    scope: str,
    sessions: list[dict[str, object]],
) -> tuple[str, str | None]:
    """用 Chat 9B 帮用户理解已授权记录，不产生设备建议或长期记忆。"""

    if not settings.llm_configured:
        return _body_insight_stub(scope, sessions)
    try:
        content = await complete_json(
            model=settings.chat_llm_model or settings.llm_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是 Nascent 身体笔记的自我探索助手。只输出 BodyInsightModelOutput JSON，"
                        "字段只能是 dialogue 和 insight_candidate。只引用输入中的聚合事实，不能诊断、"
                        "判断性功能、断言愉悦或固定用户偏好。不能输出 action、skill_proposals、档位建议、"
                        "设备控制、医疗结论或安全词。说明观察来自本次还是近期对比。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"scope": scope, "sessions": sessions, "message": message},
                        ensure_ascii=False,
                    ),
                },
            ],
            timeout_s=settings.chat_llm_timeout_s,
            temperature=0.4,
            max_tokens=260,
        )
        result = BodyInsightModelOutput.model_validate_json(content)
        return result.dialogue, result.insight_candidate
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError) as exc:
        logger.warning("Body insight fallback to stub: %s", openai_compat.error_summary(exc))
        return _body_insight_stub(scope, sessions)


def _agent_stub(request: AgentTurnRequest) -> AgentTurn:
    persona = request.persona if isinstance(request.persona, dict) else {}
    name = str(persona.get("assistant_name") or persona.get("name") or "顾深").strip() or "顾深"
    spoken = str(persona.get("spoken") or "").strip()
    phase = request.scene_id
    if request.session_mode == "wild":
        dialogue = "我在。设备那边的计时你看着就好，我陪着你。"
    elif phase == "aftercare" or "事后" in request.user_input:
        dialogue = "我还在沙发这边陪着。过来靠一会儿，还是先歇着，你说。"
    elif phase == "climax_window":
        dialogue = "我跟着你。想快就快，想慢就慢，结束了我还在。"
    elif phase == "rising":
        dialogue = "还想再近一点就拉我一下。不想的话，抱着也行。"
    else:
        dialogue = spoken or f"{name}在。过来，今天想被哄，还是想被抱？"
    emotion = "gentle" if phase in {"climax_window", "aftercare"} else "playful"
    tts_style = "温柔" if phase in {"climax_window", "aftercare"} else "俏皮"
    scene_ctrl = "end" if phase == "aftercare" else "stay"
    return AgentTurn(
        dialogue=dialogue,
        emotion=emotion,
        tts_style=tts_style,
        scene_ctrl=scene_ctrl,
    )


def _body_insight_stub(scope: str, sessions: list[dict[str, object]]) -> tuple[str, str | None]:
    current = sessions[0]
    if scope == "recent" and len(sessions) > 1:
        dialogue = (
            f"我只参考了你确认的 {len(sessions)} 次记录。"
            "从这些记录看，时长和节奏并不总是一样；你更想先比较开始阶段，还是结束前的感受？"
        )
        candidate = "近期几次里，我想先从较轻的节奏开始，再根据当下感受决定是否变化。"
    else:
        dialogue = (
            f"只看这一次：{current['temperature_summary']}，{current['pressure_summary']}。"
            "这些只是当时的记录，不代表固定偏好。哪一段最接近你自己的感受？"
        )
        candidate = "这一次，慢慢开始和清楚地收尾让我更容易听见自己的感受。"
    output = BodyInsightModelOutput(dialogue=dialogue, insight_candidate=candidate)
    return output.dialogue, output.insight_candidate


def _stub(summary: CloudSummary) -> CloudActionEnvelope:
    # 桩不给 action：默认不建议改档位。
    # 让一个还没接模型的服务去动强度是最容易被忽略的坑。
    return CloudActionEnvelope(
        dialogue="（占位）我在。",
        action=CloudAction(),
        scene_ctrl=SceneCtrl.STAY,
        emotion=Emotion.CALM,
    )
