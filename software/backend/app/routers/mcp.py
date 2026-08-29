"""自带 AI 的 MCP 骨架。

用户看不见这个名字。桌面 AI 用 JSON-RPC 连上之后，只能询问状态、
请轻一点、请强一点或马上停。没有 resume，没有逐帧灯效。

建议排队等 App 的安全总督执行；本进程不碰设备链路。
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ..services import plugin_store as store

router = APIRouter(tags=["mcp"])

PROTOCOL_VERSION = "2024-11-05"

TOOLS = [
    {
        "name": "how_is_it_going",
        "description": "现在舒不舒服、大概第几档。不会改设备。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "ease_up",
        "description": "请轻一点（降一档）。能不能改，由用户手机上的安全检查决定。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "a_bit_stronger",
        "description": "请强一点（升一档）。使用状态不清楚时，自动加档会被拒绝。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "please_stop",
        "description": "马上停。这个请求永远可以发出。停之后不能由 AI 恢复。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]

TOOL_NAMES = tuple(t["name"] for t in TOOLS)


def _empty() -> Response:
    response = Response(status_code=204)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


def _cors(response: JSONResponse) -> JSONResponse:
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


def _invite_from_auth(authorization: str | None) -> store.Invite:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="邀请无效或已收回。")
    secret = authorization.split(" ", 1)[1].strip()
    invite = store.get_by_secret(secret)
    if invite is None:
        raise HTTPException(status_code=401, detail="邀请无效或已收回。")
    return invite


def _ok(id_: Any, result: dict) -> JSONResponse:
    return _cors(JSONResponse({"jsonrpc": "2.0", "id": id_, "result": result}))


def _err(id_: Any, code: int, message: str) -> JSONResponse:
    return _cors(JSONResponse(
        {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}
    ))


def _text(text: str, *, is_error: bool = False) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def _how_is_it_going(invite: store.Invite) -> dict:
    snap = store.snapshot(invite.id)
    age = 0.0 if not snap.updated_at else time.time() - snap.updated_at
    if not snap.connected or age > 15:
        return _text("还不知道设备现在怎样。请把 Nascent App 打开，并保持设备已连接。")
    level = "还不知道" if snap.level is None else f"大约第 {snap.level} 档"
    insert = {
        "inserted": "正在使用中",
        "not_inserted": "看起来还没在使用",
        "unknown": "使用状态还不清楚，所以暂时不会自动加档",
    }.get(snap.insert_state, "使用状态还不清楚")
    stopped = snap.alert in {"safeword", "estop"}
    halt = "已经停下。只有用户在设备上长按 BOOT 键两秒才能继续。" if stopped else "还没有停下。"
    return _text(f"设备已连上。现在{level}。{insert}。{halt}")


async def _call_tool(invite: store.Invite, name: str) -> dict:
    if name == "how_is_it_going":
        return _how_is_it_going(invite)
    if name == "please_stop":
        store.new_suggestion(invite.id, cmd="stop", level=None, automatic=False)
        return _text("已请本 App 马上停。停下之后，AI 不能帮你恢复。")
    if name == "ease_up":
        envelope, _item = await store.suggestion_from_level_delta(invite.id, -1)
        return _text(envelope.dialogue, is_error=_item is None)
    if name == "a_bit_stronger":
        envelope, _item = await store.suggestion_from_level_delta(invite.id, 1)
        return _text(envelope.dialogue, is_error=_item is None)
    return _text("没有这个能力。", is_error=True)


async def _dispatch(invite: store.Invite, body: dict) -> JSONResponse | Response:
    method = body.get("method")
    id_ = body.get("id")
    if method == "initialize":
        store.mark_ai_connected(invite)
        return _ok(id_, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "nascent-connect-my-ai", "version": "0.1.0-demo"},
            "instructions": (
                "这是用户的情趣设备连接。你只能询问现在怎样、请轻一点、请强一点或马上停。"
                "不能恢复已经停下的设备。人设由你自己扮演，不要假装是官方伴侣。"
            ),
        })
    if method == "notifications/initialized":
        return _empty()
    if method == "tools/list":
        return _ok(id_, {"tools": TOOLS})
    if method == "ping":
        return _ok(id_, {})
    if method == "tools/call":
        params = body.get("params") or {}
        name = params.get("name")
        if name == "resume" or name not in TOOL_NAMES:
            if name == "resume":
                return _ok(id_, _text("不能恢复。只有用户在设备上长按 BOOT 键两秒。", is_error=True))
            return _ok(id_, _text("没有这个能力。", is_error=True))
        result = await _call_tool(invite, name)
        return _ok(id_, result)
    if id_ is None:
        return _empty()
    return _err(id_, -32601, "不支持这个方法。")


@router.options("/mcp")
async def mcp_options() -> Response:
    return _empty()


@router.post("/mcp")
async def mcp_post(
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    invite = _invite_from_auth(authorization)
    try:
        body = await request.json()
    except Exception:
        return _err(None, -32700, "读不懂这条请求。")
    if not isinstance(body, dict):
        return _err(None, -32600, "一次只处理一条请求。")
    return await _dispatch(invite, body)
