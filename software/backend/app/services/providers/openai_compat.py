"""OpenAI-compatible chat completions. Swap vendor by changing base URL and model IDs."""

from __future__ import annotations

import httpx

from ...config import settings

JSON_OBJECT = {"type": "json_object"}


def completion_url(base_url: str) -> str:
    base = (base_url or "").rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def coerce_json_text(content: str) -> str:
    text = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    if text.startswith("{"):
        return text
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return text


def message_content(body: dict) -> str:
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("LLM response has no choices")
    content = choices[0].get("message", {}).get("content")
    if not isinstance(content, str):
        raise ValueError("LLM response content is not text")
    return coerce_json_text(content)


def vendor_payload(payload: dict) -> dict:
    """Qwen3.5-9B defaults to thinking; that burns the JSON budget, so turn it off."""

    out = dict(payload)
    out.setdefault("enable_thinking", False)
    return out


async def complete(
    *,
    model: str,
    messages: list[dict[str, str]],
    timeout_s: float,
    temperature: float = 0.7,
    max_tokens: int = 220,
    base_url: str | None = None,
    api_key: str | None = None,
) -> str:
    url = completion_url(base_url or settings.llm_base_url)
    key = api_key if api_key is not None else settings.llm_api_key
    payload = vendor_payload({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "response_format": JSON_OBJECT,
    })
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        response = await client.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        body = response.json()
    if not isinstance(body, dict):
        raise ValueError("LLM response is not an object")
    return message_content(body)


def error_summary(exc: BaseException) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return type(exc).__name__
