"""ASR/TTS adapters. PCM never enters Chat/Control prompts."""

from __future__ import annotations

import re

import httpx

from ...config import settings

MAX_AUDIO_BYTES = 2_000_000
MAX_CLONE_BYTES = 20_000_000
COSYVOICE_FALLBACK_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
COSYVOICE_FALLBACK_VOICE = "FunAudioLLM/CosyVoice2-0.5B:charles"
COSYVOICE_INSTRUCT = "请用温柔、自然、口语化的语气说，像真人在说话，不要播音腔。<|endofprompt|>"
FISH_FALLBACK_STATUSES = frozenset({402, 403, 404})
MINIMAX_DEFAULT_BASE = "https://api.minimaxi.com"
MINIMAX_EMOTIONS = frozenset({
    "happy",
    "sad",
    "angry",
    "fearful",
    "disgusted",
    "surprised",
    "calm",
    "whisper",
})
MINIMAX_TO_COSYVOICE = {
    "junlang_nanyou": "FunAudioLLM/CosyVoice2-0.5B:charles",
    "male-qn-qingse": "FunAudioLLM/CosyVoice2-0.5B:david",
    "danya_xuejie": "FunAudioLLM/CosyVoice2-0.5B:claire",
}
PRESET_TTS = {
    "gentle": {
        "minimax": "junlang_nanyou",
        "cosyvoice": "FunAudioLLM/CosyVoice2-0.5B:charles",
        "emotion": "calm",
        "gender": "male",
    },
    "playful": {
        "minimax": "male-qn-qingse",
        "cosyvoice": "FunAudioLLM/CosyVoice2-0.5B:david",
        "emotion": "happy",
        "gender": "male",
    },
    "calm": {
        "minimax": "danya_xuejie",
        "cosyvoice": "FunAudioLLM/CosyVoice2-0.5B:claire",
        "emotion": "whisper",
        "gender": "female",
    },
}


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


def spoken_text(text: str) -> str:
    """Make a line speakable: complete Chinese, no markdown/emoji/stage notes."""

    clipped = (text or "").strip()[:500]
    clipped = re.sub(r"[*_`#]+", "", clipped)
    clipped = re.sub(r"[（(][^）)]{0,40}[）)]", "", clipped)
    clipped = re.sub(r"[\U0001F300-\U0001FAFF\U00002700-\U000027BF]+", "", clipped)
    clipped = clipped.replace("～", "，").replace("~", "，").replace("……", "。").replace("…", "。")
    clipped = clipped.replace("...", "。")
    clipped = re.sub(r"[ \t]+", " ", clipped)
    clipped = re.sub(r"\n+", "。", clipped)
    return clipped.strip()[:500]


def tts_payload(text: str, *, model: str, voice: str) -> dict:
    clipped = spoken_text(text) or text.strip()[:500]
    spoken = f"{COSYVOICE_INSTRUCT}{clipped}" if is_cosyvoice(model) else clipped
    return {
        "model": model,
        "voice": voice,
        "input": spoken,
        "response_format": "mp3",
        "stream": False,
        "speed": 1.0,
    }


def minimax_payload(text: str, *, model: str, voice: str, emotion: str = "calm") -> dict:
    clipped = spoken_text(text) or text.strip()[:500]
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
            "emotion": resolve_minimax_emotion(emotion),
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }


def resolve_minimax_emotion(emotion: str | None) -> str:
    raw = (emotion or "").strip().lower() or "calm"
    if raw in MINIMAX_EMOTIONS:
        return raw
    return "calm"


def is_siliconflow_voice(voice: str) -> bool:
    raw = (voice or "").strip()
    return raw.startswith("speech:") or "cosyvoice" in raw.lower()


def resolve_cosyvoice(voice: str | None, fallback: str | None = None) -> str:
    chosen = (fallback or "").strip()
    if chosen:
        if chosen.startswith("speech:") or ":" in chosen:
            return chosen
        return f"{COSYVOICE_FALLBACK_MODEL}:{chosen}"
    mapped = MINIMAX_TO_COSYVOICE.get((voice or "").strip())
    if mapped:
        return mapped
    raw = (voice or "").strip()
    if raw.startswith("speech:") or "CosyVoice" in raw or (":" in raw and not raw.startswith("male-")):
        return raw
    return COSYVOICE_FALLBACK_VOICE


def clone_voice_id(persona_id: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9_]", "_", (persona_id or "").strip())
    raw = re.sub(r"_+", "_", raw).strip("_") or "custom"
    candidate = f"Nascent_{raw}"
    if len(candidate) < 8:
        candidate = f"{candidate}_voice"
    return candidate[:256]


class TranscriptRequired(ValueError):
    """SiliconFlow clone needs the spoken text of the uploaded clip."""


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


async def synthesize(
    text: str,
    voice: str | None = None,
    *,
    fallback_voice: str | None = None,
    emotion: str | None = None,
) -> bytes:
    clipped = spoken_text(text) or text.strip()[:500]
    if not clipped:
        raise ValueError("TTS text is empty")
    chosen = ((voice or "").strip()[:256] or settings.tts_voice).strip()
    emotion_name = (emotion or "").strip()[:32] or "calm"
    fallback = (fallback_voice or "").strip()[:256]
    if is_siliconflow_voice(chosen):
        if not settings.speech_configured:
            raise ValueError("TTS unavailable")
        return await _synthesize_siliconflow(clipped, voice=chosen)
    if settings.minimax_configured:
        try:
            return await _synthesize_minimax(clipped, voice=chosen, emotion=emotion_name)
        except (httpx.HTTPError, ValueError):
            if settings.speech_configured:
                return await _synthesize_siliconflow(
                    clipped,
                    voice=resolve_cosyvoice(chosen, fallback),
                )
            raise
    if not settings.speech_configured:
        raise ValueError("TTS unavailable")
    silicon_voice = chosen
    if is_minimax_tts(settings.tts_model) or chosen in MINIMAX_TO_COSYVOICE:
        silicon_voice = resolve_cosyvoice(chosen, fallback)
    return await _synthesize_siliconflow(clipped, voice=silicon_voice)


