"""会话路由：收摘要，回建议。"""

from fastapi import APIRouter

from ..protocol import CloudActionEnvelope, CloudSummary
from ..services import llm, moderation

router = APIRouter(prefix="/v1/session", tags=["session"])


@router.post("/summary", response_model=CloudActionEnvelope)
async def post_summary(summary: CloudSummary) -> CloudActionEnvelope:
    """接收 App 上报的会话摘要，返回下一步建议。

    返回的是**建议**不是命令。浏览器侧的安全总督会再判一次，
    K10 和玩具侧固件还会各判一次。envelope 里的 action.set_level
    只要越界或与当前状态冲突，下游任何一层都可以直接丢掉。
    """
    envelope = await llm.suggest(summary)
    return await moderation.filter_envelope(envelope)
