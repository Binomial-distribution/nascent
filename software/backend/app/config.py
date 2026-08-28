from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """运行配置。密钥只从环境变量或 .env 读，不进版本库。"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="NASCENT_")

    debug: bool = False

    llm_api_key: str = ""
    llm_base_url: str = ""
    # 两个逻辑角色可以先指向同一个 Qwen 9B 快照，部署时再拆副本。
    llm_model: str = "nascent-chat-9b"
    chat_llm_model: str = "nascent-chat-9b"
    control_llm_model: str = "nascent-control-9b"
    llm_timeout_s: float = 3.0
    agent_prompt_version: str = "b-agent-v1"

    # 内容审核开关。默认开着——关掉它是个需要明确动作的决定，
    # 不该因为忘配环境变量而悄悄失效。
    moderation_enabled: bool = True


settings = Settings()
