"""身体笔记、删除和自我探索接口。"""

from fastapi import APIRouter, HTTPException

from ..services import llm
from ..services.body_note_contract import (
    BodyInsightTurnRequest,
    BodyInsightTurnResponse,
    BodyNote,
    BodyNoteCreate,
    BodyNoteUpdate,
    BodySession,
)
from ..services.body_notes import body_notes_store, run_insight_turn

router = APIRouter(prefix="/v1/body-notes", tags=["body-notes"])


@router.get("/sessions", response_model=list[BodySession])
async def list_sessions() -> list[BodySession]:
    return await body_notes_store.list_sessions()


@router.get("/sessions/{session_id}", response_model=BodySession)
async def get_session(session_id: str) -> BodySession:
    session = await body_notes_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict[str, bool]:
    if not await body_notes_store.delete_session(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    return {"deleted": True}


@router.post("/sessions/{session_id}/note", response_model=BodyNote)
async def create_note(session_id: str, request: BodyNoteCreate) -> BodyNote:
    note = await body_notes_store.add_note(session_id, request.text)
    if not note:
        raise HTTPException(status_code=404, detail="session not found")
    return note


@router.patch("/{note_id}", response_model=BodyNote)
async def update_note(note_id: str, request: BodyNoteUpdate) -> BodyNote:
    note = await body_notes_store.update_note(note_id, request.text)
    if not note:
        raise HTTPException(status_code=404, detail="note not found")
    return note


@router.delete("/{note_id}")
async def delete_note(note_id: str) -> dict[str, bool]:
    if not await body_notes_store.delete_note(note_id):
        raise HTTPException(status_code=404, detail="note not found")
    return {"deleted": True}


@router.post("/insight-turn", response_model=BodyInsightTurnResponse)
async def post_insight_turn(request: BodyInsightTurnRequest) -> BodyInsightTurnResponse:
    return await run_insight_turn(request, llm.generate_body_insight, body_notes_store)
