"""Nascent 云端。

它的定位要说清楚：**云端不控制硬件**。

App 会把会话摘要发上来，云端返回的是「建议」——一段台词、一个情景走向、
一个建议档位。这些建议全部要再过一遍 App 侧的安全总督，再由 K10 和玩具侧固件
各自的规则过滤。任何一层都可以否决云端。

换句话说，网络断了、云端挂了、模型胡说八道，设备该怎么工作还是怎么工作。
这不是容灾设计，是前提。
"""

from fastapi import FastAPI

from .config import settings
from .routers import persona, session

app = FastAPI(
    title="Nascent Cloud",
    version="0.1.0-demo",
    description="会话摘要 -> 建议。不直接控制硬件。",
    debug=settings.debug,
)

app.include_router(session.router)
app.include_router(persona.router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
