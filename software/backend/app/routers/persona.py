"""人设路由。

人设只决定**说什么**，不决定灯色也不决定强度。
换人不换灯——灯只表达当前是哪种玩法，与人设无关。
自定义人设（手写或问卷）上传后出现在选择列表，并作为 Chat 提示词。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/v1/persona", tags=["persona"])


class Persona(BaseModel):
    id: str
    name: str
    tone: str
    # 这里刻意没有任何颜色 / 强度字段。要加之前先回去看上面那句话。


class CustomPersonaIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    id: str | None = Field(default=None, max_length=128)
    name: str = Field(min_length=1, max_length=40)
    source: str = Field(default="free", max_length=16)
    card: dict[str, object] = Field(default_factory=dict)
    text: str = Field(default="", max_length=8000)


class CustomPersona(BaseModel):
    id: str
    name: str
    tone: str = ""
    source: str = "free"
    card: dict[str, object] = Field(default_factory=dict)
    text: str = ""
    created_at: str
    updated_at: str


_PRESETS = [
    Persona(id="gentle", name="顾深", tone="甜系男友，黏人但不催"),
    Persona(id="playful", name="阿北", tone="爱逗你，但会看你脸色"),
    Persona(id="calm", name="阿月", tone="低语、留白，但一直在"),
]

_CUSTOM: dict[str, dict[str, CustomPersona]] = defaultdict(dict)


def _now() -> str:
    return datetime.now(UTC).isoformat()


@router.get("", response_model=list[Persona])
async def list_personas() -> list[Persona]:
    return _PRESETS


@router.get("/custom", response_model=list[CustomPersona])
async def list_custom_personas(user_id: str) -> list[CustomPersona]:
    items = list(_CUSTOM.get(user_id, {}).values())
    items.sort(key=lambda item: item.updated_at, reverse=True)
    return items


@router.post("/custom", response_model=CustomPersona)
async def upsert_custom_persona(payload: CustomPersonaIn) -> CustomPersona:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    card = dict(payload.card or {})
    if not card.get("assistant_name"):
        card["assistant_name"] = name
    if not card.get("name"):
        card["name"] = name
    now = _now()
    persona_id = (payload.id or "").strip() or f"custom-{uuid4().hex[:10]}"
    existing = _CUSTOM[payload.user_id].get(persona_id)
    saved = CustomPersona(
        id=persona_id,
        name=name,
        tone=str(card.get("subtitle") or "")[:40],
        source=payload.source if payload.source in {"free", "quiz"} else "free",
        card=card,
        text=payload.text or "",
        created_at=existing.created_at if existing else now,
        updated_at=now,
    )
    _CUSTOM[payload.user_id][persona_id] = saved
    return saved
