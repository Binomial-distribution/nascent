"""ASR/TTS adapters. PCM never enters Chat/Control prompts."""

from __future__ import annotations

import httpx

from ...config import settings

MAX_AUDIO_BYTES = 2_000_000
COSYVOICE_FALLBACK_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
COSYVOICE_FALLBACK_VOICE = "FunAudioLLM/CosyVoice2-0.5B:claire"
COSYVOICE_INSTRUCT = "请用温柔、自然、口语化的语气说，像真人在说话，不要播音腔。<|endofprompt|>"
FISH_FALLBACK_STATUSES = frozenset({402, 403, 404})
MINIMAX_DEFAULT_BASE = "https://api.minimaxi.com"


def _speech_root() -> str:
    return settings.resolved_speech_base_url.rstrip("/")


def is_fish_speech(model: str) -> bool:
    return "fish-speech" in (model or "").lower()


def is_cosyvoice(model: str) -> bool:
    return "cosyvoice" in (model or "").lower()


def is_minimax_tts(model: str) -> bool:
    return (model or "").startswith("speech-")


def should_fallback_to_cosyvoice(status_code: int, model: str) -> bool:
    return is_fish_speech(model) and status_code in FISH_FALLBACK_STATUSES


def tts_payload(text: str, *, model: str, voice: str) -> dict:
    clipped = text.strip()[:500]
    spoken = f"{COSYVOICE_INSTRUCT}{clipped}" if is_cosyvoice(model) else clipped
    return {
        "model": model,
        "voice": voice,
        "input": spoken,
        "response_format": "mp3",
        "stream": False,
        "speed": 1.0,
    }


def minimax_payload(text: str, *, model: str, voice: str) -> dict:
    clipped = text.strip()[:500]
    return {
        "model": model,
        "text": clipped,
        "stream": False,
        "language_boost": "Chinese",
        "output_format": "hex",
        "voice_setting": {
            "voice_id": voice,
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
            "emotion": "calm",
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }


def decode_minimax_audio(body: object) -> bytes:
    if not isinstance(body, dict):
        raise ValueError("TTS returned no audio")
    status = (body.get("base_resp") or {}).get("status_code")
    if status not in (0, None):
        raise ValueError("TTS rejected")
    audio_hex = ((body.get("data") or {}) or {}).get("audio")
    if not isinstance(audio_hex, str) or not audio_hex.strip():
        raise ValueError("TTS returned no audio")
    try:
        raw = bytes.fromhex(audio_hex.strip())
    except ValueError as exc:
        raise ValueError("TTS returned no audio") from exc
    if len(raw) < 32:
        raise ValueError("TTS returned no audio")
    return raw


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
    if settings.minimax_configured:
        try:
            return await _synthesize_minimax(clipped)
        except (httpx.HTTPError, ValueError):
            if settings.speech_configured:
                return await _synthesize_siliconflow(clipped)
            raise
    if not settings.speech_configured:
        raise ValueError("TTS unavailable")
    return await _synthesize_siliconflow(clipped)


def _siliconflow_model_voice() -> tuple[str, str]:
    if is_minimax_tts(settings.tts_model):
        return COSYVOICE_FALLBACK_MODEL, COSYVOICE_FALLBACK_VOICE
    return settings.tts_model, settings.tts_voice


async def _synthesize_siliconflow(text: str) -> bytes:
    model, voice = _siliconflow_model_voice()
    primary = tts_payload(text, model=model, voice=voice)
    async with httpx.AsyncClient(timeout=settings.tts_timeout_s) as client:
        response = await _post_tts(client, primary)
        if should_fallback_to_cosyvoice(response.status_code, model):
            response = await _post_tts(
                client,
                tts_payload(
                    text,
                    model=COSYVOICE_FALLBACK_MODEL,
                    voice=COSYVOICE_FALLBACK_VOICE,
                ),
            )
        response.raise_for_status()
        return _require_audio(response)


async def _synthesize_minimax(text: str) -> bytes:
    payload = minimax_payload(text, model=settings.tts_model, voice=settings.tts_voice)
    base = (settings.minimax_base_url or MINIMAX_DEFAULT_BASE).rstrip("/")
    params = {}
    if settings.minimax_group_id:
        params["GroupId"] = settings.minimax_group_id
    async with httpx.AsyncClient(timeout=settings.tts_timeout_s) as client:
        response = await client.post(
            f"{base}/v1/t2a_v2",
            params=params or None,
            headers={
                "Authorization": f"Bearer {settings.minimax_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        return decode_minimax_audio(response.json())


async def _post_tts(client: httpx.AsyncClient, payload: dict) -> httpx.Response:
    return await client.post(
        f"{_speech_root()}/audio/speech",
        headers={
            "Authorization": f"Bearer {settings.resolved_speech_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
    )


def _require_audio(response: httpx.Response) -> bytes:
    content_type = (response.headers.get("content-type") or "").lower()
    body = response.content or b""
    if "json" in content_type or body.lstrip()[:1] == b"{":
        raise ValueError("TTS returned JSON instead of audio")
    if len(body) < 32:
        raise ValueError("TTS returned no audio")
    return body
