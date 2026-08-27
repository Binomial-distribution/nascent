"""人设路由。

人设只决定**说什么**，不决定灯色也不决定强度。
换人不换灯——灯只表达当前是哪种玩法，与人设无关。
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/v1/persona", tags=["persona"])


class Persona(BaseModel):
    id: str
    name: str
    tone: str
    # 这里刻意没有任何颜色 / 强度字段。要加之前先回去看上面那句话。


# 骨架阶段用内存里的固定列表，之后换成持久化。
_PRESETS = [
    Persona(id="gentle", name="温和", tone="缓慢、克制、多确认"),
    Persona(id="playful", name="俏皮", tone="轻快、有来有回"),
    Persona(id="calm", name="沉静", tone="低语、留白多"),
]


@router.get("", response_model=list[Persona])
async def list_personas() -> list[Persona]:
    return _PRESETS
