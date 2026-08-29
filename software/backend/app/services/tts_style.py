"""Chat 每轮的念法。只进 TTS 参数，不进台词音频。"""

from __future__ import annotations

from typing import Literal

TtsStyle = Literal["温柔", "俏皮", "低语", "平静", "着急", "开心"]
TTS_STYLES: tuple[str, ...] = ("温柔", "俏皮", "低语", "平静", "着急", "开心")

STYLE_TO_MINIMAX = {
    "温柔": "calm",
    "平静": "calm",
    "俏皮": "happy",
    "开心": "happy",
    "低语": "whisper",
    "着急": "surprised",
}

STYLE_TO_MIMO_PROMPT = {
    "温柔": "温柔、偏慢、像贴着耳边说话，不要播音腔。",
    "俏皮": "轻快、带一点笑意，像在逗她，不要播音腔。",
    "低语": "很轻、贴近耳边，语速慢，不要播音腔。",
    "平静": "自然口语，平稳、不夸张，不要播音腔。",
    "着急": "气息更紧、语速略快，但仍是对人说话，不要喊。",
    "开心": "带着笑意、明亮一点，不要播音腔。",
}

_ALIASES = {
    "温柔": "温柔",
    "俏皮": "俏皮",
    "低语": "低语",
    "平静": "平静",
    "着急": "着急",
    "开心": "开心",
    "calm": "平静",
    "gentle": "温柔",
    "happy": "开心",
    "playful": "俏皮",
    "whisper": "低语",
    "surprised": "着急",
}


def normalize_tts_style(value: object | None) -> TtsStyle:
    raw = str(value or "").strip()
    if raw in TTS_STYLES:
        return raw  # type: ignore[return-value]
    mapped = _ALIASES.get(raw) or _ALIASES.get(raw.lower())
    if mapped in TTS_STYLES:
        return mapped  # type: ignore[return-value]
    return "平静"


def minimax_emotion_for_style(value: object | None) -> str:
    return STYLE_TO_MINIMAX[normalize_tts_style(value)]


def mimo_style_prompt(value: object | None) -> str:
    return STYLE_TO_MIMO_PROMPT[normalize_tts_style(value)]
