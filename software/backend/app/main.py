"""Nascent 云端。

它的定位要说清楚：**云端不控制硬件**。

控制端会把会话摘要发上来，云端返回的是「建议」——一段台词、一个情景走向、
一个建议档位。这些建议全部要再过一遍浏览器侧的安全总督，再由 K10 和玩具侧固件
各自的规则过滤。任何一层都可以否决云端。

换句话说，网络断了、云端挂了、模型胡说八道，设备该怎么工作还是怎么工作。
这不是容灾设计，是前提。
"""

from pathlib import Path
import mimetypes

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers import agent, body_notes, persona, session, speech

WEB_ROOT = Path(__file__).resolve().parents[2] / "app"
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")

app = FastAPI(
    title="Nascent Cloud",
    version="0.1.0-demo",
    description="会话摘要 -> 建议。不直接控制硬件。同时托管浏览器控制端。",
    debug=settings.debug,
)

app.include_router(session.router)
app.include_router(persona.router)
app.include_router(agent.router)
app.include_router(body_notes.router)
app.include_router(speech.router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "llm": "configured" if settings.llm_configured else "stub",
        "llm_provider": settings.llm_provider,
        "speech": "configured" if settings.speech_configured else "stub",
        "tts": "configured" if settings.tts_configured else "stub",
    }


# 具体 API 必须先注册。挂在最后的 "/" 只负责网站静态页。
app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="web")
