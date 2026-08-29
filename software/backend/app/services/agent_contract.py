"""B 层 Agent 的应用层契约。

协议目录里的模型描述设备和会话摘要；这里描述 Agent 的受控输入输出。
Agent 契约故意不包含 BLE 命令、设备身份或可执行工具调用。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .tts_style import TtsStyle, normalize_tts_style


class AvatarState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expression: str = "neutral"
    motion: str = "listen"
    interruptible: bool = True


class MemoryProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    text: str = Field(min_length=1, max_length=240)
    reason: str = Field(default="", max_length=120)


class SkillProposal(BaseModel):
    """模型提出的技能建议，必须由客户端再次确认并通过 Governor。"""

    model_config = ConfigDict(extra="forbid")

    skill_id: Literal["rhythm_segment", "set_pattern"]
    reason: str = Field(default="", max_length=120)
    requires_confirmation: Literal[True] = True


class AgentTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dialogue: str = Field(min_length=1, max_length=500)
    avatar: AvatarState = AvatarState()
    scene_ctrl: Literal["stay", "next", "end"] = "stay"
    emotion: Literal["gentle", "playful", "calm"] = "calm"
    tts_style: TtsStyle = "平静"
    # Agent 只能给建议，绝不能产出设备命令。
    action: None = None
    memory_proposals: list[MemoryProposal] = Field(default_factory=list)
    skill_proposals: list[SkillProposal] = Field(default_factory=list, max_length=4)
    # model=真模型；stub=密钥/网络失败时的本地占位（前端据此提示用户）
    fallback: Literal["none", "stub"] = "none"

    @field_validator("tts_style", mode="before")
    @classmethod
    def _coerce_tts_style(cls, value: object) -> str:
        return normalize_tts_style(value)


class AgentTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1, max_length=128)
    persona_id: str = Field(min_length=1, max_length=128)
    persona: dict[str, object] = Field(default_factory=dict)
    session_mode: Literal["scenario", "free", "wild"] = "scenario"
    scene_id: str = Field(default="scene_01", max_length=128)
    session_state: Literal["paused", "running", "ended"] = "running"
    remaining_seconds: int | None = Field(default=None, ge=0)
    consent_state: Literal["unknown", "confirmed", "withdrawn"] = "confirmed"
    memory_policy: Literal["ask_each_time", "off"] = "ask_each_time"
    sensor_context: dict[str, object] = Field(default_factory=dict)
    recent_turns: list[dict[str, str]] = Field(default_factory=list, max_length=12)
    conversation_summary: str = Field(default="", max_length=2000)
    user_input: str = Field(min_length=1, max_length=2000)
    active_template: PersonaTemplate | None = None


class MemoryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    user_id: str
    persona_id: str
    text: str
    created_at: int


class MemoryWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1, max_length=128)
    persona_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=240)


class HardwareSkill(BaseModel):
    """模板可声明的硬件能力白名单，不是可执行 BLE 命令。"""

    model_config = ConfigDict(extra="forbid")

    skill_id: Literal["rhythm_segment", "set_pattern"]
    level: int | None = Field(default=None, ge=1, le=9)
    pattern: str | None = Field(default=None, max_length=32)
    duration_s: int = Field(ge=1, le=900)
    requires_confirmation: bool = True

    @model_validator(mode="after")
    def validate_capability(self) -> "HardwareSkill":
        allowed_patterns = {"soft", "wave", "pulse", "strong_pulse", "mixed"}
        if self.pattern is not None and self.pattern not in allowed_patterns:
            raise ValueError("pattern is not in the approved hardware skill list")
        if self.skill_id == "rhythm_segment" and self.level is None:
            raise ValueError("rhythm_segment requires a level")
        if self.skill_id == "set_pattern" and self.pattern is None:
            raise ValueError("set_pattern requires a pattern")
        return self


class PersonaTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: str = Field(min_length=1, max_length=128)
    source: Literal["preset", "custom"]
    name: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=240)
    persona_id: str = Field(min_length=1, max_length=128)
    skills: list[HardwareSkill] = Field(default_factory=list, max_length=12)
    status: Literal["draft", "confirmed"] = "draft"


class TemplateDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1, max_length=128)
    persona_id: str = Field(min_length=1, max_length=128)
    conversation: list[dict[str, str]] = Field(min_length=1, max_length=12)


class TemplateDraftResponse(BaseModel):
    template: PersonaTemplate
    requires_confirmation: bool = True


class ControlDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    session_mode: Literal["scenario", "free", "wild"] = "scenario"
    template_id: str | None = Field(default=None, max_length=128)
    template_skill_allowlist: list[
        Literal["rhythm_segment", "set_pattern", "hold_current"]
    ] = Field(default_factory=list, max_length=12)
    current_level: int = Field(default=0, ge=0, le=9)
    remaining_seconds: int | None = Field(default=None, ge=0)
    consent_state: Literal["unknown", "confirmed", "withdrawn"] = "confirmed"
    # 与亲密同意分开：每次情景开始时只在客户端内存中授权，默认不授权设备自动调节。
    automation_authorized: bool = False
    sensor_context: dict[str, object] = Field(default_factory=dict)
    explicit_user_signal: str = Field(default="", max_length=500)
    recent_feedback: Literal["unknown", "comfortable", "slow_down", "pause", "keep"] = (
        "unknown"
    )


class ControlDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["hold", "recommend", "ask"] = "hold"
    recommended_skill_id: (
        Literal["rhythm_segment", "set_pattern", "hold_current"] | None
    ) = None
    recommended_level: int | None = Field(default=None, ge=1, le=9)
    recommended_pattern: str | None = Field(default=None, max_length=32)
    hold_seconds: int = Field(default=30, ge=1, le=900)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reason_codes: list[str] = Field(default_factory=list, max_length=8)
    # 未做本次情景授权时保持 true；已授权后建议仍须经客户端 Governor，但无需逐条弹窗。
    requires_user_confirmation: bool = True
    action: None = None


class ParallelAgentTurnRequest(BaseModel):
    """Inputs for the Chat and Control lanes of one experience turn."""

    model_config = ConfigDict(extra="forbid")

    chat: AgentTurnRequest
    control: ControlDecisionRequest

    @model_validator(mode="after")
    def validate_shared_context(self) -> "ParallelAgentTurnRequest":
        if self.chat.user_id != self.control.user_id:
            raise ValueError("chat and control user_id must match")
        if self.chat.session_mode != self.control.session_mode:
            raise ValueError("chat and control session_mode must match")
        if self.chat.active_template is not None:
            if self.chat.active_template.template_id != self.control.template_id:
                raise ValueError("chat and control template_id must match")
        return self


class ParallelDataFlow(BaseModel):
    """Sanitized stages that the UI can display without exposing prompts."""

    model_config = ConfigDict(extra="forbid")

    chat: list[str] = Field(
        default_factory=lambda: [
            "用户输入与已授权记忆",
            "Chat 9B",
            "台词与人设表现",
        ]
    )
    control: list[str] = Field(
        default_factory=lambda: [
            "聚合传感趋势与 Skill 白名单",
            "Control 9B",
            "待确认节奏建议",
        ]
    )
    device: list[str] = Field(
        default_factory=lambda: [
            "本次情景授权",
            "Governor",
            "sendCommand()",
            "设备安全规则",
        ]
    )


class ParallelAgentTurnResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    execution: Literal["parallel"] = "parallel"
    elapsed_ms: int = Field(ge=0)
    chat: AgentTurn
    control: ControlDecision
    data_flow: ParallelDataFlow = Field(default_factory=ParallelDataFlow)
