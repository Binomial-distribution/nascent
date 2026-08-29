from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _env_files() -> tuple[Path, ...]:
    """部署约定 secrets/.env 优先；本机旧的 backend/.env 仍可作为回退。"""
    preferred = _BACKEND_ROOT / "secrets" / ".env"
    legacy = _BACKEND_ROOT / ".env"
    files: list[Path] = []
    if legacy.is_file():
        files.append(legacy)
    if preferred.is_file():
        files.append(preferred)
    return tuple(files) if files else (preferred,)


def normalize_llm_base_url(url: str) -> str:
    """Accept a vendor console URL, but always call the OpenAI-compatible root."""

    raw = str(url or "").strip().rstrip("/")
    if not raw:
        return ""
    host = raw.replace("https://", "").replace("http://", "").split("/")[0]
    if host in {"cloud.siliconflow.cn", "siliconflow.cn", "www.siliconflow.cn"}:
        return "https://api.siliconflow.cn/v1"
    if raw == "https://api.siliconflow.cn":
        return "https://api.siliconflow.cn/v1"
    return raw


class Settings(BaseSettings):
    """运行配置。密钥只从环境变量或 secrets/.env 读，不进版本库。"""

    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_prefix="NASCENT_",
        env_ignore_empty=False,
        extra="ignore",
    )

    debug: bool = False

    llm_api_key: str = ""
    llm_base_url: str = ""
    # 两个逻辑角色：nascent-chat-9b / nascent-control-9b。
    # HTTP model 字段发给供应商时使用下面的供应商 ID，不要填逻辑别名。
    llm_model: str = "Qwen/Qwen3.5-9B"
    chat_llm_model: str = "Qwen/Qwen3.5-9B"
    control_llm_model: str = "Qwen/Qwen3.5-9B"
    llm_timeout_s: float = 3.0
    chat_llm_timeout_s: float = 8.0
    control_llm_timeout_s: float = 2.5
    agent_prompt_version: str = "b-agent-v1"

    speech_api_key: str = ""
    speech_base_url: str = ""
    asr_model: str = "FunAudioLLM/SenseVoiceSmall"
    tts_model: str = "speech-02-turbo"
    tts_voice: str = "junlang_nanyou"
    asr_timeout_s: float = 8.0
    tts_timeout_s: float = 20.0
    minimax_api_key: str = ""
    minimax_group_id: str = ""
    minimax_base_url: str = "https://api.minimaxi.com"
    mimo_api_key: str = ""
    mimo_base_url: str = "https://api.xiaomimimo.com/v1"
    mimo_model: str = "mimo-v2.5-tts"
    tts_provider: str = "minimax"

    # 内容审核开关。默认开着——关掉它是个需要明确动作的决定，
    # 不该因为忘配环境变量而悄悄失效。
    moderation_enabled: bool = True

    @field_validator("llm_base_url", "speech_base_url", mode="before")
    @classmethod
    def _normalize_llm_base_url(cls, value: object) -> str:
        return normalize_llm_base_url(str(value or ""))

    @field_validator("tts_provider", mode="before")
    @classmethod
    def _normalize_tts_provider(cls, value: object) -> str:
        raw = str(value or "minimax").strip().lower()
        return raw if raw in {"minimax", "mimo"} else "minimax"

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key and self.llm_base_url)

    @property
    def resolved_speech_api_key(self) -> str:
        return self.speech_api_key or self.llm_api_key

    @property
    def resolved_speech_base_url(self) -> str:
        return self.speech_base_url or self.llm_base_url

    @property
    def speech_configured(self) -> bool:
        return bool(self.resolved_speech_api_key and self.resolved_speech_base_url)

    @property
    def minimax_configured(self) -> bool:
        return bool(self.minimax_api_key)

    @property
    def mimo_configured(self) -> bool:
        return bool(self.mimo_api_key)

    @property
    def tts_configured(self) -> bool:
        return self.minimax_configured or self.mimo_configured or self.speech_configured


settings = Settings()
