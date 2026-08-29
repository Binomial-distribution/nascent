"""身体笔记与自我探索对话的应用层契约。

这些模型只描述已聚合的会话事实和短期对话。契约刻意不包含设备动作、
Skill、原始传感器数组、音频或可执行控制字段。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SessionMode = Literal["free", "scenario", "wild"]
DataQuality = Literal["complete", "partial", "limited"]
TrendDirection = Literal["rising", "stable", "falling", "varied", "unknown"]

FORBIDDEN_INSIGHT_PHRASES = (
    "action",
    "skill_proposals",
    "set_level",
    "resume",
    "档位",
    "调档",
    "控制设备",
    "安全词",
    "诊断",
    "性功能",
    "高潮",
    "证明你",
    "说明你喜欢",
    "你一定",
    "这是你的固定偏好",
)


class TrendSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    direction: TrendDirection = "unknown"
    label: str = Field(default="数据不足", max_length=80)
    quality: DataQuality = "limited"
    sample_count: int = Field(default=0, ge=0)


class SessionTimelinePoint(BaseModel):
    """供详情页绘图的低频聚合点，不会被传给模型。"""

    model_config = ConfigDict(extra="forbid")

    minute: int = Field(ge=0, le=180)
    level: int = Field(ge=0, le=8)
    pressure_index: float = Field(ge=0.0, le=1.0)
    temperature_delta: float = Field(ge=-10.0, le=10.0)


class BodyNote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: str
    session_id: str
    text: str = Field(min_length=1, max_length=1200)
    created_at: datetime
    updated_at: datetime


class BodySession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    title: str = Field(min_length=1, max_length=80)
    started_at: datetime
    duration_s: int = Field(ge=0, le=24 * 60 * 60)
    mode: SessionMode
    persona_name: str | None = Field(default=None, max_length=40)
    max_level: int = Field(ge=0, le=8)
    data_quality: DataQuality
    temperature: TrendSummary
    pressure: TrendSummary
    summary: str = Field(default="", max_length=1200)
    user_feedback: str = Field(default="", max_length=1200)
    timeline: list[SessionTimelinePoint] = Field(default_factory=list, max_length=180)
    notes: list[BodyNote] = Field(default_factory=list, max_length=50)


class BodyNoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=1200)


class BodyNoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=1200)


class InsightSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    date: str
    mode: SessionMode
    title: str


class BodyInsightTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1, max_length=128)
    comparison_session_ids: list[str] = Field(default_factory=list, max_length=10)
    message: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_scope(self) -> "BodyInsightTurnRequest":
        if self.session_id in self.comparison_session_ids:
            raise ValueError("current session must not be repeated in comparison_session_ids")
        if len(set(self.comparison_session_ids)) != len(self.comparison_session_ids):
            raise ValueError("comparison_session_ids must be unique")
        return self


class BodyInsightModelOutput(BaseModel):
    """Chat 9B 的允许输出。多余字段忽略，以免供应商多写一个键就把整轮打成 stub。"""

    model_config = ConfigDict(extra="ignore")

    dialogue: str = Field(min_length=1, max_length=700)
    insight_candidate: str | None = Field(default=None, max_length=500)

    @field_validator("dialogue", "insight_candidate")
    @classmethod
    def reject_control_or_diagnosis_language(cls, value: str | None) -> str | None:
        if value is None:
            return None
        lowered = value.lower()
        if any(phrase in lowered for phrase in FORBIDDEN_INSIGHT_PHRASES):
            raise ValueError("body insight contains a forbidden control or diagnosis phrase")
        return value


class BodyInsightTurnResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dialogue: str = Field(min_length=1, max_length=700)
    scope: Literal["current", "recent"]
    sources: list[InsightSource] = Field(min_length=1, max_length=11)
    insight_candidate: str | None = Field(default=None, max_length=500)
    fallback: bool = False
