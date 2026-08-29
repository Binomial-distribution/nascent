import asyncio
import sys

import pytest

sys.path.insert(0, "software/backend")

from app.services import agent, template
from app.services.agent_contract import (
    AgentTurn,
    AgentTurnRequest,
    ControlDecision,
    ControlDecisionRequest,
    ParallelAgentTurnRequest,
    TemplateDraftRequest,
)
from app.services.memory import InMemoryMemoryProvider
from app.services.llm import _apply_control_policy
from app.services.preference import (
    InMemoryPreferenceStore,
    PreferenceObservation,
    calculate_irpi,
)


@pytest.mark.asyncio
async def test_memory_isolated_by_user_and_persona():
    provider = InMemoryMemoryProvider()
    item = await provider.add(user_id="u1", persona_id="p1", text="喜欢安静的晚上")

    assert [
        x.id for x in await provider.search(user_id="u1", persona_id="p1", query="晚上")
    ] == [item.id]
    assert await provider.search(user_id="u1", persona_id="p2", query="晚上") == []
    assert await provider.search(user_id="u2", persona_id="p1", query="晚上") == []
    assert await provider.delete(user_id="u1", persona_id="p1", memory_id=item.id)
    assert await provider.search(user_id="u1", persona_id="p1", query="晚上") == []


@pytest.mark.asyncio
async def test_template_fallback_is_draft_and_can_be_deleted():
    request = TemplateDraftRequest(
        user_id="test-user",
        persona_id="p1",
        conversation=[{"role": "user", "content": "前面慢一点，最后安静下来"}],
    )
    draft = await template.draft(request)
    assert draft.source == "custom"
    assert draft.status == "draft"
    assert all(skill.requires_confirmation for skill in draft.skills)

    confirmed = await template.confirm(request.user_id, draft)
    assert confirmed.status == "confirmed"
    assert await template.delete(request.user_id, confirmed.template_id)


@pytest.mark.asyncio
async def test_wild_mode_does_not_retrieve_memory(monkeypatch):
    class FailingProvider:
        async def search(self, **kwargs):
            raise AssertionError("wild mode must not retrieve relationship memory")

    monkeypatch.setattr(agent, "memory_provider", FailingProvider())
    result = await agent.run_turn(
        AgentTurnRequest(
            user_id="u", persona_id="p", session_mode="wild", user_input="继续"
        )
    )
    assert result.action is None
    assert result.memory_proposals == []


@pytest.mark.asyncio
async def test_parallel_turn_starts_chat_and_control_together(monkeypatch):
    chat_started = asyncio.Event()
    control_started = asyncio.Event()

    async def fake_chat(_request):
        chat_started.set()
        await asyncio.wait_for(control_started.wait(), timeout=0.2)
        return AgentTurn(dialogue="chat ready")

    async def fake_control(_request):
        control_started.set()
        await asyncio.wait_for(chat_started.wait(), timeout=0.2)
        return ControlDecision(decision="hold", reason_codes=["test"])

    monkeypatch.setattr(agent, "run_turn", fake_chat)
    monkeypatch.setattr(agent.llm, "generate_control", fake_control)
    request = ParallelAgentTurnRequest(
        chat=AgentTurnRequest(user_id="u", persona_id="p", user_input="继续"),
        control=ControlDecisionRequest(user_id="u", session_id="s"),
    )

    result = await asyncio.wait_for(agent.run_parallel_turn(request), timeout=0.5)

    assert result.execution == "parallel"
    assert result.chat.dialogue == "chat ready"
    assert result.control.reason_codes == ["test"]
    assert result.data_flow.device[-2] == "sendCommand()"


@pytest.mark.asyncio
async def test_parallel_turn_degrades_failed_lane_independently(monkeypatch):
    async def failing_chat(_request):
        raise RuntimeError("chat failed")

    async def healthy_control(_request):
        return ControlDecision(decision="hold", reason_codes=["policy_hold"])

    monkeypatch.setattr(agent, "run_turn", failing_chat)
    monkeypatch.setattr(agent.llm, "generate_control", healthy_control)
    request = ParallelAgentTurnRequest(
        chat=AgentTurnRequest(user_id="u", persona_id="p", user_input="继续"),
        control=ControlDecisionRequest(user_id="u", session_id="s"),
    )

    result = await agent.run_parallel_turn(request)

    assert result.chat.action is None
    assert result.control.reason_codes == ["policy_hold"]


