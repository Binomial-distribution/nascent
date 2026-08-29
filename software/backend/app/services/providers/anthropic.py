"""Anthropic Messages API（Claude）。固有人设走完整 system prompt 时默认用这条。"""

from __future__ import annotations

import httpx

from ...config import settings
from .openai_compat import coerce_json_text, error_summary

DEFAULT_BASE = "https://api.anthropic.com"
DEFAULT_VERSION = "2023-06-01"


def messages_url(base_url: str) -> str:
    base = (base_url or DEFAULT_BASE).rstrip("/")
    if base.endswith("/v1/messages"):
        return base
    if base.endswith("/v1"):
        return f"{base}/messages"
    return f"{base}/v1/messages"


def _split_messages(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    system_parts: list[str] = []
    converted: list[dict[str, str]] = []
    for item in messages:
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        if role == "system":
            system_parts.append(content)
            continue
        if role not in {"user", "assistant"}:
            continue
        if converted and converted[-1]["role"] == role:
            converted[-1]["content"] += "\n" + content
        else:
            converted.append({"role": role, "content": content})
    if converted and converted[0]["role"] != "user":
        converted.insert(0, {"role": "user", "content": "（继续）"})
    return "\n\n".join(system_parts).strip(), converted


async def complete(
    *,
    model: str,
    messages: list[dict[str, str]],
    timeout_s: float,
    temperature: float = 0.7,
    max_tokens: int = 700,
    base_url: str | None = None,
    api_key: str | None = None,
) -> str:
    key = api_key if api_key is not None else settings.llm_api_key
    if not key:
        raise ValueError("Anthropic API key missing")
    system, chat = _split_messages(messages)
    if not chat:
        raise ValueError("Anthropic messages empty")
    payload: dict[str, object] = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": chat,
    }
    if system:
        payload["system"] = system
    url = messages_url(base_url or settings.llm_base_url or DEFAULT_BASE)
    async with httpx.AsyncClient(timeout=timeout_s, trust_env=False) as client:
        response = await client.post(
            url,
            json=payload,
            headers={
                "x-api-key": key,
                "anthropic-version": DEFAULT_VERSION,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        body = response.json()
    if not isinstance(body, dict):
        raise ValueError("Anthropic response is not an object")
    blocks = body.get("content")
    if not isinstance(blocks, list):
        raise ValueError("Anthropic response has no content")
    texts = [
        str(block.get("text") or "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    joined = "\n".join(part for part in texts if part).strip()
    if not joined:
        raise ValueError("Anthropic response text empty")
    return coerce_json_text(joined)


__all__ = ["complete", "error_summary", "messages_url"]