def _siliconflow_model_voice() -> tuple[str, str]:
    if is_minimax_tts(settings.tts_model):
        return COSYVOICE_FALLBACK_MODEL, COSYVOICE_FALLBACK_VOICE
    return settings.tts_model, settings.tts_voice


async def _synthesize_siliconflow(text: str, *, voice: str | None = None) -> bytes:
    model, default_voice = _siliconflow_model_voice()
    chosen = (voice or default_voice).strip() or default_voice
    if is_cosyvoice(model) and chosen and ":" not in chosen and not chosen.startswith("speech:"):
        chosen = f"{model}:{chosen}"
    primary = tts_payload(text, model=model, voice=chosen)
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


async def _synthesize_minimax(text: str, *, voice: str, emotion: str = "calm") -> bytes:
    try:
        return await _post_minimax(text, voice=voice, emotion=emotion)
    except (httpx.HTTPStatusError, ValueError):
        if resolve_minimax_emotion(emotion) != "calm":
            return await _post_minimax(text, voice=voice, emotion="calm")
        raise


async def _post_minimax(text: str, *, voice: str, emotion: str) -> bytes:
    payload = minimax_payload(
        text,
        model=settings.tts_model,
        voice=voice,
        emotion=emotion,
    )
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


async def clone_voice(
    audio: bytes,
    *,
    filename: str = "voice.mp3",
    content_type: str = "audio/mpeg",
    persona_id: str = "custom",
    transcript: str = "",
) -> str:
    if not audio:
        raise ValueError("empty audio")
    if len(audio) > MAX_CLONE_BYTES:
        raise ValueError("audio too large")
    voice_id = clone_voice_id(persona_id)
    spoken = (transcript or "").strip()[:500]
    if settings.minimax_configured:
        try:
            await _clone_minimax(
                audio,
                filename=filename,
                content_type=content_type,
                voice_id=voice_id,
            )
            return voice_id
        except (httpx.HTTPError, ValueError):
            if not settings.speech_configured:
                raise
            if not spoken:
                raise TranscriptRequired("transcript required") from None
            return await _clone_siliconflow(
                audio,
                filename=filename,
                content_type=content_type,
                voice_id=voice_id,
                transcript=spoken,
            )
    if not settings.speech_configured:
        raise ValueError("TTS unavailable")
    if not spoken:
        raise TranscriptRequired("transcript required")
    return await _clone_siliconflow(
        audio,
        filename=filename,
        content_type=content_type,
        voice_id=voice_id,
        transcript=spoken,
    )


def _minimax_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.minimax_api_key}"}


def _minimax_params() -> dict[str, str] | None:
    if settings.minimax_group_id:
        return {"GroupId": settings.minimax_group_id}
    return None


def _minimax_root() -> str:
    return (settings.minimax_base_url or MINIMAX_DEFAULT_BASE).rstrip("/")


def _require_minimax_ok(body: object) -> dict:
    if not isinstance(body, dict):
        raise ValueError("clone rejected")
    status = (body.get("base_resp") or {}).get("status_code")
    if status not in (0, None):
        raise ValueError("clone rejected")
    return body


async def _clone_minimax(
    audio: bytes,
    *,
    filename: str,
    content_type: str,
    voice_id: str,
) -> None:
    timeout = max(settings.tts_timeout_s, 30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        uploaded = await client.post(
            f"{_minimax_root()}/v1/files/upload",
            params=_minimax_params(),
            headers=_minimax_headers(),
            data={"purpose": "voice_clone"},
            files={"file": (filename or "voice.mp3", audio, content_type or "application/octet-stream")},
        )
        uploaded.raise_for_status()
        body = _require_minimax_ok(uploaded.json())
        file_id = (body.get("file") or {}).get("file_id")
        if file_id in (None, ""):
            raise ValueError("clone upload failed")
        cloned = await client.post(
            f"{_minimax_root()}/v1/voice_clone",
            params=_minimax_params(),
            headers={**_minimax_headers(), "Content-Type": "application/json"},
            json={
                "file_id": file_id,
                "voice_id": voice_id,
                "model": settings.tts_model or "speech-02-turbo",
            },
        )
        cloned.raise_for_status()
        _require_minimax_ok(cloned.json())


async def _clone_siliconflow(
    audio: bytes,
    *,
    filename: str,
    content_type: str,
    voice_id: str,
    transcript: str,
) -> str:
    timeout = max(settings.tts_timeout_s, 30.0)
    custom_name = re.sub(r"[^A-Za-z0-9_-]", "", voice_id)[:40] or "NascentVoice"
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{_speech_root()}/uploads/audio/voice",
            headers={"Authorization": f"Bearer {settings.resolved_speech_api_key}"},
            data={
                "model": COSYVOICE_FALLBACK_MODEL,
                "customName": custom_name,
                "text": transcript,
            },
            files={"file": (filename or "voice.mp3", audio, content_type or "application/octet-stream")},
        )
        response.raise_for_status()
        body = response.json()
    uri = body.get("uri") if isinstance(body, dict) else None
    if not isinstance(uri, str) or not uri.strip():
        raise ValueError("clone returned no voice")
    return uri.strip()[:256]


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
