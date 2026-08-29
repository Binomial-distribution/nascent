"""用户邀请：打开 / 查看 / 收回，以及 App 心跳与待处理建议。

用户侧叫「邀请」。密钥只在创建时回给 App，不进共享日志。
"""

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from ..services import plugin_store as store

router = APIRouter(prefix="/v1/plugin", tags=["plugin"])


class InviteIn(BaseModel):
    adult_confirmed: bool = False


class HeartbeatIn(BaseModel):
    connected: bool = False
    level: int | None = None
    insert_state: str = "unknown"
    alert: str = "none"


class ResultIn(BaseModel):
    id: str
    ok: bool
    reason: str = ""


def _invite_or_401(invite_id: str, secret: str | None) -> store.Invite:
    invite = store.get_by_secret(secret or "")
    if invite is None or invite.id != invite_id:
        raise HTTPException(status_code=401, detail="邀请无效或已收回。")
    return invite


def _public(invite: store.Invite, request: Request | None = None) -> dict:
    mcp_url = ""
    if request is not None:
        mcp_url = str(request.base_url).rstrip("/") + "/mcp"
    return {
        "id": invite.id,
        "status": "revoked" if invite.revoked else "open",
        "ai_connected": invite.ai_connected,
        "mcp_url": mcp_url,
    }


def invite_text(mcp_url: str) -> str:
    return (
        "这是一份「把设备交给我的 AI」的邀请。\n\n"
        "把下面这段贴进你正在用的 AI（按它添加插件或连接的方式即可）。\n\n"
        "设备已经在 Nascent App 里连上了。\n"
        "你的 AI 只能建议轻一点、强一点或停下。\n"
        "停下之后，只有你在设备上长按 BOOT 键两秒才能继续。\n"
        "随时可以在设置里收回这份邀请。\n\n"
        f"连接地址：{mcp_url}\n"
    )


def mcp_json(mcp_url: str, secret: str) -> dict:
    return {
        "mcpServers": {
            "nascent": {
                "url": mcp_url,
                "headers": {"Authorization": f"Bearer {secret}"},
            }
        }
    }


@router.post("/invite")
async def open_invite(body: InviteIn, request: Request) -> dict:
    if not body.adult_confirmed:
        raise HTTPException(status_code=400, detail="打开前需要确认你已成年。")
    invite = store.create_invite(adult_confirmed=True)
    mcp_url = str(request.base_url).rstrip("/") + "/mcp"
    public = _public(invite, request)
    public["secret"] = invite.secret
    public["invite_text"] = invite_text(mcp_url) + f"邀请码：{invite.secret}\n"
    public["mcp_json"] = mcp_json(mcp_url, invite.secret)
    return public


@router.get("/invite/{invite_id}")
async def read_invite(
    invite_id: str,
    request: Request,
    x_nascent_invite: str | None = Header(default=None, alias=store.INVITE_HEADER),
) -> dict:
    invite = _invite_or_401(invite_id, x_nascent_invite)
    return _public(invite, request)


@router.delete("/invite/{invite_id}")
async def close_invite(
    invite_id: str,
    x_nascent_invite: str | None = Header(default=None, alias=store.INVITE_HEADER),
) -> dict:
    _invite_or_401(invite_id, x_nascent_invite)
    store.revoke(invite_id)
    return {"status": "revoked"}


@router.put("/heartbeat")
async def heartbeat(
    body: HeartbeatIn,
    invite_id: str,
    x_nascent_invite: str | None = Header(default=None, alias=store.INVITE_HEADER),
) -> dict:
    invite = _invite_or_401(invite_id, x_nascent_invite)
    store.put_snapshot(
        invite.id,
        store.Snapshot(
            connected=body.connected,
            level=body.level,
            insert_state=body.insert_state,
            alert=body.alert,
        ),
    )
    pending = store.peek_pending(invite.id)
    return {"ok": True, "pending": pending.id if pending else None}


@router.get("/pending")
async def pending(
    invite_id: str,
    x_nascent_invite: str | None = Header(default=None, alias=store.INVITE_HEADER),
) -> dict:
    invite = _invite_or_401(invite_id, x_nascent_invite)
    item = store.peek_pending(invite.id)
    if item is None:
        return {"suggestion": None}
    return {
        "suggestion": {
            "id": item.id,
            "cmd": item.cmd,
            "level": item.level,
            "automatic": item.automatic,
        }
    }


@router.post("/result")
async def result(
    body: ResultIn,
    invite_id: str,
    x_nascent_invite: str | None = Header(default=None, alias=store.INVITE_HEADER),
) -> dict:
    _invite_or_401(invite_id, x_nascent_invite)
    item = store.complete(body.id, {"ok": body.ok, "reason": body.reason})
    if item is None:
        raise HTTPException(status_code=404, detail="找不到这条建议。")
    dialogue = "已经按你的 AI 的建议调整。" if body.ok else (body.reason or "这个建议没有被采用。")
    return store.envelope(dialogue)
