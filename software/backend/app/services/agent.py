"""B 层 Agent 编排：取记忆、构造上下文、调用模型。"""

import asyncio
from time import perf_counter

from ..config import settings
from . import llm
from .agent_contract import (
    AgentTurn,
    AgentTurnRequest,
    ControlDecision,
    ParallelAgentTurnRequest,
    ParallelAgentTurnResponse,
)
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


async def run_parallel_turn(
    request: ParallelAgentTurnRequest,
) -> ParallelAgentTurnResponse:
    """并行执行两个模型通道；任一通道失败都独立安全降级。"""

    started_at = perf_counter()
    chat_result, control_result = await asyncio.gather(
        asyncio.wait_for(run_turn(request.chat), timeout=settings.chat_llm_timeout_s),
        asyncio.wait_for(
            llm.generate_control(request.control),
            timeout=settings.control_llm_timeout_s,
        ),
        return_exceptions=True,
    )

    if isinstance(chat_result, Exception):
        chat_result = AgentTurn(dialogue="我在这里，先按你的节奏来。")
    if isinstance(control_result, Exception):
        control_result = ControlDecision(
            decision="hold",
            reason_codes=["orchestrator_failure"],
        )

    return ParallelAgentTurnResponse(
        elapsed_ms=round((perf_counter() - started_at) * 1000),
        chat=chat_result,
        control=control_result,
    )
