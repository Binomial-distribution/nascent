"""可替换的分层记忆接口。

当前实现是进程内适配器，方便本地联调。接口刻意贴近 Mem0 的 add/search/delete
语义，后续可替换为自托管 Mem0 或 SQLCipher/向量存储，而不改 Agent 编排层。
"""

from __future__ import annotations

from collections import defaultdict
from time import time
from typing import Protocol
from uuid import uuid4

from .agent_contract import MemoryItem


class MemoryProvider(Protocol):
    async def search(self, *, user_id: str, persona_id: str, query: str, limit: int = 5) -> list[MemoryItem]: ...

    async def add(self, *, user_id: str, persona_id: str, text: str) -> MemoryItem: ...

    async def delete(self, *, user_id: str, persona_id: str, memory_id: str) -> bool: ...

    async def delete_scope(self, *, user_id: str, persona_id: str | None = None) -> int: ...


class InMemoryMemoryProvider:
    """默认开发适配器；不会跨用户或 Persona 检索。"""

    def __init__(self) -> None:
        self._items: dict[tuple[str, str], list[MemoryItem]] = defaultdict(list)

    async def search(self, *, user_id: str, persona_id: str, query: str, limit: int = 5) -> list[MemoryItem]:
        items = self._items[(user_id, persona_id)]
        terms = {part.lower() for part in query.split() if part.strip()}
        if not terms:
            return list(reversed(items[-limit:]))
        matched = [item for item in items if any(term in item.text.lower() for term in terms)]
        return list(reversed(matched[-limit:]))

    async def add(self, *, user_id: str, persona_id: str, text: str) -> MemoryItem:
        item = MemoryItem(
            id=f"mem_{uuid4().hex[:12]}",
            user_id=user_id,
            persona_id=persona_id,
            text=text,
            created_at=int(time()),
        )
        self._items[(user_id, persona_id)].append(item)
        return item

    async def delete(self, *, user_id: str, persona_id: str, memory_id: str) -> bool:
        key = (user_id, persona_id)
        before = len(self._items[key])
        self._items[key] = [item for item in self._items[key] if item.id != memory_id]
        return len(self._items[key]) != before

    async def delete_scope(self, *, user_id: str, persona_id: str | None = None) -> int:
        if persona_id is not None:
            key = (user_id, persona_id)
            removed = len(self._items[key])
            self._items.pop(key, None)
            return removed
        keys = [key for key in self._items if key[0] == user_id]
        removed = sum(len(self._items[key]) for key in keys)
        for key in keys:
            self._items.pop(key, None)
        return removed


memory_provider: MemoryProvider = InMemoryMemoryProvider()
