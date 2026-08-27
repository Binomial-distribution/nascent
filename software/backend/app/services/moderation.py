"""内容与动作审核桩。

这一层的职责不是"过滤脏话"，而是**兜住模型的越界输出**。
模型给出的 set_level 是不可信输入，处理方式与固件对 BLE 下行的处理一致：
越界直接丢弃，不钳位。悄悄把 99 改成 8 执行，比拒绝危险得多。
"""

from ..config import settings
from ..protocol import CloudActionEnvelope, NlConst


async def filter_envelope(envelope: CloudActionEnvelope) -> CloudActionEnvelope:
    if not settings.moderation_enabled:
        return envelope

    action = envelope.action
    if action is not None and action.set_level is not None:
        lv = action.set_level
        if lv < NlConst.LEVEL_MIN or lv > NlConst.LEVEL_MAX:
            # 丢掉整个 action，保留台词。建议档位不可信不代表这句话不能说。
            envelope = envelope.model_copy(update={"action": None})

    # TODO(骨架): 台词的内容审核。接三方审核 API 或本地规则表。
    return envelope
