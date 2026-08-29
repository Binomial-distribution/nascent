"""进程内邀请与建议队列。骨架阶段不落库，重启即丢。

云端在这里只保存「邀请是否有效」和「尚未被 App 取走的建议」。
它不持有 BLE / WiFi，也不保存第三方 AI 的对话原文。
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

from ..protocol import CloudAction, CloudActionEnvelope, Emotion, NlConst, SceneCtrl
from . import moderation


def envelope(dialogue: str, action: CloudAction | None = None) -> CloudActionEnvelope:
    return CloudActionEnvelope(
        dialogue=dialogue,
        action=action,
        scene_ctrl=SceneCtrl.STAY,
        emotion=Emotion.CALM,
    )

INVITE_HEADER = "X-Nascent-Invite"


@dataclass
class Invite:
    id: str
    secret: str
    created_at: float
    adult_confirmed: bool
    ai_connected: bool = False
    revoked: bool = False


@dataclass
class Snapshot:
    connected: bool = False
    level: int | None = None
    insert_state: str = "unknown"
    alert: str = "none"
    updated_at: float = 0.0


@dataclass
class Suggestion:
    id: str
    invite_id: str
    cmd: str
    level: int | None
    automatic: bool
    created_at: float
    result: dict | None = None


_invites: dict[str, Invite] = {}
_by_secret: dict[str, str] = {}
_snapshots: dict[str, Snapshot] = {}
_pending: dict[str, list[Suggestion]] = {}


def reset() -> None:
    """测试用。"""
    _invites.clear()
    _by_secret.clear()
    _snapshots.clear()
    _pending.clear()


def create_invite(*, adult_confirmed: bool) -> Invite:
    if not adult_confirmed:
        raise ValueError("需要确认已成年。")
    for old in list(_invites.values()):
        if not old.revoked:
            revoke(old.id)
    invite = Invite(
        id=secrets.token_hex(8),
        secret=secrets.token_urlsafe(24),
        created_at=time.time(),
        adult_confirmed=True,
    )
    _invites[invite.id] = invite
    _by_secret[invite.secret] = invite.id
    _snapshots[invite.id] = Snapshot(updated_at=time.time())
    _pending[invite.id] = []
    return invite


def get(invite_id: str) -> Invite | None:
    return _invites.get(invite_id)


def get_by_secret(secret: str) -> Invite | None:
    invite_id = _by_secret.get(secret or "")
    if not invite_id:
        return None
    invite = _invites.get(invite_id)
    if invite is None or invite.revoked:
        return None
    return invite


def revoke(invite_id: str) -> bool:
    invite = _invites.get(invite_id)
    if invite is None or invite.revoked:
        return False
    invite.revoked = True
    _by_secret.pop(invite.secret, None)
    _pending.pop(invite_id, None)
    return True


def mark_ai_connected(invite: Invite) -> None:
    invite.ai_connected = True


def put_snapshot(invite_id: str, snap: Snapshot) -> None:
    snap.updated_at = time.time()
    _snapshots[invite_id] = snap


def snapshot(invite_id: str) -> Snapshot:
    return _snapshots.get(invite_id) or Snapshot()


def enqueue(invite_id: str, suggestion: Suggestion) -> None:
    _pending.setdefault(invite_id, []).append(suggestion)


def peek_pending(invite_id: str) -> Suggestion | None:
    for item in _pending.get(invite_id) or []:
        if item.result is None:
            return item
    return None


def find_suggestion(suggestion_id: str) -> Suggestion | None:
    for queue in _pending.values():
        for item in queue:
            if item.id == suggestion_id:
                return item
    return None


def complete(suggestion_id: str, result: dict, invite_id: str | None = None) -> Suggestion | None:
    item = find_suggestion(suggestion_id)
    if item is None:
        return None
    if invite_id is not None and item.invite_id != invite_id:
        return None
    item.result = result
    queue = _pending.get(item.invite_id) or []
    _pending[item.invite_id] = [s for s in queue if s.id != suggestion_id]
    return item


def new_suggestion(invite_id: str, *, cmd: str, level: int | None, automatic: bool) -> Suggestion:
    item = Suggestion(
        id=secrets.token_hex(8),
        invite_id=invite_id,
        cmd=cmd,
        level=level,
        automatic=automatic,
        created_at=time.time(),
    )
    enqueue(invite_id, item)
    return item


async def suggestion_from_level_delta(invite_id: str, delta: int) -> tuple[CloudActionEnvelope, Suggestion | None]:
    """把「轻一点 / 强一点」变成建议信封。越界丢弃整段 action，不钳位。"""
    snap = snapshot(invite_id)
    current = snap.level
    if current is None:
        return envelope("还不知道现在第几档。请把 Nascent App 打开并保持连接。"), None
    target = current + delta
    if target < NlConst.LEVEL_MIN or target > NlConst.LEVEL_MAX:
        return envelope("这个建议不可用，设备没有改。我们不会偷偷改成最近的合法档位。"), None
    raw = envelope("", CloudAction(set_level=target))
    filtered = await moderation.filter_envelope(raw)
    if filtered.action is None or filtered.action.set_level is None:
        filtered.dialogue = "这个建议不可用，设备没有改。我们不会偷偷改成最近的合法档位。"
        return filtered, None
    item = new_suggestion(
        invite_id,
        cmd="set_level",
        level=filtered.action.set_level,
        automatic=True,
    )
    lo, hi = NlConst.LEVEL_MIN, NlConst.LEVEL_MAX
    filtered.dialogue = f"已请本 App 检查能否调到第 {item.level} 档（现在大约第 {current} 档，范围 {lo}–{hi}）。"
    return filtered, item
