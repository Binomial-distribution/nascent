"""验证期运行时配置。不写 secrets/.env，也不把密钥回给页面。"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import settings
from ..runtime_overlay import BaseUrlNotAllowed, apply_update, public_status

router = APIRouter(prefix="/v1", tags=["runtime"])

_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}
_TOKEN_HEADER = "X-Nascent-Runtime-Token"


class RuntimeConfigUpdate(BaseModel):
    reset: bool = False
    llm_api_key: str | None = Field(default=None, max_length=256)
    llm_base_url: str | None = Field(default=None, max_length=256)
    llm_model: str | None = Field(default=None, max_length=128)
    chat_llm_model: str | None = Field(default=None, max_length=128)
    control_llm_model: str | None = Field(default=None, max_length=128)
    minimax_api_key: str | None = Field(default=None, max_length=256)
    mimo_api_key: str | None = Field(default=None, max_length=256)
    speech_api_key: str | None = Field(default=None, max_length=256)
    speech_base_url: str | None = Field(default=None, max_length=256)
    tts_provider: str | None = Field(default=None, max_length=16)


def runtime_request_allowed(request: Request, token_header: str | None) -> bool:
    client_host = request.client.host if request.client else ""
    if settings.debug and client_host in _LOOPBACK_HOSTS:
        return True
    expected = str(settings.runtime_token or "").strip()
    if not expected:
        return False
    provided = str(token_header or "").strip()
    if not provided:
        return False
    return hmac.compare_digest(expected, provided)


@router.get("/runtime-config")
def get_runtime_config() -> dict[str, object]:
    return public_status()


@router.post("/runtime-config")
def post_runtime_config(
    update: RuntimeConfigUpdate,
    request: Request,
    x_nascent_runtime_token: str | None = Header(default=None, alias=_TOKEN_HEADER),
) -> dict[str, object]:
    if not runtime_request_allowed(request, x_nascent_runtime_token):
        raise HTTPException(status_code=403, detail="runtime token required")
    try:
        apply_update(update.model_dump(exclude_unset=True))
    except BaseUrlNotAllowed as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return public_status()
