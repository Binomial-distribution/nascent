from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """运行配置。密钥只从环境变量或 .env 读，不进版本库。"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="NASCENT_")

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

    # 内容审核开关。默认开着——关掉它是个需要明确动作的决定，
    # 不该因为忘配环境变量而悄悄失效。
    moderation_enabled: bool = True


settings = Settings()
