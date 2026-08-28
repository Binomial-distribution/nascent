"""B 层 Agent 编排：取记忆、构造上下文、调用模型。"""

from . import llm
from .agent_contract import AgentTurn, AgentTurnRequest
from .memory import memory_provider


async def run_turn(request: AgentTurnRequest) -> AgentTurn:
    # 失控模式和关闭记忆策略都不检索关系记忆，避免越过用户边界。
    memories = []
    if request.session_mode != "wild" and request.memory_policy != "off":
        memories = await memory_provider.search(
            user_id=request.user_id,
            persona_id=request.persona_id,
            query=request.user_input,
            limit=5,
        )
    return await llm.generate_turn(request, memories)
