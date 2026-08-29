"""验证期：设置页可以把密钥写进进程内存，不落盘、不进 git。

`.env` / `secrets/.env` 仍是启动时的事实来源。这里只覆盖当前进程；
重启后端会回到环境变量。GET 只回是否已配置，不回密钥原文。
"""

from __future__ import annotations

from urllib.parse import urlparse

from .config import normalize_llm_base_url, settings

SILICONFLOW_API_HOST = "api.siliconflow.cn"

_OVERLAY_FIELDS = (
    "llm_api_key",
    "llm_base_url",
    "llm_model",
    "chat_llm_model",
    "control_llm_model",
    "minimax_api_key",
    "mimo_api_key",
    "speech_api_key",
    "speech_base_url",
    "tts_provider",
)


def _snapshot() -> dict[str, str]:
    return {name: str(getattr(settings, name) or "") for name in _OVERLAY_FIELDS}


ENV_SNAPSHOT = _snapshot()


class BaseUrlNotAllowed(ValueError):
    """设置页不得把进程内密钥指到允许名单以外的主机。"""


def _url_host(url: str) -> str:
    text = str(url or "").strip()
    if not text:
        return ""
    if "://" not in text:
        text = f"https://{text}"
    return (urlparse(text).hostname or "").lower()


def allowed_base_hosts() -> frozenset[str]:
    hosts = {SILICONFLOW_API_HOST}
    for key in ("llm_base_url", "speech_base_url"):
        host = _url_host(normalize_llm_base_url(ENV_SNAPSHOT.get(key, "")))
        if host:
            hosts.add(host)
    return frozenset(hosts)


def allowed_base_url(url: str) -> bool:
    normalized = normalize_llm_base_url(url)
    if not normalized:
        return True
    return _url_host(normalized) in allowed_base_hosts()


def _set_field(name: str, value: str) -> None:
    text = str(value or "").strip()
    if name in {"llm_base_url", "speech_base_url"}:
        text = normalize_llm_base_url(text)
    if name == "tts_provider":
        raw = text.lower() or "minimax"
        text = raw if raw in {"minimax", "mimo"} else "minimax"
    setattr(settings, name, text)


def reset_overlay() -> None:
    """回到进程启动时从环境变量读到的值。"""
    for name, value in ENV_SNAPSHOT.items():
        setattr(settings, name, value)


def apply_update(data: dict[str, object]) -> None:
    if data.get("reset"):
        reset_overlay()
        return

    for name in ("llm_base_url", "speech_base_url"):
        if name not in data or data[name] is None:
            continue
        if not allowed_base_url(str(data[name])):
            raise BaseUrlNotAllowed(f"{name} is not on the allowlist")

    model = data.get("llm_model")
    if isinstance(model, str) and model.strip():
        _set_field("llm_model", model)
        if "chat_llm_model" not in data:
            _set_field("chat_llm_model", model)
        if "control_llm_model" not in data:
            _set_field("control_llm_model", model)

    for name in _OVERLAY_FIELDS:
        if name == "llm_model":
            continue
        if name not in data:
            continue
        value = data[name]
        if value is None:
            continue
        _set_field(name, str(value))


def public_status() -> dict[str, object]:
    """给设置页看的状态。密钥只暴露是否已填。"""
    return {
        "llm_configured": settings.llm_configured,
        "llm_base_url": settings.llm_base_url,
        "llm_model": settings.llm_model,
        "llm_api_key_set": bool(settings.llm_api_key),
        "minimax_configured": settings.minimax_configured,
        "mimo_configured": settings.mimo_configured,
        "speech_configured": settings.speech_configured,
        "tts_configured": settings.tts_configured,
        "tts_provider": settings.tts_provider,
    }
