"""预置模板与用户自定义模板。

自定义模板的生命周期是 draft -> confirmed。草稿可以由对话生成，但不能直接
启动设备；只有确认后的模板才会出现在使用界面。
"""

from __future__ import annotations

from collections import defaultdict
from uuid import uuid4

from . import llm
from .agent_contract import HardwareSkill, PersonaTemplate, TemplateDraftRequest

_PRESETS = [
    PersonaTemplate(
        template_id="preset_gentle_start",
        source="preset",
        name="轻声陪伴",
        description="慢速开始，保留充分停顿。",
        persona_id="calm",
        skills=[HardwareSkill(skill_id="rhythm_segment", level=2, pattern="soft", duration_s=90)],
        status="confirmed",
    ),
    PersonaTemplate(
        template_id="preset_steady",
        source="preset",
        name="稳定节奏",
        description="保持单一节奏，不自动改变安全规则。",
        persona_id="gentle",
        skills=[HardwareSkill(skill_id="rhythm_segment", level=3, pattern="wave", duration_s=120)],
        status="confirmed",
    ),
]

_CUSTOM: dict[str, dict[str, PersonaTemplate]] = defaultdict(dict)


async def list_templates(user_id: str) -> list[PersonaTemplate]:
    return [*_PRESETS, *_CUSTOM[user_id].values()]


async def draft(request: TemplateDraftRequest) -> PersonaTemplate:
    generated = await llm.generate_template(request)
    if generated is not None:
        return _safe_draft(generated, request)

    # 没有模型或模型超时时仍能让 UI 走通“对话创建 -> 预览 -> 确认”。
    text = " ".join(turn.get("content", "") for turn in request.conversation)
    level = 2 if any(word in text for word in ("慢", "轻", "安静")) else 3
    name = "慢慢靠近" if level == 2 else "我的新节奏"
    return PersonaTemplate(
        template_id=f"tpl_{uuid4().hex[:12]}",
        source="custom",
        name=name,
        description=text[:120] or "由对话生成的自定义节奏草稿",
        persona_id=request.persona_id,
        skills=[HardwareSkill(skill_id="rhythm_segment", level=level, pattern="soft", duration_s=90)],
        status="draft",
    )


async def confirm(user_id: str, template: PersonaTemplate) -> PersonaTemplate:
    confirmed = template.model_copy(update={"source": "custom", "status": "confirmed"})
    _CUSTOM[user_id][confirmed.template_id] = _safe_draft(confirmed, None).model_copy(update={"status": "confirmed"})
    return _CUSTOM[user_id][confirmed.template_id]


async def delete(user_id: str, template_id: str) -> bool:
    return _CUSTOM[user_id].pop(template_id, None) is not None


def _safe_draft(template: PersonaTemplate, request: TemplateDraftRequest | None) -> PersonaTemplate:
    persona_id = request.persona_id if request is not None else template.persona_id
    # 二次校验确保模型无法把草稿变成永久激活或扩大能力范围。
    safe_skills = [
        skill.model_copy(update={"requires_confirmation": True})
        for skill in template.skills
        if skill.skill_id in {"rhythm_segment", "set_pattern"}
    ][:12]
    return template.model_copy(update={
        "template_id": template.template_id or f"tpl_{uuid4().hex[:12]}",
        "source": "custom",
        "persona_id": persona_id,
        "skills": safe_skills,
        "status": "draft",
    })
