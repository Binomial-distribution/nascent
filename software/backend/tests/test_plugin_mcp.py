import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, "software/backend")

from app.protocol import NlConst
from app.routers import mcp as mcp_router
from app.routers import plugin as plugin_router
from app.services import plugin_store as store


def _client():
    store.reset()
    app = FastAPI()
    app.include_router(plugin_router.router)
    app.include_router(mcp_router.router)
    return TestClient(app)


def _open_invite(client: TestClient) -> dict:
    res = client.post("/v1/plugin/invite", json={"adult_confirmed": True})
    assert res.status_code == 200
    return res.json()


def test_invite_requires_adult():
    client = _client()
    res = client.post("/v1/plugin/invite", json={"adult_confirmed": False})
    assert res.status_code == 400


def test_mcp_has_no_resume_and_level_is_automatic():
    client = _client()
    invite = _open_invite(client)
    headers = {"Authorization": f"Bearer {invite['secret']}"}

    listed = client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    names = [t["name"] for t in listed.json()["result"]["tools"]]
    assert names == list(mcp_router.TOOL_NAMES)
    assert "resume" not in names

    resume = client.post(
        "/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "resume"}},
    )
    assert resume.json()["result"]["isError"] is True
    assert "BOOT" in resume.json()["result"]["content"][0]["text"]

    client.put(
        f"/v1/plugin/heartbeat?invite_id={invite['id']}",
        headers={"X-Nascent-Invite": invite["secret"]},
        json={"connected": True, "level": 3, "insert_state": "inserted", "alert": "none"},
    )
    stronger = client.post(
        "/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "a_bit_stronger"}},
    )
    assert stronger.json()["result"]["isError"] is False
    pending = client.get(
        f"/v1/plugin/pending?invite_id={invite['id']}",
        headers={"X-Nascent-Invite": invite["secret"]},
    ).json()["suggestion"]
    assert pending["cmd"] == "set_level"
    assert pending["level"] == 4
    assert pending["automatic"] is True

    client.put(
        f"/v1/plugin/heartbeat?invite_id={invite['id']}",
        headers={"X-Nascent-Invite": invite["secret"]},
        json={"connected": True, "level": NlConst.LEVEL_MAX, "insert_state": "inserted", "alert": "none"},
    )
    too_high = client.post(
        "/mcp",
        headers=headers,
        json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "a_bit_stronger"}},
    )
    assert too_high.json()["result"]["isError"] is True
    assert "不可用" in too_high.json()["result"]["content"][0]["text"]


def test_revoke_kills_mcp():
    client = _client()
    invite = _open_invite(client)
    client.delete(
        f"/v1/plugin/invite/{invite['id']}",
        headers={"X-Nascent-Invite": invite["secret"]},
    )
    res = client.post(
        "/mcp",
        headers={"Authorization": f"Bearer {invite['secret']}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    )
    assert res.status_code == 401
