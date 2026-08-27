"""LLM 服务桩。

骨架阶段返回固定内容，接口形状先定下来，让 App 那边可以并行开发。
接真模型时只需要替换 suggest 的实现。
"""

from ..config import settings
from ..protocol import CloudAction, CloudActionEnvelope, CloudSummary, Emotion, SceneCtrl


async def suggest(summary: CloudSummary) -> CloudActionEnvelope:
    if not settings.llm_api_key:
        return _stub(summary)

    # TODO(骨架): 调真模型。注意两件事：
    #   1. 超时要短。这条链路是"锦上添花"，卡住了宁可不给建议，
    #      也不能让 App 等着——App 等待期间用户是没有反馈的。
    #   2. 模型的输出必须当成不可信输入解析，越界值一律丢弃而不是钳位。
    return _stub(summary)


def _stub(summary: CloudSummary) -> CloudActionEnvelope:
    # 桩不给 action：默认不建议改档位。
    # 让一个还没接模型的服务去动强度是最容易被忽略的坑。
    return CloudActionEnvelope(
        dialogue="（占位）我在。",
        action=CloudAction(),
        scene_ctrl=SceneCtrl.STAY,
        emotion=Emotion.CALM,
    )
