"""Speech endpoints. PCM stops here; Chat 9B only receives transcribed text."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import settings
from ..services.providers import speech as speech_provider

logger = logging.getLogger("nascent.speech")
router = APIRouter(prefix="/v1/speech", tags=["speech"])


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class TranscriptResponse(BaseModel):
    text: str


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
    if not settings.speech_configured:
        raise HTTPException(status_code=503, detail="speech unavailable")
    try:
        audio = await speech_provider.synthesize(request.text)
    except ValueError as exc:
        logger.warning("TTS rejected text: %s", type(exc).__name__)
        raise HTTPException(status_code=400, detail="speech rejected") from exc
    except httpx.HTTPError as exc:
        logger.warning("TTS unavailable: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="speech unavailable") from exc
    return Response(content=audio, media_type="audio/mpeg")
