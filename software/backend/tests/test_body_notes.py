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
        return f"{scope}:{message}", "一条可保存发现"

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
    assert result.model_dump().keys() == {"dialogue", "scope", "sources", "insight_candidate"}


@pytest.mark.asyncio
async def test_recent_scope_uses_only_explicit_comparison_ids():
    store = InMemoryBodyNotesStore()
    seen = []

    async def generator(message, scope, sessions):
        seen.extend(sessions)
        return "只比较已授权记录", None

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
