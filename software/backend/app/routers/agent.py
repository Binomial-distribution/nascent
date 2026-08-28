"""B layer Agent API.

The routes return dialogue, performance and preference suggestions, never device commands.
Authentication is intentionally deferred for local integration only.
"""

from fastapi import APIRouter, HTTPException, Query

from ..services import agent, llm, template
from ..services.agent_contract import (
    AgentTurn,
    AgentTurnRequest,
    ControlDecision,
    ControlDecisionRequest,
    MemoryItem,
    MemoryWriteRequest,
    ParallelAgentTurnRequest,
    ParallelAgentTurnResponse,
    PersonaTemplate,
    TemplateDraftRequest,
    TemplateDraftResponse,
)
from ..services.memory import memory_provider
from ..services.preference import (
    PreferenceObservation,
    PreferenceRecordResponse,
    PreferenceSnapshot,
    calculate_irpi,
    preference_store,
)

router = APIRouter(prefix="/v1/agent", tags=["agent"])


@router.post("/turn", response_model=AgentTurn)
async def post_turn(request: AgentTurnRequest) -> AgentTurn:
    return await agent.run_turn(request)


@router.post("/parallel-turn", response_model=ParallelAgentTurnResponse)
async def post_parallel_turn(
    request: ParallelAgentTurnRequest,
) -> ParallelAgentTurnResponse:
    return await agent.run_parallel_turn(request)


@router.post("/control-decision", response_model=ControlDecision)
async def post_control_decision(request: ControlDecisionRequest) -> ControlDecision:
    return await llm.generate_control(request)


@router.post("/memory", response_model=MemoryItem)
async def add_memory(request: MemoryWriteRequest) -> MemoryItem:
    return await memory_provider.add(
        user_id=request.user_id, persona_id=request.persona_id, text=request.text
    )


@router.get("/memory", response_model=list[MemoryItem])
async def search_memory(
    user_id: str,
    persona_id: str,
    query: str = "",
    limit: int = Query(default=5, ge=1, le=20),
) -> list[MemoryItem]:
    return await memory_provider.search(
        user_id=user_id, persona_id=persona_id, query=query, limit=limit
    )


@router.delete("/memory/{memory_id}")
async def delete_memory(
    memory_id: str, user_id: str, persona_id: str
) -> dict[str, bool]:
    return {
        "deleted": await memory_provider.delete(
            user_id=user_id, persona_id=persona_id, memory_id=memory_id
        )
    }


@router.delete("/memory")
async def delete_memory_scope(
    user_id: str, persona_id: str | None = None
) -> dict[str, int]:
    return {
        "deleted_count": await memory_provider.delete_scope(
            user_id=user_id, persona_id=persona_id
        )
    }


@router.get("/templates", response_model=list[PersonaTemplate])
async def list_templates(user_id: str) -> list[PersonaTemplate]:
    return await template.list_templates(user_id)


@router.post("/templates/draft", response_model=TemplateDraftResponse)
async def create_template_draft(request: TemplateDraftRequest) -> TemplateDraftResponse:
    return TemplateDraftResponse(template=await template.draft(request))


@router.post("/templates/confirm", response_model=PersonaTemplate)
async def confirm_template(
    user_id: str, template_payload: PersonaTemplate
) -> PersonaTemplate:
    if template_payload.source != "custom" or template_payload.status != "draft":
        raise HTTPException(
            status_code=400, detail="only custom draft templates can be confirmed"
        )
    return await template.confirm(user_id, template_payload)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user_id: str) -> dict[str, bool]:
    return {"deleted": await template.delete(user_id, template_id)}


@router.post("/preferences/observe", response_model=PreferenceRecordResponse)
async def observe_preference(
    observation: PreferenceObservation,
) -> PreferenceRecordResponse:
    result = calculate_irpi(observation)
    snapshot = await preference_store.record(observation, result)
    return PreferenceRecordResponse(result=result, snapshot=snapshot)


@router.get("/preferences", response_model=list[PreferenceSnapshot])
async def list_preferences(
    user_id: str, persona_id: str, template_id: str
) -> list[PreferenceSnapshot]:
    return await preference_store.list_scope(
        user_id=user_id, persona_id=persona_id, template_id=template_id
    )


@router.delete("/preferences")
async def delete_preferences(
    user_id: str, persona_id: str, template_id: str | None = None
) -> dict[str, int]:
    return {
        "deleted_count": await preference_store.delete_scope(
            user_id=user_id, persona_id=persona_id, template_id=template_id
        )
    }