@pytest.mark.asyncio
async def test_parallel_turn_times_out_one_lane_without_losing_the_other(monkeypatch):
    async def slow_chat(_request):
        await asyncio.sleep(0.1)
        return AgentTurn(dialogue="too late")

    async def healthy_control(_request):
        return ControlDecision(decision="hold", reason_codes=["fresh_control"])

    monkeypatch.setattr(agent, "run_turn", slow_chat)
    monkeypatch.setattr(agent.llm, "generate_control", healthy_control)
    monkeypatch.setattr(agent.settings, "chat_llm_timeout_s", 0.01)
    request = ParallelAgentTurnRequest(
        chat=AgentTurnRequest(user_id="u", persona_id="p", user_input="继续"),
        control=ControlDecisionRequest(user_id="u", session_id="s"),
    )

    result = await agent.run_parallel_turn(request)

    assert result.chat.dialogue != "too late"
    assert result.control.reason_codes == ["fresh_control"]


def _observation(**overrides):
    values = {
        "user_id": "u",
        "persona_id": "p",
        "template_id": "t",
        "preference_key": "pace_preference",
        "candidate": "steady",
        "explicit_feedback": "comfortable",
        "active_behavior": "continued",
        "pressure_trend": "steady",
        "temperature_trend": "stable",
        "sensor_quality": "valid",
        "link_state": "valid",
        "data_age_ms": 1000,
    }
    values.update(overrides)
    return PreferenceObservation(**values)


def test_irpi_uses_explicit_feedback_and_quality_gate():
    result = calculate_irpi(_observation())
    assert result.accepted
    assert result.quality_gate == 1.0
    assert (
        result.weighted_components["explicit"] > result.weighted_components["pressure"]
    )

    stale = calculate_irpi(_observation(data_age_ms=20_000))
    assert not stale.accepted
    assert "stale_sensor_data" in stale.reason_codes


def test_irpi_never_learns_from_safety_or_withdrawal():
    for overrides, reason in (
        ({"safety_event": True}, "safety_event"),
        ({"consent_state": "withdrawn"}, "consent_not_confirmed"),
        ({"explicit_feedback": "pause"}, "negative_feedback"),
    ):
        result = calculate_irpi(_observation(**overrides))
        assert not result.accepted
        assert reason in result.reason_codes


@pytest.mark.asyncio
async def test_preference_store_isolated_and_deletable():
    store = InMemoryPreferenceStore()
    observation = _observation()
    await store.record(observation, calculate_irpi(observation))
    assert (
        len(await store.list_scope(user_id="u", persona_id="p", template_id="t")) == 1
    )
    assert (
        await store.list_scope(user_id="u", persona_id="other", template_id="t") == []
    )
    assert await store.delete_scope(user_id="u", persona_id="p", template_id="t") == 1
    assert await store.list_scope(user_id="u", persona_id="p", template_id="t") == []


def test_control_hold_keeps_reason_and_drops_suggestions():
    result = _apply_control_policy(
        ControlDecision(
            decision="hold",
            recommended_skill_id="rhythm_segment",
            recommended_level=3,
            reason_codes=["user_asked_to_wait"],
        ),
        ["rhythm_segment"],
    )
    assert result.decision == "hold"
    assert result.reason_codes == ["user_asked_to_wait"]
    assert result.recommended_skill_id is None
    assert result.recommended_level is None
    assert result.action is None


def test_control_hold_with_null_skill_is_not_rewritten_as_not_allowed():
    result = _apply_control_policy(
        ControlDecision(decision="hold", recommended_skill_id=None, reason_codes=["policy_hold"]),
        ["rhythm_segment"],
    )
    assert result.reason_codes == ["policy_hold"]
    assert "skill_not_allowed" not in result.reason_codes


def test_control_recommend_outside_allowlist_holds():
    result = _apply_control_policy(
        ControlDecision(
            decision="recommend",
            recommended_skill_id="set_pattern",
            recommended_pattern="wave",
        ),
        ["rhythm_segment"],
    )
    assert result.decision == "hold"
    assert result.reason_codes == ["skill_not_allowed"]


