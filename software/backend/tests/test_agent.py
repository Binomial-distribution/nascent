import asyncio
import sys

import pytest

sys.path.insert(0, "software/backend")

from app.services import agent, template
from app.services.agent_contract import (
    AgentTurn,
    AgentTurnRequest,
    ControlDecision,
    ControlDecisionRequest,
    ParallelAgentTurnRequest,
    TemplateDraftRequest,
)
from app.services.memory import InMemoryMemoryProvider
from app.services.llm import _apply_control_policy
from app.services.preference import (
    InMemoryPreferenceStore,
    PreferenceObservation,
    calculate_irpi,
)


@pytest.mark.asyncio
async def test_memory_isolated_by_user_and_persona():
    provider = InMemoryMemoryProvider()
    item = await provider.add(user_id="u1", persona_id="p1", text="喜欢安静的晚上")

    assert [
        x.id for x in await provider.search(user_id="u1", persona_id="p1", query="晚上")
    ] == [item.id]
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
        AgentTurnRequest(
            user_id="u", persona_id="p", session_mode="wild", user_input="继续"
        )
    )
    assert result.action is None
    assert result.memory_proposals == []


@pytest.mark.asyncio
async def test_parallel_turn_starts_chat_and_control_together(monkeypatch):
    chat_started = asyncio.Event()
    control_started = asyncio.Event()

    async def fake_chat(_request):
        chat_started.set()
        await asyncio.wait_for(control_started.wait(), timeout=0.2)
        return AgentTurn(dialogue="chat ready")

    async def fake_control(_request):
        control_started.set()
        await asyncio.wait_for(chat_started.wait(), timeout=0.2)
        return ControlDecision(decision="hold", reason_codes=["test"])

    monkeypatch.setattr(agent, "run_turn", fake_chat)
    monkeypatch.setattr(agent.llm, "generate_control", fake_control)
    request = ParallelAgentTurnRequest(
        chat=AgentTurnRequest(user_id="u", persona_id="p", user_input="继续"),
        control=ControlDecisionRequest(user_id="u", session_id="s"),
    )

    result = await asyncio.wait_for(agent.run_parallel_turn(request), timeout=0.5)

    assert result.execution == "parallel"
    assert result.chat.dialogue == "chat ready"
    assert result.control.reason_codes == ["test"]
    assert result.data_flow.device[-2] == "sendCommand()"


@pytest.mark.asyncio
async def test_parallel_turn_degrades_failed_lane_independently(monkeypatch):
    async def failing_chat(_request):
        raise RuntimeError("chat failed")

    async def healthy_control(_request):
        return ControlDecision(decision="hold", reason_codes=["policy_hold"])

    monkeypatch.setattr(agent, "run_turn", failing_chat)
    monkeypatch.setattr(agent.llm, "generate_control", healthy_control)
    request = ParallelAgentTurnRequest(
        chat=AgentTurnRequest(user_id="u", persona_id="p", user_input="继续"),
        control=ControlDecisionRequest(user_id="u", session_id="s"),
    )

    result = await agent.run_parallel_turn(request)

    assert result.chat.action is None
    assert result.control.reason_codes == ["policy_hold"]


@pytest.mark.asyncio
async def test_parallel_turn_times_out_one_lane_without_losing_the_other(monkeypatch):
    async def slow_chat(_request):
        await asyncio.sleep(0.1)
        return AgentTurn(dialogue="too late")

    async def healthy_control(_request):
        return ControlDecision(decision="hold", reason_codes=["fresh_control"])

    monkeypatch.setattr(agent, "run_turn", slow_chat)
    monkeypatch.setattr(agent.llm, "generate_control", healthy_control)
    monkeypatch.setattr(agent.settings, "chat_llm_timeout_s", 0.01)
    request = ParallelAgentTurnRequest(
        chat=AgentTurnRequest(user_id="u", persona_id="p", user_input="继续"),
        control=ControlDecisionRequest(user_id="u", session_id="s"),
    )

    result = await agent.run_parallel_turn(request)

    assert result.chat.dialogue != "too late"
    assert result.control.reason_codes == ["fresh_control"]


def _observation(**overrides):
    values = {
        "user_id": "u",
        "persona_id": "p",
        "template_id": "t",
        "preference_key": "pace_preference",
        "candidate": "steady",
        "explicit_feedback": "comfortable",
        "active_behavior": "continued",
        "pressure_trend": "steady",
        "temperature_trend": "stable",
        "sensor_quality": "valid",
        "link_state": "valid",
        "data_age_ms": 1000,
    }
    values.update(overrides)
    return PreferenceObservation(**values)


def test_irpi_uses_explicit_feedback_and_quality_gate():
    result = calculate_irpi(_observation())
    assert result.accepted
    assert result.quality_gate == 1.0
    assert (
        result.weighted_components["explicit"] > result.weighted_components["pressure"]
    )

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
    assert (
        len(await store.list_scope(user_id="u", persona_id="p", template_id="t")) == 1
    )
    assert (
        await store.list_scope(user_id="u", persona_id="other", template_id="t") == []
    )
    assert await store.delete_scope(user_id="u", persona_id="p", template_id="t") == 1
    assert await store.list_scope(user_id="u", persona_id="p", template_id="t") == []


def test_control_hold_keeps_reason_and_drops_suggestions():
    result = _apply_control_policy(
        ControlDecision(
            decision="hold",
            recommended_skill_id="rhythm_segment",
            recommended_level=3,
            reason_codes=["user_asked_to_wait"],
        ),
        ["rhythm_segment"],
    )
    assert result.decision == "hold"
    assert result.reason_codes == ["user_asked_to_wait"]
    assert result.recommended_skill_id is None
    assert result.recommended_level is None
    assert result.action is None


def test_control_hold_with_null_skill_is_not_rewritten_as_not_allowed():
    result = _apply_control_policy(
        ControlDecision(decision="hold", recommended_skill_id=None, reason_codes=["policy_hold"]),
        ["rhythm_segment"],
    )
    assert result.reason_codes == ["policy_hold"]
    assert "skill_not_allowed" not in result.reason_codes


def test_control_recommend_outside_allowlist_holds():
    result = _apply_control_policy(
        ControlDecision(
            decision="recommend",
            recommended_skill_id="set_pattern",
            recommended_pattern="wave",
        ),
        ["rhythm_segment"],
    )
    assert result.decision == "hold"
    assert result.reason_codes == ["skill_not_allowed"]


@pytest.mark.asyncio
async def test_memory_search_clamps_negative_limit():
    provider = InMemoryMemoryProvider()
    await provider.add(user_id="u", persona_id="p", text="第一条")
    await provider.add(user_id="u", persona_id="p", text="第二条")
    assert await provider.search(user_id="u", persona_id="p", query="", limit=-3) == []
    assert len(await provider.search(user_id="u", persona_id="p", query="", limit=1)) == 1
    assert len(await provider.search(user_id="u", persona_id="p", query="", limit=99)) == 2
