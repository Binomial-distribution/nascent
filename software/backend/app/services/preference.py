"""Non-medical IRPI preference scoring and a replaceable store."""

from __future__ import annotations

from dataclasses import dataclass
from time import time
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

IRPI_WEIGHTS = {"explicit": 0.45, "behavior": 0.25, "pressure": 0.15, "temperature": 0.10, "context": 0.05}
PreferenceKey = Literal["pace_preference", "intensity_preference", "pattern_preference", "voice_preference", "scene_preference", "boundary_preference"]


class PreferenceObservation(BaseModel):
    """Redacted post-turn data. Sensors never establish consent or health."""

    model_config = ConfigDict(extra="forbid")
    user_id: str = Field(min_length=1, max_length=128)
    persona_id: str = Field(min_length=1, max_length=128)
    template_id: str = Field(min_length=1, max_length=128)
    preference_key: PreferenceKey
    candidate: str = Field(min_length=1, max_length=64)
    explicit_feedback: Literal["unknown", "comfortable", "keep", "slow_down", "pause", "dislike"] = "unknown"
    active_behavior: Literal["unknown", "continued", "advanced", "lowered", "paused", "skipped"] = "unknown"
    pressure_trend: Literal["unknown", "rising", "steady", "variable", "falling"] = "unknown"
    temperature_trend: Literal["unknown", "warming", "stable", "cooling"] = "unknown"
    context_fit: float = Field(default=0.5, ge=0.0, le=1.0)
    sensor_quality: Literal["unknown", "partial", "valid"] = "unknown"
    link_state: Literal["unknown", "degraded", "valid"] = "unknown"
    data_age_ms: int | None = Field(default=None, ge=0)
    missing_ratio: float = Field(default=0.0, ge=0.0, le=1.0)
    consent_state: Literal["unknown", "confirmed", "withdrawn"] = "confirmed"
    safety_event: bool = False


class IRPIResult(BaseModel):
    """An explainable product ranking score, never a medical measurement."""

    model_config = ConfigDict(extra="forbid")
    score: float = Field(ge=0.0, le=1.0)
    quality_gate: float = Field(ge=0.0, le=1.0)
    accepted: bool
    weighted_components: dict[str, float]
    reason_codes: list[str] = Field(default_factory=list)


class PreferenceSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    persona_id: str
    template_id: str
    preference_key: PreferenceKey
    candidate: str
    score: float = Field(ge=0.0, le=1.0)
    sample_count: int = Field(ge=1)
    updated_at: int


class PreferenceStore(Protocol):
    async def record(self, observation: PreferenceObservation, result: IRPIResult) -> PreferenceSnapshot | None: ...
    async def list_scope(self, *, user_id: str, persona_id: str, template_id: str) -> list[PreferenceSnapshot]: ...
    async def delete_scope(self, *, user_id: str, persona_id: str, template_id: str | None = None) -> int: ...


@dataclass
class _StoredPreference:
    score: float
    sample_count: int
    updated_at: int


class InMemoryPreferenceStore:
    """Process-local store used until a persistent store is wired in."""

    def __init__(self) -> None:
        self._items: dict[tuple[str, str, str, str, str], _StoredPreference] = {}

    async def record(self, observation: PreferenceObservation, result: IRPIResult) -> PreferenceSnapshot | None:
        if not result.accepted:
            return None
        key = (observation.user_id, observation.persona_id, observation.template_id, observation.preference_key, observation.candidate)
        previous = self._items.get(key)
        count = 1 if previous is None else previous.sample_count + 1
        score = result.score if previous is None else (previous.score * (count - 1) + result.score) / count
        now = int(time())
        self._items[key] = _StoredPreference(score=score, sample_count=count, updated_at=now)
        return PreferenceSnapshot(user_id=observation.user_id, persona_id=observation.persona_id, template_id=observation.template_id, preference_key=observation.preference_key, candidate=observation.candidate, score=score, sample_count=count, updated_at=now)

    async def list_scope(self, *, user_id: str, persona_id: str, template_id: str) -> list[PreferenceSnapshot]:
        result = []
        for (u, p, t, key, candidate), value in self._items.items():
            if (u, p, t) == (user_id, persona_id, template_id):
                result.append(PreferenceSnapshot(user_id=u, persona_id=p, template_id=t, preference_key=key, candidate=candidate, score=value.score, sample_count=value.sample_count, updated_at=value.updated_at))
        return sorted(result, key=lambda item: item.score, reverse=True)

    async def delete_scope(self, *, user_id: str, persona_id: str, template_id: str | None = None) -> int:
        keys = [key for key in self._items if key[0] == user_id and key[1] == persona_id and (template_id is None or key[2] == template_id)]
        for key in keys:
            del self._items[key]
        return len(keys)


preference_store: PreferenceStore = InMemoryPreferenceStore()


def calculate_irpi(observation: PreferenceObservation) -> IRPIResult:
    """Apply explicit-feedback-first weights and a sensor/link quality gate."""

    if observation.safety_event:
        return _rejected("safety_event")
    if observation.consent_state != "confirmed":
        return _rejected("consent_not_confirmed")
    reasons: list[str] = []
    quality = _quality_gate(observation, reasons)
    values = {
        "explicit": {"unknown": .5, "comfortable": .85, "keep": .8, "slow_down": .35, "pause": 0., "dislike": .1}[observation.explicit_feedback],
        "behavior": {"unknown": .5, "continued": .75, "advanced": .8, "lowered": .3, "paused": .1, "skipped": .15}[observation.active_behavior],
        "pressure": {"unknown": .5, "rising": .6, "steady": .75, "variable": .5, "falling": .35}[observation.pressure_trend],
        "temperature": {"unknown": .5, "warming": .6, "stable": .75, "cooling": .35}[observation.temperature_trend],
        "context": observation.context_fit,
    }
    weighted = {key: IRPI_WEIGHTS[key] * value for key, value in values.items()}
    score = max(0., min(1., quality * sum(weighted.values())))
    accepted = quality >= .5 and observation.explicit_feedback not in {"pause", "dislike"}
    if not accepted:
        reasons.append("quality_below_threshold" if quality < .5 else "negative_feedback")
    return IRPIResult(score=score, quality_gate=quality, accepted=accepted, weighted_components=weighted, reason_codes=reasons)


def _rejected(reason: str) -> IRPIResult:
    return IRPIResult(score=0., quality_gate=0., accepted=False, weighted_components={}, reason_codes=[reason])


def _quality_gate(observation: PreferenceObservation, reasons: list[str]) -> float:
    sensor = {"unknown": 0., "partial": .7, "valid": 1.}[observation.sensor_quality]
    link = {"unknown": 0., "degraded": .7, "valid": 1.}[observation.link_state]
    if observation.data_age_ms is None:
        age = 0.
    elif observation.data_age_ms > 10_000:
        age = 0.
        reasons.append("stale_sensor_data")
    elif observation.data_age_ms > 5_000:
        age = .7
    else:
        age = 1.
    return sensor * link * age * (1. - observation.missing_ratio)

class PreferenceRecordResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    result: IRPIResult
    snapshot: PreferenceSnapshot | None = None
