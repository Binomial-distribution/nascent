"""Qwen 9B 的 OpenAI-compatible 适配器。

没有完整配置时仍然安全回退到本地短句。模型输出永远按不可信输入处理，
不会因为模型请求失败而阻塞停止路径。
"""

from __future__ import annotations

import json

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

    if not settings.llm_api_key or not settings.llm_base_url:
        return _agent_stub(request)

    payload = {
        "model": settings.chat_llm_model or settings.llm_model,
        "messages": build_messages(request, memories),
        "temperature": 0.7,
        "max_tokens": 220,
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    try:
        body = await _post_json(payload, settings.chat_llm_timeout_s)
        result = AgentTurn.model_validate_json(_message_content(body))
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
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError):
        return _agent_stub(request)


async def generate_control(request: ControlDecisionRequest) -> ControlDecision:
    """Control 9B 只生成受限建议；安全条件不满足时保持当前状态。"""

    if _control_must_hold(request) or not settings.llm_api_key or not settings.llm_base_url:
        return _control_hold("policy_hold")
    payload = {
        "model": settings.control_llm_model,
        "messages": [
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
        "temperature": 0.1,
        "max_tokens": 180,
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    try:
        result = ControlDecision.model_validate_json(
            _message_content(await _post_json(payload, settings.control_llm_timeout_s))
        )
        allowed = set(request.template_skill_allowlist)
        if result.recommended_skill_id not in allowed:
            return _control_hold("skill_not_allowed")
        return result.model_copy(update={"action": None, "requires_user_confirmation": True})
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError):
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


async def generate_template(request: TemplateDraftRequest) -> PersonaTemplate | None:
    """让模型生成参数化模板草稿；永远返回 draft，不能直接启用。"""

    if not settings.llm_api_key or not settings.llm_base_url:
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
        body = await _post_json(
            {
                "model": settings.chat_llm_model or settings.llm_model,
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": 300,
                "stream": False,
                "response_format": {"type": "json_object"},
            },
            settings.chat_llm_timeout_s,
        )
        template = PersonaTemplate.model_validate_json(_message_content(body))
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

    if not settings.llm_api_key or not settings.llm_base_url:
        return _body_insight_stub(scope, sessions)
    payload = {
        "model": settings.chat_llm_model or settings.llm_model,
        "messages": [
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
        "temperature": 0.4,
        "max_tokens": 260,
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    try:
        result = BodyInsightModelOutput.model_validate_json(
            _message_content(await _post_json(payload, settings.chat_llm_timeout_s))
        )
        return result.dialogue, result.insight_candidate
    except (httpx.HTTPError, ValueError, TypeError, json.JSONDecodeError):
        return _body_insight_stub(scope, sessions)


async def _post_json(payload: dict, timeout_s: float | None = None) -> dict:
    async with httpx.AsyncClient(timeout=timeout_s or settings.llm_timeout_s) as client:
        response = await client.post(
            _completion_url(settings.llm_base_url),
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        return response.json()


def _completion_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _message_content(body: dict) -> str:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("LLM response has no choices")
    content = choices[0].get("message", {}).get("content")
    if not isinstance(content, str):
        raise ValueError("LLM response content is not text")
    return content.strip().removeprefix("```json").removesuffix("```").strip()


def _agent_stub(request: AgentTurnRequest) -> AgentTurn:
    dialogue = "我在这里，按设备的计时和安全规则来。" if request.session_mode == "wild" else "我在这里，按你的节奏来。"
    return AgentTurn(dialogue=dialogue, emotion="calm")


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
    return dialogue, candidate


def _stub(summary: CloudSummary) -> CloudActionEnvelope:
    # 桩不给 action：默认不建议改档位。
    # 让一个还没接模型的服务去动强度是最容易被忽略的坑。
    return CloudActionEnvelope(
        dialogue="（占位）我在。",
        action=CloudAction(),
        scene_ctrl=SceneCtrl.STAY,
        emotion=Emotion.CALM,
    )
