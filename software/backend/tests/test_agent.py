import sys

import pytest

sys.path.insert(0, "software/backend")

from app.services import agent, template
from app.services.agent_contract import AgentTurnRequest, TemplateDraftRequest
from app.services.memory import InMemoryMemoryProvider
from app.services.preference import InMemoryPreferenceStore, PreferenceObservation, calculate_irpi


@pytest.mark.asyncio
async def test_memory_isolated_by_user_and_persona():
    provider = InMemoryMemoryProvider()
    item = await provider.add(user_id="u1", persona_id="p1", text="喜欢安静的晚上")

    assert [x.id for x in await provider.search(user_id="u1", persona_id="p1", query="晚上")] == [item.id]
    assert await provider.search(user_id="u1", persona_id="p2", query="晚上") == []
    assert await provider.search(user_id="u2", persona_id="p1", query="晚上") == []
    assert await provider.delete(user_id="u1", persona_id="p1", memory_id=item.id)
    assert await provider.search(user_id="u1", persona_id="p1", query="晚上") == []


@pytest.mark.asyncio
async def test_template_fallback_is_draft_and_can_be_deleted():
    request = TemplateDraftRequest(
        user_id="test-user",
        persona_id="p1",
        conversation=[{"role": "user", "content": "前面慢一点，最后安静下来"}],
    )
    draft = await template.draft(request)
    assert draft.source == "custom"
    assert draft.status == "draft"
    assert all(skill.requires_confirmation for skill in draft.skills)

    confirmed = await template.confirm(request.user_id, draft)
    assert confirmed.status == "confirmed"
    assert await template.delete(request.user_id, confirmed.template_id)


@pytest.mark.asyncio
async def test_wild_mode_does_not_retrieve_memory(monkeypatch):
    class FailingProvider:
        async def search(self, **kwargs):
            raise AssertionError("wild mode must not retrieve relationship memory")

    monkeypatch.setattr(agent, "memory_provider", FailingProvider())
    result = await agent.run_turn(
        AgentTurnRequest(user_id="u", persona_id="p", session_mode="wild", user_input="继续")
    )
    assert result.action is None
    assert result.memory_proposals == []




def _observation(**overrides):
    values = {
        "user_id": "u", "persona_id": "p", "template_id": "t",
        "preference_key": "pace_preference", "candidate": "steady",
        "explicit_feedback": "comfortable", "active_behavior": "continued",
        "pressure_trend": "steady", "temperature_trend": "stable",
        "sensor_quality": "valid", "link_state": "valid", "data_age_ms": 1000,
    }
    values.update(overrides)
    return PreferenceObservation(**values)


def test_irpi_uses_explicit_feedback_and_quality_gate():
    result = calculate_irpi(_observation())
    assert result.accepted
    assert result.quality_gate == 1.0
    assert result.weighted_components["explicit"] > result.weighted_components["pressure"]

    stale = calculate_irpi(_observation(data_age_ms=20_000))
    assert not stale.accepted
    assert "stale_sensor_data" in stale.reason_codes


def test_irpi_never_learns_from_safety_or_withdrawal():
    for overrides, reason in (
        ({"safety_event": True}, "safety_event"),
        ({"consent_state": "withdrawn"}, "consent_not_confirmed"),
        ({"explicit_feedback": "pause"}, "negative_feedback"),
    ):
        result = calculate_irpi(_observation(**overrides))
        assert not result.accepted
        assert reason in result.reason_codes


@pytest.mark.asyncio
async def test_preference_store_isolated_and_deletable():
    store = InMemoryPreferenceStore()
    observation = _observation()
    await store.record(observation, calculate_irpi(observation))
    assert len(await store.list_scope(user_id="u", persona_id="p", template_id="t")) == 1
    assert await store.list_scope(user_id="u", persona_id="other", template_id="t") == []
    assert await store.delete_scope(user_id="u", persona_id="p", template_id="t") == 1
    assert await store.list_scope(user_id="u", persona_id="p", template_id="t") == []
