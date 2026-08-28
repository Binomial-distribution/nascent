"""OpenAI-compatible ASR/TTS. Audio never enters Chat/Control prompts."""

from __future__ import annotations

import httpx

from ...config import settings

MAX_AUDIO_BYTES = 2_000_000


def _speech_root() -> str:
    return settings.resolved_speech_base_url.rstrip("/")


async def transcribe(
    audio: bytes,
    *,
    filename: str = "utterance.wav",
    content_type: str = "audio/wav",
) -> str:
    if len(audio) > MAX_AUDIO_BYTES:
        raise ValueError("audio too large")
    async with httpx.AsyncClient(timeout=settings.asr_timeout_s) as client:
        response = await client.post(
            f"{_speech_root()}/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.resolved_speech_api_key}"},
            files={"file": (filename, audio, content_type or "application/octet-stream")},
            data={"model": settings.asr_model},
        )
        response.raise_for_status()
        body = response.json()
    text = body.get("text") if isinstance(body, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise ValueError("ASR returned no text")
    return text.strip()[:2000]


async def synthesize(text: str) -> bytes:
    clipped = text.strip()[:500]
    if not clipped:
        raise ValueError("TTS text is empty")
    async with httpx.AsyncClient(timeout=settings.tts_timeout_s) as client:
        response = await client.post(
            f"{_speech_root()}/audio/speech",
            headers={
                "Authorization": f"Bearer {settings.resolved_speech_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.tts_model,
                "voice": settings.tts_voice,
                "input": clipped,
                "response_format": "mp3",
                "stream": False,
                "speed": 1.0,
            },
        )
        response.raise_for_status()
        return _require_audio(response)


def _require_audio(response: httpx.Response) -> bytes:
    content_type = (response.headers.get("content-type") or "").lower()
    body = response.content or b""
    if "json" in content_type or body.lstrip()[:1] == b"{":
        raise ValueError("TTS returned JSON instead of audio")
    if len(body) < 32:
        raise ValueError("TTS returned no audio")
    return body