@pytest.mark.asyncio
async def test_memory_search_clamps_negative_limit():
    provider = InMemoryMemoryProvider()
    await provider.add(user_id="u", persona_id="p", text="第一条")
    await provider.add(user_id="u", persona_id="p", text="第二条")
    assert await provider.search(user_id="u", persona_id="p", query="", limit=-3) == []
    assert len(await provider.search(user_id="u", persona_id="p", query="", limit=1)) == 1
    assert len(await provider.search(user_id="u", persona_id="p", query="", limit=99)) == 2


def test_memory_search_http_rejects_out_of_range_limit():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    for limit in (0, -3, 21):
        response = client.get(
            "/v1/agent/memory",
            params={"user_id": "u", "persona_id": "p", "limit": limit},
        )
        assert response.status_code == 422, limit


def test_chat_stub_aftercare_does_not_escalate():
    from app.services.llm import _agent_stub

    turn = _agent_stub(
        AgentTurnRequest(
            user_id="u",
            persona_id="p",
            scene_id="aftercare",
            user_input="累了",
            sensor_context={
                "temperature_state": "comfortable",
                "pressure_rhythm": "decreasing",
                "hr_trend": "unknown",
            },
        )
    )
    assert turn.action is None
    assert turn.scene_ctrl == "end"
    assert "高潮" not in turn.dialogue


def test_prompt_includes_sensor_trends_and_aftercare():
    from app.services.prompt_builder import SYSTEM_PROMPT, build_messages

    assert "事后抚慰" in SYSTEM_PROMPT
    assert "Chat 9B" in SYSTEM_PROMPT
    assert "前戏" in SYSTEM_PROMPT
    assert "升温" in SYSTEM_PROMPT
    assert "仅当用户自己" in SYSTEM_PROMPT
    messages = build_messages(
        AgentTurnRequest(
            user_id="u",
            persona_id="p",
            scene_id="rising",
            user_input="可以再近一点",
            sensor_context={
                "temperature_state": "warming",
                "pressure_rhythm": "increasing",
                "hr_trend": "unknown",
            },
        ),
        [],
    )
    blob = messages[1]["content"]
    assert "warming" in blob
    assert "increasing" in blob
    assert "hr_trend" in blob
    assert "press_l" not in blob
    assert "顾深" in messages[0]["content"]
    assert "角色卡" in messages[0]["content"]
    assert "请依据以下受控上下文" not in messages[1]["content"]


def test_persona_card_uses_waifu_profile_fields():
    from app.services.prompt_builder import format_persona_card

    card = format_persona_card({
        "user_name": "宝贝",
        "assistant_name": "顾深",
        "profile": ["你是黏人的甜系男友"],
        "skills": ["用短句增加温度"],
        "background": ["阳台上种着薄荷"],
        "rules": ["你就是顾深"],
        "prologue": "晚上九点半靠在沙发上",
    })
    assert "assistant_name: 顾深" in card
    assert "user_name: 宝贝" in card
    assert "甜系男友" in card
    assert "薄荷" in card


