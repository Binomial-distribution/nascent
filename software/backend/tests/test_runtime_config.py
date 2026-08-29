import sys

from fastapi.testclient import TestClient

sys.path.insert(0, "software/backend")

from app.config import settings
from app.main import app
from app.runtime_overlay import (
    ENV_SNAPSHOT,
    apply_update,
    public_status,
    reset_overlay,
)


TOKEN = "test-runtime-token"
AUTH = {"X-Nascent-Runtime-Token": TOKEN}


def setup_function() -> None:
    reset_overlay()
    settings.debug = False
    settings.runtime_token = TOKEN


def teardown_function() -> None:
    reset_overlay()
    settings.debug = False
    settings.runtime_token = ""


def test_public_status_does_not_leak_secrets():
    apply_update({
        "llm_api_key": "sk-secret-value",
        "llm_base_url": "https://cloud.siliconflow.cn/",
        "llm_model": "Qwen/Qwen3.5-9B",
    })
    status = public_status()
    dumped = str(status)
    assert "sk-secret-value" not in dumped
    assert status["llm_api_key_set"] is True
    assert status["llm_configured"] is True
    assert status["llm_base_url"] == "https://api.siliconflow.cn/v1"
    assert "runtime_token" not in dumped
    assert TOKEN not in dumped


def test_reset_restores_env_snapshot():
    apply_update({"llm_api_key": "overlay-key", "llm_base_url": "https://api.siliconflow.cn/v1"})
    assert settings.llm_api_key == "overlay-key"
    apply_update({"reset": True})
    assert settings.llm_api_key == ENV_SNAPSHOT["llm_api_key"]
    assert settings.llm_base_url == ENV_SNAPSHOT["llm_base_url"]


def test_post_without_token_is_forbidden():
    client = TestClient(app)
    before = settings.llm_base_url
    saved = client.post("/v1/runtime-config", json={
        "llm_api_key": "sk-from-settings",
        "llm_base_url": "https://api.siliconflow.cn/v1",
    })
    assert saved.status_code == 403
    assert settings.llm_base_url == before
    assert "sk-from-settings" not in str(saved.json())


def test_malicious_url_without_key_change_is_rejected():
    client = TestClient(app)
    original = settings.llm_base_url
    original_key = settings.llm_api_key
    saved = client.post("/v1/runtime-config", headers=AUTH, json={
        "llm_base_url": "https://attacker.invalid/v1",
    })
    assert saved.status_code == 400
    assert settings.llm_base_url == original
    assert settings.llm_api_key == original_key


def test_siliconflow_with_token_succeeds():
    client = TestClient(app)
    saved = client.post("/v1/runtime-config", headers=AUTH, json={
        "llm_api_key": "sk-from-settings",
        "llm_base_url": "https://api.siliconflow.cn/v1",
        "llm_model": "Qwen/Qwen3.5-9B",
        "minimax_api_key": "mm-from-settings",
    })
    assert saved.status_code == 200
    body = saved.json()
    assert body["llm_configured"] is True
    assert body["minimax_configured"] is True
    assert "sk-from-settings" not in str(body)
    assert "mm-from-settings" not in str(body)
    assert TOKEN not in str(body)


def test_missing_token_config_forbids_even_on_loopback():
    settings.runtime_token = ""
    settings.debug = False
    client = TestClient(app)
    saved = client.post("/v1/runtime-config", json={"reset": True})
    assert saved.status_code == 403


def test_debug_loopback_exemption_and_lan_still_needs_token():
    from types import SimpleNamespace

    from app.routers.runtime import runtime_request_allowed

    settings.debug = True
    settings.runtime_token = ""
    loopback = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
    ipv6 = SimpleNamespace(client=SimpleNamespace(host="::1"))
    lan = SimpleNamespace(client=SimpleNamespace(host="192.168.1.20"))
    assert runtime_request_allowed(loopback, None)
    assert runtime_request_allowed(ipv6, None)
    assert not runtime_request_allowed(lan, None)

    settings.runtime_token = TOKEN
    settings.debug = False
    assert runtime_request_allowed(lan, TOKEN)
    assert not runtime_request_allowed(lan, "wrong-token")


def test_http_round_trip_omits_unset_fields():
    client = TestClient(app)
    empty = client.get("/v1/runtime-config")
    assert empty.status_code == 200
    assert empty.json()["llm_configured"] is False
    assert "runtime_token" not in empty.json()

    saved = client.post("/v1/runtime-config", headers=AUTH, json={
        "llm_api_key": "sk-from-settings",
        "llm_base_url": "https://api.siliconflow.cn/v1",
        "llm_model": "Qwen/Qwen3.5-9B",
        "minimax_api_key": "mm-from-settings",
    })
    assert saved.status_code == 200
    body = saved.json()
    assert body["llm_configured"] is True
    assert body["minimax_configured"] is True
    assert "sk-from-settings" not in str(body)
    assert "mm-from-settings" not in str(body)

    health = client.get("/healthz")
    assert health.json()["llm"] == "configured"
    assert health.json()["tts"] == "configured"

    client.post("/v1/runtime-config", headers=AUTH, json={"reset": True})
    restored = client.get("/healthz")
    assert restored.json()["llm"] == "stub"
