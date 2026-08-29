"""身体笔记的可替换存储与自我探索编排。

当前使用进程内数据方便联调。公开方法保持存储无关，后续可以替换为 PostgreSQL，
并继续保证删除记录后无法被 Agent 检索。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException

from .body_note_contract import (
    BodyInsightTurnRequest,
    BodyInsightTurnResponse,
    BodyNote,
    BodySession,
    InsightSource,
    SessionTimelinePoint,
    TrendSummary,
)


InsightGenerator = Callable[[str, str, list[dict[str, object]]], Awaitable[tuple[str, str | None, bool]]]


def _now() -> datetime:
    return datetime.now(UTC)


def _seed_sessions() -> list[BodySession]:
    now = _now().replace(minute=0, second=0, microsecond=0)
    return [
        BodySession(
            session_id="demo-session-03",
            title="慢慢靠近的晚上",
            started_at=now - timedelta(days=1, hours=2),
            duration_s=18 * 60,
            mode="scenario",
            persona_name="温柔陪伴",
            max_level=4,
            data_quality="complete",
            temperature=TrendSummary(
                direction="rising",
                label="表面温感缓慢上升后趋稳",
                quality="complete",
                sample_count=1080,
            ),
            pressure=TrendSummary(
                direction="varied",
                label="接触压力中段更有节律",
                quality="complete",
                sample_count=1080,
            ),
            summary="本次从较低档位开始，中段节律更连续，结束前主动回到较轻的强度。",
            user_feedback="前面慢一点很舒服，最后收得也刚好。",
            timeline=[
                SessionTimelinePoint(minute=0, level=1, pressure_index=0.18, temperature_delta=0.0),
                SessionTimelinePoint(minute=4, level=2, pressure_index=0.32, temperature_delta=0.4),
                SessionTimelinePoint(minute=8, level=4, pressure_index=0.62, temperature_delta=0.9),
                SessionTimelinePoint(minute=12, level=3, pressure_index=0.54, temperature_delta=1.1),
                SessionTimelinePoint(minute=18, level=1, pressure_index=0.22, temperature_delta=0.8),
            ],
            notes=[],
        ),
        BodySession(
            session_id="demo-session-02",
            title="自己掌握节奏",
            started_at=now - timedelta(days=4, hours=1),
            duration_s=12 * 60,
            mode="free",
            persona_name=None,
            max_level=3,
            data_quality="partial",
            temperature=TrendSummary(
                direction="stable",
                label="表面温感整体平稳",
                quality="partial",
                sample_count=510,
            ),
            pressure=TrendSummary(
                direction="stable",
                label="接触压力变化较少",
                quality="partial",
                sample_count=510,
            ),
            summary="本次以手动低档为主，节奏变化较少。部分传感数据缺失，因此只描述可见事实。",
            user_feedback="短一点更适合那天的状态。",
            timeline=[
                SessionTimelinePoint(minute=0, level=1, pressure_index=0.2, temperature_delta=0.0),
                SessionTimelinePoint(minute=4, level=2, pressure_index=0.29, temperature_delta=0.2),
                SessionTimelinePoint(minute=8, level=3, pressure_index=0.33, temperature_delta=0.3),
                SessionTimelinePoint(minute=12, level=1, pressure_index=0.18, temperature_delta=0.2),
            ],
            notes=[],
        ),
        BodySession(
            session_id="demo-session-01",
            title="一次定时体验",
            started_at=now - timedelta(days=8),
            duration_s=10 * 60,
            mode="wild",
            persona_name=None,
            max_level=5,
            data_quality="complete",
            temperature=TrendSummary(
                direction="stable",
                label="表面温感在可回看区间内平稳",
                quality="complete",
                sample_count=600,
            ),
            pressure=TrendSummary(
                direction="rising",
                label="后半段接触压力更连续",
                quality="complete",
                sample_count=600,
            ),
            summary="本次按预设计时结束。记录只用于回看，不会用于恢复或延长失控模式。",
            user_feedback="结束得比我预想快，下次想先选更短的时间。",
            timeline=[
                SessionTimelinePoint(minute=0, level=2, pressure_index=0.25, temperature_delta=0.0),
                SessionTimelinePoint(minute=3, level=4, pressure_index=0.43, temperature_delta=0.3),
                SessionTimelinePoint(minute=6, level=5, pressure_index=0.65, temperature_delta=0.5),
                SessionTimelinePoint(minute=10, level=0, pressure_index=0.1, temperature_delta=0.4),
            ],
            notes=[],
        ),
    ]


class InMemoryBodyNotesStore:
    def __init__(self, sessions: list[BodySession] | None = None):
        source = sessions if sessions is not None else _seed_sessions()
        self._sessions = {item.session_id: item.model_copy(deep=True) for item in source}

    async def list_sessions(self) -> list[BodySession]:
        return sorted(
            (item.model_copy(deep=True) for item in self._sessions.values()),
            key=lambda item: item.started_at,
            reverse=True,
        )

    async def get_session(self, session_id: str) -> BodySession | None:
        item = self._sessions.get(session_id)
        return item.model_copy(deep=True) if item else None

    async def delete_session(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    async def add_note(self, session_id: str, text: str) -> BodyNote | None:
        session = self._sessions.get(session_id)
        if not session:
            return None
        now = _now()
        note = BodyNote(
            note_id=f"note-{uuid4().hex}",
            session_id=session_id,
            text=text.strip(),
            created_at=now,
            updated_at=now,
        )
        session.notes.append(note)
        return note.model_copy(deep=True)

    async def update_note(self, note_id: str, text: str) -> BodyNote | None:
        for session in self._sessions.values():
            for index, note in enumerate(session.notes):
                if note.note_id == note_id:
                    updated = note.model_copy(update={"text": text.strip(), "updated_at": _now()})
                    session.notes[index] = updated
                    return updated.model_copy(deep=True)
        return None

    async def delete_note(self, note_id: str) -> bool:
        for session in self._sessions.values():
            kept = [note for note in session.notes if note.note_id != note_id]
            if len(kept) != len(session.notes):
                session.notes = kept
                return True
        return False

    async def recent_comparisons(self, session_id: str, limit: int = 5) -> list[BodySession]:
        sessions = await self.list_sessions()
        return [
            session
            for session in sessions
            if session.session_id != session_id and session.data_quality != "limited"
        ][: min(limit, 10)]


def _model_context(session: BodySession) -> dict[str, object]:
    """只保留来源标识、数据质量和温度/压力聚合趋势。"""

    return {
        "session_id": session.session_id,
        "date": session.started_at.date().isoformat(),
        "data_quality": session.data_quality,
        "temperature_trend": session.temperature.direction,
        "temperature_summary": session.temperature.label,
        "temperature_quality": session.temperature.quality,
        "pressure_trend": session.pressure.direction,
        "pressure_summary": session.pressure.label,
        "pressure_quality": session.pressure.quality,
    }


async def run_insight_turn(
    request: BodyInsightTurnRequest,
    generator: InsightGenerator,
    store: InMemoryBodyNotesStore,
) -> BodyInsightTurnResponse:
    current = await store.get_session(request.session_id)
    if not current:
        raise HTTPException(status_code=404, detail="session not found")

    comparisons: list[BodySession] = []
    for session_id in request.comparison_session_ids:
        session = await store.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail=f"comparison session not found: {session_id}")
        if session.data_quality == "limited":
            raise HTTPException(status_code=422, detail=f"comparison session has limited data: {session_id}")
        comparisons.append(session)

    scope = "recent" if comparisons else "current"
    selected = [current, *comparisons]
    dialogue, candidate, fallback = await generator(request.message, scope, [_model_context(item) for item in selected])
    sources = [
        InsightSource(
            session_id=item.session_id,
            date=item.started_at.date().isoformat(),
            mode=item.mode,
            title=item.title,
        )
        for item in selected
    ]
    return BodyInsightTurnResponse(
        dialogue=dialogue,
        scope=scope,
        sources=sources,
        insight_candidate=candidate,
        fallback=fallback,
    )


body_notes_store = InMemoryBodyNotesStore()