def test_custom_persona_uploads_and_lists_for_selection():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    created = client.post(
        "/v1/persona/custom",
        json={
            "user_id": "quiz-user",
            "name": "陆予",
            "source": "quiz",
            "card": {
                "assistant_name": "陆予",
                "user_name": "宝贝",
                "profile": ["你是稳、会照顾人的男友"],
                "spoken": "我在。你先靠近就好。",
            },
            "text": "assistant_name: 陆予",
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["name"] == "陆予"
    assert body["source"] == "quiz"
    assert body["card"]["assistant_name"] == "陆予"
    listed = client.get("/v1/persona/custom", params={"user_id": "quiz-user"})
    assert listed.status_code == 200
    names = [item["name"] for item in listed.json()]
    assert "陆予" in names
    other = client.get("/v1/persona/custom", params={"user_id": "other-user"})
    assert other.json() == []


def test_siliconflow_console_url_normalizes_to_api_root():
    from app.config import normalize_llm_base_url

    assert normalize_llm_base_url("https://cloud.siliconflow.cn/") == "https://api.siliconflow.cn/v1"
    assert normalize_llm_base_url("https://api.siliconflow.cn/v1") == "https://api.siliconflow.cn/v1"


def test_llm_vendor_payload_disables_thinking_and_extracts_json():
    from app.services.providers.openai_compat import coerce_json_text, vendor_payload

    payload = vendor_payload({"model": "Qwen/Qwen3.5-9B", "messages": []})
    assert payload["enable_thinking"] is False
    extracted = coerce_json_text('thinking\n```json\n{"dialogue":"我在","action":null}\n```')
    assert extracted == '{"dialogue":"我在","action":null}'


@pytest.mark.asyncio
async def test_generate_turn_uses_completion_provider(monkeypatch):
    import json as json_lib

    from app.config import settings
    from app.services import llm

    captured = {}

    async def fake_complete(**kwargs):
        captured["model"] = kwargs["model"]
        captured["messages"] = kwargs["messages"]
        return json_lib.dumps({
            "dialogue": "按你的节奏来",
            "action": None,
            "scene_ctrl": "stay",
            "emotion": "calm",
        })

    monkeypatch.setattr(settings, "llm_api_key", "test")
    monkeypatch.setattr(settings, "llm_base_url", "https://example.invalid/v1")
    monkeypatch.setattr(llm, "complete_json", fake_complete)
    result = await llm.generate_turn(
        AgentTurnRequest(
            user_id="u",
            persona_id="p",
            user_input="你好",
            memory_policy="off",
            sensor_context={"temperature_state": "warming", "pressure_rhythm": "steady"},
        ),
        [],
    )
    assert result.dialogue == "按你的节奏来"
    assert result.action is None
    assert captured["model"] == "Qwen/Qwen3.5-9B"
    blob = json_lib.dumps(captured["messages"], ensure_ascii=False)
    assert "press_l" not in blob
    assert "warming" in blob


def test_speech_routes_fail_closed_without_vendor_config():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    transcribe = client.post(
        "/v1/speech/transcribe",
        files={"file": ("utterance.wav", b"RIFF", "audio/wav")},
    )
    speak = client.post("/v1/speech/speak", json={"text": "我在"})
    assert transcribe.status_code == 503
    assert speak.status_code == 503
    health = client.get("/healthz")
    assert health.json()["speech"] == "stub"


@pytest.mark.asyncio
async def test_transcribe_rejects_oversized_audio():
    from app.services.providers.speech import MAX_AUDIO_BYTES, transcribe

    with pytest.raises(ValueError):
        await transcribe(b"x" * (MAX_AUDIO_BYTES + 1))


def test_tts_rejects_json_error_payload():
    from types import SimpleNamespace

    from app.services.providers.speech import _require_audio

    with pytest.raises(ValueError):
        _require_audio(SimpleNamespace(headers={"content-type": "application/json"}, content=b'{"error":"no"}'))
    audio = _require_audio(SimpleNamespace(headers={"content-type": "audio/mpeg"}, content=b"ID3" + b"\x00" * 40))
    assert audio.startswith(b"ID3")


def test_fish_tts_payload_has_no_instruct():
    from app.services.providers.speech import tts_payload

    payload = tts_payload(
        "我在",
        model="fishaudio/fish-speech-1.5",
        voice="fishaudio/fish-speech-1.5:claire",
    )
    assert payload["model"] == "fishaudio/fish-speech-1.5"
    assert payload["voice"] == "fishaudio/fish-speech-1.5:claire"
    assert payload["input"] == "我在"
    assert "<|endofprompt|>" not in payload["input"]


def test_cosyvoice_tts_payload_wraps_instruct():
    from app.services.providers.speech import COSYVOICE_INSTRUCT, tts_payload

    payload = tts_payload(
        "我在",
        model="FunAudioLLM/CosyVoice2-0.5B",
        voice="FunAudioLLM/CosyVoice2-0.5B:claire",
    )
    assert payload["input"].startswith(COSYVOICE_INSTRUCT)
    assert payload["input"].endswith("我在")
    assert "<|endofprompt|>" in payload["input"]


def test_fish_billing_errors_fall_back_to_cosyvoice():
    from app.services.providers.speech import should_fallback_to_cosyvoice

    assert should_fallback_to_cosyvoice(402, "fishaudio/fish-speech-1.5")
    assert should_fallback_to_cosyvoice(403, "fishaudio/fish-speech-1.5")
    assert should_fallback_to_cosyvoice(404, "fishaudio/fish-speech-1.5")
    assert not should_fallback_to_cosyvoice(500, "fishaudio/fish-speech-1.5")
    assert not should_fallback_to_cosyvoice(402, "FunAudioLLM/CosyVoice2-0.5B")


@pytest.mark.asyncio
async def test_synthesize_falls_back_when_fish_returns_402(monkeypatch):
    import httpx

    from app.config import settings
    from app.services.providers import speech as speech_provider

    payloads = []

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self._calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers=None, json=None, params=None):
            payloads.append(json)
            self._calls += 1
            request = httpx.Request("POST", url)
            if self._calls == 1:
                return httpx.Response(
                    402,
                    headers={"content-type": "application/json"},
                    content=b'{"error":"balance"}',
                    request=request,
                )
            return httpx.Response(
                200,
                headers={"content-type": "audio/mpeg"},
                content=b"ID3" + b"\x00" * 40,
                request=request,
            )

    monkeypatch.setattr(settings, "tts_model", "fishaudio/fish-speech-1.5")
    monkeypatch.setattr(settings, "tts_voice", "fishaudio/fish-speech-1.5:claire")
    monkeypatch.setattr(settings, "tts_timeout_s", 1.0)
    monkeypatch.setattr(settings, "speech_api_key", "test")
    monkeypatch.setattr(settings, "speech_base_url", "https://api.siliconflow.cn/v1")
    monkeypatch.setattr(settings, "minimax_api_key", "")
    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    audio = await speech_provider.synthesize("我在")
    assert audio.startswith(b"ID3")
    assert payloads[0]["model"] == "fishaudio/fish-speech-1.5"
    assert payloads[0]["input"] == "我在"
    assert payloads[1]["model"] == "FunAudioLLM/CosyVoice2-0.5B"
    assert payloads[1]["voice"] == "FunAudioLLM/CosyVoice2-0.5B:claire"
    assert "<|endofprompt|>" in payloads[1]["input"]


def test_minimax_payload_uses_free_system_voice():
    from app.services.providers.speech import minimax_payload

    payload = minimax_payload("我在", model="speech-02-turbo", voice="female-tianmei")
    assert payload["model"] == "speech-02-turbo"
    assert payload["text"] == "我在"
    assert payload["voice_setting"]["voice_id"] == "female-tianmei"
    assert payload["stream"] is False
    assert "input" not in payload


def test_minimax_hex_audio_decodes_and_rejects_vendor_errors():
    from app.services.providers.speech import decode_minimax_audio

    audio = b"ID3" + b"\x00" * 40
    decoded = decode_minimax_audio({
        "data": {"audio": audio.hex(), "status": 2},
        "base_resp": {"status_code": 0, "status_msg": "success"},
    })
    assert decoded == audio
    with pytest.raises(ValueError):
        decode_minimax_audio({
            "data": {"audio": audio.hex()},
            "base_resp": {"status_code": 1004, "status_msg": "auth"},
        })


@pytest.mark.asyncio
async def test_synthesize_uses_minimax_t2a_when_configured(monkeypatch):
    import httpx

    from app.config import settings
    from app.services.providers import speech as speech_provider

    audio = b"ID3" + b"\x00" * 40
    captured = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers=None, json=None, params=None):
            captured["url"] = url
            captured["json"] = json
            captured["params"] = params
            request = httpx.Request("POST", url)
            return httpx.Response(
                200,
                json={
                    "data": {"audio": audio.hex(), "status": 2},
                    "base_resp": {"status_code": 0, "status_msg": "success"},
                },
                request=request,
            )

    monkeypatch.setattr(settings, "minimax_api_key", "test")
    monkeypatch.setattr(settings, "minimax_group_id", "g1")
    monkeypatch.setattr(settings, "minimax_base_url", "https://api.minimaxi.com")
    monkeypatch.setattr(settings, "tts_model", "speech-02-turbo")
    monkeypatch.setattr(settings, "tts_voice", "female-tianmei")
    monkeypatch.setattr(settings, "tts_timeout_s", 1.0)
    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    result = await speech_provider.synthesize("我在")
    assert result == audio
    assert captured["url"] == "https://api.minimaxi.com/v1/t2a_v2"
    assert captured["params"]["GroupId"] == "g1"
    assert captured["json"]["voice_setting"]["voice_id"] == "female-tianmei"
