"""Speech endpoints. PCM stops here; Chat 9B only receives transcribed text."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import settings
from ..services.providers import speech as speech_provider

logger = logging.getLogger("nascent.speech")
router = APIRouter(prefix="/v1/speech", tags=["speech"])


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    voice: str | None = Field(default=None, max_length=256)
    fallback_voice: str | None = Field(default=None, max_length=256)
    emotion: str | None = Field(default=None, max_length=32)
    tts_style: str | None = Field(default=None, max_length=16)
    provider: str | None = Field(default=None, max_length=16)


class TranscriptResponse(BaseModel):
    text: str


class CloneResponse(BaseModel):
    voice_id: str


@router.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(file: UploadFile = File(...)) -> TranscriptResponse:
    if not settings.speech_configured:
        raise HTTPException(status_code=503, detail="speech unavailable")
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    try:
        text = await speech_provider.transcribe(
            audio,
            filename=file.filename or "utterance.wav",
            content_type=file.content_type or "audio/wav",
        )
    except ValueError as exc:
        logger.warning("ASR rejected audio: %s", type(exc).__name__)
        raise HTTPException(status_code=400, detail="audio rejected") from exc
    except httpx.HTTPError as exc:
        logger.warning("ASR unavailable: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="speech unavailable") from exc
    return TranscriptResponse(text=text)


@router.post("/speak")
async def speak(request: SpeakRequest) -> Response:
    if not settings.tts_configured:
        raise HTTPException(status_code=503, detail="speech unavailable")
    voice = (request.voice or "").strip() or None
    fallback = (request.fallback_voice or "").strip() or None
    emotion = (request.emotion or "").strip() or None
    tts_style = (request.tts_style or "").strip() or None
    provider = (request.provider or "").strip().lower() or None
    if provider and provider not in {"minimax", "mimo"}:
        provider = None
    try:
        audio = await speech_provider.synthesize(
            request.text,
            voice,
            fallback_voice=fallback,
            emotion=emotion,
            tts_style=tts_style,
            provider=provider,
        )
    except ValueError as exc:
        logger.warning("TTS rejected text: %s", type(exc).__name__)
        raise HTTPException(status_code=400, detail="speech rejected") from exc
    except httpx.HTTPError as exc:
        logger.warning("TTS unavailable: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="speech unavailable") from exc
    return Response(content=audio, media_type="audio/mpeg")


@router.post("/clone", response_model=CloneResponse)
async def clone(
    file: UploadFile = File(...),
    persona_id: str = Form(default="custom"),
    transcript: str = Form(default=""),
) -> CloneResponse:
    if not settings.tts_configured:
        raise HTTPException(status_code=503, detail="speech unavailable")
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    try:
        voice_id = await speech_provider.clone_voice(
            audio,
            filename=file.filename or "voice.mp3",
            content_type=file.content_type or "audio/mpeg",
            persona_id=(persona_id or "custom").strip()[:128] or "custom",
            transcript=transcript or "",
        )
    except speech_provider.TranscriptRequired as exc:
        raise HTTPException(status_code=400, detail="transcript required") from exc
    except ValueError as exc:
        logger.warning("voice clone rejected: %s", type(exc).__name__)
        raise HTTPException(status_code=400, detail="clone rejected") from exc
    except httpx.HTTPError as exc:
        logger.warning("voice clone unavailable: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="speech unavailable") from exc
    return CloneResponse(voice_id=voice_id)
