import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, "software/backend")

from pydantic import ValidationError

from app.services.body_note_contract import BodyInsightModelOutput, BodyInsightTurnRequest
from app.services.body_notes import InMemoryBodyNotesStore, run_insight_turn


@pytest.mark.asyncio
async def test_current_scope_only_sends_selected_session_to_model():
    store = InMemoryBodyNotesStore()
    seen = []

    async def generator(message, scope, sessions):
        seen.extend(sessions)
        return f"{scope}:{message}", "一条可保存发现", False

    result = await run_insight_turn(
        BodyInsightTurnRequest(session_id="demo-session-03", message="帮我看看"),
        generator,
        store,
    )

    assert result.scope == "current"
    assert [item["session_id"] for item in seen] == ["demo-session-03"]
    assert "timeline" not in seen[0]
    assert "max_level" not in seen[0]
    assert "duration_s" not in seen[0]
    assert "user_feedback" not in seen[0]
    assert result.model_dump().keys() == {"dialogue", "scope", "sources", "insight_candidate", "fallback"}
    assert result.fallback is False


@pytest.mark.asyncio
async def test_recent_scope_uses_only_explicit_comparison_ids():
    store = InMemoryBodyNotesStore()
    seen = []

    async def generator(message, scope, sessions):
        seen.extend(sessions)
        return "只比较已授权记录", None, False

    result = await run_insight_turn(
        BodyInsightTurnRequest(
            session_id="demo-session-03",
            comparison_session_ids=["demo-session-02"],
            message="最近有什么不同",
        ),
        generator,
        store,
    )

    assert result.scope == "recent"
    assert [item["session_id"] for item in seen] == ["demo-session-03", "demo-session-02"]


@pytest.mark.asyncio
async def test_delete_session_cascades_notes_and_blocks_agent_retrieval():
    store = InMemoryBodyNotesStore()
    note = await store.add_note("demo-session-03", "这一次想慢一点")
    assert note is not None
    assert await store.delete_session("demo-session-03")
    assert await store.get_session("demo-session-03") is None
    assert not await store.delete_note(note.note_id)

    async def generator(message, scope, sessions):
        raise AssertionError("deleted session must never reach the model")

    with pytest.raises(HTTPException) as exc:
        await run_insight_turn(
            BodyInsightTurnRequest(session_id="demo-session-03", message="还能读取吗"),
            generator,
            store,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_note_is_editable_and_deletable():
    store = InMemoryBodyNotesStore()
    note = await store.add_note("demo-session-03", "先保存")
    assert note is not None
    updated = await store.update_note(note.note_id, "改成更准确的表达")
    assert updated is not None
    assert updated.text == "改成更准确的表达"
    assert await store.delete_note(note.note_id)


def test_body_insight_rejects_control_and_diagnosis_language():
    with pytest.raises(ValidationError):
        BodyInsightModelOutput(dialogue="建议把档位调高", insight_candidate=None)

    with pytest.raises(ValidationError):
        BodyInsightModelOutput(dialogue="这说明你喜欢固定节奏", insight_candidate=None)

    with pytest.raises(ValidationError):
        BodyInsightModelOutput(dialogue="这是你的固定偏好", insight_candidate=None)

    allowed = BodyInsightModelOutput(
        dialogue="这些只是当时的记录，不代表固定偏好。",
        insight_candidate=None,
    )
    assert "不代表固定偏好" in allowed.dialogue


@pytest.mark.asyncio
async def test_limited_comparison_is_not_sent_to_model():
    source = await InMemoryBodyNotesStore().list_sessions()
    limited = source[1].model_copy(update={"data_quality": "limited"})
    store = InMemoryBodyNotesStore([source[0], limited])

    async def generator(message, scope, sessions):
        raise AssertionError("limited comparison must never reach the model")

    with pytest.raises(HTTPException) as exc:
        await run_insight_turn(
            BodyInsightTurnRequest(
                session_id=source[0].session_id,
                comparison_session_ids=[limited.session_id],
                message="比较一下",
            ),
            generator,
            store,
        )
    assert exc.value.status_code == 422


def test_body_insight_stub_passes_output_contract():
    from app.services.llm import _body_insight_stub

    dialogue, candidate = _body_insight_stub(
        "current",
        [{"temperature_summary": "温感平稳", "pressure_summary": "接触压力变化较少"}],
    )
    parsed = BodyInsightModelOutput(dialogue=dialogue, insight_candidate=candidate)
    assert "不代表固定偏好" in parsed.dialogue


def test_body_insight_ignores_extra_model_fields():
    parsed = BodyInsightModelOutput.model_validate({
        "dialogue": "这些只是当时的记录，不代表固定偏好。",
        "insight_candidate": None,
        "action": None,
        "skill_proposals": [],
    })
    assert parsed.dialogue.startswith("这些只是当时的记录")
    assert parsed.model_dump().keys() == {"dialogue", "insight_candidate"}


@pytest.mark.asyncio
async def test_body_insight_calls_chat_9b_not_control(monkeypatch):
    import json

    from app.services import llm

    captured = {}

    async def fake_complete(**kwargs):
        captured.update(kwargs)
        return json.dumps({
            "dialogue": "这些只是当时的记录，不代表固定偏好。",
            "insight_candidate": None,
            "tone": "ignored",
        })

    monkeypatch.setattr(llm, "complete_json", fake_complete)
    monkeypatch.setattr(llm.settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm.settings, "llm_base_url", "https://api.example/v1")
    monkeypatch.setattr(llm.settings, "chat_llm_model", "Qwen/Qwen3.5-9B")
    monkeypatch.setattr(llm.settings, "control_llm_model", "must-not-use")

    dialogue, candidate, fallback = await llm.generate_body_insight(
        "帮我看看",
        "current",
        [{"temperature_summary": "温感平稳", "pressure_summary": "接触压力变化较少"}],
    )
    assert captured["model"] == "Qwen/Qwen3.5-9B"
    assert fallback is False
    assert candidate is None
    assert "不代表固定偏好" in dialogue
